import { BrowserWindow, type BrowserWindow as MainWindow } from 'electron';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { assertQaDirectory, assertTestDatabasePath } from '../database/safety';
import { createReceiptRepository } from '../receipts/repository';
import { renderReceipt } from '../receipts/render';
import type { PrintManager } from '../receipts/manager';
import type { ReceiptPayload } from '../../src/domain/receipts';
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const financial=(db:Database.Database)=>Object.fromEntries(['orders','order_items','order_payments','inventory_balances','inventory_movements','cafe_tables','products','expenses'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
export async function verifyReceipts(window:MainWindow,directory:string,db:Database.Database,manager:PrintManager,errors:string[]){
 assertQaDirectory(directory);assert.equal(path.resolve(db.name),path.join(directory,'fox.sqlite'));
 const repo=createReceiptRepository(db),evaluate=(code:string)=>window.webContents.executeJavaScript(code);
 const api=(code:string)=>evaluate(`(async()=>{${code}})()`);
 const wait=async(condition:()=>boolean|Promise<boolean>)=>{for(let i=0;i<400;i++){if(await condition())return;await pause(50);}throw Error('Receipt QA condition timed out');};
 const printer=process.env.FOX_VERIFY_PRINTER!,output=process.env.FOX_VERIFY_PRINTER_OUTPUT!;
 assert.ok(printer?.startsWith('FOX QA Receipt '));assertTestDatabasePath(output);
 const printers=await api('return fox.receipts.listPrinters();');assert.ok(printers.ok);assert.ok(printers.data.some((p:{deviceName:string})=>p.deviceName===printer));
 const beforeTest=financial(db),reportBeforeTest=await api("return fox.reports.getSalesReport('ALL');");
 assert.deepEqual(repo.settings(),{deviceName:null,displayName:null,autoPrint:false,paperWidth:80,copies:1});
 await evaluate("document.querySelector('[data-nav=settings]').click()");
 await wait(()=>evaluate("Boolean(document.querySelector('[aria-label=\"Printeri i kuponit\"]'))"));
 assert.equal((await api(`return fox.receipts.saveSettings({deviceName:${JSON.stringify(printer)},autoPrint:false,paperWidth:80,copies:1});`)).data.saved,true);
 const test=await api('return fox.receipts.testPrint();');assert.ok(test.ok);
 await wait(()=>repo.recentJobs().find(j=>j.id===test.data.id)?.status==='SUBMITTED');await wait(()=>fs.existsSync(output)&&fs.statSync(output).size>0);
 fs.renameSync(output,path.join(directory,'windows-spool-test.pdf'));
 assert.deepEqual(financial(db),beforeTest);assert.deepEqual(await api("return fox.reports.getSalesReport('ALL');"),reportBeforeTest);
 assert.equal((await api(`return fox.receipts.saveSettings({deviceName:${JSON.stringify(printer)},autoPrint:true,paperWidth:80,copies:1});`)).data.saved,true);
 await api("const p=(await fox.products.list()).find(p=>p.id==='KAFE-1');return fox.products.update({...p,name:'Çaj ë Ë ç Ç <script>alert(1)</script>',sellingPriceCents:100,purchaseCostCents:50,trackInventory:true,lowStockThreshold:2});");
 assert.ok((await api("return fox.inventory.addSupply({requestId:crypto.randomUUID(),productId:'KAFE-1',quantity:10});")).ok);
 const added=await api("return fox.orders.addProduct({tableId:'M5',productId:'KAFE-1'});");assert.ok(added.ok);
 const id=added.data.order.id;
 const sale=await api(`return fox.orders.completeOrder({orderId:${JSON.stringify(id)}});`);assert.ok(sale.ok);
 await wait(()=>repo.state(id).jobs[0]?.status==='SUBMITTED');await wait(()=>fs.existsSync(output)&&fs.statSync(output).size>0);
 fs.renameSync(output,path.join(directory,'windows-spool-original.pdf'));
 const beforeCopy=financial(db),reportBeforeCopy=await api("return fox.reports.getSalesReport('ALL');"),original=repo.document(id);
 assert.equal(reportBeforeCopy.summary.salesCents,100);assert.equal((db.prepare("SELECT quantity FROM inventory_balances WHERE product_id='KAFE-1'").get() as {quantity:number}).quantity,9);
 const copy=await api(`const input={saleId:${JSON.stringify(id)},requestId:crypto.randomUUID()};return Promise.all([fox.receipts.printCopy(input),fox.receipts.printCopy(input)]);`);assert.ok(copy.every((r:{ok:boolean})=>r.ok));assert.equal(copy[0].data.id,copy[1].data.id);
 await wait(()=>repo.state(id).jobs[0]?.status==='SUBMITTED'&&repo.state(id).jobs[0]?.kind==='COPY');await wait(()=>fs.existsSync(output)&&fs.statSync(output).size>0);
 fs.renameSync(output,path.join(directory,'windows-spool-copy.pdf'));
 assert.deepEqual(financial(db),beforeCopy);assert.deepEqual(await api("return fox.reports.getSalesReport('ALL');"),reportBeforeCopy);assert.deepEqual(repo.document(id),original);
 // Render the same immutable HTML with real Chromium for layout/security QA.
 const sample:ReceiptPayload={...original.payload,items:Array.from({length:25},(_,i)=>({name:`Çaj shumë i gjatë ë Ë ç Ç ${i} `+'Emër '.repeat(20)+'<img src=x onerror="window.injected=1">',quantity:2,unitPriceCents:12345,lineTotalCents:24690})),totalCents:617250};
 const layout=new BrowserWindow({show:false,useContentSize:true,width:303,height:1000,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:'fox-receipt-layout-qa'}});
 try{
  await layout.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(renderReceipt(sample,true)));
  const metrics=await layout.webContents.executeJavaScript(`({overflow:document.documentElement.scrollWidth>innerWidth,items:document.querySelectorAll('.line').length,script:document.querySelectorAll('script,img').length,text:document.body.textContent,injected:window.injected,process:typeof process,require:typeof require})`);
  assert.equal(metrics.overflow,false);assert.equal(metrics.items,25);assert.equal(metrics.script,0);assert.equal(metrics.injected,undefined);assert.equal(metrics.process,'undefined');assert.equal(metrics.require,'undefined');assert.ok(metrics.text.includes('ë Ë ç Ç'));assert.ok(metrics.text.includes('KOPJE'));
  fs.writeFileSync(path.join(directory,'receipt-layout.png'),(await layout.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(directory,'receipt-long-layout.pdf'),await layout.webContents.printToPDF({pageSize:{width:80/25.4,height:Math.ceil((await layout.webContents.executeJavaScript('document.body.scrollHeight'))*25.4/96+8)/25.4},margins:{top:0,bottom:0,left:0,right:0},displayHeaderFooter:false}));
  fs.writeFileSync(path.join(directory,'receipt-layout.json'),JSON.stringify(metrics,null,2));
 }finally{layout.destroy();}
 // Operator Settings and report detail at desktop sizes.
 for(const [width,height] of [[1366,768],[1440,900],[1920,1080]]){
  window.setContentSize(width!,height!);await evaluate("document.querySelector('[data-nav=settings]').click()");await pause(200);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  fs.writeFileSync(path.join(directory,`settings-${width}.png`),(await window.webContents.capturePage()).toPNG());
 }
 await evaluate("document.querySelector('[data-nav=reports]').click()");await wait(()=>evaluate('Boolean(document.querySelector("[data-sale-id]"))'));
 await evaluate('document.querySelector("[data-sale-id] button").click()');await wait(()=>evaluate('Boolean(document.querySelector(".receipt-actions"))'));
 fs.writeFileSync(path.join(directory,'receipt-report.png'),(await window.webContents.capturePage()).toPNG());
 assert.equal(BrowserWindow.getAllWindows().length,1);assert.deepEqual(errors,[]);
 await manager.idle();
 fs.writeFileSync(path.join(directory,'receipt-result.json'),JSON.stringify({passed:true,physicalPrinter:false,realWindowsSpooler:true,printer,documents:db.prepare('SELECT id,sale_id,payload_hash FROM receipt_documents').all(),jobs:repo.recentJobs(),testPrintNoFinancialChanges:true,copyNoFinancialChanges:true,htmlInjectionBlocked:true,hiddenWindowsCleaned:true,settingsSizes:[1366,1440,1920]},null,2));
 console.log('FOX real Windows spooler, immutable receipt, copy, security and UI QA PASS');
}
