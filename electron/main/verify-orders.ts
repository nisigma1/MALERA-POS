// Isolated, hidden Electron integration QA. Never runs against production userData.
import { ipcMain, type BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createRepositories } from '../database/repositories';
import { createOrderService } from '../database/orders';
import { assertQaDirectory } from '../database/safety';
import { IPC } from '../../src/types/api';
const sizes = [[1366,768],[1440,900],[1920,1080]] as const;
const pause = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms));
function harness(window: BrowserWindow, directory:string) {
  const evaluate = (code:string) => window.webContents.executeJavaScript(code);
  const wait = async (condition:string) => { for(let i=0;i<160;i++) { if(await evaluate(condition))return; await pause(25); } throw new Error(`Order UI timed out: ${condition}`); };
  const click = async (selector:string) => { await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(30); };
  const saved = () => wait(`['saved','empty'].includes(document.querySelector('.order-footer')?.dataset.orderState)`);
  const select = async (code:string) => { await click(`[data-table-code="${code}"]`); await saved(); };
  const snapshot = async (name:string) => { await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await pause(80); fs.writeFileSync(path.join(directory,name),(await window.webContents.capturePage()).toPNG()); };
  const assert = async (condition:string,message:string) => { if(!await evaluate(condition))throw new Error(message); };
  const measure = async (width:number,height:number) => {
  // Windows applies native content-size changes asynchronously before renderer resize.
  await pause(150);
  let requestedWidth=width,requestedHeight=height;
  for(let attempt=0;attempt<3;attempt++) {
    const actual=await evaluate('({width:innerWidth,height:innerHeight})');
    if(actual.width===width&&actual.height===height)break;
    // Windows frame rounding can add two pixels; verify the actual renderer viewport.
    requestedWidth+=width-actual.width; requestedHeight+=height-actual.height;
    window.setContentSize(requestedWidth,requestedHeight); await pause(150);
  }
  const metric=await evaluate(`(() => {
      const board=document.querySelector('.board-scroll'),panel=document.querySelector('.order-workspace'),footer=document.querySelector('.order-footer'),body=document.querySelector('.order-body');
      const b=board.getBoundingClientRect(),p=panel.getBoundingClientRect(),f=footer.getBoundingClientRect();
      const map=document.querySelector('.floor-stage').getBoundingClientRect();
      if(map.height<b.height-10||map.width<b.width-10||map.top>b.top+6)throw new Error('Map does not fill the entire operational workspace');
      if(document.querySelector('.hamburger-trigger'))throw new Error('Removed hamburger button returned');
      const clipping=[...panel.querySelectorAll('button,.order-item-name strong,.order-item-controls strong,[data-order-total]')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent);
      const tiles=[...board.querySelectorAll('.position')];
      const tileBoxes=tiles.map(e=>e.getBoundingClientRect());
      if(tileBoxes.some((a,i)=>a.width<40||a.height<40||a.left<b.left||a.right>b.right||a.top<b.top||a.bottom>b.bottom||tileBoxes.slice(i+1).some(c=>a.left<c.right&&a.right>c.left&&a.top<c.bottom&&a.bottom>c.top)))throw new Error('Floor-plan target size/visibility/overlap failure');
      if(new Set(tiles.map(e=>e.dataset.tableCode)).size!==27||tiles.some(e=>!e.getAttribute('aria-label')?.includes(e.dataset.tableCode)))throw new Error('Canonical floor-plan identity/accessibility failure');
      const badTiles=tiles.filter(e=>e.scrollWidth>e.clientWidth+1||e.querySelector('.badge').getBoundingClientRect().right>e.getBoundingClientRect().right).map(e=>e.textContent);
      const current=document.querySelector('main');
      const firstItem=panel.querySelector('.order-item'),bodyBox=body.getBoundingClientRect();
      const categories=panel.querySelector('.order-categories').getBoundingClientRect(),product=panel.querySelector('.order-product')?.getBoundingClientRect(),order=panel.querySelector('.current-order').getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,panelWidth:p.width,footerVisible:f.bottom<=innerHeight&&f.top>p.top,firstOrderRowVisible:!firstItem||firstItem.getBoundingClientRect().bottom<=bodyBox.bottom,
        catalogFirst:categories.top<order.top,categoriesVisible:categories.top>=bodyBox.top&&categories.bottom<=bodyBox.bottom,firstProductVisible:!product||product.bottom<=bodyBox.bottom,
        redundantAddAction:Boolean(panel.querySelector('[data-order-browse]')),fullHeight:Math.abs(p.bottom-b.bottom)<8 && p.top>=b.top,
        boardSeparate:b.right<=p.left,horizontalOverflow:document.documentElement.scrollWidth>innerWidth||body.scrollWidth>body.clientWidth||board.scrollWidth>board.clientWidth,
        pageScroll:current.scrollHeight>current.clientHeight+1,clipping,badTiles,tiles:tiles.length,
        controls:[...panel.querySelectorAll('button')].map(e=>({text:e.textContent.trim(),height:e.getBoundingClientRect().height})),
        bodyScroll:body.scrollHeight>body.clientHeight,boardScroll:board.scrollHeight>board.clientHeight};
    })()`);
    if(metric.width!==width||metric.height!==height||!metric.footerVisible||!metric.firstOrderRowVisible||!metric.catalogFirst||!metric.categoriesVisible||!metric.firstProductVisible||metric.redundantAddAction||!metric.fullHeight||!metric.boardSeparate||metric.horizontalOverflow||metric.pageScroll||metric.clipping.length||metric.badTiles.length||metric.tiles!==27||metric.panelWidth<400||metric.panelWidth>460) throw new Error(`POS layout failed: ${JSON.stringify(metric)}`);
    await evaluate(`document.querySelector('.board-scroll').scrollTop=document.querySelector('.board-scroll').scrollHeight`);
    await assert(`(() => {const b=document.querySelector('.board-scroll').getBoundingClientRect(),t=document.querySelector('[data-table-code="T10"]').getBoundingClientRect();return t.bottom<=b.bottom&&t.top>=b.top})()`,'Terrace positions cannot be reached');
    await evaluate(`document.querySelector('.board-scroll').scrollTop=0`);
    return metric;
  };
  return {evaluate,wait,click,saved,select,snapshot,assert,measure};
}
const stockSnapshot = (db:Database.Database) => ({ balances:db.prepare('SELECT * FROM inventory_balances ORDER BY rowid').all(),movements:db.prepare('SELECT * FROM inventory_movements ORDER BY rowid').all(),reports:createRepositories(db).getSummary() });
const persistedOrders = (db:Database.Database) => ({ orders:db.prepare('SELECT * FROM orders ORDER BY rowid').all(),items:db.prepare('SELECT * FROM order_items ORDER BY rowid').all() });

