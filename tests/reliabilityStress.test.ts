import {it,expect,vi} from 'vitest';
import {Worker} from 'node:worker_threads';
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {performance} from 'node:perf_hooks';
import {openDatabase} from '../electron/database/connection';
import {assertAll,accepted,configure,services,sale,snapshot} from './support/reliability';
import {parseEuro} from '../src/domain/money';
import {createBackup,validateBackup,fileHash} from '../electron/database/backups';
import {replaceDatabase} from '../electron/database/restore';
import {random,streamDigest,digest} from './support/reliability';

it.each([10,50,100,250,500])('bounded competing writer %i ms releases without a half mutation or unsafe retry',async delay=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fox-phase10-contention-')),file=path.join(root,'fox.sqlite'),db=openDatabase(file);let worker:Worker|undefined;
 try{
  configure(db);const s=services(db),order=accepted(s.orders.addProduct({tableId:'M5',productId:'KAFE-1'})).order!;
  worker=new Worker(`const {workerData,parentPort}=require('node:worker_threads');const Database=require('better-sqlite3');const db=new Database(workerData.file);db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');db.exec('BEGIN IMMEDIATE');parentPort.postMessage('LOCKED');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,workerData.delay);db.exec('COMMIT');db.close();parentPort.postMessage('RELEASED');`,{eval:true,workerData:{file,delay},execArgv:[]});
  await new Promise<void>((resolve,reject)=>{worker!.once('message',()=>resolve());worker!.once('error',reject);});
  const start=performance.now();accepted(s.checkout.completeOrder({orderId:order.id}));const elapsedMs=performance.now()-start;expect(elapsedMs).toBeLessThan(5000);const committed=snapshot(db);
  expect(s.checkout.completeOrder({orderId:order.id})).toMatchObject({ok:false,code:'ALREADY_COMPLETED'});expect(snapshot(db)).toEqual(committed);assertAll(db);
  const backup=path.join(root,'live.sqlite');const booked=accepted(s.reservations.reserve({requestId:randomUUID(),tableId:'M13',customerName:'QA',phone:'',startsAt:'2099-01-01T10:00:00.000Z',guests:2,note:''}));accepted(s.orders.addProduct({tableId:'T1',productId:'KAFE-1'}));await createBackup(db,backup,'0.7.1-rc.2');expect((await validateBackup(backup)).schemaVersion).toBe(6);expect(booked.reservation?.status).toBe('BOOKED');assertAll(db);
  fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync(`outputs/fox-phase10-storage-${delay}.json`,JSON.stringify({passed:true,delayMs:delay,elapsedMs,busyTimeoutMs:5000,committedOnce:true,liveBackup:true},null,2));
 }finally{await worker?.terminate();db.close();if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('fox-phase10-contention-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});}
});
it.each([0,-1,NaN,Infinity,1.1,1e309,Number.MAX_SAFE_INTEGER+1,'1e9','1,20','1.20','1..20','01.20',' ','alphabetic'])('numeric fuzz rejects non-authoritative cents %#',amountCents=>{
 const db=openDatabase(':memory:');try{const before=snapshot(db);expect(services(db).finance.recordCashMovement({requestId:randomUUID(),direction:'IN',amountCents,reason:'QA',note:''}).ok).toBe(false);expect(snapshot(db)).toEqual(before);assertAll(db);}finally{db.close();}
});
it.each(['1e9','1e309','NaN','Infinity','1..20','+1','-1','letters'])('money input rejects ambiguous syntax %s',text=>{expect(()=>parseEuro(text)).toThrow();});
it.each(['2024-02-28','2024-02-29','2025-02-28','2025-12-31','2026-01-31','2026-04-30'])('half-open local report boundaries and cross-midnight cash on %s',day=>{
 vi.useFakeTimers();const db=openDatabase(':memory:');try{
  configure(db);vi.setSystemTime(new Date(day+'T23:59:59'));sale(db);const first=services(db).finance.cashPreview({openingCents:0}).sessionId;
  const next=new Date(day+'T23:59:59');next.setSeconds(next.getSeconds()+1);vi.setSystemTime(next);sale(db,'T1');expect(services(db).finance.cashPreview({openingCents:0}).sessionId).toBe(first);const r=services(db).finance.report({period:'CUSTOM',startDate:day,endDate:day});expect(r.sales.summary.salesCents).toBe(100);expect(r.sales.summary.completedOrders).toBe(1);assertAll(db);
  vi.setSystemTime(new Date(day+'T01:00:00'));sale(db,'M13');expect(db.prepare('SELECT sale_number FROM orders ORDER BY sale_number').all()).toEqual([{sale_number:1},{sale_number:2},{sale_number:3}]);assertAll(db);
 }finally{db.close();vi.useRealTimers();}
});
it.each(['ë ç € 😀',"O'Connor",'<script>alert(1)</script>',"Robert'); DROP TABLE expenses;--",'line\nline','tab\ttext','control\u0001'])('text fuzz persists data without execution: %s',description=>{
 const db=openDatabase(':memory:');try{accepted(services(db).finance.saveExpense({requestId:randomUUID(),amountCents:1,category:'OTHER',occurredAt:new Date().toISOString(),description,paidFromTill:false,note:description}));assertAll(db);expect(db.prepare('SELECT count(*) n FROM cafe_tables').get()).toEqual({n:27});}finally{db.close();}
});
it('backend enforces all editable field length limits independently of HTML',()=>{
 const db=openDatabase(':memory:');try{const s=services(db),before=snapshot(db);expect(s.finance.saveExpense({requestId:randomUUID(),amountCents:1,category:'OTHER',occurredAt:new Date().toISOString(),description:'x'.repeat(501),paidFromTill:false}).ok).toBe(false);expect(s.finance.recordCashMovement({requestId:randomUUID(),direction:'IN',amountCents:1,reason:'x'.repeat(201),note:''}).ok).toBe(false);const p=s.repo.listProducts()[0]!;expect(s.configuration.updateProduct({...p,name:'x'.repeat(201)}).ok).toBe(false);expect(snapshot(db)).toEqual(before);assertAll(db);}finally{db.close();}
});
it('prolonged writer contention fails before any commit and later retry is safe',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fox-phase10-long-lock-')),file=path.join(root,'fox.sqlite'),db=openDatabase(file);let worker:Worker|undefined;
 try{configure(db);const s=services(db),order=accepted(s.orders.addProduct({tableId:'M5',productId:'KAFE-1'})).order!,before=snapshot(db);
  const barrier=new Int32Array(new SharedArrayBuffer(4));worker=new Worker(`const {workerData,parentPort}=require('node:worker_threads');const D=require('better-sqlite3');const d=new D(workerData.file);d.pragma('foreign_keys=ON');d.exec('BEGIN IMMEDIATE');parentPort.postMessage('LOCKED');Atomics.wait(new Int32Array(workerData.barrier),0,0,10000);d.exec('COMMIT');d.close();`,{eval:true,workerData:{file,barrier:barrier.buffer},execArgv:[]});
  const done=new Promise<number>(r=>worker!.once('exit',r));await new Promise<void>((r,j)=>{worker!.once('message',()=>r());worker!.once('error',j);});
  const start=performance.now();expect(s.checkout.completeOrder({orderId:order.id})).toMatchObject({ok:false,code:'CHECKOUT_FAILED'});const elapsedMs=performance.now()-start;expect(db.pragma('busy_timeout',{simple:true})).toBe(5000);expect(elapsedMs).toBeLessThan(10000);expect(snapshot(db)).toEqual(before);Atomics.store(barrier,0,1);Atomics.notify(barrier,0);expect(await done).toBe(0);accepted(s.checkout.completeOrder({orderId:order.id}));assertAll(db);fs.writeFileSync('outputs/fox-phase10-lock-deadline.json',JSON.stringify({passed:true,lockHeldUntilControlledFailure:true,fixtureSafetyDeadlineMs:10000,busyTimeoutMs:5000,elapsedMs,safeRetry:true},null,2));
 }finally{await worker?.terminate();db.close();fs.rmSync(root,{recursive:true,force:true});}
},15000);
it('corrupt backup rejection matrix preserves the operational state exactly',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fox-phase10-corrupt-')),file=path.join(root,'fox.sqlite'),db=openDatabase(file);try{
  configure(db);sale(db);const valid=path.join(root,'valid.sqlite');await createBackup(db,valid,'0.7.2-rc.1');const before=streamDigest(db),results=[];
  for(const kind of ['zero','truncated','random','unrelated','foreignKey','physicalPage','future','tampered']){
   const candidate=path.join(root,kind+'.sqlite');fs.copyFileSync(valid,candidate);const meta=JSON.parse(fs.readFileSync(valid+'.json','utf8'));
   if(kind==='zero')fs.writeFileSync(candidate,'');if(kind==='truncated')fs.truncateSync(candidate,1024);if(kind==='random')fs.writeFileSync(candidate,Buffer.alloc(4096,0xA5));
   if(kind==='unrelated'){fs.unlinkSync(candidate);const other=new Database(candidate);try{other.exec('CREATE TABLE unrelated(value TEXT)');}finally{other.close();}}
   if(['foreignKey','future'].includes(kind)){const other=openDatabase(candidate);try{if(kind==='foreignKey'){other.pragma('foreign_keys=OFF');other.prepare("INSERT INTO inventory_balances VALUES ('missing',1,'QA')").run();}if(kind==='future')other.prepare("INSERT INTO schema_migrations VALUES (7,'QA')").run();other.pragma('wal_checkpoint(TRUNCATE)');}finally{other.close();}}
   if(kind==='physicalPage'){const fd=fs.openSync(candidate,'r+');try{fs.writeSync(fd,Buffer.alloc(4096,0xFF),0,4096,4096);}finally{fs.closeSync(fd);}}
   if(kind==='tampered')fs.appendFileSync(candidate,'QA tamper');else meta.sha256=await fileHash(candidate);fs.writeFileSync(candidate+'.json',JSON.stringify(meta));
   await expect(replaceDatabase(db,candidate,root,'0.7.2-rc.1',()=>{})).rejects.toThrow();expect(db.open).toBe(true);expect(streamDigest(db)).toBe(before);assertAll(db);results.push({kind,rejected:true,originalUnchanged:true});
  }fs.writeFileSync('outputs/fox-phase10-corrupt-backups.json',JSON.stringify({passed:true,results},null,2));
 }finally{db.close();fs.rmSync(root,{recursive:true,force:true});}
});
it('long inventory sequences reconcile after every accepted operation',()=>{
 const seed=0xF0105678,next=random(seed),db=openDatabase(':memory:');try{
  configure(db,123,37,10000);for(let index=0;index<500;index++){const kind=next(3),quantity=1+next(4),s=services(db);if(kind===0)accepted(s.configuration.addSupply({requestId:randomUUID(),productId:'KAFE-1',quantity}));else if(kind===1)sale(db,'M5',quantity);else accepted(s.finance.recordLoss({requestId:randomUUID(),productId:'KAFE-1',quantity,reason:'WASTE',note:''}));try{assertAll(db);}catch(error){throw Error(JSON.stringify({seed,index,kind,quantity,cause:String(error)}));}}
  expect(streamDigest(db)).toBe(digest(snapshot(db)));fs.writeFileSync('outputs/fox-phase10-inventory-sequence.json',JSON.stringify({passed:true,seed,operations:500,verifiedAfterEveryOperation:true},null,2));
 }finally{db.close();}
},60000);
