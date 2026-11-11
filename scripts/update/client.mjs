// Per-user update broker. Scheduled checks only stage files. Installation happens
// through the desktop launcher, before starting the POS, and never kills the POS.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { validateDescriptor, validateAssetUrl, selectRelease } from './core.mjs';
import { withBrokerLock } from './launch-control.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  fs.readFileSync(path.join(home, 'config.json'), 'utf8').replace(/^\uFEFF/, ''),
);
const stateFile = path.join(home, 'state.json'),
  pendingFile = path.join(home, 'pending.json');
const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
};
const write = (file, value) => {
  const next = file + '.next';
  fs.writeFileSync(next, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(next, file);
};
const state = {};
const status = (phase, extra = {}) =>
  write(path.join(home, 'status.json'), {
    phase,
    checkedAt: new Date().toISOString(),
    branch: config.branch,
    ...extra,
  });
const launch = process.argv.includes('--launch');
if (process.argv.includes('--status')) {
  console.log(JSON.stringify(read(path.join(home, 'status.json'), {}), null, 2));
  process.exit(0);
}
if (process.platform !== 'win32') throw Error('Windows update client required');
if (
  !/^[\w.-]+\/[\w.-]+$/.test(config.repository) ||
  typeof config.branch !== 'string' ||
  !config.branch ||
  config.allowUnsignedQA !== true
)
  throw Error('Invalid update configuration');
const executable = path.join(
  process.env.LOCALAPPDATA,
  'Programs',
  'FOX Kafeteri',
  'FOX Kafeteri.exe',
);
const profile = path.join(process.env.APPDATA, 'FOX Kafeteri');
const headers = { 'User-Agent': 'MALERA-Desktop-Updater/1', Accept: 'application/vnd.github+json' };

async function json(url, limit = 4000000) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`GitHub request failed (${response.status})`);
  const text = await response.text();
  if (Buffer.byteLength(text) > limit) throw Error('Update metadata too large');
  return JSON.parse(text);
}
function appRunning() {
  const code =
    '$target=' +
    "'" +
    executable.replaceAll("'", "''") +
    "'; @((Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Equals($target,[StringComparison]::OrdinalIgnoreCase) })).Count";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  });
  if (result.status !== 0 || !/^\d+$/.test(result.stdout.trim()))
    throw Error('Cannot determine whether POS is closed');
  return Number(result.stdout.trim()) > 0;
}
class InvalidInstallerContent extends Error {}

