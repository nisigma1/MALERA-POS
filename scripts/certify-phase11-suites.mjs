import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync,execFileSync} from 'node:child_process';
import {createQaDirectory} from './qa-directory.mjs';
const output='outputs/phase11',commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),result={passed:false,commit,phase:11,tests:534,consecutivePasses:0,retriedFailures:0,runs:[]};fs.mkdirSync(output,{recursive:true});
for(let run=1;run<=5;run++){
 const workspaceTemp=path.resolve(`work/phase11-suite-temp-${run}`);assert.ok(workspaceTemp.startsWith(path.resolve('work')+path.sep));
 // SQLite's Windows file path limit includes the safety-backup stage suffix.
 // Deep local checkouts made that path263 characters and deterministically
 // failed SQLITE_CANTOPEN. Keep CI workspace isolation where short enough.
 const temp=workspaceTemp.length<=100?workspaceTemp:createQaDirectory(`phase11-suite-${run}`);assert.ok(temp.length<=100,'QA temp root too long for native backup stage');fs.mkdirSync(temp,{recursive:true});const start=Date.now(),test=spawnSync(process.execPath,['scripts/test.mjs'],{env:{...process.env,TEMP:temp,TMP:temp},windowsHide:true,encoding:'utf8',maxBuffer:4000000});
 const text=(test.stdout??'')+(test.stderr??'');fs.writeFileSync(`${output}/suite-${run}.log`,text);const tests=Number(text.match(/Tests\s+(\d+) passed/)?.[1]??0),passed=test.status===0&&tests===534;result.runs.push({run,passed,tests,elapsedMs:Date.now()-start});if(passed)result.consecutivePasses++;
 result.passed=passed&&run===5;for(const target of [`${output}/five-suites.json`,'outputs/fox-phase11-regression.json'])fs.writeFileSync(target,JSON.stringify(result,null,2));console.log(JSON.stringify(result.runs.at(-1)));assert.ok(passed,`Suite${run} failed; no retry. Preserve log and diagnose.`);
}
