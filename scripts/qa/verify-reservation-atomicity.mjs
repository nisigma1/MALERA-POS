import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import electron from 'electron';
import { createQaDirectory } from '../lib/qa-directory.mjs';
await build({
  entryPoints: ['electron/verification/reservation-crash-fixture.ts'],
  outfile: 'work/reservation-crash-fixture.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['better-sqlite3'],
});
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  results = [];
for (const key of Object.keys(env))
  if (key.startsWith('FOX_VERIFY_') || key === 'NODE_ENV' || key === 'VITEST') delete env[key];
for (const stage of ['before', 'after']) {
  const directory = createQaDirectory('reservation-atomicity-' + stage);
  const run = (mode) => {
    const r = spawnSync(electron, ['work/reservation-crash-fixture.cjs', directory, mode], {
      env,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  run('prepare');
  const child = spawn(electron, ['work/reservation-crash-fixture.cjs', directory, stage], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Atomicity barrier timeout')), 20000);
      let log = '';
      child.stdout.on('data', (b) => {
        log += b;
        if (log.includes('CERTIFICATION_READY')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        reject(Error('Atomicity child exited before barrier: ' + code));
      });
      child.stderr.on('data', () => {});
    });
    const marker = JSON.parse(fs.readFileSync(path.join(directory, '.fox-qa.json')));
    assert.equal(fs.realpathSync.native(marker.directory), fs.realpathSync.native(directory));
    const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(killed.status, 0, killed.stderr);
    results.push(JSON.parse(run('inspect-' + stage)));
  } finally {
    if (child.exitCode === null) child.kill();
  }
}
const output = path.resolve('outputs/fox-phase9-3-reservation-atomicity.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ passed: true, isolated: true, results }, null, 2));
console.log(JSON.stringify({ passed: true, stages: results.length, output }));
