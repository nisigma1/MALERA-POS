import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import electron from 'electron';
import { createQaDirectory } from '../lib/qa-directory.mjs';
assert.equal(process.platform, 'win32', 'Native Windows regression requires Windows');
const directory = createQaDirectory('phase10-mapped-shm'),
  mode = process.argv.includes('--expect-unpatched') ? 'unpatched' : 'patched';
const moduleArgument = process.argv.find((v) => v.startsWith('--module=')),
  modulePath = moduleArgument
    ? path.resolve(moduleArgument.slice(9))
    : path.resolve('node_modules/better-sqlite3');
const entry = path.join(directory, 'fixture.cjs');
await build({
  entryPoints: ['scripts/fixtures/windows-shm-fixture.ts'],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['better-sqlite3'],
});
// The owned fixture sits outside node_modules; use the installed ABI-matched module explicitly.
fs.writeFileSync(
  entry,
  fs
    .readFileSync(entry, 'utf8')
    .replaceAll('require("better-sqlite3")', `require(${JSON.stringify(modulePath)})`),
);
const runtime = typeof electron === 'string' ? electron : process.execPath;
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'test' };
const run = (m) => {
  const r = spawnSync(runtime, [entry, directory, m], {
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null;
};
run('prepare');
assert.ok(fs.existsSync(path.join(directory, 'fox.sqlite-shm')));
const mapper = spawn(
  'powershell.exe',
  [
    '-NoProfile',
    '-File',
    'scripts/windows/hold-windows-shm.ps1',
    '-File',
    path.join(directory, 'fox.sqlite-shm'),
  ],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
);
let errors = '';
mapper.stderr.on('data', (b) => (errors += b));
try {
  await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(
      () => reject(Error('Owned mapping readiness deadline ' + errors)),
      10000,
    );
    mapper.stdout.on('data', (b) => {
      text += b;
      if (text.includes('{"ready":true}')) {
        clearTimeout(timer);
        resolve();
      }
    });
    mapper.once('exit', (code) => {
      clearTimeout(timer);
      reject(Error('Mapper exited ' + code + ' ' + errors));
    });
  });
  const result = run(mode);
  fs.mkdirSync('outputs', { recursive: true });
  fs.writeFileSync(
    `outputs/fox-phase10-windows-shm-${mode}.json`,
    JSON.stringify(
      {
        ...result,
        mode,
        moduleType: moduleArgument ? 'INSTALLED' : 'SOURCE',
        externalMappingHeld: true,
        ownerDataUsed: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(result));
} finally {
  mapper.stdin.end('\n');
  if (mapper.exitCode === null) await new Promise((resolve) => mapper.once('exit', resolve));
}
if (mode === 'unpatched') run('patched');
