import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import electron from 'electron';
import assert from 'node:assert/strict';
import {createQaDirectory} from './qa-directory.mjs';
const directory=createQaDirectory('product-ui'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('FOX_VERIFY_')||['ELECTRON_RUN_AS_NODE','FOX_DEV_URL'].includes(k))delete env[k];Object.assign(env,{FOX_VERIFY_DIR:directory,FOX_VERIFY_MANUAL:'1'});
const child=spawn(electron,['.',`--remote-debugging-port=${port}`,'--force-device-scale-factor=1'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stderr.on('data',b=>log+=b);let ws;
const result={directory,views:[],issues:[],checks:[]};
try{
 let page;for(let i=0;i<300;i++){try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page');if(page)break;}catch{}if(child.exitCode!==null)throw Error(log);await pause(50);}assert.ok(page);
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);};
 const command=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id:key,method,params}));});
 const js=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const until=async expression=>{for(let i=0;i<200;i++){if(await js(expression))return;await pause(25);}throw Error('Timeout: '+expression);};
 const api=code=>js(`(async()=>{const fox=window.fox;${code}})()`);
 await until('document.querySelectorAll("[data-table-code]").length===27');
 result.initial=await api('return {products:await fox.products.list(),tables:await fox.tables.list(),report:await fox.reports.getSalesReport("ALL")};');
 for(const id of ['KAFE-1','CAJ-1','PIJE-1','UJE-1','ALKOOL-1']){assert.ok((await api(`const p=(await fox.products.list()).find(p=>p.id===${JSON.stringify(id)});return fox.products.update({...p,sellingPriceCents:100,purchaseCostCents:id==='CAJ-1'?null:50,trackInventory:true,lowStockThreshold:5,active:true});`.replace("id==='CAJ-1'",JSON.stringify(id)+"==='CAJ-1'"))).ok);assert.ok((await api(`return fox.inventory.addSupply({requestId:crypto.randomUUID(),productId:${JSON.stringify(id)},quantity:200});`)).ok);}
 await js('location.reload()');await until('Boolean(document.querySelector("[data-order-product=KAFE-1]:not(:disabled)"))');
 await js('document.querySelector("[data-order-product=KAFE-1]").click()');await until('Boolean(document.querySelector("[data-order-item]"))');
 await api('const w=await fox.orders.addProduct({tableId:"M1",productId:"CAJ-1"});return fox.orders.completeOrder({orderId:w.data.order.id});');
 const capture=async name=>fs.writeFileSync(path.join(directory,name+'.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const nav=async name=>{await js(`document.querySelector('[data-nav=${name}]').click()`);await until(`Boolean(document.querySelector('[data-page=${name}]'))`);await pause(180);};
 for(const [width,height,scale] of [[1366,768,1],[1440,900,1],[1920,1080,1],[1093,614,1.25],[910,512,1.5]]){
  await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});
  for(const screen of ['tables','inventory','reports','settings']){
   await nav(screen);await capture(`${screen}-${width}-${scale}`);
   const metrics=await js(`(()=>{const r=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,visible:b.x>=0&&b.y>=0&&b.right<=innerWidth&&b.bottom<=innerHeight};};return {pageOverflow:document.documentElement.scrollWidth>innerWidth,buttons:[...document.querySelectorAll('.checkout-open,.panel-footer button')].map(r),tableCount:document.querySelectorAll('[data-table-code]').length,overlaps:(()=>{const a=[...document.querySelectorAll('[data-table-code]')];return a.flatMap((e,i)=>a.slice(i+1).filter(f=>{const b=e.getBoundingClientRect(),c=f.getBoundingClientRect();return b.left<c.right&&b.right>c.left&&b.top<c.bottom&&b.bottom>c.top;}).map(f=>[e.dataset.tableCode,f.dataset.tableCode]));})(),bodyText:document.querySelector('main').innerText};})()`);
   result.views.push({width,height,scale,screen,...metrics});
   if(screen==='tables'){assert.equal(metrics.tableCount,27);assert.deepEqual(metrics.overlaps,[]);} assert.equal(metrics.pageOverflow,false); if(metrics.pageOverflow)result.issues.push({screen,width,scale,issue:'Horizontal page overflow'});
   if(metrics.buttons.some(b=>!b.visible))result.issues.push({screen,width,scale,issue:'Critical footer outside viewport'});
   if(screen==='tables'){
    await until('Boolean(document.querySelector("[data-open-checkout]:not(:disabled)"))');await js('(()=>{const b=document.querySelector("[data-open-checkout]");b.focus();b.click();})()');await until('Boolean(document.querySelector(".checkout-dialog[open]"))');await capture(`checkout-${width}-${scale}`);
    result.views.push({width,height,scale,screen:'checkout',...(await js('(()=>{const b=document.querySelector(".checkout-dialog").getBoundingClientRect(),f=document.querySelector("[data-confirm-payment]").getBoundingClientRect();return {dialogHeight:b.height,dialogTop:b.top,confirmBottom:f.bottom,viewport:innerHeight,focus:document.activeElement.textContent};})()'))});
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until('!document.querySelector(".checkout-dialog[open]")');
   }
   if(screen==='inventory'){await js('document.querySelector(".row-actions button").click()');await until('Boolean(document.querySelector("dialog[open]"))');await capture(`editor-${width}-${scale}`);await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until('!document.querySelector("dialog[open]")');}
   if(screen==='settings'){await js('document.querySelector(".data-protection").scrollIntoView({block:"end"})');await pause(150);await capture(`data-${width}-${scale}`);}
  }
 }

 // Golden workflow uses actual React controls, including form validation and double actions.
 await command('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
 await nav('inventory');await js('document.querySelector(".row-actions button").click()');await until('Boolean(document.querySelector("#sellingPriceCents"))');
 const field=async(id,value)=>js('(()=>{const e=document.getElementById('+JSON.stringify(id)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()');
 await field('sellingPriceCents','abc');await js('document.querySelector("button[form=product-form]").click()');await until('Boolean(document.querySelector("#sellingPriceCents[aria-invalid=true]"))');assert.equal((await api('return (await fox.products.list()).find(p=>p.id==="KAFE-1").sellingPriceCents;')),100);
 await field('sellingPriceCents','1,00');await field('purchaseCostCents','0,50');await js('(()=>{const b=document.querySelector("button[form=product-form]");b.click();b.click();})()');await until('!document.querySelector("dialog[open]")');
 await js('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Shto furnizim")).click()');await until('Boolean(document.querySelector("#supply-form"))');
 await js('(()=>{const e=document.querySelector("#productId");e.value="KAFE-1";e.dispatchEvent(new Event("change",{bubbles:true}));})()');await field('quantity','-5');await js('document.querySelector("button[form=supply-form]").click()');await until('Boolean(document.querySelector("#quantity[aria-invalid=true]"))');await field('quantity','20');
 await js('(()=>{const b=document.querySelector("button[form=supply-form]");b.click();b.click();})()');await until('!document.querySelector("dialog[open]")');assert.equal(await api('return (await fox.products.list()).find(p=>p.id==="KAFE-1").stockQuantity;'),220);
 await nav('tables');await until('Boolean(document.querySelector("[data-order-item]"))');
 await js('(()=>{for(const code of ["M1","M4","T3","M5"])document.querySelector("[data-table-code="+code+"]").click();})()');await until('document.querySelector("#order-heading")?.textContent==="Tavolina B5" && document.querySelector("[data-order-quantity]")?.textContent==="1"');
 await js('(()=>{for(const c of ["CAJ","PIJE","KAFE"])document.querySelector("[data-order-category="+c+"]").click();})()');
 await js('(()=>{const b=document.querySelector("button[aria-label^=Rrit]");b.click();b.click();})()');await until('document.querySelector("[data-order-quantity]")?.textContent==="2"');
 await js('(()=>{const b=document.querySelector("button[aria-label^=Ul]");b.click();b.click();})()');await until('document.querySelector("[data-order-quantity]")?.textContent==="1"');
 await js('(()=>{const b=document.querySelector("[data-open-checkout]");b.focus();b.click();})()');await until('Boolean(document.querySelector("dialog[open]"))');assert.equal(await js('document.activeElement.hasAttribute("data-cancel-payment")'),true);
 await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.equal(await js('document.activeElement.hasAttribute("data-confirm-payment")'),true);
 await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until('!document.querySelector("dialog[open]")');assert.equal(await js('document.activeElement.hasAttribute("data-open-checkout")'),true);
 await js('(()=>{const b=document.querySelector("[data-open-checkout]");b.focus();b.click();})()');await until('Boolean(document.querySelector("dialog[open]"))');await js('(()=>{const b=document.querySelector("[data-confirm-payment]");b.click();b.click();})()');await until('!document.querySelector("dialog[open]") && !document.querySelector("[data-order-item]")');
 const paid=await api('return {report:await fox.reports.getSalesReport("ALL"),product:(await fox.products.list()).find(p=>p.id==="KAFE-1"),table:(await fox.tables.list()).find(t=>t.code==="M5")};');assert.equal(paid.report.summary.completedOrders,2);assert.equal(paid.report.summary.salesCents,200);assert.equal(paid.report.cashCents,200);assert.equal(paid.product.stockQuantity,219);assert.equal(paid.table.status,'FREE');
 result.golden={passed:true,reactFormValidation:true,commaMoneyInput:true,doubleSaveSupplyQuantityCheckout:true,rapidSwitches:true,safeEscapeFocusRestore:true,stock:219,revenueCents:200};
 // Large isolated values and a full catalogue order must keep confirmation usable.
 const all=await api('return fox.products.list();');for(const p of all){await api('return fox.products.update({...'+JSON.stringify(p)+',sellingPriceCents:99999,purchaseCostCents:50,trackInventory:false,active:true});');assert.ok((await api('return fox.orders.addProduct({tableId:"M5",productId:'+JSON.stringify(p.id)+'});')).ok);}
 for(let i=1;i<99;i++)assert.ok((await api('const w=await fox.orders.getForTable("M5");return fox.orders.incrementItem({tableId:"M5",itemId:w.order.items[0].id});')).ok);
 const long=await api('return (await fox.products.list())[0];');assert.ok((await api('return fox.products.update({...'+JSON.stringify(long)+',name:'+JSON.stringify('QA long product name '.repeat(9).slice(0,190))+',trackInventory:true});')).ok);assert.ok((await api('return fox.inventory.addSupply({requestId:crypto.randomUUID(),productId:"KAFE-1",quantity:99999});')).ok);
 await nav('inventory');await nav('tables');await until('document.querySelectorAll("[data-order-item]").length===21');
 for(const [width,height,scale] of [[1366,768,1],[1093,614,1.25],[910,512,1.5]]){await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});await js('(()=>{const b=document.querySelector("[data-open-checkout]");b.focus();b.click();})()');await until('Boolean(document.querySelector("dialog[open]"))');const rect=await js('(()=>{const b=document.querySelector("[data-confirm-payment]").getBoundingClientRect(),h=document.querySelector(".checkout-dialog h2").getBoundingClientRect();return {top:h.top,bottom:b.bottom,height:innerHeight};})()');assert.ok(rect.top>=0&&rect.bottom<=rect.height);await capture('checkout-many-'+width);await js('document.querySelector("[data-cancel-payment]").click()');await until('!document.querySelector("dialog[open]")');}
 result.edgeValues={quantity:99,stockAbove99999:true,priceCents:99999,longName:true,lines:21,paymentActionsVisible:true};
 await command('HeapProfiler.collectGarbage');result.dom=await command('Memory.getDOMCounters');const logDirectory=path.join(directory,'logs');const logFiles=fs.readdirSync(logDirectory).filter(n=>n.endsWith('.log'));const logBytes=logFiles.reduce((n,f)=>n+fs.statSync(path.join(logDirectory,f)).size,0);assert.equal(logBytes,0,'Normal workflow must not log errors');result.normalLogs={files:logFiles.length,bytes:logBytes};result.passed=true;
 fs.writeFileSync(path.join(directory,'audit-result.json'),JSON.stringify(result,null,2));
 // Closing the last page can disconnect CDP before its response is delivered.
 // Verify the actual process exit instead of awaiting that disappearing response.
 const closed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Electron did not close after UI audit')),10000);child.once('exit',(code)=>{clearTimeout(timer);code===0?resolve():reject(Error('UI audit Electron exit: '+code));});});
 ws.send(JSON.stringify({id:++id,method:'Page.close'}));await closed;ws.close();console.log(directory);
}catch(e){ws?.close();if(child.exitCode===null)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});throw e;}
