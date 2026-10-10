// Developer-only isolated full-day acceptance; not imported by production main.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {openDatabase} from '../database/connection';
import {assertQaDirectory} from '../database/safety';
import {createRepositories} from '../database/repositories';
import {createConfigurationService} from '../database/configuration';
import {createOrderService} from '../database/orders';
import {createCheckoutService} from '../database/checkout';
import {readSalesReport,reportBounds} from '../database/salesReports';
import {createBackup,validateBackup} from '../database/backups';
import {replaceDatabase} from '../database/restore';
import {inspectDatabase} from '../database/health';
async function run(){
const [directory,restoreDirectory,mode]=process.argv.slice(2);
if(!directory||!restoreDirectory)throw Error('Two isolated QA paths required');
assertQaDirectory(directory);assertQaDirectory(restoreDirectory);
const version='0.6.0-rc.1',filename=path.join(directory,'fox.sqlite');let db=openDatabase(filename,version);
const rows=()=>Object.fromEntries((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(({name})=>[name,db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
const count=(name:string)=>Number((db.prepare(`SELECT COUNT(*) n FROM ${name}`).get() as {n:number}).n);
const fresh={tables:count('cafe_tables'),products:count('products'),categories:count('categories'),orders:count('orders'),payments:count('order_payments'),movements:count('inventory_movements'),documents:count('receipt_documents'),jobs:count('receipt_print_jobs')};
assert.deepEqual(fresh,{tables:27,products:21,categories:5,orders:0,payments:0,movements:0,documents:0,jobs:0});
assert.ok(createRepositories(db).listProducts().every(p=>p.sellingPriceCents===null&&p.purchaseCostCents===null&&p.trackInventory===null&&p.stockQuantity===null&&p.lowStockThreshold===null));
const result:Record<string,unknown>={fresh,version,isolated:true};
if(mode!=='production-only'){
 const config=()=>createConfigurationService(db,createRepositories(db));
 const orders=()=>createOrderService(db,createRepositories(db));
 const checkout=()=>createCheckoutService(db,orders());
 const set=(id:string,price:number,cost:number|null,tracking:boolean)=>{const p=createRepositories(db).listProducts().find(p=>p.id===id)!;assert.ok(config().updateProduct({...p,sellingPriceCents:price,purchaseCostCents:cost,trackInventory:tracking}).ok);};
 set('KAFE-1',100,50,true);set('PIJE-1',150,60,true);set('CAJ-1',100,null,false);
 for(const id of ['KAFE-1','PIJE-1']){const input={requestId:crypto.randomUUID(),productId:id,quantity:500};assert.ok(config().addSupply(input).ok);assert.ok(config().addSupply(input).ok);assert.equal(createRepositories(db).listProducts().find(p=>p.id===id)!.stockQuantity,500);}
 // An explicit isolated stock adjustment exercises reconciliation, not a new UI feature.
 db.transaction(()=>{db.prepare("INSERT INTO inventory_movements VALUES (?,?, 'MANUAL_ADJUSTMENT',?,NULL,?,?)").run(crypto.randomUUID(),'PIJE-1',-3,'QA counted adjustment',new Date().toISOString());db.prepare("UPDATE inventory_balances SET quantity=quantity-3 WHERE product_id='PIJE-1'").run();})();
 const tableIds=createRepositories(db).listTables().map(t=>t.id);let expectedRevenue=0,restarts=0;const started=performance.now();
 for(let i=0;i<120;i++){
  const tableId=tableIds[i%tableIds.length]!;
  assert.ok(orders().addProduct({tableId,productId:'KAFE-1'}).ok);assert.ok(orders().addProduct({tableId,productId:i%2?'CAJ-1':'PIJE-1'}).ok);
  let w=orders().getForTable(tableId);const coffee=w.order!.items.find(p=>p.productId==='KAFE-1')!;
  assert.ok(orders().incrementItem({tableId,itemId:coffee.id}).ok);if(i%3===0)assert.ok(orders().decrementItem({tableId,itemId:coffee.id}).ok);
  const other=tableIds[(i+1)%tableIds.length]!;assert.equal(orders().getForTable(other).order,null);w=orders().getForTable(tableId);assert.ok(w.order);
  if(i%25===0){const before=rows(),report=readSalesReport(db,'ALL');db.close();db=openDatabase(filename,version);assert.deepEqual(rows(),before);assert.deepEqual(readSalesReport(db,'ALL'),report);restarts++;w=orders().getForTable(tableId);}
  expectedRevenue+=w.order!.totalCents;
  const request={orderId:w.order!.id,expectedRevision:w.order!.revision};assert.ok(checkout().completeOrder(request).ok);assert.equal(checkout().completeOrder(request).ok,false);
  assert.equal(orders().getForTable(tableId).table.status,'FREE');const report=readSalesReport(db,'ALL');assert.equal(report.summary.salesCents,expectedRevenue);assert.equal(report.cashCents,expectedRevenue);assert.equal(report.summary.completedOrders,i+1);
 }
 const reconcile=()=>{
  const report=readSalesReport(db,'ALL');const revenue=Number((db.prepare("SELECT SUM(i.quantity*i.unit_price_cents) n FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.status='CLOSED'").get() as {n:number}).n);
  assert.equal(report.summary.salesCents,revenue);assert.equal(report.cashCents,revenue);assert.equal(report.cardCents,0);assert.equal(report.unknownPaymentCents,0);assert.equal(report.summary.completedOrders,count('order_payments'));assert.equal(report.summary.costCents,null);
  const sequence=db.prepare("SELECT sale_number n FROM orders WHERE status='CLOSED' ORDER BY sale_number").all() as {n:number}[];assert.deepEqual(sequence.map(s=>s.n),Array.from({length:sequence.length},(_,i)=>i+1));
  const stock=createRepositories(db).listProducts().filter(p=>p.trackInventory===true).map(p=>{const delta=Number((db.prepare('SELECT SUM(quantity_delta) n FROM inventory_movements WHERE product_id=?').get(p.id) as {n:number}).n);assert.equal(p.stockQuantity,delta);return {product:p.id,opening:0,movementSum:delta,closing:p.stockQuantity};});
  assert.equal(inspectDatabase(db,true),4);return {revenueCents:revenue,cashCents:report.cashCents,sales:sequence.length,stock,unknownCost:true};
 };
 const accounting=reconcile(),beforeHistory=readSalesReport(db,'ALL');set('KAFE-1',250,80,true);const p=createRepositories(db).listProducts().find(p=>p.id==='KAFE-1')!;assert.ok(config().updateProduct({...p,name:'QA changed after historical sale',active:false}).ok);assert.deepEqual(readSalesReport(db,'ALL'),beforeHistory);assert.ok(config().updateProduct({...p,name:'Espresso',active:true}).ok);
 const backup=path.join(directory,'day-end.sqlite');await createBackup(db,backup,version);await validateBackup(backup);const exact=rows();
 db.close();db=openDatabase(path.join(restoreDirectory,'fox.sqlite'),version);await replaceDatabase(db,backup,restoreDirectory,version,()=>{});db=openDatabase(path.join(restoreDirectory,'fox.sqlite'),version);assert.deepEqual(rows(),exact);assert.deepEqual(reconcile(),accounting);
 const add=orders().addProduct({tableId:'M5',productId:'KAFE-1'});assert.ok(add.ok);assert.ok(checkout().completeOrder({orderId:orders().getForTable('M5').order!.id}).ok);assert.equal(reconcile().sales,121);
 // Local-time boundaries, including year/month change and DST, remain calendar-based.
 for(const now of [new Date(2026,0,1,0,0),new Date(2026,9,25,0,0),new Date(2026,10,1,0,0),new Date(2026,11,31,23,59)]){const b=reportBounds('TODAY',now),start=new Date(b.start),end=new Date(b.end);assert.equal(start.getHours(),0);assert.equal(end.getHours(),0);assert.equal(start.getDate(),now.getDate());assert.ok(end>start);}
 Object.assign(result,{fullDay:true,completedSales:120,restarts,accounting,backupValidated:true,separateRestoreExact:true,continuedSale:true,historicalSnapshotsUnchanged:true,duplicateCheckoutRejected:true,durationMs:performance.now()-started});
}
db.close();fs.writeFileSync(path.join(directory,mode==='production-only'?'production-db-result.json':'product-day-result.json'),JSON.stringify({passed:true,...result},null,2));console.log(JSON.stringify({passed:true,directory,restoreDirectory,...result}));
}
run().catch(error=>{console.error(error);process.exit(1);});
