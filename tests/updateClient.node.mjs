import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {validateDescriptor,validateAssetUrl,verifyInstaller,selectRelease,APP_ID} from '../scripts/update/core.mjs';
const config={repository:'nisigma1/MALERA-POS',branch:'codex/duo-hp'};
const good={...config,formatVersion:1,appId:APP_ID,platform:'win32',arch:'x64',channel:'DESKTOP_QA',commit:'a'.repeat(40),sha256:'b'.repeat(64),version:'0.7.2-rc.4',artifact:'FOX-Setup-0.7.2-rc.4-x64.exe',runId:123,schemaVersion:6,minUpdaterVersion:1};
test('accepts only the configured application, repository and branch',()=>{
 assert.equal(validateDescriptor(good,config),good);
 for(const [key,value]of Object.entries({repository:'other/repo',branch:'main',appId:'other',arch:'arm64',platform:'linux',channel:'PRODUCTION',commit:'../main',version:'../../exe',artifact:'../evil.exe',runId:'123',schemaVersion:0,minUpdaterVersion:2}))assert.throws(()=>validateDescriptor({...good,[key]:value},config),key);
});
test('restricts downloads to HTTPS release assets from the configured repository',()=>{
 assert.equal(validateAssetUrl('https://github.com/nisigma1/MALERA-POS/releases/download/desktop-abc/file.exe',config.repository),'https://github.com/nisigma1/MALERA-POS/releases/download/desktop-abc/file.exe');
 for(const url of ['http://github.com/nisigma1/MALERA-POS/releases/download/x/y','https://github.com.evil.test/nisigma1/MALERA-POS/releases/download/x/y','https://github.com/other/repo/releases/download/x/y','https://user:pass@github.com/nisigma1/MALERA-POS/releases/download/x/y','file:///C:/evil.exe'])assert.throws(()=>validateAssetUrl(url,config.repository));
});
test('rejects a corrupted or non-executable installer',()=>{
 const bytes=Buffer.alloc(2048);bytes.write('MZ');const descriptor={...good,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 verifyInstaller(bytes,descriptor);bytes[8]=42;assert.throws(()=>verifyInstaller(bytes,descriptor));assert.throws(()=>verifyInstaller(Buffer.from('MZ'),good));
});
test('never selects drafts, stable releases, replayed IDs or releases by another author',()=>{
 const release={id:11,draft:false,prerelease:true,tag_name:`desktop-${'a'.repeat(40)}-123-1`,author:{login:'github-actions[bot]'},assets:[{name:'desktop-update.json'}]};
 assert.deepEqual(selectRelease([release],{releaseId:10}),[release]);
 for(const value of [{...release,draft:true},{...release,prerelease:false},{...release,id:10},{...release,author:{login:'someone'}},{...release,tag_name:'v1.0.0'}])assert.deepEqual(selectRelease([value],{releaseId:10}),[]);
});
