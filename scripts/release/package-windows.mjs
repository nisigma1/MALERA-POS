import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {signingConfiguration} from './signing-config.mjs';
const qa=process.argv.includes('--qa');
const args=process.argv.slice(2).filter(arg=>arg!=='--qa');
if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Release packaging requires clean committed source');
const signing=signingConfiguration(process.env,qa);
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
if(!qa&&execFileSync('git',['describe','--tags','--exact-match'],{encoding:'utf8'}).trim()!==`v${version}`)throw Error('Official release tag/version mismatch');
const outputArg=args.find(a=>a.startsWith('--config.directories.output='));
const output=path.resolve(outputArg?.split('=').slice(1).join('=')||'release');
const releaseRoot=path.resolve('release');
const relative=path.relative(releaseRoot,output);
if(relative.startsWith('..')||path.isAbsolute(relative)||fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink()) throw Error('Unsafe package output');
for(let ancestor=output;;ancestor=path.dirname(ancestor)){
  if(fs.existsSync(ancestor)&&fs.lstatSync(ancestor).isSymbolicLink())throw Error('Package output cannot traverse junctions');
  if(ancestor===releaseRoot)break;
}
if(output===releaseRoot) {
  // Preserve separately named QA evidence builds; remove only official build outputs.
  for(const name of fs.existsSync(output)?fs.readdirSync(output):[]) if(name==='win-unpacked'||/^FOX-Setup-[0-9A-Za-z.-]+-x64\.exe(?:\..*)?$/.test(name)||['release-manifest.json','builder-debug.yml','builder-effective-config.yaml'].includes(name)) fs.rmSync(path.join(output,name),{recursive:true,force:true});
} else fs.rmSync(output,{recursive:true,force:true});
const npmCli=process.env.npm_execpath;
if(!npmCli) throw Error('Use npm run package:win');
fs.mkdirSync('work',{recursive:true});
const config=path.resolve('work/release-signing.json');
fs.writeFileSync(config,JSON.stringify({extends:path.resolve('electron-builder.json'),...signing}));
fs.writeFileSync('work/fox-release.json',JSON.stringify({version,signing:qa?'UNSIGNED':'SIGNED',channel:qa?'QA':version.includes('-rc.')?'RC':'PRODUCTION'}));
for(const params of [[npmCli,'run','build:release'],['node_modules/electron-builder/cli.js','--config',config,'--win','nsis','--x64','--publish','never',...args]]) {
  const result=spawnSync(process.execPath,params,{stdio:'inherit',windowsHide:true});
  if(result.status!==0)process.exit(result.status??1);
}
const verification=spawnSync('powershell.exe',['-NoProfile','-File','scripts/release/verify-signatures.ps1','-Root',output,...(qa?[]:['-RequireSigned'])],{stdio:'inherit',windowsHide:true});
if(verification.status!==0)process.exit(verification.status??1);
const sbom=spawnSync(process.execPath,[npmCli,'run','release:sbom','--',output],{stdio:'inherit',windowsHide:true});
if(sbom.status!==0)process.exit(sbom.status??1);
