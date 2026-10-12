import type Database from 'better-sqlite3';
import {effectiveExpenses} from './financeQueries';

type Totals={revenue:bigint;cost:bigint;quantity:bigint;missingCost:bigint;expense:bigint;loss:bigint;missingLoss:bigint};
type Capacity={totals:Totals;stamp:string};
const cached=new WeakMap<Database.Database,Capacity>();
const domains=new WeakMap<Database.Database,{version:number;tables:Set<string>}>();
function metadata(db:Database.Database){const version=(db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as {version:number}).version;let value=domains.get(db);if(value?.version!==version){value={version,tables:new Set((db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as {name:string}[]).map(t=>t.name))};domains.set(db,value);}return value;}
function stamp(db:Database.Database):string {
 const m=metadata(db),last=(table:string)=>m.tables.has(table)?(db.prepare(`SELECT COALESCE(MAX(rowid),0) n FROM ${table}`).get() as {n:number}).n:0;
 // CLOSED sales/items, expense revisions and losses are immutable. Their append
 // identities detect own-connection changes; data_version detects other writers.
 return JSON.stringify([m.version,db.pragma('data_version',{simple:true}),(db.prepare('SELECT COALESCE(MAX(sale_number),0) n FROM orders WHERE sale_number IS NOT NULL').get() as {n:number}).n,last('expenses'),last('expense_revisions'),last('stock_losses')]);
}
function load(db:Database.Database):Totals {
 const r=db.prepare("SELECT COALESCE(SUM(i.quantity*i.unit_price_cents),0) revenue,COALESCE(SUM(i.quantity*i.unit_cost_cents),0) cost,COALESCE(SUM(i.quantity),0) quantity,COUNT(CASE WHEN i.unit_cost_cents IS NULL THEN 1 END) missingCost FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status='CLOSED'").safeIntegers().get() as Pick<Totals,'revenue'|'cost'|'quantity'|'missingCost'>;
 const m=metadata(db),source=m.tables.has('expense_revisions')?effectiveExpenses:'SELECT amount_cents amountCents FROM expenses';
 const expense=(db.prepare(`SELECT COALESCE(SUM(amountCents),0) n FROM (${source})`).safeIntegers().get() as {n:bigint}).n;
 const losses=m.tables.has('stock_losses')?db.prepare('SELECT COALESCE(SUM(total_cost_cents),0) loss,COUNT(CASE WHEN total_cost_cents IS NULL THEN 1 END) missingLoss FROM stock_losses').safeIntegers().get() as Pick<Totals,'loss'|'missingLoss'>:{loss:0n,missingLoss:0n};
 return {...r,expense,...losses};
}
export function prepareFinancialCapacity(db:Database.Database,delta:Partial<Totals>):Capacity {
 const observed=stamp(db);let base=cached.get(db);if(base?.stamp!==observed){base={stamp:observed,totals:load(db)};cached.set(db,base);}
 const totals={...base.totals};for(const key of Object.keys(delta) as (keyof Totals)[])totals[key]+=delta[key]!;
 const limit=BigInt(Number.MAX_SAFE_INTEGER),valid=(n:bigint)=>n>=-limit&&n<=limit;
 if(Object.values(totals).some(n=>typeof n!=='bigint'||n<0n||!valid(n)))throw Error('Shuma e regjistrimeve tejkalon kufirin teknik të lejuar.');
 if(totals.missingCost===0n){const gross=totals.revenue-totals.cost;if(!valid(gross)||(totals.missingLoss===0n&&!valid(gross-totals.expense-totals.loss)))throw Error('Rezultati financiar tejkalon kufirin teknik të lejuar.');}
 return {totals,stamp:observed};
}
export function sealFinancialCapacity(db:Database.Database,capacity:Capacity):void {capacity.stamp=stamp(db);}
export function commitFinancialCapacity(db:Database.Database,capacity:Capacity|undefined):void {if(capacity)cached.set(db,capacity);}
export type FinancialCapacity=Capacity;
