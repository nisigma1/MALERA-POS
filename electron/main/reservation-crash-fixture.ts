// Isolated certification harness, never imported by the application/release.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openDatabase} from '../database/connection';
import {assertQaDirectory} from '../database/safety';
import {createRepositories} from '../database/repositories';
import {createOrderService} from '../database/orders';
import {createReservationService} from '../database/reservations';

const [directory,mode]=process.argv.slice(2);assertQaDirectory(directory!);
const db=openDatabase(path.join(directory!,'fox.sqlite'),'0.7.1-rc.2');
const rows=()=>Object.fromEntries((db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(({name})=>[name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wait=()=>{fs.writeSync(1,'CERTIFICATION_READY\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
if(mode==='prepare'){
 fs.writeFileSync(path.join(directory!,'before.json'),JSON.stringify({hash:hash(rows()),businessHash:hash(Object.fromEntries(Object.entries(rows()).filter(([name])=>!['cafe_tables','table_reservations'].includes(name))))}));db.close();
}else if(mode==='before'||mode==='after'){
 if(mode==='before'){db.function('certification_barrier',wait);db.exec('CREATE TEMP TRIGGER certification_before_commit BEFORE UPDATE ON cafe_tables BEGIN SELECT certification_barrier(); END;');}
 const result=createReservationService(db,createOrderService(db,createRepositories(db))).reserve({requestId:'00000000-0000-4000-8000-000000000001',tableId:'M13',customerName:'QA crash only',phone:'+000 000 901393',startsAt:new Date(Date.now()+3600000).toISOString(),guests:2,note:''});assert.equal(result.ok,true);wait();
}else if(mode==='inspect-before'||mode==='inspect-after'){
 const before=JSON.parse(fs.readFileSync(path.join(directory!,'before.json'),'utf8'));const current=rows();assert.equal(db.pragma('quick_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);
 assert.equal(hash(Object.fromEntries(Object.entries(current).filter(([name])=>!['cafe_tables','table_reservations'].includes(name)))),before.businessHash);
 if(mode==='inspect-before'){assert.equal(hash(current),before.hash);assert.equal(current.table_reservations!.length,0);}
 else{assert.equal(current.table_reservations!.length,1);assert.deepEqual(db.prepare("SELECT id,table_id,status FROM table_reservations").get(),{id:'00000000-0000-4000-8000-000000000001',table_id:'M13',status:'BOOKED'});assert.equal(createOrderService(db,createRepositories(db)).getForTable('M13').table.status,'RESERVED');}
 db.close();console.log(JSON.stringify({passed:true,stage:mode,quickCheck:'ok',foreignKeyCheck:'ok',businessDelta:0}));
}else throw Error('Unknown certification mode');
