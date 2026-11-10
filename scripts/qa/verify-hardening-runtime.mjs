import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';
import { createQaDirectory } from '../lib/qa-directory.mjs';
const directory = createQaDirectory('hardening-runtime'),
  env = { ...process.env };
for (const key of Object.keys(env))
  if (key.startsWith('FOX_VERIFY_') || key === 'ELECTRON_RUN_AS_NODE' || key === 'FOX_DEV_URL')
    delete env[key];
Object.assign(env, { FOX_VERIFY_DIR: directory, FOX_VERIFY_HARDENING: '1' });
const result = spawnSync(electron, ['--force-device-scale-factor=1', '.'], {
  env,
  windowsHide: true,
  stdio: 'inherit',
  timeout: 90000,
});
if (result.status !== 0) throw Error('Native hardening runtime failed: ' + result.error?.message);
const file = path.join(directory, 'hardening-result.json');
for (let i = 0; i < 600 && !fs.existsSync(file); i++)
  await new Promise((resolve) => setTimeout(resolve, 50));
if (!fs.existsSync(file) || !JSON.parse(fs.readFileSync(file)).passed)
  throw Error('Actual restore relaunch did not pass');
console.log('Native backup/restore/relaunch evidence: ' + directory);
