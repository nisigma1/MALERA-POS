// Real visible packaged window + normal taskbar on disposable Windows CI only.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.GITHUB_ACTIONS,'true','Never run visible/default-userData acceptance on the owner desktop');
const evidence=JSON.parse(fs.readFileSync(path.join(path.resolve(process.env.FOX_VISUAL_OUTPUT??'../../outputs/fox-phase9-regression-screenshots'),'after-packaged-visual-result.json')));
assert.equal(evidence.passed,true);assert.equal(evidence.packaged,true);
const normalData=path.join(process.env.APPDATA,'FOX Kafeteri');assert.equal(fs.existsSync(path.join(normalData,'fox.sqlite')),false,'Refuse existing normal-profile data');
const executable=path.join(evidence.directory,'application','FOX Kafeteri.exe');assert.ok(fs.existsSync(executable));
const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('FOX_VERIFY_')||['FOX_DEV_URL','ELECTRON_RUN_AS_NODE','NODE_ENV'].includes(k))delete env[k];
const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const child=spawn(executable,[`--remote-debugging-port=${port}`,'--force-device-scale-factor=1'],{env,windowsHide:true});let ws;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let page;for(let i=0;i<300;i++){try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page');if(page)break;}catch{}await pause(50);}assert.ok(page);
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
 const command=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const js=async expression=>{const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 for(let i=0;i<200&&!await js('Boolean(window.fox&&document.querySelector("[data-table-code]"))');i++)await pause(50);
 await pause(1000);
 const output=path.resolve(process.env.FOX_VISUAL_OUTPUT??'../../outputs/fox-phase9-regression-screenshots');const views=[];
 for(const pageName of ['tables','inventory','reports','settings']){
  await js(`document.querySelector('[data-nav=${pageName}]').click()`);await pause(400);
  const metrics=await js(`(()=>{const b=document.querySelector('[data-open-checkout]')?.getBoundingClientRect();return {viewport:[innerWidth,innerHeight,devicePixelRatio],overflow:document.documentElement.scrollWidth>innerWidth,checkout:b?{top:b.top,bottom:b.bottom,right:b.right}:null};})()`);
  assert.equal(metrics.overflow,false);if(metrics.checkout)assert.ok(metrics.checkout.bottom<=metrics.viewport[1]&&metrics.checkout.right<=metrics.viewport[0]);
  const screenshot=await command('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`after-workarea-${pageName}.png`),Buffer.from(screenshot.data,'base64'));views.push({pageName,...metrics});
 }
 await js('document.querySelector("[data-nav=tables]").click()');await pause(500);
 const capture=spawnSync('powershell.exe',['-NoProfile','-File','scripts/capture-owned-window.ps1','-FoxProcessId',String(child.pid),'-Title','FOX Kafeteri','-File',path.join(output,'after-workarea-window.png'),'-Desktop'],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(capture.status,0,capture.stdout+capture.stderr);
 const native=JSON.parse(fs.readFileSync(path.join(output,'after-workarea-window.png.json'),'utf8').replace(/^\uFEFF/,''));assert.equal(native.taskbarVisible,true);
 fs.writeFileSync(path.join(output,'workarea-result.json'),JSON.stringify({passed:true,actualVisibleWindow:true,normalTaskbar:true,disposableHostedWindows:true,ownerMachineTouched:false,normalData,views,native},null,2));
}finally{ws?.close();if(child.exitCode===null)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});}
