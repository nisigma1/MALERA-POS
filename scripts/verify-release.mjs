import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const version = process.argv[2] || pkg.version;
if(version!==pkg.version)throw Error('Source/package version mismatch');
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(version)) throw Error('Invalid version');
const root = path.resolve(process.argv[3] || 'release');
const artifact = `FOX-Setup-${version}-x64.exe`;
const installer = path.join(root,artifact);
const forbidden = name => /\.(?:sqlite(?:-wal|-shm)?|db(?:-wal|-shm)?|pfx|p12|pem|key)$/i.test(name) || /(?:^|[\\/])\.env(?:\.|$)/.test(name);
const secrets = /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
function scan(directory) {
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const filename=path.join(directory,entry.name);
    if(forbidden(filename)) throw Error(`Forbidden release file: ${filename}`);
    if(entry.isDirectory()) scan(filename);
    else if(/\.(?:json|js|cjs|html|css|txt|yml)$/i.test(filename)&&fs.statSync(filename).size<5000000&&secrets.test(fs.readFileSync(filename,'utf8'))) throw Error('Secret pattern in release');
  }
}
scan(root);
const archive=path.join(root,'win-unpacked/resources/app.asar');
const files=asar.listPackage(archive).map(name=>name.replaceAll('\\','/'));
if(files.some(name=>forbidden(name)||/^\/(?:tests|scripts|docs|work|\.github)\//.test(name))) throw Error('Forbidden ASAR content');
const metadata=JSON.parse(asar.extractFile(archive,'package.json').toString());
if(metadata.version!==version||metadata.name!=='fox-pos'||metadata.main!=='dist-electron/main.cjs') throw Error('Packaged metadata mismatch');
const main=asar.extractFile(archive,'dist-electron/main.cjs').toString();
if(main.includes('Intentional lost checkout response')||main.includes('checkout-expected.json')||secrets.test(main)) throw Error('QA or secrets embedded');
for(const name of files.filter(n=>/\.(cjs|js|json|html|css)$/.test(n))) {
  const relative=path.normalize(name.replace(/^\//,''));
  const raw=asar.statFile(archive,relative,false);
  const content=raw.unpacked?fs.readFileSync(path.join(archive+'.unpacked',relative)):asar.extractFile(archive,relative);
  if(secrets.test(content.toString())) throw Error('ASAR secret pattern');
}
const exe=fs.readFileSync(installer);
if(exe.readUInt16LE(0)!==0x5a4d) throw Error('Invalid installer executable');
const appExe=fs.readFileSync(path.join(root,'win-unpacked/FOX Kafeteri.exe'));
if(appExe.readUInt16LE(appExe.readUInt32LE(0x3c)+4)!==0x8664) throw Error('Not x64');
if(!files.includes('/node_modules/better-sqlite3/prebuilds/win32-x64.node')) throw Error('Native SQLite missing');
const native=fs.readFileSync(path.join(archive+'.unpacked','node_modules/better-sqlite3/prebuilds/win32-x64.node'));
if(native.readUInt16LE(native.readUInt32LE(0x3c)+4)!==0x8664) throw Error('SQLite is not x64');
const sha256=crypto.createHash('sha256').update(exe).digest('hex');
let commit; try {commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();} catch {throw Error('A source commit is required');}
const checksum=`${sha256}  ${artifact}\n`;
const stamp=JSON.parse(fs.readFileSync(path.join(root,'win-unpacked/resources/fox-release.json'),'utf8'));
if(stamp.version!==version||!['QA','RC','PRODUCTION'].includes(stamp.channel))throw Error('Invalid release channel stamp');
const signatures=JSON.parse(fs.readFileSync(path.join(root,'signature-verification.json'),'utf8').replace(/^\uFEFF/,''));
if(stamp.channel!=='QA'&&signatures.some(s=>s.status!=='Valid'||!s.timestamp))throw Error('Trusted signatures required');
const signing=stamp.channel==='QA'?'UNSIGNED':'SIGNED';
const sbom=`FOX-${version}-sbom.json`,sbomContent=fs.readFileSync(path.join(root,sbom));
if(JSON.parse(sbomContent).bomFormat!=='CycloneDX'||secrets.test(sbomContent.toString()))throw Error('Invalid SBOM');
let tag=null;try{tag=execFileSync('git',['describe','--tags','--exact-match'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
if(stamp.channel!=='QA'&&tag!==`v${version}`)throw Error('Official tag mismatch');
const manifest={manifestVersion:2,product:'FOX Kafeteri',appId:'com.foxkafeteri.pos',version,channel:stamp.channel,platform:'win32',arch:'x64',artifact,sha256,commit,tag,ciRun:process.env.GITHUB_RUN_ID??null,builtAt:new Date().toISOString(),schemaVersion:4,signing,signer:signing==='SIGNED'?signatures.find(s=>s.file===artifact)?.signer:null,sbom,sbomSha256:crypto.createHash('sha256').update(sbomContent).digest('hex'),databaseBundled:false};
fs.writeFileSync(installer+'.sha256',checksum);
fs.writeFileSync(path.join(root,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({passed:true,artifact,sha256,commit,asarEntries:files.length}));
