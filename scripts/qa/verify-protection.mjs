import {build} from 'esbuild';
import {spawn,spawnSync} from 'node:child_process';
import electron from 'electron';
import {createQaDirectory} from '../lib/qa-directory.mjs';
import assert from 'node:assert/strict';
const env={...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_ENV:'test'};for(const key of Object.keys(env))if(key.startsWith('FOX_VERIFY_'))delete env[key];
await build({entryPoints:['electron/main/protection-fixture.ts'],outfile:'work/protection-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['better-sqlite3']});
const directory=createQaDirectory('large-protection');
const large=spawnSync(electron,['work/protection-fixture.cjs',directory,'large'],{env,windowsHide:true,stdio:'inherit',timeout:120000});assert.equal(large.status,0,large.error?.message);console.log('Large DB and disaster drill: '+directory);
for(const phase of ['idle','open','quantity','sale','settings','backup','restore']){
 const directory=createQaDirectory('protection-crash-'+phase);
 const child=spawn(electron,['work/protection-fixture.cjs',directory,phase],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Crash fixture timeout')),20000);let output='';child.stdout.on('data',b=>{output+=b;if(output.includes(phase.toUpperCase()+'_READY')){clearTimeout(timer);resolve();}});child.stderr.on('data',b=>process.stderr.write(b));child.on('exit',code=>{clearTimeout(timer);reject(Error('Early fixture exit '+code));});});
 const killed=spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,encoding:'utf8'});assert.equal(killed.status,0,killed.stderr);if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>child.once('exit',resolve));
 const recovered=spawnSync(electron,['work/protection-fixture.cjs',directory,'recover-'+phase],{env,windowsHide:true,stdio:'inherit',timeout:30000});assert.equal(recovered.status,0);console.log(`Crash ${phase}: ${directory}`);
}
