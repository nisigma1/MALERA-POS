import { spawnSync } from 'node:child_process';
import { createQaDirectory } from './qa-directory.mjs';
import electron from 'electron';
const directory = createQaDirectory('runtime');
const env = { ...process.env };
for(const key of Object.keys(env))if(key.startsWith('FOX_VERIFY_'))delete env[key];
env.FOX_VERIFY_DIR=directory;
delete env.ELECTRON_RUN_AS_NODE;
delete env.FOX_DEV_URL;
delete env.FOX_VERIFY_MANUAL;
delete env.FOX_VERIFY_ORDER_RESTART;
const result = spawnSync(electron, ['--force-device-scale-factor=1','.'], { stdio: 'inherit', env, timeout: 120000, windowsHide: true });
if (result.error) console.error(result.error);
if(result.status===0) {
  const restarted=spawnSync(electron,['--force-device-scale-factor=1','.'],{stdio:'inherit',env:{...env,FOX_VERIFY_ORDER_RESTART:'1'},timeout:120000,windowsHide:true});
  if(restarted.error)console.error(restarted.error);
  result.status=restarted.status;
}
console.log(`Isolated runtime verification files: ${directory}`);
process.exitCode = result.status ?? 1;
