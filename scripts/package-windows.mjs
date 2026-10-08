import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);
const outputArg=args.find(a=>a.startsWith('--config.directories.output='));
const output=path.resolve(outputArg?.split('=').slice(1).join('=')||'release');
const releaseRoot=path.resolve('release');
const relative=path.relative(releaseRoot,output);
if(relative.startsWith('..')||path.isAbsolute(relative)||fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink()) throw Error('Unsafe package output');
if(output===releaseRoot) {
  // Preserve separately named QA evidence builds; remove only official build outputs.
  for(const name of fs.existsSync(output)?fs.readdirSync(output):[]) if(name==='win-unpacked'||/^FOX-Setup-0\.4\.2-x64\.exe(?:\..*)?$/.test(name)||['release-manifest.json','builder-debug.yml','builder-effective-config.yaml'].includes(name)) fs.rmSync(path.join(output,name),{recursive:true,force:true});
} else fs.rmSync(output,{recursive:true,force:true});
for(const [command,params] of [['npm.cmd',['run','build:release']],['node',['node_modules/electron-builder/cli.js','--win','nsis','--x64','--publish','never',...args]]]) {
  const result=spawnSync(command,params,{stdio:'inherit',shell:command==='npm.cmd',windowsHide:true});
  if(result.status!==0)process.exit(result.status??1);
}
