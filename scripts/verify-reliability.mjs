import {build} from 'esbuild';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import electron from 'electron';
import {createQaDirectory} from './qa-directory.mjs';
await build({entryPoints:['scripts/reliability-fixture.ts'],outfile:'work/reliability-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['better-sqlite3']});
const env={...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_ENV:'test'};for(const key of Object.keys(env))if(key.startsWith('FOX_VERIFY_'))delete env[key];
const run=(args,timeout=60000)=>{const r=spawnSync(electron,['work/reliability-fixture.cjs',...args],{env,windowsHide:true,encoding:'utf8',timeout});assert.equal(r.status,0,r.error?.message??r.stderr);return r.stdout.trim().split('\n').filter(l=>l.startsWith('{')).map(JSON.parse).at(-1);};
if(process.argv.includes('--long')){const resume=process.argv.find(a=>a.startsWith('--resume='));const d=resume?path.resolve(resume.slice(9)):createQaDirectory('phase10-long');const r=run([d,'long',process.argv.includes('--100k')?'100000':'10000'],1800000);console.log(JSON.stringify(r));process.exit(0);}
if(process.argv.includes('--golden')){const d=createQaDirectory('phase10-golden');console.log(JSON.stringify(run([d,'golden'])));process.exit(0);}
if(process.argv.includes('--latency')){const source=process.argv.find(a=>a.startsWith('--source='))?.slice(9);const d=createQaDirectory('phase10-latency');console.log(JSON.stringify(run([d,'latency',...(source?[path.resolve(source)]:[])],300000)));process.exit(0);}
const results=[];
for(const action of ['checkout','expense','loss','supply','movement','reservation','close','backup','restore'])for(const stage of action==='restore'?['SAFETY_BACKUP','ORIGINAL_RENAMED','CANDIDATE_RENAMED','postcommit']:['precommit','postcommit']){
 const d=createQaDirectory('phase10-crash'),before=run([d,'prepare',action]);const child=spawn(electron,['work/reliability-fixture.cjs',d,'crash',action,stage],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);
 let ready;try{ready=await new Promise((resolve,reject)=>{let output='';const deadline=setTimeout(()=>reject(Error('Owned crash fixture did not reach barrier')),20000);child.stdout.on('data',b=>{output+=b;const line=output.split('\n').find(l=>l.startsWith('{')&&l.endsWith('}'));if(line){clearTimeout(deadline);resolve(JSON.parse(line));}});child.once('exit',code=>{clearTimeout(deadline);reject(Error('Early fixture exit '+code+' '+errors));});});}finally{if(child.exitCode===null){const kill=spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,encoding:'utf8'});assert.equal(kill.status,0,kill.stderr);if(child.exitCode===null)await new Promise(r=>child.once('exit',r));}}
 const recovered=run([d,'recover',action,stage]);assert.equal(recovered.hash,stage==='postcommit'?ready.hash:before.hash);if(action==='restore'&&stage==='postcommit')assert.equal(recovered.hash,before.restoreHash);results.push({action,stage,passed:true,rollback:stage!=='postcommit',safeRetry:stage==='postcommit'&&!['backup','restore'].includes(action),continued:recovered.continued??false,hash:recovered.hash});console.log(JSON.stringify(results.at(-1)));
}
fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync(path.resolve('outputs/fox-phase10-crash-matrix.json'),JSON.stringify({passed:true,processKills:results.length,results,isolated:true},null,2));
