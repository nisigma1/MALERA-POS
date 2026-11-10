// Standalone QA harness. Excluded by the production package allowlist.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import {openDatabase} from '../../electron/database/connection';
import {assertQaDirectory} from '../../electron/database/safety';
import {createBackup,validateBackup} from '../../electron/database/backups';
import {replaceDatabase,recoverInterruptedRestore} from '../../electron/database/restore';
import {services,configure,accepted,sale,assertAll,snapshot,digest,streamDigest,canonical,assertDatabaseIntegrity,assertCanonicalPositionInvariants,assertOrderInvariants,assertCheckoutInvariants,assertInventoryInvariants,assertFinancialInvariants,assertCashInvariants,assertReservationInvariants} from '../../tests/support/reliability';

const [directory,mode,action,stage]=process.argv.slice(2);assertQaDirectory(directory!);
const file=path.join(directory!,'fox.sqlite'),output=(v:unknown)=>process.stdout.write(JSON.stringify(v)+'\n');
const timings:Record<string,number[]>={};
let measurementLabel='unlabelled';
function time<T>(name:string,fn:()=>T):T {const t=performance.now(),previous=measurementLabel;measurementLabel=name;try{return fn();}finally{(timings[name]??=[]).push(performance.now()-t);measurementLabel=previous;}}
function measuredConnection(raw:Database.Database):Database.Database {
 // The native transaction controller caches its own prepared COMMIT statement;
 // intercepting database.prepare cannot observe it. This standalone QA process
 // observes the actual native Statement prototype, never the production bundle.
 const prototype=Object.getPrototypeOf(raw.prepare('SELECT 1')) as {run:Database.Statement['run']};const original=prototype.run;
 prototype.run=function(this:Database.Statement,...args:unknown[]){const started=performance.now();try{return original.apply(this,args);}finally{if(this.source==='COMMIT')(timings[measurementLabel+':commit']??=[]).push(performance.now()-started);}};
 return raw;
}
async function asyncTime<T>(name:string,fn:()=>Promise<T>):Promise<T>{const t=performance.now();try{return await fn();}finally{(timings[name]??=[]).push(performance.now()-t);}}
function summary(){return Object.fromEntries(Object.entries(timings).map(([k,values])=>{const sorted=[...values].sort((a,b)=>a-b);return [k,{samples:sorted.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],max:sorted.at(-1)}];}));}
function write(name:string,data:unknown){fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync(path.join('outputs',name),JSON.stringify(data,null,2));}
function ready(db:Database.Database,point:string){output({ready:true,point,hash:point==='precommit'||!db.open?null:digest(snapshot(db))});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}
const expense=()=>({requestId:randomUUID(),amountCents:37,category:'OTHER' as const,occurredAt:new Date().toISOString(),description:'QA reliability',paidFromTill:true,note:''});
const loss=()=>({requestId:randomUUID(),productId:'KAFE-1',quantity:1,reason:'DAMAGED' as const,note:''});
const cash=(db:Database.Database)=>{const p=services(db).finance.cashPreview({openingCents:10000});return {requestId:randomUUID(),sessionId:p.sessionId,openingCents:10000,countedCents:p.expectedCents,expectedFingerprint:p.fingerprint,note:''};};

