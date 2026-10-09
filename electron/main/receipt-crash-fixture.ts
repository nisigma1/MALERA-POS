// Bundled by the developer-only verification script; never included in production entrypoints.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openDatabase} from '../database/connection';
import {assertQaDirectory} from '../database/safety';
import {createReceiptRepository} from '../receipts/repository';
import {PrintManager} from '../receipts/manager';
import {createRepositories} from '../database/repositories';
import {createOrderService} from '../database/orders';
import {createCheckoutService} from '../database/checkout';
const [directory,mode]=process.argv.slice(2);assertQaDirectory(directory!);
const db=openDatabase(path.join(directory!,'fox.sqlite')),repo=createReceiptRepository(db);
const snapshot=()=>Object.fromEntries(['orders','order_items','order_payments','inventory_balances','inventory_movements','cafe_tables'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
async function run(){
 if(mode==='pending'||mode==='submitting'){
  if(mode==='pending'){db.prepare("UPDATE products SET selling_price_cents=100,purchase_cost_cents=50,track_inventory=1 WHERE id='KAFE-1'").run();db.prepare("UPDATE inventory_balances SET quantity=10 WHERE product_id='KAFE-1'").run();}
  repo.saveSettings({deviceName:'Crash QA printer',displayName:'Crash QA printer',autoPrint:true,paperWidth:80,copies:1});
  const orders=createOrderService(db,createRepositories(db)),add=orders.addProduct({tableId:'M5',productId:'KAFE-1'});assert.ok(add.ok);assert.ok(createCheckoutService(db,orders).completeOrder({orderId:add.data.order!.id}).ok);
  fs.writeFileSync(path.join(directory!,mode+'-financial.json'),JSON.stringify(snapshot()));
  if(mode==='pending'){console.log('PENDING_READY');setInterval(()=>{},1000);}
  else{const manager=new PrintManager(repo,{list:async()=>[{deviceName:'Crash QA printer',displayName:'QA',description:'mock'}],submit:async()=>{console.log('SUBMITTING_READY');await new Promise(()=>{});}},60000);manager.start();setInterval(()=>{},1000);}
 }else{
  let calls=0;const manager=new PrintManager(repo,{list:async()=>[{deviceName:'Crash QA printer',displayName:'QA',description:'mock'}],submit:async()=>{calls++;}});manager.start();await manager.idle();
  const phase=mode==='recover-pending'?'pending':'submitting';assert.deepEqual(snapshot(),JSON.parse(fs.readFileSync(path.join(directory!,phase+'-financial.json'),'utf8')));
  assert.equal(calls,phase==='pending'?1:0);assert.equal(repo.recentJobs()[0]!.status,phase==='pending'?'SUBMITTED':'UNKNOWN');
  fs.writeFileSync(path.join(directory!,mode+'.json'),JSON.stringify({passed:true,submissionCalls:calls,status:repo.recentJobs()[0]!.status,financialRowsUnchanged:true}));manager.stop();db.close();console.log('RECOVERY_PASS');
 }
}
run().catch(error=>{console.error(error);process.exit(1);});
