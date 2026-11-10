// Narrow upstream SQLite Windows recovery backport. Never accept another source
// version or download a prebuilt binary that bypasses the corrected VFS.
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const patch=JSON.parse(fs.readFileSync('patches/sqlite-windows-shm-recovery.json','utf8'));
assert.equal(JSON.parse(fs.readFileSync('node_modules/better-sqlite3/package.json','utf8')).version,patch.packageVersion);
const filename='node_modules/better-sqlite3/deps/sqlite3/sqlite3.c',hash=s=>crypto.createHash('sha256').update(s).digest('hex');
let source=fs.readFileSync(filename,'utf8');
if(hash(source)!==patch.sourceSha256After){
 assert.equal(hash(source),patch.sourceSha256Before,'Unknown SQLite source; refuse patch');
 assert.equal(source.split(patch.anchor).length,2);assert.equal(source.split(patch.before).length,2);
 source=source.replace(patch.anchor,patch.helper+patch.anchor).replace(patch.before,patch.after);
 assert.equal(hash(source),patch.sourceSha256After);fs.writeFileSync(filename,source);
}
console.log(JSON.stringify({sqliteRecoveryBackport:patch.fossilCommit,sourceSha256:hash(source),buildFromSource:true}));
const prebuild=`node_modules/better-sqlite3/prebuilds/${process.platform}-${process.arch}.node`,saved=prebuild+'.fox-original';
assert.ok(!fs.existsSync(saved),'Interrupted native build requires inspection');
const hadPrebuild=fs.existsSync(prebuild);if(hadPrebuild)fs.renameSync(prebuild,saved);
const r=spawnSync(process.execPath,['node_modules/@electron/rebuild/lib/cli.js','-f','-w','better-sqlite3','--build-from-source'],{stdio:'inherit',windowsHide:true});
try{if(r.error||r.status!==0){if(hadPrebuild)fs.renameSync(saved,prebuild);if(r.error)throw r.error;process.exitCode=r.status??1;}else{
 const built='node_modules/better-sqlite3/build/Release/better_sqlite3.node';assert.ok(fs.existsSync(built),'Corrected native addon missing');fs.copyFileSync(built,prebuild);if(hadPrebuild)fs.unlinkSync(saved);assert.equal(hash(fs.readFileSync(prebuild)),hash(fs.readFileSync(built)));console.log(JSON.stringify({nativeSha256:hash(fs.readFileSync(prebuild)),prebuiltDownloadBypassed:true}));
}}catch(error){if(fs.existsSync(saved)){if(fs.existsSync(prebuild))fs.unlinkSync(prebuild);fs.renameSync(saved,prebuild);}throw error;}
