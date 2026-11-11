import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  validateDescriptor,
  validateAssetUrl,
  verifyInstaller,
  selectRelease,
  APP_ID,
} from '../scripts/update/core.mjs';
const config = { repository: 'nisigma1/MALERA-POS', branch: 'main' };
const good = {
  ...config,
  formatVersion: 1,
  appId: APP_ID,
  platform: 'win32',
  arch: 'x64',
  channel: 'DESKTOP_QA',
  commit: 'a'.repeat(40),
  sha256: 'b'.repeat(64),
  version: '0.7.2-rc.4',
  artifact: 'FOX-Setup-0.7.2-rc.4-x64.exe',
  runId: 123,
  schemaVersion: 6,
  minUpdaterVersion: 1,
};
test('accepts only the configured application, repository and branch', () => {
  assert.equal(validateDescriptor(good, config), good);
  for (const [key, value] of Object.entries({
    repository: 'other/repo',
    branch: 'development',
    appId: 'other',
    arch: 'arm64',
    platform: 'linux',
    channel: 'PRODUCTION',
    commit: '../main',
    version: '../../exe',
    artifact: '../evil.exe',
    runId: '123',
    schemaVersion: 0,
    minUpdaterVersion: 2,
  }))
    assert.throws(() => validateDescriptor({ ...good, [key]: value }, config), key);
});
test('restricts downloads to HTTPS release assets from the configured repository', () => {
  assert.equal(
    validateAssetUrl(
      'https://github.com/nisigma1/MALERA-POS/releases/download/desktop-abc/file.exe',
      config.repository,
    ),
    'https://github.com/nisigma1/MALERA-POS/releases/download/desktop-abc/file.exe',
  );
  for (const url of [
    'http://github.com/nisigma1/MALERA-POS/releases/download/x/y',
    'https://github.com.evil.test/nisigma1/MALERA-POS/releases/download/x/y',
    'https://github.com/other/repo/releases/download/x/y',
    'https://user:pass@github.com/nisigma1/MALERA-POS/releases/download/x/y',
    'file:///C:/evil.exe',
  ])
    assert.throws(() => validateAssetUrl(url, config.repository));
});
test('rejects a corrupted or non-executable installer', () => {
  const bytes = Buffer.alloc(2048);
  bytes.write('MZ');
  const descriptor = { ...good, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  verifyInstaller(bytes, descriptor);
  bytes[8] = 42;
  assert.throws(() => verifyInstaller(bytes, descriptor));
  assert.throws(() => verifyInstaller(Buffer.from('MZ'), good));
});
test('never selects drafts, stable releases, replayed IDs or releases by another author', () => {
  const release = {
    id: 11,
    draft: false,
    prerelease: true,
    tag_name: `desktop-${'a'.repeat(40)}-123-1`,
    author: { login: 'github-actions[bot]' },
    assets: [{ name: 'desktop-update.json' }],
  };
  assert.deepEqual(selectRelease([release], { releaseId: 10 }), [release]);
  for (const value of [
    { ...release, draft: true },
    { ...release, prerelease: false },
    { ...release, id: 10 },
    { ...release, author: { login: 'someone' } },
    { ...release, tag_name: 'v1.0.0' },
  ])
    assert.deepEqual(selectRelease([value], { releaseId: 10 }), []);
});

test(
  'the scheduled check replaces a corrupt staged installer with a verified download',
  {
    skip: process.platform !== 'win32',
  },
  (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'malera-update-check-'));
    t.after(() => {
      assert.equal(path.dirname(home), os.tmpdir());
      assert.ok(path.basename(home).startsWith('malera-update-check-'));
      fs.rmSync(home, { recursive: true, force: true });
    });
    for (const name of ['client.mjs', 'core.mjs', 'launch-control.mjs'])
      fs.copyFileSync(new URL('../scripts/update/' + name, import.meta.url), path.join(home, name));
    const clean = Buffer.alloc(2048);
    clean.write('MZ');
    const descriptor = { ...good, sha256: crypto.createHash('sha256').update(clean).digest('hex') };
    const tag = `desktop-${descriptor.commit}-${descriptor.runId}-1`;
    const prefix = `https://github.com/${config.repository}/releases/download/${tag}/`;
    const api = `https://api.github.com/repos/${config.repository}`;
    const remote = {
      [api + '/releases?per_page=30']: [
        {
          id: 2,
          draft: false,
          prerelease: true,
          tag_name: tag,
          author: { login: 'github-actions[bot]' },
          assets: [
            { name: 'desktop-update.json', browser_download_url: prefix + 'desktop-update.json' },
            {
              name: descriptor.artifact,
              size: clean.length,
              browser_download_url: prefix + descriptor.artifact,
            },
          ],
        },
      ],
      [prefix + 'desktop-update.json']: descriptor,
      [api + '/actions/runs/' + descriptor.runId]: {
        status: 'completed',
        conclusion: 'success',
        head_sha: descriptor.commit,
        head_branch: config.branch,
        event: 'push',
        path: '.github/workflows/desktop-updates.yml',
        repository: { full_name: config.repository },
      },
      [api + '/compare/' + descriptor.commit + '...' + config.branch]: { status: 'identical' },
    };
    const installed = { commit: 'c'.repeat(40), releaseId: 1 };
    const write = (name, value) => fs.writeFileSync(path.join(home, name), JSON.stringify(value));
    const read = (name) => JSON.parse(fs.readFileSync(path.join(home, name), 'utf8'));
    write('config.json', { ...config, allowUnsignedQA: true });
    write('state.json', installed);
    write('pending.json', { descriptor, releaseId: 2 });
    fs.mkdirSync(path.join(home, 'downloads'));
    const installer = path.join(home, 'downloads', descriptor.commit + '.exe');
    const corrupt = Buffer.from(clean);
    corrupt[8] = 42;
    fs.writeFileSync(installer, corrupt);

    function check(downloadAvailable) {
      const runner = `
      const remote = ${JSON.stringify(remote)};
      globalThis.fetch = async (url) => {
        if (url === ${JSON.stringify(prefix + descriptor.artifact)})
          return ${downloadAvailable} ? new Response(Buffer.from(${JSON.stringify(clean.toString('base64'))}, 'base64'))
            : new Response(null, { status: 503 });
        if (!Object.hasOwn(remote, url)) throw Error('Unexpected URL: ' + url);
        return Response.json(remote[url]);
      };
      await import(${JSON.stringify(pathToFileURL(path.join(home, 'client.mjs')).href)});
    `;
      execFileSync(process.execPath, ['--input-type=module', '--eval', runner], {
        env: { ...process.env, APPDATA: home, LOCALAPPDATA: home },
        windowsHide: true,
        timeout: 10000,
      });
    }
    check(false);
    assert.equal(read('status.json').phase, 'check-failed');
    assert.equal(read('status.json').message, 'Installer download failed');
    assert.deepEqual(fs.readFileSync(installer), corrupt);

    check(true);
    assert.equal(read('status.json').phase, 'ready-for-next-launch');
    assert.deepEqual(fs.readFileSync(installer), clean);
    assert.deepEqual(read('pending.json').descriptor, descriptor);
    assert.deepEqual(read('state.json'), installed);
    assert.equal(fs.existsSync(installer + '.partial'), false);
  },
);
