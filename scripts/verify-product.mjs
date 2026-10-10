import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import electron from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQaDirectory} from './qa-directory.mjs';
await build({entryPoints:['electron/main/product-fixture.ts'],outfile:'work/product-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['better-sqlite3']});
const env={...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_ENV:'test'};for(const k of Object.keys(env))if(k.startsWith('FOX_VERIFY_'))delete env[k];
const a=createQaDirectory('product-day'),b=createQaDirectory('product-day-restore');
const productionOnly=process.argv.includes('--production-only');
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const run=spawnSync(electron,['work/product-fixture.cjs',a,b,productionOnly?'production-only':'day',version],{env,windowsHide:true,stdio:'inherit',timeout:120000});assert.equal(run.status,0,'Isolated product acceptance failed');
if(productionOnly){
 const evidence=JSON.parse(fs.readFileSync(path.join(a,'production-db-result.json'),'utf8'));
 for(const target of [a,b]){
  const actual=fs.realpathSync.native(target),temp=fs.realpathSync.native(os.tmpdir()),relative=path.relative(temp,actual);
  const marker=JSON.parse(fs.readFileSync(path.join(actual,'.fox-qa.json'),'utf8'));
  if(relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(actual).startsWith('fox-qa-')||marker.version!==1||fs.realpathSync.native(marker.directory)!==actual||fs.lstatSync(target).isSymbolicLink())throw Error('Unsafe QA cleanup target');
  fs.rmSync(actual,{recursive:true});
 }
 fs.mkdirSync('work/ci-evidence',{recursive:true});fs.writeFileSync('work/ci-evidence/production-db-result.json',JSON.stringify({...evidence,temporaryDataRemoved:true},null,2));
}
