import type Database from 'better-sqlite3';
import type { ReportPeriod, SalesReport } from '../../src/domain/types';

export function reportBounds(period: ReportPeriod, now = new Date()): { start: string; end: string } {
  const start = new Date(now); start.setHours(0,0,0,0);
  if (period === '7_DAYS') start.setDate(start.getDate()-6);
  if (period === '30_DAYS') start.setDate(start.getDate()-29);
  const end = new Date(now); end.setHours(0,0,0,0); end.setDate(end.getDate()+1);
  return { start: period === 'ALL' ? '' : start.toISOString(), end: period === 'ALL' ? '9999' : end.toISOString() };
}
export function readSalesReport(db: Database.Database, input: unknown, now = new Date()): SalesReport {
  if (typeof input !== 'string' || !['TODAY','7_DAYS','30_DAYS','ALL'].includes(input)) throw new Error('Invalid report period');
  const period = input as ReportPeriod;
  const bounds = reportBounds(period,now);
  return db.transaction(() => {
    const totals = db.prepare(`SELECT COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(i.quantity*i.unit_price_cents),0) AS sales,
      COALESCE(SUM(i.quantity*i.unit_cost_cents),0) AS cost, COUNT(CASE WHEN i.unit_cost_cents IS NULL THEN 1 END) AS unknownCost,
      COALESCE(SUM(CASE WHEN i.unit_cost_cents IS NULL THEN i.quantity ELSE 0 END),0) AS missingCostUnits,
      COALESCE(SUM(CASE WHEN i.unit_cost_cents IS NULL THEN i.quantity*i.unit_price_cents ELSE 0 END),0) AS salesWithoutCost,
      COALESCE(SUM(i.quantity),0) AS quantity,
      COALESCE(SUM(CASE WHEN p.payment_method='CASH' THEN i.quantity*i.unit_price_cents ELSE 0 END),0) AS cash,
      COALESCE(SUM(CASE WHEN p.payment_method='CARD' THEN i.quantity*i.unit_price_cents ELSE 0 END),0) AS card,
      COALESCE(SUM(CASE WHEN p.payment_method IS NULL THEN i.quantity*i.unit_price_cents ELSE 0 END),0) AS unknownPayment
      FROM orders o JOIN order_items i ON i.order_id=o.id LEFT JOIN order_payments p ON p.order_id=o.id
      WHERE o.status='CLOSED' AND o.closed_at>=? AND o.closed_at<?`).get(bounds.start,bounds.end) as { orders: number; sales: number; cost: number; unknownCost: number; missingCostUnits: number; salesWithoutCost: number; quantity: number; cash: number; card: number; unknownPayment: number };
    // Expense dates are local YYYY-MM-DD, while completion timestamps are UTC ISO.
    const localDate = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
    const expenseStart = period === 'ALL' ? '' : localDate(bounds.start);
    const expenseEnd = period === 'ALL' ? '9999' : localDate(bounds.end);
    const expense = db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total FROM expenses WHERE expense_date>=? AND expense_date<?').get(expenseStart,expenseEnd) as { total: number };
    for (const value of [...Object.values(totals),expense.total]) if (!Number.isSafeInteger(value)) throw new Error('Unsafe report aggregate');
    const cost = totals.unknownCost ? null : totals.cost;
    const gross = cost === null ? null : totals.sales-cost;
    const net = gross === null ? null : gross-expense.total;
    if ((gross !== null && !Number.isSafeInteger(gross)) || (net !== null && !Number.isSafeInteger(net))) throw new Error('Unsafe profit aggregate');
    if (totals.cash+totals.card+totals.unknownPayment !== totals.sales) throw new Error('Payment reconciliation failed');
    const recentSales = db.prepare(`SELECT o.id,o.sale_number AS saleNumber,t.code AS tableCode,o.closed_at AS completedAt,p.payment_method AS paymentMethod,
      SUM(i.quantity*i.unit_price_cents) AS totalCents FROM orders o JOIN cafe_tables t ON t.id=o.table_id
      JOIN order_items i ON i.order_id=o.id LEFT JOIN order_payments p ON p.order_id=o.id
      WHERE o.status='CLOSED' AND o.closed_at>=? AND o.closed_at<? GROUP BY o.id ORDER BY o.closed_at DESC,o.id DESC LIMIT 50`).all(bounds.start,bounds.end) as SalesReport['recentSales'];
    if (recentSales.some(row=>!Number.isSafeInteger(row.totalCents))) throw new Error('Unsafe sale total');
    // Read immutable sale snapshots, never today's product names, prices or costs.
    const details = recentSales.length ? db.prepare(`SELECT id,order_id AS orderId,product_name_snapshot AS name,quantity,
      unit_price_cents AS unitPriceCents,unit_cost_cents AS unitCostCents FROM order_items
      WHERE order_id IN (${recentSales.map(()=>'?').join(',')}) ORDER BY rowid`).all(...recentSales.map(s=>s.id)) as {id:string;orderId:string;name:string;quantity:number;unitPriceCents:number;unitCostCents:number|null}[] : [];
    const safe = (value: bigint) => { const number=Number(value);if(!Number.isSafeInteger(number))throw new Error('Unsafe sale detail');return number; };
    for(const sale of recentSales) {
      sale.items=details.filter(item=>item.orderId===sale.id).map(item=>{
        const totalCents=safe(BigInt(item.quantity)*BigInt(item.unitPriceCents));
        const costCents=item.unitCostCents===null?null:safe(BigInt(item.quantity)*BigInt(item.unitCostCents));
        return {id:item.id,name:item.name,quantity:item.quantity,unitPriceCents:item.unitPriceCents,unitCostCents:item.unitCostCents,totalCents,costCents,profitCents:costCents===null?null:safe(BigInt(totalCents)-BigInt(costCents))};
      });
      if(safe(sale.items.reduce((sum,item)=>sum+BigInt(item.totalCents),0n))!==sale.totalCents)throw new Error('Sale detail reconciliation failed');
    }
    return { period, summary: { salesCents: totals.sales, costCents: cost, grossProfitCents: gross, expensesCents: expense.total, netProfitCents: net, completedOrders: totals.orders, productsSold: totals.quantity, averageOrderCents: totals.orders ? Math.round(totals.sales/totals.orders) : null }, cashCents: totals.cash, cardCents: totals.card, unknownPaymentCents: totals.unknownPayment, costCoverage:{knownCostCents:totals.cost,missingCostLines:totals.unknownCost,missingCostUnits:totals.missingCostUnits,salesWithoutCostCents:totals.salesWithoutCost}, recentSales };
  })();
}
