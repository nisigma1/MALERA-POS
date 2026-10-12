import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../electron/database/connection';
import {services,accepted,configure,snapshot} from './support/reliability';
import {inventorySummary} from '../src/domain/configuration';

it('loss must reject a quantity subtraction that cannot preserve exact units',()=>{
 const db=openDatabase(':memory:');try{
  configure(db,100,2,Number.MAX_SAFE_INTEGER);const before=snapshot(db);
  expect(services(db).finance.recordLoss({requestId:randomUUID(),productId:'KAFE-1',quantity:1.5,reason:'DAMAGED',note:''}).ok).toBe(false);expect(snapshot(db)).toEqual(before);
 }finally{db.close();}
});
it('supply must reject an addition that rounds accepted physical quantity',()=>{
 const db=openDatabase(':memory:');try{
  configure(db,100,2,Number.MAX_SAFE_INTEGER-2);const before=snapshot(db);
  expect(services(db).configuration.addSupply({requestId:randomUUID(),productId:'KAFE-1',quantity:1.5}).ok).toBe(false);expect(snapshot(db)).toEqual(before);
 }finally{db.close();}
});
it('cash movement must reject an unsafe aggregate before committing its event',()=>{
 const db=openDatabase(':memory:');try{
  const s=services(db);accepted(s.finance.recordCashMovement({requestId:randomUUID(),direction:'IN',amountCents:Number.MAX_SAFE_INTEGER,reason:'QA',note:''}));const before=snapshot(db);
  expect(s.finance.recordCashMovement({requestId:randomUUID(),direction:'IN',amountCents:1,reason:'QA',note:''}).ok).toBe(false);expect(snapshot(db)).toEqual(before);expect(s.finance.cashPreview({openingCents:0}).expectedCents).toBe(Number.MAX_SAFE_INTEGER);
 }finally{db.close();}
});
it('sale numbering uses the existing unique index and keeps NULL OPEN rows out of allocation',()=>{
 const db=openDatabase(':memory:');try{const plan=db.prepare('EXPLAIN QUERY PLAN SELECT COALESCE(MAX(sale_number),0)+1 AS number FROM orders WHERE sale_number IS NOT NULL').all() as {detail:string}[];expect(plan.some(p=>p.detail.includes('unique_sale_number'))).toBe(true);expect(db.prepare('SELECT COALESCE(MAX(sale_number),0)+1 AS number FROM orders WHERE sale_number IS NOT NULL').get()).toEqual({number:1});}finally{db.close();}
});
it('fractional stock operations preserve exact decimal ledger quantities and cents',()=>{
 const db=openDatabase(':memory:');try{const s=services(db),p=s.repo.listProducts().find(p=>p.id==='KAFE-1')!;accepted(s.configuration.updateProduct({...p,trackInventory:true,sellingPriceCents:100,purchaseCostCents:100}));for(const quantity of [.1,.2,.29])accepted(s.configuration.addSupply({requestId:randomUUID(),productId:'KAFE-1',quantity}));expect(s.repo.listProducts().find(p=>p.id==='KAFE-1')?.stockQuantity).toBe(.59);expect(s.finance.recordLoss({requestId:randomUUID(),productId:'KAFE-1',quantity:.29,reason:'DAMAGED',note:''})).toMatchObject({ok:true,data:{totalCostCents:29}});expect(s.repo.listProducts().find(p=>p.id==='KAFE-1')?.stockQuantity).toBe(.3);}finally{db.close();}
});
it('known fractional inventory value is computed in exact cents without false incompleteness',()=>{
 const db=openDatabase(':memory:');try{const p=services(db).repo.listProducts()[0]!;expect(inventorySummary([{...p,trackInventory:true,stockQuantity:.29,purchaseCostCents:100,sellingPriceCents:200}]).inventoryValueCents).toBe(29);expect(inventorySummary([{...p,trackInventory:true,stockQuantity:.25,purchaseCostCents:3,sellingPriceCents:200}]).inventoryValueCents).toBeNull();}finally{db.close();}
});
it('new cash session cannot bypass all-history money capacity',()=>{
 const db=openDatabase(':memory:');try{configure(db,Number.MAX_SAFE_INTEGER,0,5);const s=services(db),a=accepted(s.orders.addProduct({tableId:'M5',productId:'KAFE-1'})).order!;accepted(s.checkout.completeOrder({orderId:a.id}));const p=s.finance.cashPreview({openingCents:0});accepted(s.finance.closeCash({requestId:randomUUID(),sessionId:p.sessionId,openingCents:0,countedCents:p.expectedCents,expectedFingerprint:p.fingerprint,note:''}));const product=s.repo.listProducts().find(p=>p.id==='KAFE-1')!;accepted(s.configuration.updateProduct({...product,sellingPriceCents:1}));const b=accepted(s.orders.addProduct({tableId:'M6',productId:'KAFE-1'})).order!,before=snapshot(db);expect(s.checkout.completeOrder({orderId:b.id}).ok).toBe(false);expect(snapshot(db)).toEqual(before);expect(s.finance.report({period:'ALL'}).sales.summary.salesCents).toBe(Number.MAX_SAFE_INTEGER);}finally{db.close();}
});
it('expense aggregate capacity fails before persistence',()=>{
 const db=openDatabase(':memory:');try{const s=services(db),input={amountCents:Number.MAX_SAFE_INTEGER,category:'OTHER',occurredAt:new Date().toISOString(),description:'QA',paidFromTill:false};accepted(s.finance.saveExpense({...input,requestId:randomUUID()}));const before=snapshot(db);expect(s.finance.saveExpense({...input,requestId:randomUUID(),amountCents:1}).ok).toBe(false);expect(snapshot(db)).toEqual(before);expect(s.finance.report({period:'ALL'}).operatingResultCents).toBe(-Number.MAX_SAFE_INTEGER);}finally{db.close();}
});
it('combined operating result cannot become unsafe after a stock loss',()=>{
 const db=openDatabase(':memory:');try{configure(db,1,1,5);const s=services(db);accepted(s.finance.saveExpense({requestId:randomUUID(),amountCents:Number.MAX_SAFE_INTEGER,category:'OTHER',occurredAt:new Date().toISOString(),description:'QA',paidFromTill:false}));const before=snapshot(db);expect(s.finance.recordLoss({requestId:randomUUID(),productId:'KAFE-1',quantity:1,reason:'WASTE',note:''}).ok).toBe(false);expect(snapshot(db)).toEqual(before);}finally{db.close();}
});
