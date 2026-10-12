// Isolated developer harness; never imported by the release app.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {openDatabase} from '../database/connection';
import {assertQaDirectory} from '../database/safety';
import {createBackup} from '../database/backups';
import {replaceDatabase,recoverInterruptedRestore} from '../database/restore';
import {inspectDatabase} from '../database/health';
import {readSalesReport,reportBounds} from '../database/salesReports';
import {createRepositories} from '../database/repositories';
import {createOrderService} from '../database/orders';
import {createCheckoutService} from '../database/checkout';
import {createReceiptRepository} from '../receipts/repository';
const [directory,mode]=process.argv.slice(2);assertQaDirectory(directory!);
const filename=path.join(directory!,'fox.sqlite'),version='0.5.0-qa.1';
recoverInterruptedRestore(directory!);
let db=openDatabase(filename);
const snapshot=()=>Object.fromEntries((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(({name})=>[name,db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
const digest=()=>crypto.createHash('sha256').update(JSON.stringify(snapshot())).digest('hex');
function config(){db.prepare("UPDATE products SET selling_price_cents=100,purchase_cost_cents=50,track_inventory=1 WHERE id='KAFE-1'").run();db.prepare("UPDATE inventory_balances SET quantity=50000 WHERE product_id='KAFE-1'").run();}
function add(table='M5'){const result=createOrderService(db,createRepositories(db)).addProduct({tableId:table,productId:'KAFE-1'});assert.ok(result.ok);return result.data.order!;}
function complete(id:string){assert.ok(createCheckoutService(db,createOrderService(db,createRepositories(db))).completeOrder({orderId:id}).ok);}
async function run(){
 if(mode==='large'){
  config();const seedStarted=performance.now();const date=new Date(),dates:string[]=[];
  db.transaction(()=>{const order=db.prepare("INSERT INTO orders(id,table_id,status,created_at,updated_at) VALUES (?,'M5','OPEN',?,?)"),item=db.prepare("INSERT INTO order_items(id,order_id,product_id,product_name_snapshot,quantity,unit_price_cents,unit_cost_cents,created_at) VALUES (?,?,'KAFE-1','QA Espresso',1,100,?,?)"),payment=db.prepare("INSERT INTO order_payments VALUES (?,'CASH',?)"),close=db.prepare("UPDATE orders SET status='CLOSED',closed_at=?,sale_number=? WHERE id=?"),movement=db.prepare("INSERT INTO inventory_movements VALUES (?,'KAFE-1','SALE',-1,?,'QA',?)");
   for(let i=1;i<=10000;i++){const completed=new Date(date.getTime()-(i%90)*86400000).toISOString(),id=`QA-sale-${i}`;dates.push(completed);order.run(id,completed,completed);item.run(`QA-item-${i}`,id,i%2?50:null,completed);payment.run(id,completed);close.run(completed,i,id);movement.run(`QA-movement-${i}`,id,completed);createReceiptRepository(db).document(id,false);}
   db.prepare("UPDATE inventory_balances SET quantity=40000 WHERE product_id='KAFE-1'").run();
  }).immediate();
  const timing:Record<string,number>={seedMs:performance.now()-seedStarted};
  for(const period of ['TODAY','7_DAYS','30_DAYS','ALL'] as const){const started=performance.now(),report=readSalesReport(db,period),bounds=reportBounds(period,new Date()),count=dates.filter(d=>d>=bounds.start&&d<bounds.end).length;assert.equal(report.summary.completedOrders,count);assert.equal(report.summary.salesCents,count*100);assert.equal(report.cashCents,count*100);assert.equal(report.cardCents,0);assert.equal(report.unknownPaymentCents,0);if(period==='ALL'){assert.equal(report.summary.costCents,null);assert.equal(report.summary.grossProfitCents,null);assert.equal(report.costCoverage.knownCostCents,250000);assert.equal(report.costCoverage.missingCostLines,5000);}timing[`${period}ReportMs`]=performance.now()-started;}
  const open=add('M6'),backup=path.join(directory!,'QA-large-backup.sqlite'),a=digest();let started=performance.now();await createBackup(db,backup,version);timing.backupMs=performance.now()-started;complete(open.id);complete(add('M7').id);assert.notEqual(digest(),a);
  started=performance.now();await replaceDatabase(db,backup,directory!,version,()=>{});timing.restoreMs=performance.now()-started;
  started=performance.now();db=openDatabase(filename);timing.coldOpenMs=performance.now()-started;assert.equal(digest(),a);assert.equal(inspectDatabase(db,true),6);complete(open.id);assert.equal(readSalesReport(db,'ALL').summary.completedOrders,10001);assert.equal((db.prepare("SELECT quantity FROM inventory_balances WHERE product_id='KAFE-1'").get() as {quantity:number}).quantity,39999);
  const final=snapshot();db.close();started=performance.now();db=openDatabase(filename);timing.warmOpenMs=performance.now()-started;assert.deepEqual(snapshot(),final);
  fs.writeFileSync(path.join(directory!,'large-result.json'),JSON.stringify({passed:true,sales:10000,timing,databaseBytes:fs.statSync(filename).size,roundtrip:true,openOrderRestored:true,continuedSale:true,knownUnknownCostsPreserved:true},null,2));db.close();console.log('LARGE_PASS');
 }else if(mode?.startsWith('recover-')){const phase=mode.slice(8);assert.equal(inspectDatabase(db,true),6);assert.equal(digest(),fs.readFileSync(path.join(directory!,phase+'-expected.sha256'),'utf8'));fs.writeFileSync(path.join(directory!,phase+'-result.json'),JSON.stringify({passed:true,integrity:true,exactState:true}));db.close();console.log('RECOVERY_PASS');
 }else{
  config();const orders=createOrderService(db,createRepositories(db));
  if(mode==='open'||mode==='quantity'){const open=add();if(mode==='quantity')assert.ok(orders.incrementItem({tableId:'M5',itemId:open.items[0]!.id}).ok);}
  if(mode==='sale')complete(add().id);
  if(mode==='settings')createReceiptRepository(db).saveSettings({deviceName:'QA only',displayName:'QA',autoPrint:false,paperWidth:80,copies:1});
  if(mode==='backup'||mode==='restore'){complete(add().id);}
  if(mode==='restore'){
    const backup=path.join(directory!,'QA-A.sqlite');await createBackup(db,backup,version);complete(add('M6').id);fs.writeFileSync(path.join(directory!,mode+'-expected.sha256'),digest());
    await replaceDatabase(db,backup,directory!,version,()=>{},stage=>{if(stage==='CANDIDATE_RENAMED'){console.log('RESTORE_READY');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}});
  }else{
    fs.writeFileSync(path.join(directory!,mode+'-expected.sha256'),digest());
    if(mode==='backup'){const pending=createBackup(db,path.join(directory!,'interrupted.sqlite'),version);console.log('BACKUP_READY');void pending;}
    else console.log(mode?.toUpperCase()+'_READY');
    setInterval(()=>{},1000);
  }
 }
}
run().catch(error=>{console.error(error);process.exit(1);});