export async function verifyActiveOrders(window:BrowserWindow,directory:string,db:Database.Database) {
  assertQaDirectory(directory); if(path.resolve(db.name)!==path.join(directory,'fox.sqlite'))throw new Error('Order QA database mismatch');
  const qa=harness(window,directory);
  db.prepare("UPDATE products SET selling_price_cents=120,purchase_cost_cents=30,active=1,track_inventory=1 WHERE id='KAFE-1'").run();
  db.prepare("UPDATE products SET active=0 WHERE id='KAFE-2'").run();
  db.prepare("UPDATE products SET selling_price_cents=0,purchase_cost_cents=NULL,track_inventory=0 WHERE id='KAFE-3'").run();
  db.prepare("UPDATE products SET selling_price_cents=140,purchase_cost_cents=40,track_inventory=0 WHERE id='KAFE-4'").run();
  db.prepare("UPDATE products SET selling_price_cents=100,purchase_cost_cents=NULL,track_inventory=0 WHERE id='UJE-1'").run();
  // Phase 4 blocks unknown tracked stock; give this isolated order fixture real available stock.
  db.prepare("UPDATE inventory_balances SET quantity=20 WHERE product_id='KAFE-1'").run();
  const before=stockSnapshot(db);
  const count=db.prepare('SELECT COUNT(*) n FROM orders').get();
  await qa.click('[data-nav="inventory"]'); await qa.wait(`Boolean(document.querySelector('[data-page="inventory"]'))`);
  await qa.click('[data-nav="tables"]');
  for(const [width,height] of sizes) {
    window.setContentSize(width,height); await qa.select('M5');
    await qa.assert(`document.querySelector('.order-empty')?.textContent.includes('Nuk ka porosi aktive.') && document.querySelector('.order-empty')?.textContent.includes('Zgjidh një produkt për ta nisur porosinë.')`,'Empty order copy missing');
    await qa.assert(`document.querySelector('[data-order-total]').textContent==='—' && document.querySelector('.order-footer').dataset.orderState==='empty' && !document.querySelector('.order-footer').textContent.includes('Porosia ruhet automatikisht.')`,'Untouched table falsely shows a zero/saved order');
    await qa.assert(`document.querySelector('[data-order-product="KAFE-5"]').disabled && document.querySelector('[data-order-product="KAFE-5"]').textContent.includes('Pa çmim')`,'NULL selling price is not blocked');
    await qa.assert(`!document.querySelector('[data-order-product="KAFE-2"]')`,'Inactive product appears in POS');
    await qa.assert(`document.querySelector('[data-order-product="KAFE-3"]').textContent.includes('0.00 €') && !document.querySelector('[data-order-product="KAFE-3"]').disabled`,'Zero price is not sellable');
    await qa.assert(`document.querySelectorAll('[data-order-category]').length===5 && document.querySelector('[data-order-category="ALKOOL"]').textContent==='Alkool'`,'Canonical categories changed');
    await qa.measure(width,height); await qa.snapshot(`order-empty-${width}.png`);
  }
  if(JSON.stringify(db.prepare('SELECT COUNT(*) n FROM orders').get())!==JSON.stringify(count))throw new Error('Selection created an empty order');
  window.setContentSize(1366,768);
  await qa.click('[data-order-product="KAFE-1"]'); await qa.saved();
  await qa.assert(`document.querySelector('[data-order-total]').textContent==='1.20 €' && document.querySelector('[data-table-code="M5"]').textContent.includes('Porosi aktive')`,'First add did not activate the table');
  await qa.evaluate(`(() => {const e=document.querySelector('[data-order-product="KAFE-1"]');e.click();e.click();})()`); await qa.saved();
  await qa.assert(`document.querySelector('[data-order-quantity]').textContent==='2' && document.querySelectorAll('[data-order-item]').length===1`,'Rapid repeated click duplicated an add');
  await qa.click('[aria-label="Ul sasinë e Espresso"]'); await qa.saved();
  await qa.assert(`document.querySelector('[data-order-quantity]').textContent==='1' && document.querySelector('[aria-label="Ul sasinë e Espresso"]').disabled`,'Minus at one deletes a line');
  await qa.evaluate(`(() => {const e=document.querySelector('[aria-label="Rrit sasinë e Espresso"]');e.click();e.click();})()`); await qa.saved();
  await qa.click('[data-order-category="UJE"]'); await qa.click('[data-order-product="UJE-1"]'); await qa.saved();
  await qa.assert(`document.querySelector('[data-order-total]').textContent==='3.40 €'`,'Exact order total incorrect');
  await qa.click('[aria-label="Hiq Ujë natyral"]'); await qa.saved();
  await qa.assert(`document.querySelector('[data-order-total]').textContent==='2.40 €'`,'Line removal total incorrect');
  await qa.click('[data-order-product="UJE-1"]'); await qa.saved();
  await qa.select('M6'); await qa.click('[data-order-product="KAFE-3"]'); await qa.saved();
  await qa.assert(`document.querySelector('[data-table-code="M6"]').textContent.includes('0.00 €')`,'Real zero-total order not displayed');
  await qa.click('[aria-label="Hiq Double Espresso"]'); await qa.saved();
  await qa.assert(`Boolean(document.querySelector('.order-empty')) && !document.querySelector('[data-table-code="M6"]').textContent.includes('€')`,'Last removal did not free the table');
  const cancelled=db.prepare("SELECT COUNT(*) n FROM orders WHERE table_id='M6' AND status='CANCELLED'").get() as {n:number};
  if(cancelled.n!==1)throw new Error('Cancelled draft not preserved');
  await qa.select('M5'); await qa.assert(`document.querySelector('[data-order-total]').textContent==='3.40 €'`,'Table switching lost order');
  // A real configuration save via the existing Inventari form must leave old lines untouched.
  await qa.click('[data-nav="inventory"]'); await qa.click('[aria-label="Edito Espresso"]');
  await qa.evaluate(`(() => {const e=document.querySelector('#sellingPriceCents');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1.35');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await qa.evaluate(`document.querySelector('#product-form').requestSubmit()`);
  await qa.wait(`!document.querySelector('dialog[open]')`);
  await qa.click('[data-nav="tables"]'); await qa.select('M5');
  await qa.assert(`document.querySelector('[data-order-product="KAFE-1"]').textContent.includes('1.35 €') && document.querySelector('[data-order-total]').textContent==='3.40 €'`,'Catalog price update rewrote the old order');
  await qa.click('[data-order-product="KAFE-1"]'); await qa.saved();
  await qa.assert(`document.querySelectorAll('[data-order-item]').length===3 && document.querySelector('[data-order-total]').textContent==='4.75 €'`,'Changed price did not create a new snapshot');
  // A command continues to commit when its workspace is unmounted immediately.
  await qa.evaluate(`document.querySelector('[aria-label="Rrit sasinë e Espresso"]').click();document.querySelector('[data-nav="settings"]').click()`);
  await qa.wait(`Boolean(document.querySelector('[data-page="settings"]'))`);
  await qa.click('[data-nav="tables"]'); await qa.select('M5');
  await qa.assert(`document.querySelector('[data-order-total]').textContent==='5.95 €'`,'Navigation during save lost a committed quantity change');
  const metrics: unknown[]=[];
  for(const [width,height] of sizes) { window.setContentSize(width,height); await qa.measure(width,height).then(value=>metrics.push(value)); await qa.snapshot(`order-active-${width}.png`); }
  // Deferred statuses are readable and blocked; no invented transitions.
  for(const [code,status] of [['SH4','RESERVED'],['T10','AWAITING_PAYMENT']] as const) {
    db.prepare('UPDATE cafe_tables SET status=? WHERE id=?').run(status,code);
    await qa.select(code); await qa.assert(`[...document.querySelectorAll('[data-order-product]')].every(e=>e.disabled)`,'Deferred table status remained writable');
  }
  await qa.snapshot('order-blocked-1920.png');
  // A stale line command from a different table is rejected through the real preload.
  const line=(db.prepare("SELECT i.id FROM order_items i JOIN orders o ON i.order_id=o.id WHERE o.table_id='M5' AND o.status='OPEN' ORDER BY i.rowid LIMIT 1").get() as {id:string}).id;
  await qa.assert(`(async()=>!(await window.fox.orders.removeItem({tableId:'M7',itemId:${JSON.stringify(line)}})).ok)()`,'Cross-table deletion succeeded');
  // Exercise a genuine IPC failure, blocked retry state and canonical refresh.
  ipcMain.removeHandler(IPC.getOrder); ipcMain.handle(IPC.getOrder,()=> {throw new Error('Intentional order read verification failure');});
  await qa.click('[data-table-code="M7"]'); await qa.wait(`Boolean(document.querySelector('.order-body [role="alert"]'))`); await qa.snapshot('order-read-error.png');
  ipcMain.removeHandler(IPC.getOrder); const service=createOrderService(db,createRepositories(db));
  ipcMain.handle(IPC.getOrder,(event,input:unknown)=> {if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('Unauthorized FOX request');return service.getForTable(input);});
  await qa.click('.order-body [role="alert"] button'); await qa.saved();
  // The renderer's catalog can become stale: backend validation must still win.
  db.prepare("UPDATE products SET active=0 WHERE id='KAFE-4'").run();
  await qa.click('[data-order-product="KAFE-4"]');
  await qa.wait(`document.querySelector('.order-body [role="alert"]')?.textContent.includes('Produkti nuk është aktiv.')`);
  await qa.assert(`Boolean(document.querySelector('.order-empty')) && document.querySelector('[data-order-total]').textContent==='—'`,'Rejected command optimistically changed the order');
  await qa.snapshot('order-rejected.png');
  db.prepare("UPDATE products SET active=1 WHERE id='KAFE-4'").run();
  await qa.select('M7');
  ipcMain.removeHandler(IPC.addProduct); ipcMain.handle(IPC.addProduct,()=> {throw new Error('Intentional order transport verification failure');});
  await qa.click('[data-order-product="KAFE-1"]');
  await qa.wait(`document.querySelector('.order-body [role="alert"]')?.textContent.includes('Porosia nuk u konfirmua.')`);
  await qa.assert(`document.querySelector('[data-order-product="KAFE-1"]').disabled && !document.querySelector('[data-order-category="UJE"]').disabled`,'Unconfirmed mutation is not guarded with usable workspace navigation');
  await qa.snapshot('order-save-error.png');
  ipcMain.removeHandler(IPC.addProduct);
  ipcMain.handle(IPC.addProduct,(event,input:unknown)=> {if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('Unauthorized FOX request');return service.addProduct(input);});
  await qa.click('.order-body [role="alert"] button'); await qa.saved();
  await qa.assert(`!document.querySelector('[data-order-product="KAFE-1"]').disabled && Boolean(document.querySelector('.order-empty'))`,'Canonical refresh did not clear uncertainty');
  await qa.select('M5');
  // Rapid cross-zone selection must only expose the final table's persisted DTO.
  for(const codes of [['M5','M6','M5'],['T3','SH2','M5']]) {
    await qa.evaluate(`(${JSON.stringify(codes)}).forEach(code=>document.querySelector('[data-table-code="'+code+'"]').click())`);
    await qa.saved();
    await qa.assert(`document.querySelector('#order-heading').textContent==='Tavolina M5' && document.querySelector('[data-order-total]').textContent==='5.95 €' && document.querySelectorAll('.position[aria-pressed="true"]').length===1 && document.querySelector('.position[aria-pressed="true"]').dataset.tableCode==='M5'`,'Rapid table switch mixed workspace state');
  }
  await qa.evaluate(`document.querySelector('.order-body').scrollTop=document.querySelector('.order-body').scrollHeight`);
  await qa.select('M6');
  await qa.assert(`document.querySelector('.order-body').scrollTop===0`,'New table opens with the old table scroll position');
  await qa.select('M5');
  await qa.evaluate(`document.querySelector('[data-table-code="M5"]').focus()`);
  window.webContents.focus(); window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await qa.wait(`!document.querySelector('[data-order-workspace]')`);
  await qa.assert(`document.activeElement.getAttribute('data-table-code')==='M5'`,'Escape did not restore table focus');
  await qa.select('M5');
  const after=stockSnapshot(db);
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Active orders changed stock or closed-order reports');
  const expected=service.getForTable('M5');
  fs.writeFileSync(path.join(directory,'phase3-order-expected.json'),JSON.stringify({workspace:expected,stock:after,persisted:persistedOrders(db)},null,2));
  fs.writeFileSync(path.join(directory,'phase3-result.json'),JSON.stringify({tests:'real preload, DOM clicks, native Escape, inventory price edit, navigation while saving, safe retry',metrics,selectionReadOnly:true,rapidClickGuard:true,snapshotPriceChange:true,lastItemCancellation:true,inventoryUnchanged:true,reportsUnchanged:true,expectedTotalCents:595},null,2));
  console.log('FOX Phase 3 order workflow verified in Electron; prepared persisted order for process restart.');
}

export async function verifyOrderRestart(window:BrowserWindow,directory:string,db:Database.Database,errors:string[]) {
  assertQaDirectory(directory); if(path.resolve(db.name)!==path.join(directory,'fox.sqlite'))throw new Error('Restart QA database mismatch');
  const qa=harness(window,directory); const expected=JSON.parse(fs.readFileSync(path.join(directory,'phase3-order-expected.json'),'utf8'));
  await qa.wait(`Boolean(document.querySelector('[data-table-code="T10"]'))`);
  const actual=await qa.evaluate(`window.fox.orders.getForTable('M5')`);
  if(JSON.stringify(actual)!==JSON.stringify(expected.workspace))throw new Error('Actual Electron process restart changed the persisted order');
  if(JSON.stringify(persistedOrders(db))!==JSON.stringify(expected.persisted))throw new Error('Electron restart changed persisted name, price or nullable cost snapshots');
  if(JSON.stringify(stockSnapshot(db))!==JSON.stringify(expected.stock))throw new Error('Electron restart changed stock or reports');
  const metrics=[];
  for(const [width,height] of sizes) { window.setContentSize(width,height); await qa.select('M5'); await qa.assert(`document.querySelector('[data-order-total]').textContent==='5.95 €' && document.querySelector('[data-order-quantity]').textContent==='3'`,'Restart UI does not match persisted order'); metrics.push(await qa.measure(width,height)); await qa.snapshot(`order-restarted-${width}.png`); }
  if(errors.length)throw new Error(`Restart renderer errors: ${errors.join('; ')}`);
  fs.writeFileSync(path.join(directory,'phase3-restart.json'),JSON.stringify({actualProcessRestart:true,canonicalWorkspaceEqual:true,rawOrdersAndAllSnapshotsEqual:true,stockAndReportsEqual:true,metrics,rendererErrors:errors},null,2));
  console.log('FOX Phase 3 real Electron process restart verified: identical M5 order, snapshots, quantities, total and ACTIVE status.');
}