async function verifyFile(file, descriptor) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Invalid installer file');
  if (stat.size < 1024 || stat.size > 300 * 1024 * 1024)
    throw new InvalidInstallerContent('Invalid installer size');
  const handle = fs.openSync(file, 'r');
  const magic = Buffer.alloc(2);
  try {
    fs.readSync(handle, magic, 0, 2, 0);
  } finally {
    fs.closeSync(handle);
  }
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  if (magic.toString() !== 'MZ' || hash.digest('hex') !== descriptor.sha256)
    throw new InvalidInstallerContent('Installer integrity check failed');
}
async function stage() {
  const previousStage = read(pendingFile, null);
  if (previousStage?.descriptor?.commit === state.commit) fs.unlinkSync(pendingFile);
  const releases = selectRelease(
    await json(`https://api.github.com/repos/${config.repository}/releases?per_page=30`),
    state,
  );
  for (const release of releases) {
    const meta = release.assets.find((a) => a.name === 'desktop-update.json');
    const descriptor = await json(
      validateAssetUrl(meta.browser_download_url, config.repository),
      16000,
    );
    if (descriptor.branch !== config.branch) continue;
    validateDescriptor(descriptor, config);
    if (!release.tag_name.startsWith(`desktop-${descriptor.commit}-${descriptor.runId}-`))
      throw Error('Release tag does not match descriptor');
    if (descriptor.commit === state.commit) {
      state.releaseId = release.id;
      write(stateFile, state);
      return;
    }
    const run = await json(
      `https://api.github.com/repos/${config.repository}/actions/runs/${descriptor.runId}`,
    );
    if (run.status !== 'completed' || run.conclusion !== 'success') continue;
    if (
      run.head_sha !== descriptor.commit ||
      run.head_branch !== config.branch ||
      run.event !== 'push' ||
      run.path !== '.github/workflows/desktop-updates.yml' ||
      run.repository?.full_name !== config.repository
    )
      throw Error('Update did not come from the configured passing push workflow');
    const comparison = await json(
      `https://api.github.com/repos/${config.repository}/compare/${descriptor.commit}...${encodeURIComponent(config.branch)}`,
    );
    if (!['ahead', 'identical'].includes(comparison.status)) continue;
    const asset = release.assets.find((a) => a.name === descriptor.artifact);
    if (!asset || asset.size < 1024 || asset.size > 300 * 1024 * 1024)
      throw Error('Installer asset missing or too large');
    const installer = path.join(home, 'downloads', descriptor.commit + '.exe');
    fs.mkdirSync(path.dirname(installer), { recursive: true });
    const pending = read(pendingFile, null);
    if (pending?.descriptor?.commit === descriptor.commit && fs.existsSync(installer)) {
      try {
        await verifyFile(installer, descriptor);
        return;
      } catch (error) {
        if (!(error instanceof InvalidInstallerContent)) throw error;
        // Keep the staged file in place until its replacement has been verified.
      }
    }
    const response = await fetch(validateAssetUrl(asset.browser_download_url, config.repository), {
      headers,
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok || !response.body) throw Error('Installer download failed');
    const temporary = installer + '.partial';
    let received = 0;
    async function* bounded(stream) {
      for await (const bytes of stream) {
        received += bytes.length;
        if (received > asset.size || received > 300 * 1024 * 1024)
          throw Error('Oversized installer');
        yield bytes;
      }
    }
    try {
      await pipeline(
        bounded(Readable.fromWeb(response.body)),
        fs.createWriteStream(temporary, { flags: 'w' }),
      );
      if (received !== asset.size) throw Error('Incomplete installer');
      await verifyFile(temporary, descriptor);
      fs.renameSync(temporary, installer);
      write(pendingFile, {
        descriptor,
        releaseId: release.id,
        downloadedAt: new Date().toISOString(),
      });
      status('ready-for-next-launch', { commit: descriptor.commit });
      return;
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  status(read(pendingFile, null) ? 'ready-for-next-launch' : 'up-to-date', {
    commit: state.commit ?? null,
  });
}
async function backup(descriptor) {
  const database = path.join(profile, 'fox.sqlite');
  if (!fs.existsSync(database)) {
    if (fs.existsSync(path.join(profile, 'fox-data-identity.json')))
      throw Error('Existing business database is missing; update refused');
    return null;
  }
  const folder = path.join(home, 'backups');
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(
    folder,
    `FOX-before-update-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.sqlite`,
  );
  const modulePath = path.join(
    path.dirname(executable),
    'resources',
    'app.asar',
    'node_modules',
    'better-sqlite3',
  );
  const code = `(async()=>{const fs=require('fs'),crypto=require('crypto'),DB=require(${JSON.stringify(modulePath)});const source=new DB(${JSON.stringify(database)},{readonly:true,fileMustExist:true});try{await source.backup(${JSON.stringify(target)});}finally{source.close();}const copy=new DB(${JSON.stringify(target)},{readonly:true,fileMustExist:true});try{if(copy.pragma('integrity_check',{simple:true})!=='ok'||copy.pragma('foreign_key_check').length)throw Error('Backup integrity failed');const schemaVersion=copy.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;if(schemaVersion>${descriptor.schemaVersion})throw Error('Schema downgrade refused');const hash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(${JSON.stringify(target)}))hash.update(bytes);const metadata={format:'FOX_SQLITE_BACKUP',formatVersion:1,createdAt:new Date().toISOString(),applicationVersion:${JSON.stringify(state.version ?? '0.7.2-rc.4')},schemaVersion,sha256:hash.digest('hex'),kind:'MANUAL'};fs.writeFileSync(${JSON.stringify(target + '.json')},JSON.stringify(metadata,null,2),{flag:'wx'});}finally{copy.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});`;
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  for (const key of Object.keys(env))
    if (key.startsWith('FOX_VERIFY_') || key === 'FOX_DEV_URL') delete env[key];
  const result = spawnSync(executable, ['-e', code], {
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
  });
  if (result.status !== 0) throw Error('Pre-update database backup failed; installation refused');
  return target;
}
async function apply() {
  const pending = read(pendingFile, null);
  if (!pending) return;
  if (appRunning()) return;
  const descriptor = validateDescriptor(pending.descriptor, config);
  if (descriptor.commit === state.commit) {
    fs.unlinkSync(pendingFile);
    return;
  }
  const installer = path.join(home, 'downloads', descriptor.commit + '.exe');
  await verifyFile(installer, descriptor);
  const backupPath = await backup(descriptor);
  if (appRunning()) {
    status('waiting-for-app-to-close', { commit: descriptor.commit });
    return;
  }
  status('installing', { commit: descriptor.commit, backupPath });
  const notice = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$shell=New-Object -ComObject WScript.Shell; $null=$shell.Popup('MALERA POS po perditesohet. Do te hapet automatikisht; ju lutem prisni.',5,'MALERA POS',64)",
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  notice.on('error', () => {});
  notice.unref();
  const result = spawnSync(installer, ['/currentuser', '/S'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 180000,
  });
  if (result.status !== 0 || !fs.existsSync(executable))
    throw Error('Installer failed; backup preserved. See update logs before reopening');
  const installedStamp = JSON.parse(
    fs.readFileSync(path.join(path.dirname(executable), 'resources', 'fox-release.json'), 'utf8'),
  );
  if (
    installedStamp.sourceCommit !== descriptor.commit ||
    installedStamp.version !== descriptor.version
  )
    throw Error('Installed files do not match the downloaded source commit; backup preserved');
  const unpack = path.join(
    path.dirname(executable),
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'prebuilds',
    'win32-x64.node',
  );
  if (!fs.existsSync(unpack))
    throw Error('Updated application native module missing; backup preserved');
  Object.assign(state, {
    commit: descriptor.commit,
    version: descriptor.version,
    releaseId: pending.releaseId,
    installedAt: new Date().toISOString(),
    backupPath,
  });
  write(stateFile, state);
  fs.unlinkSync(pendingFile);
  refreshShortcuts();
  status('updated', { commit: state.commit, version: state.version, backupPath });
}
function refreshShortcuts() {
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  const script = `$ErrorActionPreference='Stop';$shell=New-Object -ComObject WScript.Shell;$app=${quote(executable)};$launcher=${quote(path.join(home, 'launch.vbs'))};$roots=@([Environment]::GetFolderPath('Desktop'),(Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'));foreach($root in $roots){Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse | ForEach-Object {$link=$shell.CreateShortcut($_.FullName);if($link.TargetPath -eq $app){$link.TargetPath=Join-Path $env:WINDIR 'System32\\wscript.exe';$link.Arguments='"'+$launcher+'"';$link.WorkingDirectory=${quote(home)};$link.IconLocation=$app+',0';$link.Save()}}}`;
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, encoding: 'utf8', timeout: 20000 },
  );
  if (result.status !== 0) throw Error('App updated, but update shortcuts need repair');
}
function startApp() {
  if (!fs.existsSync(executable)) throw Error('MALERA executable is missing');
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith('FOX_VERIFY_') || ['ELECTRON_RUN_AS_NODE', 'FOX_DEV_URL'].includes(key))
      delete env[key];
  const child = spawn(executable, [], { detached: true, stdio: 'ignore', env, windowsHide: false });
  child.unref();
}
const lockFile = path.join(home, 'update.lock');
try {
  await withBrokerLock({
    lockFile,
    stateFile,
    mode: launch ? 'launch' : 'check',
    onBusy: (owner) => {
      if (launch && owner.mode === 'check') startApp();
    },
    work: async (currentState) => {
      Object.assign(state, currentState);
      if (!launch) {
        try {
          await stage();
        } catch (error) {
          status('check-failed', { message: error.message, currentVersion: state.version ?? null });
        }
        return;
      }
      // Opening the POS never waits for network calls or downloads. Only the
      // scheduled checker stages new releases; launch applies an existing stage.
      await apply();
      startApp();
    },
  });
} catch (error) {
  status('error', { message: error.message });
  console.error(error.message);
  process.exitCode = 1;
}
