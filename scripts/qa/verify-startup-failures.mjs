import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import electron from 'electron';
import assert from 'node:assert/strict';
import {createQaDirectory} from '../lib/qa-directory.mjs';
const evidence=[];
// Independent trials: every trial must pass; never retry a failed assertion.
for(let trial=0;trial<(process.argv.includes('--stress')?10:1);trial++){
for(const kind of ['empty','corrupt','foreign','missing-existing','inaccessible-directory']){
 const directory=createQaDirectory('startup-failure-'+kind),file=path.join(directory,'fox.sqlite');
 if(kind==='empty')fs.writeFileSync(file,'');
 if(kind==='corrupt')fs.writeFileSync(file,Buffer.alloc(4096,17));
 if(kind==='foreign'){
  const created=spawnSync(electron,['-e',`const DB=require('better-sqlite3');const db=new DB(process.argv[1]);db.exec('CREATE TABLE foreign_data(value TEXT)');db.close();`,file],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,encoding:'utf8'});assert.equal(created.status,0,created.stderr);
 }
 if(kind==='missing-existing')fs.writeFileSync(path.join(directory,'fox-data-identity.json'),JSON.stringify({format:1,product:'FOX Kafeteri'}));
 if(kind==='inaccessible-directory')fs.mkdirSync(file);
 const before=fs.existsSync(file)&&fs.statSync(file).isFile()?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('FOX_VERIFY_')||key==='ELECTRON_RUN_AS_NODE'||key==='FOX_DEV_URL')delete env[key];Object.assign(env,{FOX_VERIFY_DIR:directory,FOX_VERIFY_MANUAL:'1'});
 const result=spawnSync(electron,['.'],{env,windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(result.status,1,`Startup must fail closed for ${kind}`);
 if(before!==null)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before);else if(kind==='missing-existing')assert.equal(fs.existsSync(file),false);
 const item={kind,trial,passed:true,noSilentReset:true,directory};evidence.push(item);fs.writeFileSync(path.join(directory,'startup-result.json'),JSON.stringify(item));
}
}
console.log(JSON.stringify(evidence,null,2));
