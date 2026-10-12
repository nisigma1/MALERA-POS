import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const evidence={commit,consecutivePasses:0,retriedFailures:0,runs:[]};fs.mkdirSync('outputs',{recursive:true});
for(let run=1;run<=5;run++){
 const started=Date.now(),result=spawnSync(process.execPath,['scripts/test.mjs'],{windowsHide:true,encoding:'utf8',maxBuffer:4000000});
 const output=(result.stdout??'')+(result.stderr??'');fs.writeFileSync(path.resolve(`outputs/fox-phase10-suite-${run}.log`),output);
 const passed=result.status===0,total=Number(output.match(/Tests\s+(\d+) passed/)?.[1]??0);evidence.runs.push({run,passed,tests:total,elapsedMs:Date.now()-started});if(passed)evidence.consecutivePasses++;
 fs.writeFileSync('outputs/fox-phase10-local-repeatability.json',JSON.stringify({...evidence,passed:passed&&run===5},null,2));console.log(JSON.stringify(evidence.runs.at(-1)));
 assert.ok(passed,`Certification stops at suite ${run}; see retained log. No automatic retry.`);assert.ok(total>=418,'Baseline tests lost');
}
