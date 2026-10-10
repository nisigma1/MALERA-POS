import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import electron from 'electron';
import assert from 'node:assert/strict';
import {createQaDirectory} from './qa-directory.mjs';
await build({entryPoints:['electron/main/product-fixture.ts'],outfile:'work/product-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['better-sqlite3']});
const env={...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_ENV:'test'};for(const k of Object.keys(env))if(k.startsWith('FOX_VERIFY_'))delete env[k];
const a=createQaDirectory('product-day'),b=createQaDirectory('product-day-restore');
const run=spawnSync(electron,['work/product-fixture.cjs',a,b,process.argv.includes('--production-only')?'production-only':'day'],{env,windowsHide:true,stdio:'inherit',timeout:120000});assert.equal(run.status,0,'Isolated product acceptance failed');
