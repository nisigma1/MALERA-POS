import fs from 'node:fs';
import {validateDescriptor} from './core.mjs';
const manifest=JSON.parse(fs.readFileSync('release/release-manifest.json','utf8').replace(/^\uFEFF/,''));
if(manifest.commit!==process.env.GITHUB_SHA || manifest.channel!=='QA' || manifest.databaseBundled!==false)throw Error('Release provenance mismatch');
const descriptor={formatVersion:1,repository:process.env.GITHUB_REPOSITORY,branch:process.env.GITHUB_REF_NAME,
  commit:manifest.commit,version:manifest.version,artifact:manifest.artifact,sha256:manifest.sha256,
  appId:manifest.appId,platform:manifest.platform,arch:manifest.arch,channel:'DESKTOP_QA',
  schemaVersion:manifest.schemaVersion,runId:Number(process.env.GITHUB_RUN_ID),minUpdaterVersion:1};
validateDescriptor(descriptor,descriptor);
fs.writeFileSync('release/desktop-update.json',JSON.stringify(descriptor,null,2)+'\n');
