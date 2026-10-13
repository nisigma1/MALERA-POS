import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import Database from 'better-sqlite3';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../electron/database/connection';
import {migrations,migrate} from '../electron/database/migrations';
import {seed} from '../electron/database/seed';
import {inspectDatabase} from '../electron/database/health';
import {createRepositories} from '../electron/database/repositories';
import {createOrderService} from '../electron/database/orders';
import {createCheckoutService} from '../electron/database/checkout';
import {createConfigurationService} from '../electron/database/configuration';
import {createFinanceService} from '../electron/database/finance';
import {createReservationService} from '../electron/database/reservations';
import {createReceiptRepository} from '../electron/receipts/repository';
import {createBackup,validateBackup} from '../electron/database/backups';
import {replaceDatabase} from '../electron/database/restore';
import {initializeLogging,logError} from '../electron/main/logging';
import {SERVICE_POSITIONS} from '../src/domain/definitions';
import {FLOOR_PLAN_BY_CODE} from '../src/presentation/floorPlan';
import {formatReservationTime,type ReserveTableInput} from '../src/domain/reservations';

// Independent contract copied from the owner's Phase 9.3, never from seed output.
const approved=['M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12','M13','SH1','SH2','SH3','SH4','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10'];
const now=new Date('2026-10-11T12:00:00.000Z');
const phone='+000 000 901393';
let db:Database.Database;
const roots:string[]=[];
const folder=()=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),'fox-test-certification-'));roots.push(p);return p;};
const services=()=>{const repositories=createRepositories(db),orders=createOrderService(db,repositories);return {orders,reservations:createReservationService(db,orders,()=>now),finance:createFinanceService(db),configuration:createConfigurationService(db,repositories),checkout:createCheckoutService(db,orders)};};
const rows=()=>Object.fromEntries((db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(({name})=>[name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const booking=(tableId='M13',over:Partial<ReserveTableInput>={}):ReserveTableInput=>({requestId:randomUUID(),tableId,customerName:'QA Arbër Çelik',phone,startsAt:'2026-10-12T19:30:00.000Z',guests:4,note:'QA vetëm',...over});
function saved(input=booking()){const r=services().reservations.reserve(input);expect(r.ok).toBe(true);if(!r.ok||!r.data.reservation)throw Error('Booking required');return r.data.reservation;}
function health(){expect(db.pragma('quick_check',{simple:true})).toBe('ok');expect(db.pragma('foreign_key_check')).toEqual([]);}
function business(){return {rows:Object.fromEntries(Object.entries(rows()).filter(([name])=>!['cafe_tables','table_reservations'].includes(name))),finance:services().finance.report({period:'ALL'}),cash:services().finance.cashPreview({openingCents:5000})};}
function fixture(){
  db.prepare("UPDATE products SET selling_price_cents=10000,purchase_cost_cents=4000,track_inventory=1 WHERE id='KAFE-1'").run();
  db.prepare("UPDATE products SET selling_price_cents=500,purchase_cost_cents=250,track_inventory=1 WHERE id='PIJE-1'").run();
  const s=services();for(const [productId,quantity] of [['KAFE-1',20],['PIJE-1',10]] as const)expect(s.configuration.addSupply({requestId:randomUUID(),productId,quantity}).ok).toBe(true);
  const order=s.orders.addProduct({tableId:'M5',productId:'KAFE-1'});if(!order.ok||!order.data.order)throw Error('Sale fixture failed');expect(s.checkout.completeOrder({orderId:order.data.order.id}).ok).toBe(true);
  const receipts=createReceiptRepository(db);receipts.document(order.data.order.id,false);
  receipts.saveSettings({deviceName:'QA unavailable device',displayName:'QA unavailable device',autoPrint:false,paperWidth:80,copies:1});receipts.enqueueCopy({saleId:order.data.order.id,requestId:randomUUID()});const job=receipts.claim();if(!job)throw Error('QA receipt audit job required');receipts.finish(job,'FAILED','PRINTER_NOT_FOUND');
  for(const [amountCents,paidFromTill] of [[2000,true],[5000,false]] as const)expect(s.finance.saveExpense({requestId:randomUUID(),amountCents,category:'ELECTRICITY',occurredAt:now.toISOString(),description:'QA',paidFromTill}).ok).toBe(true);
  expect(s.finance.recordLoss({requestId:randomUUID(),productId:'PIJE-1',quantity:2,reason:'DAMAGED',note:'QA'}).ok).toBe(true);
  expect(s.finance.recordCashMovement({requestId:randomUUID(),direction:'OUT',amountCents:1000,reason:'QA owner withdrawal',note:''}).ok).toBe(true);
  const preview=s.finance.cashPreview({openingCents:5000});expect(preview.expectedCents).toBe(12000);
  expect(s.finance.closeCash({requestId:randomUUID(),sessionId:preview.sessionId,openingCents:5000,countedCents:11800,expectedFingerprint:preview.fingerprint,note:'QA'})).toMatchObject({ok:true,data:{expectedCents:12000,countedCents:11800,differenceCents:-200}});
  expect(s.orders.addProduct({tableId:'M6',productId:'KAFE-1'}).ok).toBe(true);
}
function independentCents(){
  const n=(sql:string)=>Number((db.prepare(sql).get() as {n:number|null}).n??0);
  const revenue=n("SELECT SUM(i.quantity*i.unit_price_cents) n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status='CLOSED'");
  const cogs=n("SELECT SUM(i.quantity*i.unit_cost_cents) n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status='CLOSED'");
  const expenses=n('SELECT SUM(amount_cents) n FROM expense_revisions r WHERE NOT EXISTS(SELECT 1 FROM expense_revisions next WHERE next.previous_revision_id=r.id)');
  const loss=n('SELECT SUM(total_cost_cents) n FROM stock_losses');
  return {revenue,cogs,gross:revenue-cogs,expenses,loss,operating:revenue-cogs-expenses-loss,cashEventTotal:n('SELECT SUM(amount_cents) n FROM cash_events')};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now);db=openDatabase(':memory:');});
afterEach(()=>{if(db.open)db.close();vi.useRealTimers();for(const p of roots.splice(0)){const absolute=path.resolve(p);if(path.dirname(absolute)!==path.resolve(os.tmpdir())||!path.basename(absolute).startsWith('fox-test-certification-'))throw Error('Unsafe test cleanup');fs.rmSync(absolute,{recursive:true,force:true});}});

describe('Phase 9.3 independent functional certification',()=>{
  it('matches every canonical identity and physical anchor independently',()=>{
    expect(createRepositories(db).listTables().map(t=>t.code)).toEqual(approved);
    expect(SERVICE_POSITIONS.map(p=>p.code)).toEqual(approved);expect(Object.keys(FLOOR_PLAN_BY_CODE)).toEqual(approved);
    expect(new Set(approved).size).toBe(27);expect(approved.filter(c=>/^M\d+$/.test(c))).toHaveLength(13);expect(approved.filter(c=>/^SH\d+$/.test(c))).toHaveLength(4);expect(approved.filter(c=>/^T\d+$/.test(c))).toHaveLength(10);
    expect(FLOOR_PLAN_BY_CODE.M13).toMatchObject({x:173,y:803,area:'MAIN',rotation:45});expect(FLOOR_PLAN_BY_CODE.T1).toMatchObject({x:995,y:858,area:'TERRACE',shape:'round'});
    expect(['SH1','SH2','SH3','SH4'].map(c=>FLOOR_PLAN_BY_CODE[c]!.x)).toEqual([354,457,561,666]);
    expect(['T2','T3','T4'].map(c=>[FLOOR_PLAN_BY_CODE[c]!.x,FLOOR_PLAN_BY_CODE[c]!.y])).toEqual([[315,945],[672,945],[1027,945]]);
    expect(['T5','T6','T7','T8','T9','T10'].map(c=>[FLOOR_PLAN_BY_CODE[c]!.x,FLOOR_PLAN_BY_CODE[c]!.y,FLOOR_PLAN_BY_CODE[c]!.shape])).toEqual([148,351,550,758,965,1199].map(x=>[x,1040,'rect']));
    expect(approved.some(c=>/^[BJ]/.test(c)||c==='T11')).toBe(false);health();
  });
  it('fresh production-like DB has no financial, reservation, order or receipt history',()=>{
    expect(inspectDatabase(db,true)).toBe(6);expect(createRepositories(db).listProducts()).toHaveLength(21);expect(db.prepare('SELECT count(*) n FROM categories').get()).toEqual({n:5});
    for(const table of ['orders','order_items','order_payments','expenses','expense_revisions','stock_losses','cash_sessions','cash_events','cash_closes','inventory_movements','table_reservations','receipt_documents','receipt_print_jobs','receipt_print_attempts','receipt_generation_errors'])expect(db.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});health();
  });
  it('all reservation mutations/reads have zero delta over real mixed financial truth',()=>{
    fixture();expect(independentCents()).toEqual({revenue:10000,cogs:4000,gross:6000,expenses:7000,loss:500,operating:-1500,cashEventTotal:7000});
    expect(services().finance.report({period:'ALL'})).toMatchObject({operatingResultCents:-1500,stockLossCents:500,sales:{summary:{salesCents:10000,costCents:4000,grossProfitCents:6000,expensesCents:7000}}});
    const before=business();for(const code of ['M1','M13','SH1','SH4','T1','T10']){
      const reservation=saved(booking(code));expect(business()).toEqual(before);
      for(let i=0;i<10;i++)expect(services().orders.getForTable(code).reservation?.id).toBe(reservation.id);expect(business()).toEqual(before);
      const command={tableId:code,reservationId:reservation.id};for(let i=0;i<10;i++)expect(services().reservations.cancel(command).ok).toBe(true);expect(business()).toEqual(before);
      const next=saved(booking(code));expect(services().reservations.arrive({tableId:code,reservationId:next.id}).ok).toBe(true);expect(business()).toEqual(before);
    }health();
  });
  it('10 overlapping create requests with one intent or competing IDs never duplicate a hold',async()=>{
    const input=booking();const repeated=await Promise.all(Array.from({length:10},()=>Promise.resolve().then(()=>services().reservations.reserve(input))));expect(repeated.every(r=>r.ok)).toBe(true);expect(db.prepare('SELECT count(*) n FROM table_reservations').get()).toEqual({n:1});
    const before=rows();const conflicting=await Promise.all(Array.from({length:10},()=>Promise.resolve().then(()=>services().reservations.reserve(booking()))));expect(conflicting.every(r=>!r.ok)).toBe(true);expect(rows()).toEqual(before);health();
  });
  it('unsupported edit/table-change is rejected; cancellation/rebook preserves both identities',()=>{
    const input=booking(),r=saved(input),before=rows();expect(Object.keys(services().reservations).sort()).toEqual(['arrive','cancel','reserve']);
    for(let i=0;i<10;i++)expect(services().reservations.reserve({...input,phone:'+000 000 991'}).ok).toBe(false);
    expect(services().reservations.reserve({...input,tableId:'T10'}).ok).toBe(false);expect(rows()).toEqual(before);
    expect(services().reservations.cancel({tableId:'M13',reservationId:r.id}).ok).toBe(true);const newReservation=saved(booking('M13',{customerName:'QA D’Angelo'}));expect(newReservation.id).not.toBe(r.id);
    expect(db.prepare('SELECT id,table_id,status FROM table_reservations ORDER BY rowid').all()).toEqual([{id:r.id,table_id:'M13',status:'CANCELLED'},{id:newReservation.id,table_id:'M13',status:'BOOKED'}]);health();
  });
  it.each(['M13','T1','SH4','T10'])('SQLite and backend both reject orphan/alias references adjacent to %s',code=>{
    const bad=booking(code);expect(services().reservations.reserve({...bad,tableId:'T11'}).ok).toBe(false);expect(services().reservations.reserve({...bad,tableId:'B13'}).ok).toBe(false);expect(services().reservations.reserve({...bad,tableId:'J1'}).ok).toBe(false);
    expect(()=>db.prepare("INSERT INTO table_reservations VALUES (?,'missing','QA','','2027-01-01T00:00:00.000Z',1,'','BOOKED',?,NULL)").run(randomUUID(),now.toISOString())).toThrow();expect(db.prepare('SELECT count(*) n FROM table_reservations').get()).toEqual({n:0});health();
  });
  it.each(['2026-10-11T12:00:00.000Z','2026-10-11T23:59:00.000Z','2026-10-12T00:00:00.000Z','2026-10-31T23:59:00.000Z','2026-11-01T00:00:00.000Z','2026-12-31T23:59:00.000Z','2027-01-01T00:00:00.000Z'])('preserves exact scheduled instant %s and uses local calendar display',startsAt=>{
    const reservation=saved(booking('M13',{startsAt}));expect(reservation.startsAt).toBe(startsAt);const date=new Date(startsAt),pad=(n:number)=>String(n).padStart(2,'0');expect(formatReservationTime(startsAt)).toBe(`${pad(date.getDate())}.${pad(date.getMonth()+1)}.${date.getFullYear()} · ${pad(date.getHours())}:${pad(date.getMinutes())}`);health();
  });
  it('past creation is rejected; a previously booked hold requires explicit arrival/cancel',()=>{
    expect(services().reservations.reserve(booking('M13',{startsAt:'2026-10-11T11:59:59.999Z'})).ok).toBe(false);
    const r=saved();const late=createReservationService(db,services().orders,()=>new Date('2028-01-01T00:00:00.000Z'));expect(services().orders.getForTable('M13')).toMatchObject({table:{status:'RESERVED'},reservation:{id:r.id},order:null});expect(late.cancel({tableId:'M13',reservationId:r.id}).ok).toBe(true);expect(services().orders.getForTable('M13').table.status).toBe('FREE');health();
  });
  it.each(["Enis Qetaj","O'Connor","D'Angelo",'Arbër','Çelik','<script>alert(1)</script>',"Robert'); DROP TABLE reservations;--",'QA 😀'])('stores text safely without SQL interpretation: %s',customerName=>{
    const r=saved(booking('M13',{customerName,note:customerName}));expect(r.customerName).toBe(customerName);expect(r.note).toBe(customerName);expect(createRepositories(db).listTables().map(t=>t.code)).toEqual(approved);health();
  });
  it.each(['',' +000 (000) 901-393 ','123','000.111.222'])('stores optional/formatted phone safely: %s',value=>{expect(saved(booking('M13',{phone:value})).phone).toBe(value.trim());health();});
  it.each(['1'.repeat(41),'123\n456','123\t456','123\u0000','电话１２３','😀','<script>','  '])('rejects unsafe/unapproved phone structure except optional whitespace %#',value=>{
    const before=rows(),r=services().reservations.reserve(booking('M13',{phone:value}));if(value.trim()===''){expect(r.ok).toBe(true);expect(r.ok&&r.data.reservation?.phone).toBe('');}else{expect(r.ok).toBe(false);expect(rows()).toEqual(before);expect(!r.ok&&r.message.includes(value)).toBe(false);}health();
  });
  it.each([{customerName:'A'.repeat(101)},{note:'A'.repeat(501)},{note:'new\nline'},{customerName:'tab\tname'}])('rejects extreme/control text without writes %#',over=>{const before=rows(),r=services().reservations.reserve(booking('M13',over));expect(r.ok).toBe(false);expect(rows()).toEqual(before);health();});
  it('contact data stays out of receipt/report/cash payloads and routine logs',()=>{
    fixture();saved();const s=services(),receipt=createReceiptRepository(db);const closed=db.prepare("SELECT id FROM orders WHERE status='CLOSED'").get() as {id:string};
    const sinks=[s.finance.report({period:'ALL'}),s.finance.cashPreview({openingCents:0}),receipt.document(closed.id,false),createRepositories(db).listProducts(),db.prepare('SELECT * FROM cash_closes').all(),db.prepare('SELECT * FROM receipt_print_jobs').all()];
    expect(JSON.stringify(sinks)).not.toContain(phone);expect(JSON.stringify(sinks)).not.toContain('QA Arbër Çelik');
    const root=folder();initializeLogging(root);const error=new Error(`${phone} QA Arbër Çelik QA vetëm`);error.name=phone;logError('RESERVATION_FAILED',error);const logged=fs.readFileSync(path.join(root,'logs','fox.log'),'utf8');expect(logged).not.toContain(phone);expect(logged).not.toContain('Arbër');expect(logged).toContain('UNEXPECTED_ERROR');health();
  });
  it('mixed-domain backup restores one coherent snapshot including open orders and cancelled history',async()=>{
    fixture();for(const code of ['M1','M13','SH1','SH4','T1','T10'])saved(booking(code));const first=services().orders.getForTable('T10').reservation!;services().reservations.cancel({tableId:'T10',reservationId:first.id});
    const root=folder(),file=path.join(root,'fox.sqlite'),backup=path.join(root,'coherent.sqlite');vi.useRealTimers();await db.backup(file);db.close();db=openDatabase(file);const before=rows(),financial=services().finance.report({period:'ALL'});await createBackup(db,backup,'0.7.1-rc.2');expect((await validateBackup(backup)).schemaVersion).toBe(6);
    const s=services(),open=s.orders.getForTable('M6').order!;expect(s.checkout.completeOrder({orderId:open.id}).ok).toBe(true);s.reservations.cancel({tableId:'M13',reservationId:s.orders.getForTable('M13').reservation!.id});s.configuration.addSupply({requestId:randomUUID(),productId:'PIJE-1',quantity:1,drawerPaymentCents:10});s.finance.saveExpense({requestId:randomUUID(),amountCents:10,category:'OTHER',occurredAt:now.toISOString(),description:'QA later',paidFromTill:true});s.finance.recordLoss({requestId:randomUUID(),productId:'PIJE-1',quantity:1,reason:'DAMAGED',note:'QA later'});s.finance.recordCashMovement({requestId:randomUUID(),direction:'IN',amountCents:5,reason:'QA later',note:''});expect(hash(rows())).not.toBe(hash(before));
    await replaceDatabase(db,backup,root,'0.7.1-rc.2',()=>{});db=openDatabase(file);expect(rows()).toEqual(before);expect(services().finance.report({period:'ALL'})).toEqual(financial);health();
    db.close();db=openDatabase(file);expect(rows()).toEqual(before);for(const code of ['M1','M13','SH1','SH4','T1'])expect(services().orders.getForTable(code).reservation?.tableId).toBe(code);expect(services().orders.getForTable('T10').reservation).toBeNull();health();
  });
  it('schema5→6 preserves independently computed cents and every historical row exactly once',()=>{
    db.close();const root=folder(),file=path.join(root,'fox.sqlite');db=new Database(file);db.pragma('foreign_keys=ON');db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL) STRICT');for(const m of migrations.filter(m=>m.version<=5)){db.transaction(()=>{db.exec(m.sql);db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(m.version,now.toISOString());}).immediate();}seed(db);fixture();const before=rows(),cents=independentCents(),finance=services().finance.report({period:'ALL'});db.close();db=openDatabase(file,'0.7.1-rc.2');
    for(const [name,value] of Object.entries(before))if(name!=='schema_migrations')expect(rows()[name]).toEqual(value);expect(independentCents()).toEqual(cents);expect(services().finance.report({period:'ALL'})).toEqual(finance);expect(createRepositories(db).listTables().map(t=>t.code)).toEqual(approved);expect(db.prepare('SELECT count(*) n FROM table_reservations').get()).toEqual({n:0});health();
    const once=rows();migrate(db);expect(rows()).toEqual(once);db.close();db=openDatabase(file);expect(rows()).toEqual(once);health();
    const evidence={beforeSchema:5,afterSchema:6,countsBefore:Object.fromEntries(Object.entries(before).map(([name,value])=>[name,value.length])),countsAfter:Object.fromEntries(Object.entries(once).map(([name,value])=>[name,value.length])),financialBefore:cents,financialAfter:independentCents(),historicalHashes:Object.fromEntries(Object.entries(before).filter(([name])=>name!=='schema_migrations').map(([name,value])=>[name,{before:hash(value),after:hash(once[name])}])),canonical:approved,quickCheck:'ok',foreignKeyCheck:'ok',migrationCount:6,idempotent:true};
    fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync('outputs/fox-phase9-3-migration-evidence.json',JSON.stringify(evidence,null,2));
    const oldBackup=fs.readdirSync(path.join(root,'backups')).filter(n=>n.endsWith('.sqlite'));expect(oldBackup).toHaveLength(1);const old=new Database(path.join(root,'backups',oldBackup[0]!),{readonly:true});try{expect(inspectDatabase(old,true)).toBe(5);for(const [name,value] of Object.entries(before))expect(old.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()).toEqual(value);}finally{old.close();}
  });
});
