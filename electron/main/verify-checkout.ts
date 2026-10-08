// Real native input in a hidden Electron window; requires an isolated FOX_VERIFY_DIR.
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { readSalesReport } from '../database/salesReports';
import { createRepositories } from '../database/repositories';
import { createOrderService } from '../database/orders';
import { createCheckoutService } from '../database/checkout';
import { assertQaDirectory } from '../database/safety';
import { IPC } from '../../src/types/api';
const pause = (ms: number) => new Promise(resolve=>setTimeout(resolve,ms));
const snapshot = (db: Database.Database) => Object.fromEntries(['orders','order_items','order_payments','inventory_balances','inventory_movements','cafe_tables'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
export async function verifyCheckout(window: BrowserWindow, directory: string, db: Database.Database, errors: string[], restart: boolean) {
  assertQaDirectory(directory);
  if (path.resolve(db.name)!==path.join(directory,'fox.sqlite')) throw new Error('Checkout QA database mismatch');
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const wait = async (condition: string) => { for(let i=0;i<200;i++){ if(await evaluate(condition))return; await pause(25); } throw new Error(`Checkout QA timed out: ${condition}`); };
  const assert = async (condition: string, message: string) => { if(!await evaluate(condition))throw new Error(message); };
  const click = async (selector: string, count=1) => {
    await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const rect = await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`);
    window.webContents.focus();
    for(let i=0;i<count;i++){ window.webContents.sendInputEvent({type:'mouseDown',x:rect.x,y:rect.y,button:'left',clickCount:1}); window.webContents.sendInputEvent({type:'mouseUp',x:rect.x,y:rect.y,button:'left',clickCount:1}); }
    await pause(120);
  };
  const capture = async (name: string) => { await pause(150); fs.writeFileSync(path.join(directory,name+'.png'),(await window.webContents.capturePage()).toPNG()); };
  const resize = async (width: number, height: number) => {
    window.webContents.disableDeviceEmulation();
    let requestedWidth=width,requestedHeight=height;
    window.setContentSize(width,height); await pause(160);
    for(let attempt=0;attempt<3;attempt++) {
      const actual=await evaluate('({width:innerWidth,height:innerHeight})');
      if(actual.width===width&&actual.height===height)return;
      requestedWidth+=width-actual.width; requestedHeight+=height-actual.height;
      window.setContentSize(requestedWidth,requestedHeight); await pause(150);
    }
    // A Windows monitor may clamp oversized native windows. Exercise the same
    // renderer at a true 4K CSS viewport without changing the operator's display.
    {
      window.webContents.enableDeviceEmulation({screenPosition:'desktop',screenSize:{width,height},viewPosition:{x:0,y:0},deviceScaleFactor:1,viewSize:{width,height},scale:1});
      await pause(150);
      const actual=await evaluate('({width:innerWidth,height:innerHeight})');
      if(actual.width===width&&actual.height===height)return;
    }
    throw new Error('Native viewport sizing failed');
  };
  const fill = async (selector: string, value: string) => {
    await click(selector);
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Home'}); window.webContents.sendInputEvent({type:'keyUp',keyCode:'Home'});
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'End',modifiers:['shift']}); window.webContents.sendInputEvent({type:'keyUp',keyCode:'End',modifiers:['shift']});
    await window.webContents.insertText(value); await pause(80);
  };
  const selected = async (code: string) => { await click(`[data-table-code="${code}"]`); await wait(`document.querySelector('#order-heading')?.textContent==='Tavolina ${code}' && ['saved','empty'].includes(document.querySelector('.order-footer')?.dataset.orderState)`); };
  const saved = () => wait(`document.querySelector('.order-footer')?.dataset.orderState==='saved'`);
  const expectedFile = path.join(directory,'checkout-expected.json');
  if (restart) {
    const expected = JSON.parse(fs.readFileSync(expectedFile,'utf8'));
    if (JSON.stringify(snapshot(db))!==JSON.stringify(expected.database) || JSON.stringify(readSalesReport(db,'ALL'))!==JSON.stringify(expected.report))throw new Error('Checkout restart changed persisted sale/stock/report');
    await wait(`Boolean(document.querySelector('[data-table-code="M5"]'))`); await selected('M5');
    await assert(`document.querySelector('[data-table-code="M5"]').dataset.status==='FREE' && document.querySelector('[data-open-checkout]').disabled && document.querySelector('.order-empty')`,'Restart did not keep paid table free');
    await click('[data-nav="reports"]'); await wait(`document.querySelectorAll('[data-sale-id]').length===${expected.report.summary.completedOrders}`);
    await capture('checkout-restart-reports');
    if(errors.length)throw new Error('Renderer errors on checkout restart: '+errors.join(';'));
    fs.writeFileSync(path.join(directory,'checkout-restart.json'),JSON.stringify({passed:true,sales:expected.report.summary.completedOrders,identicalDatabase:true,identicalReport:true},null,2));
    console.log('FOX checkout real Electron process restart PASS'); return;
  }
  db.prepare("UPDATE products SET selling_price_cents=100,purchase_cost_cents=30,track_inventory=1 WHERE id='KAFE-1'").run();
  db.prepare("UPDATE products SET selling_price_cents=100,purchase_cost_cents=40,track_inventory=1 WHERE id='KAFE-2'").run();
  db.prepare("UPDATE inventory_balances SET quantity=10 WHERE product_id IN ('KAFE-1','KAFE-2')").run();
  db.prepare("UPDATE products SET selling_price_cents=150,purchase_cost_cents=NULL,track_inventory=0 WHERE id='UJE-1'").run();
  db.prepare("UPDATE products SET selling_price_cents=100,track_inventory=1 WHERE id IN ('KAFE-3','KAFE-4')").run();
  db.prepare("UPDATE inventory_balances SET quantity=0 WHERE product_id='KAFE-4'").run();
  await click('[data-nav="inventory"]'); await wait(`Boolean(document.querySelector('[data-page="inventory"]'))`);
  await click('[data-nav="tables"]'); await selected('M5');
  await assert(`document.querySelector('[data-order-product="KAFE-3"]').disabled && document.querySelector('[data-order-product="KAFE-3"]').textContent.includes('Stok pa vendosur') && document.querySelector('[data-order-product="KAFE-4"]').disabled && document.querySelector('[data-order-product="KAFE-4"]').textContent.includes('Pa stok')`,'Stock catalog affordances failed');
  const codes = (db.prepare('SELECT code FROM cafe_tables ORDER BY sort_order').all() as {code: string}[]).map(t=>t.code);
  for(const code of codes)await selected(code);
  await selected('M5'); await click('[data-order-product="KAFE-1"]'); await saved();
  await click('[aria-label="Rrit sasinë e Espresso"]'); await saved();
  await click('[data-open-checkout]'); await wait(`Boolean(document.querySelector('.checkout-dialog[open]'))`);
  await assert(`document.querySelectorAll('[data-checkout-item]').length===1 && (() => { const cells=document.querySelector('[data-checkout-item]').cells; return cells[0].querySelector('strong').textContent==='Espresso' && cells[0].querySelector('small').textContent==='€1.00 / njësi' && cells[1].textContent==='2' && cells[2].textContent==='€2.00'; })()`,'Checkout summary does not match saved order snapshots');
  await assert(`!document.querySelector('[data-confirm-payment]').disabled && document.querySelectorAll('[data-payment]').length===0 && document.querySelector('.checkout-method').textContent.includes('Para të gatshme')`,'Removed payment selector is still present');
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await wait(`!document.querySelector('.checkout-dialog')`);
  await assert(`document.querySelector('#order-heading').textContent==='Tavolina M5' && document.querySelector('[data-order-total]').textContent==='€2.00'`,'Escape mutated order or closed table');
  await click('[data-open-checkout]'); await wait(`Boolean(document.querySelector('.checkout-dialog[open]'))`);
  const metrics: unknown[]=[];
  for(const [width,height] of [[1366,768],[1440,900],[1920,1080],[3840,2160]]) {
    await resize(width!,height!);
    const metric = await evaluate(`(() => { const dialog=document.querySelector('.checkout-dialog').getBoundingClientRect(),footer=document.querySelector('.order-footer').getBoundingClientRect(),board=document.querySelector('.board-scroll').getBoundingClientRect(); const boxes=[...document.querySelectorAll('[data-table-code]')].map(e=>e.getBoundingClientRect()); const overlap=boxes.some((a,i)=>boxes.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)); return {width:innerWidth,height:innerHeight,positions:boxes.length,overflow:document.documentElement.scrollWidth>innerWidth,dialogFits:dialog.top>=0&&dialog.bottom<=innerHeight,footerFits:footer.bottom<=innerHeight,allVisible:boxes.every(b=>b.width>=40&&b.height>=40&&b.left>=board.left&&b.right<=board.right&&b.top>=board.top&&b.bottom<=board.bottom),overlap,viewBox:document.querySelector('.floor-scene').getAttribute('viewBox'),m13:document.querySelector('[data-table-code="M13"]').dataset.rotation,confirmVisible:document.querySelector('[data-confirm-payment]').getBoundingClientRect().bottom<=innerHeight}; })()`);
    if(metric.positions!==27||metric.overflow||!metric.dialogFits||!metric.footerFits||!metric.allVisible||metric.overlap||metric.m13!=='45'||!metric.confirmVisible||metric.viewBox!=='72 315 1204 780')throw new Error('Checkout layout failed '+JSON.stringify(metric));
    metrics.push(metric); await capture(`checkout-dialog-${width}`);
  }
  await resize(1366,768);
  // Native Tab stays in the modal; no background navigation/mutation is available.
  for(let i=0;i<7;i++){window.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await pause(20);await assert(`document.activeElement.closest('.checkout-dialog')!==null`,'Modal focus escaped');}
  await click('[data-confirm-payment]',2);
  await wait(`!document.querySelector('.checkout-dialog') && document.querySelector('[data-table-code="M5"]').dataset.status==='FREE'`);
  await assert(`document.querySelector('.order-footer').textContent.includes('Shitja u regjistrua.') && document.querySelector('[data-open-checkout]').disabled`,'Cash completion UI failed');
  const paidCash = readSalesReport(db,'ALL');
  if(paidCash.cashCents!==200||paidCash.summary.completedOrders!==1)throw new Error('Double-click created duplicate sale');
  await selected('M6'); await click('[data-order-product="KAFE-2"]'); await saved(); await click('[data-open-checkout]'); await click('[data-confirm-payment]');
  await wait(`!document.querySelector('.checkout-dialog') && document.querySelector('[data-table-code="M6"]').dataset.status==='FREE'`);
  const history = readSalesReport(db,'ALL');
  await click('[data-nav="inventory"]'); await click('[aria-label="Edito Espresso"]');
  await fill('#sellingPriceCents','9.00'); await fill('#purchaseCostCents','8.00'); await click('[form="product-form"]');
  await wait(`!document.querySelector('dialog[open]')`);
  if(JSON.stringify(history)!==JSON.stringify(readSalesReport(db,'ALL')))throw new Error('Catalog edit changed paid history');
  await click('[data-nav="tables"]');
  await selected('M7'); await click('[data-order-product="KAFE-1"]'); await saved(); await click('[aria-label="Rrit sasinë e Espresso"]'); await saved();
  db.prepare("UPDATE inventory_balances SET quantity=1 WHERE product_id='KAFE-1'").run();
  const beforeFailure=JSON.stringify(snapshot(db)); await click('[data-open-checkout]'); await click('[data-confirm-payment]');
  await wait(`document.querySelector('.checkout-dialog [role="alert"]')?.textContent.includes('stok i pamjaftueshëm')`);
  if(JSON.stringify(snapshot(db))!==beforeFailure)throw new Error('Failed native checkout partially wrote');
  await capture('checkout-insufficient'); await click('.checkout-dialog footer .button-secondary');
  await click('[aria-label="Hiq Espresso"]'); await wait(`document.querySelector('.order-footer')?.dataset.orderState==='empty'`);
  await selected('M8'); await click('[data-order-category="UJE"]'); await click('[data-order-product="UJE-1"]'); await saved();
  // Lose the IPC response AFTER a successful commit; UI must require an authoritative refresh.
  ipcMain.removeHandler(IPC.completeOrder);
  const checkout = createCheckoutService(db,createOrderService(db,createRepositories(db)));
  ipcMain.handle(IPC.completeOrder, (_event,input: unknown) => { checkout.completeOrder(input); throw new Error('Intentional lost checkout response after commit'); });
  await click('[data-open-checkout]'); await click('[data-confirm-payment]');
  await wait(`!document.querySelector('.checkout-dialog') && document.querySelector('.order-body [role="alert"]')?.textContent.includes('Rifresko gjendjen')`);
  await assert(`document.querySelector('[data-open-checkout]').disabled && [...document.querySelectorAll('[data-order-product]')].every(e=>e.disabled)`,'Uncertain checkout allowed a retry before refresh');
  await click('.order-body [role="alert"] .button');
  await wait(`!document.querySelector('.checkout-dialog') && document.querySelector('[data-table-code="M8"]').dataset.status==='FREE'`);
  ipcMain.removeHandler(IPC.completeOrder);
  ipcMain.handle(IPC.completeOrder, (_event,input: unknown) => checkout.completeOrder(input));
  const finalReport=readSalesReport(db,'ALL');
  if(finalReport.summary.salesCents!==450||finalReport.cashCents!==450||finalReport.cardCents!==0||finalReport.unknownPaymentCents!==0||finalReport.summary.costCents!==null||finalReport.summary.netProfitCents!==null||finalReport.summary.completedOrders!==3)throw new Error('Final native report totals failed');
  if(db.prepare("SELECT * FROM inventory_movements WHERE type='SALE'").all().length!==2)throw new Error('SALE movement/untracked inventory failed');
  const reportMetrics: unknown[]=[];
  await click('[data-nav="reports"]'); await wait(`document.querySelectorAll('[data-sale-id]').length===3`);
  await assert(`document.querySelector('[data-cash-total]').textContent==='€4.50' && !document.querySelector('[data-card-total]') && document.querySelector('.notice').textContent.includes('Kosto e paplotë')`,'Report presentation failed');
  await assert(`[...document.querySelectorAll('[data-sale-id]')].every(row=>/^#[0-9]{6}$/.test(row.cells[0].textContent) && /^[0-9]{2}\\.[0-9]{2}\\.[0-9]{4} [0-9]{2}:[0-9]{2}$/.test(row.cells[1].textContent))`,'Human sale number/local date failed');
  for(const sale of finalReport.recentSales) {
    await click(`[data-sale-id="${sale.id}"] button`);
    await wait(`document.querySelectorAll('[data-sale-item]').length===${sale.items.length}`);
    await assert(`(() => {const actual=[...document.querySelectorAll('[data-sale-item]')].map(row=>({name:row.cells[0].textContent,quantity:Number(row.cells[1].textContent)}));return JSON.stringify(actual)===JSON.stringify(${JSON.stringify(sale.items.map(item=>({name:item.name,quantity:item.quantity})))});})()`,'Historical sale detail names/quantities failed');
  }
  await assert(`document.querySelector('[data-cost-coverage]').textContent.includes('1 njësi në 1 rreshta') && document.querySelector('[data-cost-coverage]').textContent.includes('€1.50')`,'Missing historical cost coverage failed');
  for(const [width,height] of [[1366,768],[1440,900],[1920,1080]]) { await resize(width!,height!); const metric=await evaluate(`({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,sales:document.querySelectorAll('[data-sale-id]').length})`); if(metric.overflow||metric.sales!==3)throw new Error('Report overflow'); reportMetrics.push(metric);await capture(`checkout-reports-${width}`); }
  // Native select changes the server filter, without renderer-side aggregation.
  await click('select[aria-label="Periudha e raportit"]'); window.webContents.sendInputEvent({type:'keyDown',keyCode:'Home'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Home'});window.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'}); await pause(250);
  await assert(`document.querySelector('select[aria-label="Periudha e raportit"]').value==='TODAY'`,'Native report period selection failed');
  // Phase 4.1: controlled NULL/FALSE/TRUE fixtures and native operator correction.
  db.prepare("UPDATE products SET selling_price_cents=125,purchase_cost_cents=25,track_inventory=NULL WHERE id='KAFE-5'").run();
  db.prepare("UPDATE products SET track_inventory=1 WHERE id='KAFE-6'").run();
  db.prepare("UPDATE products SET track_inventory=0 WHERE id='KAFE-7'").run();
  await click('[data-nav="inventory"]');
  const inventoryMetrics: unknown[]=[];
  for(const [width,height] of [[1366,768],[1440,900],[1920,1080]]) {
    await resize(width!,height!);
    await assert(`(() => {const row=name=>[...document.querySelectorAll('.catalog tbody tr')].find(r=>r.cells[0].textContent===name);return row('Makiato i madh').textContent.includes('Pa konfiguruar') && row('Kapuçino').textContent.includes('Stok pa vendosur') && row('Latte Makiato').textContent.includes('Nuk ndiqet');})()`,'Inventory states collapsed in UI');
    const metric=await evaluate('({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth})');
    if(metric.overflow)throw new Error('Inventory horizontal overflow');inventoryMetrics.push(metric);await capture(`phase41-inventory-${width}`);
  }
  await resize(1366,768);await click('[aria-label="Edito Makiato i madh"]');
  await assert(`document.querySelector('#trackInventory').value==='' && document.querySelector('#trackInventory option:checked').textContent==='Pa konfiguruar'`,'Unconfigured editor silently selected a decision');
  await click('[form="product-form"]');await wait(`Boolean(document.querySelector('#trackInventory-error'))`);
  await capture('phase41-explicit-tracking');
  const chooseTracking=async (key: string) => {await click('#trackInventory');for(const code of [key,'Enter']){window.webContents.sendInputEvent({type:'keyDown',keyCode:code});window.webContents.sendInputEvent({type:'keyUp',keyCode:code});}await pause(80);};
  await chooseTracking('End');await assert(`document.querySelector('#trackInventory').value==='no'`,'Native Jo choice failed');
  await click('[form="product-form"]');await wait(`!document.querySelector('dialog[open]')`);
  await click('[data-nav="tables"]');await selected('M10');
  await click('[data-order-product="KAFE-5"]');await saved();
  const untrackedBalances=JSON.stringify(db.prepare('SELECT * FROM inventory_balances ORDER BY rowid').all());
  await click('[data-open-checkout]');await click('[data-confirm-payment]');await wait(`document.querySelector('[data-table-code="M10"]').dataset.status==='FREE' && !document.querySelector('.checkout-dialog')`);
  if(JSON.stringify(db.prepare('SELECT * FROM inventory_balances ORDER BY rowid').all())!==untrackedBalances || db.prepare("SELECT * FROM inventory_movements WHERE type='SALE'").all().length!==2)throw new Error('Jo sale touched unit inventory');
  await selected('M11');await click('[data-order-product="KAFE-5"]');await saved();
  db.prepare("UPDATE products SET track_inventory=NULL WHERE id='KAFE-5'").run();
  db.prepare("UPDATE inventory_balances SET quantity=1 WHERE product_id='KAFE-5'").run();
  await click('[data-nav="inventory"]');await click('[data-nav="tables"]');await selected('M11');
  await assert(`document.querySelector('[data-order-product="KAFE-5"]').disabled && document.querySelector('[data-order-product="KAFE-5"]').textContent.includes('Konfiguro stokun')`,'NULL product can be newly ordered');
  const ambiguousBefore=JSON.stringify(snapshot(db));
  const malicious=await evaluate(`window.fox.orders.completeOrder({orderId:${JSON.stringify((db.prepare("SELECT id FROM orders WHERE table_id='M11' AND status='OPEN'").get() as {id:string}).id)},paymentMethod:'CARD'})`);
  if(malicious.ok||malicious.code!=='INVALID_REQUEST'||JSON.stringify(snapshot(db))!==ambiguousBefore)throw new Error('Stale renderer created CARD or wrote state');
  await click('[data-open-checkout]');await click('[data-confirm-payment]');await wait(`document.querySelector('.checkout-dialog [role="alert"]')?.textContent.includes('Ndjek stokun')`);
  if(JSON.stringify(snapshot(db))!==ambiguousBefore)throw new Error('Ambiguous checkout mutated state');await capture('phase41-null-blocked');await click('[data-cancel-payment]');
  await click('[data-nav="inventory"]');await click('[aria-label="Edito Makiato i madh"]');await chooseTracking('Home');
  await assert(`document.querySelector('#trackInventory').value==='yes'`,'Native Po choice failed');await click('[form="product-form"]');await wait(`!document.querySelector('dialog[open]')`);
  await click('[data-nav="tables"]');await selected('M11');await click('[data-open-checkout]');await click('[data-confirm-payment]');await wait(`document.querySelector('[data-table-code="M11"]').dataset.status==='FREE' && !document.querySelector('.checkout-dialog')`);
  if((db.prepare("SELECT quantity FROM inventory_balances WHERE product_id='KAFE-5'").get() as {quantity:number}).quantity!==0||db.prepare("SELECT * FROM inventory_movements WHERE type='SALE'").all().length!==3)throw new Error('Po deduction failed');
  // Historical fixtures are inserted directly in isolated SQLite, never via supported checkout.
  const fixtureOrders=createOrderService(db,createRepositories(db));
  for(const [tableId,method] of [['M9','CARD'],['M10',null]] as const){const result=fixtureOrders.addProduct({tableId,productId:'UJE-1'});if(!result.ok)throw new Error(result.message);const orderId=result.data.order!.id,now=new Date().toISOString();if(method)db.prepare('INSERT INTO order_payments VALUES (?,?,?)').run(orderId,method,now);db.prepare("UPDATE orders SET status='CLOSED',closed_at=?,sale_number=(SELECT MAX(sale_number)+1 FROM orders) WHERE id=?").run(now,orderId);db.prepare("UPDATE cafe_tables SET status='FREE' WHERE id=?").run(tableId);}
  const auditedReport=readSalesReport(db,'ALL');
  if(auditedReport.summary.salesCents!==1000||auditedReport.cashCents!==700||auditedReport.cardCents!==150||auditedReport.unknownPaymentCents!==150||auditedReport.summary.completedOrders!==7)throw new Error('Legacy reconciliation failed');
  await click('[data-nav="reports"]');await wait(`document.querySelectorAll('[data-sale-id]').length===7`);
  await assert(`document.querySelector('[data-cash-total]').textContent==='€7.00' && !document.querySelector('[data-card-total]') && document.body.textContent.includes('Kartelë historike: €1.50') && document.body.textContent.includes('Pa metodë të regjistruar: €1.50')`,'Legacy reporting relabeled or omitted money');
  for(const [width,height] of [[1366,768],[1440,900],[1920,1080]]){await resize(width!,height!);await assert(`document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('[data-sale-id]')].every(row=>/^#[0-9]{6}$/.test(row.cells[0].textContent) && !row.textContent.includes(row.dataset.saleId))`,'Legacy report overflow/raw UUID');await capture(`phase41-legacy-${width}`);}
  fs.writeFileSync(expectedFile,JSON.stringify({database:snapshot(db),report:auditedReport},null,2));
  if(errors.length)throw new Error('Checkout renderer errors: '+errors.join(';'));
  fs.writeFileSync(path.join(directory,'checkout-result.json'),JSON.stringify({passed:true,nativeConfirm:true,noPaymentSelector:true,cashOnly:true,saleNumber:true,localDate:true,inventoryNull:true,explicitPoJo:true,legacyPaymentRead:true,cardCommandRejected:true,doubleClick:true,escape:true,focusTrap:true,lostResponseRecovery:true,all27NativeSelections:true,insufficientRollback:true,unknownStockCatalog:true,historicalSnapshots:true,nullCost:true,metrics,reportMetrics,inventoryMetrics},null,2));
  console.log('FOX native checkout/payment/inventory/report QA PASS');
}
