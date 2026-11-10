import type Database from 'better-sqlite3';
import { dateBounds, localDate } from '../../src/domain/finance';
import { type ShiftPeriod, type ShiftSales } from '../../src/domain/operators';

export function readShiftSales(
  db: Database.Database,
  input: unknown,
  now = new Date(),
): ShiftSales {
  if (input !== 'AM' && input !== 'PM' && input !== 'DAY')
    throw Error('Periudha nuk është e vlefshme.');
  const period: ShiftPeriod = input;
  const date = localDate(now);
  const { start, end } = dateBounds(date, date);
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT o.id, d.operator_id AS operator, i.quantity, i.unit_price_cents AS unitPrice,
        c.amount_cents AS cash, p.payment_method AS method
      FROM orders o JOIN order_items i ON i.order_id=o.id
      LEFT JOIN duo_order_lines d ON d.item_id=i.id
      LEFT JOIN order_payments p ON p.order_id=o.id
      LEFT JOIN cash_events c ON c.sale_id=o.id AND c.kind='CASH_SALE_IN'
      WHERE o.status='CLOSED' AND o.closed_at>=? AND o.closed_at<?`,
      )
      .safeIntegers()
      .all(start, end) as {
      id: string;
      operator: string | null;
      quantity: bigint;
      unitPrice: bigint;
      cash: bigint | null;
      method: string | null;
    }[];
    const paid = new Map<
      string,
      { total: bigint; cash: bigint | null; method: string | null; attributed: boolean }
    >();
    const totals = new Map<string, bigint>();
    for (const row of rows) {
      const amount = row.quantity * row.unitPrice;
      const order = paid.get(row.id) ?? {
        total: 0n,
        cash: row.cash,
        method: row.method,
        attributed: false,
      };
      order.total += amount;
      order.attributed ||= row.operator !== null;
      paid.set(row.id, order);
      if (!row.method && !row.operator) continue;
      const operator = row.operator ?? 'LEGACY';
      totals.set(operator, (totals.get(operator) ?? 0n) + amount);
    }
    for (const payment of paid.values())
      if (
        (payment.attributed && payment.method !== 'CASH') ||
        ((payment.attributed || payment.cash !== null) && (payment.cash ?? 0n) !== payment.total)
      )
        throw Error('Shitjet nuk përputhen me pagesat e regjistruara.');
    const safe = (n: bigint) => {
      if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
        throw Error('Totali nuk mund të llogaritet.');
      return Number(n);
    };
    const keys = ['OWNER', 'AM', 'PM', 'LEGACY'] as const;
    const selected = period === 'DAY' ? keys : keys.filter((key) => key === period);
    const breakdown = selected.map((operator) => ({
      operator,
      totalCents: safe(totals.get(operator) ?? 0n),
    }));
    return {
      date,
      rows: breakdown,
      totalCents: safe(breakdown.reduce((sum, row) => sum + BigInt(row.totalCents), 0n)),
    };
  })();
}
