// Use Electron's Node runtime so tests and the application share the native SQLite ABI.
import { spawnSync } from 'node:child_process';
import electron from 'electron';
// The supported 8GB operator laptop must remain usable during certification.
// Cap independent test workers instead of changing assertions or deadlines.
const result = spawnSync(
  electron,
  ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=1', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', ELECTRON_RUN_AS_NODE: '1' },
  },
);
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