async function main(){
if(mode==='latency'){
 if(action){assertQaDirectory(path.dirname(action));const source=openDatabase(action);try{await source.backup(file);}finally{source.close();}}
 const raw=time('open',()=>openDatabase(file));if(!action)configure(raw,137,53,10000);const db=measuredConnection(raw),s=services(db);for(const row of db.prepare("SELECT id FROM orders WHERE status='OPEN'").all() as {id:string}[])accepted(s.checkout.completeOrder({orderId:row.id}));
 for(let i=0;i<30;i++){
  const order=time('addProduct',()=>accepted(s.orders.addProduct({tableId:'M5',productId:'KAFE-1'}))).order!;time('checkout',()=>accepted(s.checkout.completeOrder({orderId:order.id})));time('expense',()=>accepted(s.finance.saveExpense(expense())));time('loss',()=>accepted(s.finance.recordLoss(loss())));
  const b=time('reservation',()=>accepted(s.reservations.reserve({requestId:randomUUID(),tableId:'M13',customerName:'QA',phone:'',startsAt:'2099-01-01T10:00:00.000Z',guests:2,note:''})));accepted(s.reservations.cancel({tableId:'M13',reservationId:b.reservation!.id}));time('cashClose',()=>accepted(s.finance.closeCash(cash(db))));time('report',()=>s.finance.report({period:'ALL'}));
 }
 for(let i=0;i<5;i++){const saved=path.join(directory!,`timed-${i}.sqlite`);await asyncTime('backup',()=>createBackup(db,saved,'0.7.2-rc.1'));await asyncTime('restoreValidation',()=>validateBackup(saved));}
 assertAll(db);assert.equal(timings['checkout:commit']?.length,30,'Every native checkout COMMIT must be measured');time('shutdown',()=>db.close());const result={passed:true,atScale:!!action,samples:30,timings:summary(),commitInstrumentation:'Actual native Statement prototype COMMIT duration in standalone owned QA process; no production hook'};write(action?'fox-phase10-latency-scale.json':'fox-phase10-latency-fresh.json',result);output(result);
}else if(mode==='profile'){
 const db=openDatabase(file),measurements:unknown[]=[];const observed=new Proxy(db,{get(target,key){if(key==='prepare')return (sql:string)=>{const stmt=target.prepare(sql);return new Proxy(stmt,{get(st,op){const value=Reflect.get(st,op);if(typeof value!=='function')return value;return (...args:unknown[])=>{const t=performance.now();try{return value.apply(st,args);}finally{measurements.push({sql:sql.replace(/\s+/g,' '),method:String(op),ms:performance.now()-t});}};}});};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}) as Database.Database;
 services(observed).finance.report({period:'ALL'});output({measurements,memory:process.memoryUsage()});write('fox-phase10-query-profile.json',{measurements,memory:process.memoryUsage()});db.close();
}else if(mode==='audit'){
 const db=openDatabase(file);for(const [name,check] of Object.entries({database:assertDatabaseIntegrity,positions:assertCanonicalPositionInvariants,orders:assertOrderInvariants,checkout:assertCheckoutInvariants,inventory:assertInventoryInvariants,cash:assertCashInvariants,reservations:assertReservationInvariants,finance:assertFinancialInvariants})){output({starting:name,memory:process.memoryUsage().rss});time(name,()=>check(db));output({completed:name,timings:summary(),memory:process.memoryUsage().rss});}db.close();
}else if(mode==='prepare'){
 const db=openDatabase(file);configure(db,137,53,200000);const s=services(db);s.receipts.saveSettings({deviceName:'QA printer',displayName:'QA',autoPrint:false,paperWidth:80,copies:1});
 const order=accepted(s.orders.addProduct({tableId:'M5',productId:'KAFE-1'})).order!;const commands={checkout:{orderId:order.id},expense:expense(),loss:loss(),supply:{requestId:randomUUID(),productId:'KAFE-1',quantity:3,drawerPaymentCents:75},movement:{requestId:randomUUID(),direction:'IN',amountCents:17,reason:'QA',note:''},reservation:{requestId:randomUUID(),tableId:'M13',customerName:'QA',phone:'',startsAt:'2099-01-01T10:00:00.000Z',guests:2,note:''},close:{}};
 if(action==='close'||action==='restore'){accepted(s.checkout.completeOrder(commands.checkout));commands.close=cash(db);}
 let restoreHash:string|undefined;
 if(action==='restore'){await createBackup(db,path.join(directory!,'master.sqlite'),'0.7.2-rc.1');restoreHash=digest(snapshot(db));sale(db,'M6');}
 if(action==='backup'){accepted(s.finance.recordCashMovement(commands.movement));accepted(s.reservations.reserve(commands.reservation));}
 fs.writeFileSync(path.join(directory!,'commands.json'),JSON.stringify(commands));assertAll(db);output({hash:digest(snapshot(db)),restoreHash});db.close();
}else if(mode==='crash'){
 const db=openDatabase(file),s=services(db),command=JSON.parse(fs.readFileSync(path.join(directory!,'commands.json'),'utf8'))[action!];
 if(action==='backup'){
  const target=path.join(directory!,'master.sqlite');let observed=db;
  if(stage==='precommit')observed=new Proxy(db,{get(real,key){if(key==='backup')return (filename:string)=>real.backup(filename,{progress:()=>{ready(real,'precommit');return 100;}});const value=Reflect.get(real,key);return typeof value==='function'?value.bind(real):value;}}) as Database.Database;
  await createBackup(observed,target,'0.7.2-rc.1');ready(db,'postcommit');return;
 }
 if(action==='restore'){
  await replaceDatabase(db,path.join(directory!,'master.sqlite'),directory!,'0.7.2-rc.1',()=>{},point=>{if(point===stage)ready(db,'precommit');});const restored=openDatabase(file);ready(restored,'postcommit');return;
 }
 if(stage==='precommit'){
  const target={checkout:['orders','AFTER UPDATE','WHEN NEW.status=\'CLOSED\''],expense:['expense_revisions','AFTER INSERT',''],loss:['stock_losses','AFTER INSERT',''],supply:['cash_events','AFTER INSERT',''],movement:['cash_events','AFTER INSERT',''],reservation:['table_reservations','AFTER INSERT',''],close:['cash_closes','AFTER INSERT','']}[action!]!;
  db.function('qa_barrier',()=>{ready(db,'precommit');return 0;});db.exec(`CREATE TEMP TRIGGER qa_barrier ${target[1]} ON ${target[0]} ${target[2]} BEGIN SELECT qa_barrier(); END`);
 }
 const r=action==='checkout'?s.checkout.completeOrder(command):action==='expense'?s.finance.saveExpense(command):action==='loss'?s.finance.recordLoss(command):action==='supply'?s.configuration.addSupply(command):action==='movement'?s.finance.recordCashMovement(command):action==='reservation'?s.reservations.reserve(command):s.finance.closeCash(command);accepted(r);ready(db,'postcommit');
}else if(mode==='recover'){
 recoverInterruptedRestore(directory!);const db=openDatabase(file);assertAll(db);const before=digest(snapshot(db));
 if(stage==='postcommit'&&!['backup','restore'].includes(action!)){
  const s=services(db),command=JSON.parse(fs.readFileSync(path.join(directory!,'commands.json'),'utf8'))[action!];const r=action==='checkout'?s.checkout.completeOrder(command):action==='expense'?s.finance.saveExpense(command):action==='loss'?s.finance.recordLoss(command):action==='supply'?s.configuration.addSupply(command):action==='movement'?s.finance.recordCashMovement(command):action==='reservation'?s.reservations.reserve(command):s.finance.closeCash(command);
  if(action==='checkout')assert.deepEqual(r,{ok:false,code:'ALREADY_COMPLETED',message:'Kjo porosi është paguar tashmë. Rifresko gjendjen.'});else accepted(r);assert.equal(digest(snapshot(db)),before);
 }
 if(action==='backup'&&stage==='postcommit')await validateBackup(path.join(directory!,'master.sqlite'));
 if(['backup','restore'].includes(action!)){const s=services(db);for(const row of db.prepare("SELECT id FROM orders WHERE status='OPEN'").all() as {id:string}[])accepted(s.checkout.completeOrder({orderId:row.id}));sale(db,'M6');accepted(s.finance.saveExpense(expense()));assertAll(db);}
 output({passed:true,hash:before,continued:['backup','restore'].includes(action!),quickCheck:'ok',foreignKeys:'ok'});db.close();
}else if(mode==='long'){
 const requested=Number(action??100000);assert.ok([10000,50000,100000].includes(requested));let db=time('open',()=>openDatabase(file));const resumed=(db.prepare("SELECT count(*) n FROM orders WHERE status='CLOSED'").get() as {n:number}).n;if(!resumed)configure(db,137,53,requested*3);assert.ok(resumed<=requested);
 const NativeDate=Date;let instant=new NativeDate('2025-01-01T12:00:00.000Z').getTime();globalThis.Date=new Proxy(NativeDate,{construct(target,args){return new target(...(args.length?args:[instant]) as [number]);},get(target,key){if(key==='now')return ()=>instant;return Reflect.get(target,key);}}) as DateConstructor;
 const months=new Map<string,{revenue:number;cogs:number;expense:number;loss:number}>(),growth:unknown[]=[],walSamples:unknown[]=[];const size=()=>({db:fs.statSync(file).size,wal:fs.existsSync(file+'-wal')?fs.statSync(file+'-wal').size:0,shm:fs.existsSync(file+'-shm')?fs.statSync(file+'-shm').size:0});
 const freshFile=path.join(directory!,`fresh-baseline-${randomUUID()}.sqlite`),empty=openDatabase(freshFile);empty.pragma('wal_checkpoint(TRUNCATE)');growth.push({sales:0,db:fs.statSync(freshFile).size,wal:0,shm:fs.existsSync(freshFile+'-shm')?fs.statSync(freshFile+'-shm').size:0});empty.close();
 if(resumed)growth.push({sales:resumed,...size(),resumed:true});for(const historical of [10000,50000]){const saved=path.join(directory!,`scale-${historical}.sqlite`);if(historical<resumed&&fs.existsSync(saved))growth.push({sales:historical,db:fs.statSync(saved).size,verifiedHistoricalBackup:true});}
 const sqlite={journalMode:db.pragma('journal_mode',{simple:true}),synchronous:db.pragma('synchronous',{simple:true}),foreignKeys:db.pragma('foreign_keys',{simple:true}),busyTimeout:db.pragma('busy_timeout',{simple:true}),autoCheckpointPages:db.pragma('wal_autocheckpoint',{simple:true}),transactionMode:'IMMEDIATE',operationalConnections:1};
 const started=performance.now();let count=resumed;
 for(let i=0;i<requested;i++){
  instant=new NativeDate(Date.UTC(2025+Math.floor((i%24)/12),(i%24)%12,1+(Math.floor(i/24)%27),12)).getTime();const month=new Date().toISOString().slice(0,7);const oracle=months.get(month)??{revenue:0,cogs:0,expense:0,loss:0};months.set(month,oracle);
  oracle.revenue+=137;oracle.cogs+=53;if(i<resumed){if(i%1000===0){oracle.expense+=37;oracle.loss+=53;}continue;}
  const current=services(db).orders.getForTable(canonical[i%27]).order;
  if(current){assert.equal(current.totalCents,137);assert.equal(current.items.length,1);assert.equal(current.items[0]!.quantity,1);time('checkout',()=>accepted(services(db).checkout.completeOrder({orderId:current.id,expectedRevision:current.revision})));}
  else time('checkout',()=>sale(db,canonical[i%27]));count++;
  if(i%1000===0){const s=services(db);time('expense',()=>accepted(s.finance.saveExpense(expense())));oracle.expense+=37;time('loss',()=>accepted(s.finance.recordLoss(loss())));oracle.loss+=53;time('supply',()=>accepted(s.configuration.addSupply({requestId:randomUUID(),productId:'KAFE-1',quantity:3,drawerPaymentCents:75})));accepted(s.finance.recordCashMovement({requestId:randomUUID(),direction:'IN',amountCents:17,reason:'QA',note:''}));const b=time('reservation',()=>accepted(s.reservations.reserve({requestId:randomUUID(),tableId:'M13',customerName:'QA',phone:'',startsAt:'2099-01-01T10:00:00.000Z',guests:2,note:''})));accepted(s.reservations.cancel({tableId:'M13',reservationId:b.reservation!.id}));time('cashClose',()=>accepted(s.finance.closeCash(cash(db))));walSamples.push({sales:count,...size()});}
  if([10000,50000,100000].includes(count)){growth.push({sales:count,...size()});output({progress:count,elapsedMs:performance.now()-started});time('report',()=>assertAll(db));await asyncTime('backup',()=>createBackup(db,path.join(directory!,`scale-${count}.sqlite`),'0.7.1-rc.2'));time('shutdown',()=>db.close());db=time('open',()=>openDatabase(file));}
 }
 const finance=assertAll(db);assert.equal(finance.revenue,requested*137);assert.equal(finance.cogs,requested*53);assert.equal(finance.expense,Math.ceil(requested/1000)*37);assert.equal(finance.loss,Math.ceil(requested/1000)*53);
 for(const [month,expected] of months){const [year,m]=month.split('-').map(Number),end=new NativeDate(year!,m!,0).getDate();const r=time('monthlyReport',()=>services(db).finance.report({period:'CUSTOM',startDate:month+'-01',endDate:month+'-'+String(end).padStart(2,'0')}));assert.equal(r.sales.summary.salesCents,expected.revenue);assert.equal(r.sales.summary.costCents,expected.cogs);assert.equal(r.sales.summary.expensesCents,expected.expense);assert.equal(r.stockLossCents,expected.loss);}
 for(let i=0;i<30;i++){time('todayReport',()=>services(db).finance.report({period:'TODAY'}));time('weeklyReport',()=>services(db).finance.report({period:'WEEK'}));time('yearReport',()=>services(db).finance.report({period:'CUSTOM',startDate:'2025-01-01',endDate:'2025-12-31'}));time('reservationLookup',()=>services(db).orders.getForTable('M13'));time('cashHistory',()=>services(db).finance.cashPreview({openingCents:10000}));}
 const backup=path.join(directory!,`scale-${requested}.sqlite`);if(!fs.existsSync(backup))await asyncTime('backup',()=>createBackup(db,backup,'0.7.2-rc.1'));await asyncTime('backupValidation',()=>validateBackup(backup));const before=streamDigest(db);await asyncTime('restore',()=>replaceDatabase(db,backup,directory!,'0.7.1-rc.2',()=>{}));db=openDatabase(file);assert.equal(streamDigest(db),before);sale(db);assertAll(db);
 const result={passed:true,sales:requested,resumedAfterControlledInterruptionAt:resumed,months:months.size,elapsedMs:performance.now()-started,financial:finance,growth,walSamples,sqlite,timings:summary(),sequenceMaximum:(db.prepare('SELECT MAX(sale_number) n FROM orders').get() as {n:number}).n,isolated:true,quickCheck:'ok',foreignKeys:'ok'};write('fox-phase10-long-run.json',result);output(result);db.close();globalThis.Date=NativeDate;
}else if(mode==='golden'){
 let db=openDatabase(file);configure(db,100,40,1000);let s=services(db);const booked=accepted(s.reservations.reserve({requestId:randomUUID(),tableId:'M13',customerName:'QA',phone:'',startsAt:'2099-01-01T10:00:00.000Z',guests:2,note:''}));
 for(const code of ['M1','M2','SH1','T1'])accepted(s.orders.addProduct({tableId:code,productId:'KAFE-1'}));const openHash=digest(snapshot(db));db.close();db=openDatabase(file);assert.equal(digest(snapshot(db)),openHash);s=services(db);for(const code of ['M1','M2','SH1','T1'])accepted(s.checkout.completeOrder({orderId:s.orders.getForTable(code).order!.id}));
 accepted(s.configuration.addSupply({requestId:randomUUID(),productId:'KAFE-1',quantity:10,drawerPaymentCents:400}));accepted(s.finance.saveExpense(expense()));accepted(s.finance.recordLoss(loss()));accepted(s.finance.recordCashMovement({requestId:randomUUID(),direction:'OUT',amountCents:15,reason:'QA',note:''}));accepted(s.finance.closeCash(cash(db)));assertAll(db);
 const results:unknown[]=[];for(let loop=0;loop<5;loop++){
  const a=path.join(directory!,`a-${loop}.sqlite`),b=path.join(directory!,`b-${loop}.sqlite`),stateA=snapshot(db);await createBackup(db,a,'0.7.1-rc.2');sale(db);accepted(services(db).finance.saveExpense(expense()));const stateB=snapshot(db);await createBackup(db,b,'0.7.1-rc.2');sale(db,'T10');accepted(services(db).finance.recordLoss(loss()));
  await replaceDatabase(db,a,directory!,'0.7.1-rc.2',()=>{});db=openDatabase(file);assert.deepEqual(snapshot(db),stateA);assertAll(db);sale(db);accepted(services(db).finance.saveExpense(expense()));
  await replaceDatabase(db,b,directory!,'0.7.1-rc.2',()=>{});db=openDatabase(file);assert.deepEqual(snapshot(db),stateB);assertAll(db);sale(db);accepted(services(db).finance.recordCashMovement({requestId:randomUUID(),direction:'IN',amountCents:3,reason:'QA',note:''}));results.push({loop,hashA:digest(stateA),hashB:digest(stateB),continued:true});
 }
 assert.equal(services(db).orders.getForTable('M13').reservation?.id,booked.reservation!.id);const before=digest(snapshot(db));db.close();db=openDatabase(file);assert.equal(digest(snapshot(db)),before);const result={passed:true,loops:results,finance:assertAll(db),coherentHash:before,isolated:true};write('fox-phase10-golden-master.json',result);output(result);db.close();
}else throw Error('Unknown mode');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
