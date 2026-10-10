// Compiled out of release main; only native selection is injected for isolated UI tests.
import {dialog} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {assertQaDirectory} from '../database/safety';
export function cutoverDialogs(directory:string){
 assertQaDirectory(directory);
 const choice=()=>{const value=JSON.parse(fs.readFileSync(path.join(directory,'cutover-dialog.json'),'utf8')) as {path:string;action:string};const target=path.resolve(value.path),relative=path.relative(directory,target);assert.ok(!relative.startsWith('..')&&!path.isAbsolute(relative));assert.equal(path.extname(target),'.sqlite');return {...value,path:target};};
 dialog.showSaveDialog=async()=>({canceled:false,filePath:choice().path});
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[choice().path]});
 dialog.showMessageBox=async(...args:unknown[])=>{const options=args.at(-1) as {defaultId?:number;cancelId?:number;message?:string};assert.equal(options.defaultId,0);assert.equal(options.cancelId,0);assert.ok(options.message?.includes('zëvendësojë'));return {response:1,checkboxChecked:false};};
}
