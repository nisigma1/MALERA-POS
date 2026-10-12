import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/database/connection';
import { createRepositories } from '../electron/database/repositories';
import { createOrderService } from '../electron/database/orders';
import { createReservationService } from '../electron/database/reservations';
import { createFinanceService } from '../electron/database/finance';
import { createCheckoutService } from '../electron/database/checkout';
import { createBackup, validateBackup } from '../electron/database/backups';
import { inspectDatabase } from '../electron/database/health';
import { migrations } from '../electron/database/migrations';
import { seed } from '../electron/database/seed';
import type { ReserveTableInput } from '../src/domain/reservations';

let db: Database.Database;
const roots: string[] = [];
const directory = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(),'fox-reservations-')); roots.push(root); return root; };
const now = new Date('2026-10-11T12:00:00.000Z');
const input = (override: Partial<ReserveTableInput> = {}): ReserveTableInput => ({requestId:randomUUID(),tableId:'M5',customerName:'Arben',phone:'+383 44 123456',startsAt:'2026-10-11T19:30:00.000Z',guests:4,note:'Pranë hyrjes',...override});
const context = () => { const orders = createOrderService(db,createRepositories(db)); return {orders,reservations:createReservationService(db,orders,()=>now),finance:createFinanceService(db),checkout:createCheckoutService(db,orders)}; };
const snapshot = () => Object.fromEntries((db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(({name})=>[name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
function reserve(value = input()) { const result = context().reservations.reserve(value); expect(result.ok).toBe(true); if (!result.ok || !result.data.reservation) throw Error('Expected reservation'); return result.data.reservation; }
beforeEach(()=>{db=openDatabase(':memory:');db.prepare("UPDATE products SET selling_price_cents=100,purchase_cost_cents=50,track_inventory=1 WHERE id='KAFE-1'").run();db.prepare("UPDATE inventory_balances SET quantity=200 WHERE product_id='KAFE-1'").run();});
afterEach(()=>{if(db.open)db.close();for(const root of roots.splice(0)){if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('fox-reservations-'))throw Error('Unsafe QA cleanup');fs.rmSync(root,{recursive:true,force:true});}});

describe('persistent phone reservations',()=>{
  it.each(['M5','M13','SH1','T1'])('reserves canonical %s without any order, cash or inventory effect',tableId=>{
    const before = snapshot(), report = context().finance.report({period:'ALL'}), cash = context().finance.cashPreview({openingCents:0});
    const saved=reserve(input({tableId}));expect(saved).toMatchObject({tableId,customerName:'Arben',phone:'+383 44 123456',guests:4,status:'BOOKED',resolvedAt:null});
    expect(context().orders.getForTable(tableId)).toMatchObject({table:{status:'RESERVED',activeOrderTotalCents:null},order:null,reservation:saved});
    for(const [name,rows] of Object.entries(before))if(!['cafe_tables','table_reservations'].includes(name))expect(snapshot()[name]).toEqual(rows);
    expect(context().finance.report({period:'ALL'})).toEqual(report);expect(context().finance.cashPreview({openingCents:0})).toEqual(cash);
    expect(context().orders.addProduct({tableId,productId:'KAFE-1'}).ok).toBe(false);
  });
  it('retries the same request once, rejects conflicts and keeps one booked reservation',()=>{
    const value=input(),saved=reserve(value),before=snapshot();expect(context().reservations.reserve(value).ok).toBe(true);expect(snapshot()).toEqual(before);
    expect(context().reservations.reserve({...value,customerName:'Tjetër'}).ok).toBe(false);expect(context().reservations.reserve(input()).ok).toBe(false);expect(snapshot()).toEqual(before);
    expect(context().orders.getForTable('M5').reservation?.id).toBe(saved.id);
  });
  it.each([null,[],{},input({customerName:' '}),input({customerName:'x'.repeat(101)}),input({phone:'not-a-phone'}),input({phone:'1'.repeat(41)}),input({startsAt:'2026-10-10T19:30:00.000Z'}),input({startsAt:'2026-02-30T19:30:00.000Z'}),input({startsAt:'invalid'}),input({guests:0}),input({guests:31}),input({guests:1.5}),input({note:'x'.repeat(501)}),input({tableId:'missing'}),input({requestId:'invalid'}),{...input(),totalCents:100}])('rejects invalid booking %# without partial writes',value=>{const before=snapshot();expect(context().reservations.reserve(value).ok).toBe(false);expect(snapshot()).toEqual(before);});
  it.each(['ACTIVE','AWAITING_PAYMENT','DISABLED'])('does not reserve a %s table',status=>{
    if(status==='ACTIVE')context().orders.addProduct({tableId:'M5',productId:'KAFE-1'});else if(status==='DISABLED')db.prepare("UPDATE cafe_tables SET enabled=0 WHERE id='M5'").run();else db.prepare("UPDATE cafe_tables SET status='AWAITING_PAYMENT' WHERE id='M5'").run();
    const before=snapshot();expect(context().reservations.reserve(input()).ok).toBe(false);expect(snapshot()).toEqual(before);
  });
  it('arrives without creating an order, then uses existing atomic checkout; stale arrival never frees ACTIVE',()=>{
    const saved=reserve(),command={tableId:'M5',reservationId:saved.id};expect(context().reservations.arrive(command)).toMatchObject({ok:true,data:{table:{status:'FREE'},order:null,reservation:null}});
    const result=context().orders.addProduct({tableId:'M5',productId:'KAFE-1'});if(!result.ok)throw Error(result.message);const active=snapshot();
    expect(context().reservations.arrive(command)).toMatchObject({ok:true,data:{table:{status:'ACTIVE'}}});expect(snapshot()).toEqual(active);
    expect(context().reservations.cancel(command).ok).toBe(false);expect(context().checkout.completeOrder({orderId:result.data.order!.id}).ok).toBe(true);
    expect(db.prepare("SELECT quantity FROM inventory_balances WHERE product_id='KAFE-1'").get()).toEqual({quantity:199});expect(context().finance.report({period:'ALL'}).sales.summary.salesCents).toBe(100);
    expect(db.prepare('SELECT status FROM table_reservations').get()).toEqual({status:'ARRIVED'});
  });
  it('cancels and rebooks while preserving history; old cancellation cannot free a newer hold',()=>{
    const first=reserve(),command={tableId:'M5',reservationId:first.id};expect(context().reservations.cancel(command).ok).toBe(true);const second=reserve(),before=snapshot();
    expect(context().reservations.cancel(command).ok).toBe(true);expect(snapshot()).toEqual(before);expect(context().orders.getForTable('M5').reservation?.id).toBe(second.id);
    expect(db.prepare('SELECT status FROM table_reservations ORDER BY rowid').all()).toEqual([{status:'CANCELLED'},{status:'BOOKED'}]);
  });
  it('rejects foreign/malformed resolution and leaves reservation intact',()=>{
    const saved=reserve(),before=snapshot();for(const value of [null,{},[],{tableId:'M6',reservationId:saved.id},{tableId:'M5',reservationId:'missing'},{tableId:'M5',reservationId:saved.id,status:'FREE'}])for(const action of [context().reservations.arrive,context().reservations.cancel])expect(action(value).ok).toBe(false);expect(snapshot()).toEqual(before);
  });
  it('rolls back both booking and table status when a write fails',()=>{
    db.exec("CREATE TRIGGER injected_reservation_failure BEFORE UPDATE ON cafe_tables BEGIN SELECT RAISE(ABORT,'injected'); END;");const before=snapshot();expect(()=>context().reservations.reserve(input())).toThrow('injected');expect(snapshot()).toEqual(before);
  });
  it('retains immutable reservation history and enforces one hold in SQLite',()=>{
    const saved=reserve();expect(()=>db.prepare('DELETE FROM table_reservations WHERE id=?').run(saved.id)).toThrow('history');expect(()=>db.prepare("UPDATE table_reservations SET customer_name='Changed' WHERE id=?").run(saved.id)).toThrow('immutable');
    expect(()=>db.prepare("INSERT INTO table_reservations SELECT ?,table_id,customer_name,phone,starts_at,guests,note,status,created_at,resolved_at FROM table_reservations WHERE id=?").run(randomUUID(),saved.id)).toThrow();expect(db.prepare('SELECT count(*) AS n FROM table_reservations').get()).toEqual({n:1});
  });
  it('persists booking over restart and verified backup/restore',async()=>{
    const root=directory(),file=path.join(root,'fox.sqlite');db.close();db=openDatabase(file);const saved=reserve(),before=snapshot();db.close();db=openDatabase(file);expect(snapshot()).toEqual(before);expect(context().orders.getForTable('M5').reservation).toEqual(saved);
    const backup=path.join(root,'saved.sqlite');await createBackup(db,backup,'0.7.1-rc.1');expect((await validateBackup(backup)).schemaVersion).toBe(6);db.close();db=openDatabase(backup);expect(snapshot()).toEqual(before);expect(inspectDatabase(db,true)).toBe(6);
  });
  it('upgrades schema5 with a safety backup and identical historical financial rows',()=>{
    const root=directory(),file=path.join(root,'fox.sqlite');db.close();db=new Database(file);db.pragma('foreign_keys=ON');db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL) STRICT');for(const migration of migrations.filter(m=>m.version<=5)){db.exec(migration.sql);db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(migration.version,now.toISOString());}seed(db);
    db.prepare("UPDATE products SET selling_price_cents=100,purchase_cost_cents=50,track_inventory=0 WHERE id='KAFE-1'").run();const order=context().orders.addProduct({tableId:'M13',productId:'KAFE-1'});if(!order.ok)throw Error(order.message);expect(context().checkout.completeOrder({orderId:order.data.order!.id}).ok).toBe(true);
    const before=snapshot(),report=context().finance.report({period:'ALL'}),cash=context().finance.cashPreview({openingCents:100});db.close();db=openDatabase(file,'0.7.1-rc.1');for(const [name,rows] of Object.entries(before))if(name!=='schema_migrations')expect(snapshot()[name]).toEqual(rows);expect(context().finance.report({period:'ALL'})).toEqual(report);expect(context().finance.cashPreview({openingCents:100})).toEqual(cash);
    expect(db.prepare('SELECT count(*) AS n FROM table_reservations').get()).toEqual({n:0});expect(inspectDatabase(db,true)).toBe(6);const backup=fs.readdirSync(path.join(root,'backups')).find(f=>f.endsWith('.sqlite'))!;const old=new Database(path.join(root,'backups',backup),{readonly:true});try{expect(inspectDatabase(old,true)).toBe(5);}finally{old.close();}
  });
});
