import {build} from 'esbuild';
import {spawn,spawnSync} from 'node:child_process';
import electron from 'electron';
import {createQaDirectory} from './qa-directory.mjs';
import assert from 'node:assert/strict';
const directory=createQaDirectory('receipt-crashes');
await build({entryPoints:['electron/main/receipt-crash-fixture.ts'],outfile:'work/receipt-crash-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['better-sqlite3']});
const env={...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_ENV:'test'};for(const key of Object.keys(env))if(key.startsWith('FOX_VERIFY_'))delete env[key];
for(const phase of ['pending','submitting']){
 const child=spawn(electron,['work/receipt-crash-fixture.cjs',directory,phase],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Crash fixture timeout')),20000);let text='';child.stdout.on('data',b=>{text+=b;if(text.includes(phase.toUpperCase()+'_READY')){clearTimeout(timer);resolve();}});child.stderr.on('data',b=>process.stderr.write(b));child.on('exit',code=>{clearTimeout(timer);reject(Error('Fixture exited early '+code));});});
 const killed=spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,encoding:'utf8'});assert.equal(killed.status,0,killed.stderr);
 if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>child.once('exit',resolve));
 const recovered=spawnSync(electron,['work/receipt-crash-fixture.cjs',directory,'recover-'+phase],{env,windowsHide:true,stdio:'inherit',timeout:30000});assert.equal(recovered.status,0);
}
console.log('Real process kill/restart outbox evidence: '+directory);
