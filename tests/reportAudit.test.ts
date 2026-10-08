import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../electron/database/connection';
import { createRepositories } from '../electron/database/repositories';
import { createOrderService } from '../electron/database/orders';
import { createCheckoutService } from '../electron/database/checkout';
import { readSalesReport } from '../electron/database/salesReports';
let db: Database.Database;
beforeEach(()=>{db=openDatabase(':memory:');});
afterEach(()=>db.close());
function product(id: string, price: number, cost: number|null) {
  db.prepare('UPDATE products SET selling_price_cents=?,purchase_cost_cents=?,track_inventory=0 WHERE id=?').run(price,cost,id);
}
function sell(items: {id:string;quantity:number}[],tableId='M5') {
  const orders=createOrderService(db,createRepositories(db));
  for(const item of items)for(let i=0;i<item.quantity;i++)expect(orders.addProduct({tableId,productId:item.id})).toMatchObject({ok:true});
  const order=orders.getForTable(tableId).order!;
  expect(createCheckoutService(db,orders).completeOrder({orderId:order.id})).toMatchObject({ok:true});
}
describe('auditable historical sales',()=>{
  it('reconciles line quantity, sale, historical cost and profit',()=>{
    product('KAFE-1',100,50);product('PIJE-1',150,60);
    sell([{id:'KAFE-1',quantity:2},{id:'PIJE-1',quantity:3}]);
    const report=readSalesReport(db,'ALL');
    expect(report.summary).toMatchObject({salesCents:650,costCents:280,grossProfitCents:370});
    expect(report.recentSales[0]!.items).toMatchObject([{quantity:2,unitPriceCents:100,unitCostCents:50,totalCents:200,costCents:100,profitCents:100},{quantity:3,unitPriceCents:150,unitCostCents:60,totalCents:450,costCents:180,profitCents:270}]);
    expect(report.costCoverage).toEqual({knownCostCents:280,missingCostLines:0,missingCostUnits:0,salesWithoutCostCents:0});
  });
  it('reports missing cost quantity and exposed revenue without inventing zero cost',()=>{
    product('KAFE-1',100,50);product('PIJE-1',150,null);
    sell([{id:'KAFE-1',quantity:2},{id:'PIJE-1',quantity:3}]);
    const report=readSalesReport(db,'ALL');
    expect(report.costCoverage).toEqual({knownCostCents:100,missingCostLines:1,missingCostUnits:3,salesWithoutCostCents:450});
    expect(report.summary).toMatchObject({costCents:null,grossProfitCents:null,netProfitCents:null});
    expect(report.recentSales[0]!.items[1]).toMatchObject({costCents:null,profitCents:null});
  });
  it('keeps historical names and missing costs after catalog corrections',()=>{
    product('KAFE-1',100,null);sell([{id:'KAFE-1',quantity:2}]);
    const before=readSalesReport(db,'ALL');
    db.prepare("UPDATE products SET name='Renamed',selling_price_cents=200,purchase_cost_cents=50 WHERE id='KAFE-1'").run();
    expect(readSalesReport(db,'ALL')).toEqual(before);
    expect(before.recentSales[0]!.items[0]).toMatchObject({name:'Espresso',unitPriceCents:100,unitCostCents:null});
  });
  it('shows real losses and subtracts only recorded expenses',()=>{
    product('KAFE-1',100,150);sell([{id:'KAFE-1',quantity:2}]);
    db.prepare("INSERT INTO expenses(id,amount_cents,description,expense_date,created_at) VALUES ('audit',75,'Recorded expense','2026-01-01','2026-01-01T12:00:00Z')").run();
    const report=readSalesReport(db,'ALL');
    expect(report.recentSales[0]!.items[0]!.profitCents).toBe(-100);
    expect(report.summary).toMatchObject({grossProfitCents:-100,expensesCents:75,netProfitCents:-175});
  });
  it('keeps totals for all sales while limiting the detailed list to the last 50',()=>{
    product('KAFE-1',100,50);for(let i=0;i<51;i++)sell([{id:'KAFE-1',quantity:1}]);
    const report=readSalesReport(db,'ALL');
    expect(report.summary).toMatchObject({salesCents:5100,costCents:2550,completedOrders:51});
    expect(report.recentSales).toHaveLength(50);expect(report.recentSales.every(s=>s.items.length===1)).toBe(true);
  });
  it('uses identical accounting across both report endpoints',()=>{
    product('KAFE-1',100,50);product('PIJE-1',150,null);
    sell([{id:'KAFE-1',quantity:2},{id:'PIJE-1',quantity:1}]);
    expect(createRepositories(db).getSummary()).toEqual(readSalesReport(db,'ALL').summary);
  });
  it('rejects unsafe net-profit subtraction in both report endpoints',()=>{
    product('KAFE-1',0,Number.MAX_SAFE_INTEGER);sell([{id:'KAFE-1',quantity:1}]);
    db.prepare('INSERT INTO expenses VALUES (?,?,?,?,?)').run('large',Number.MAX_SAFE_INTEGER,'Recorded expense','2026-01-01','2026-01-01T12:00:00Z');
    expect(()=>readSalesReport(db,'ALL')).toThrow('Unsafe profit aggregate');
    expect(()=>createRepositories(db).getSummary()).toThrow('Unsafe profit aggregate');
  });
});
