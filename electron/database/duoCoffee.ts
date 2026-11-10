import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { COFFEE_STOCK_ID } from '../../src/domain/operators';
import { exactQuantity } from './numericSafety';

export function coffeeBalance(db: Database.Database) {
  const row = db
    .prepare(
      'SELECT p.track_inventory,b.quantity FROM products p JOIN inventory_balances b ON b.product_id=p.id WHERE p.id=?',
    )
    .get(COFFEE_STOCK_ID) as
    | { track_inventory: number | null; quantity: number | null }
    | undefined;
  return row?.track_inventory === 1 ? row.quantity : null;
}

// A confirmed portion changes available stock immediately. Checkout reads the
// recorded quantity on the item and only deducts portions not yet charged.
export function changeCoffeeStock(
  db: Database.Database,
  orderId: string,
  delta: number,
  now: string,
) {
  const current = coffeeBalance(db);
  if (current === null || !Number.isFinite(current)) return 'Vendos stokun e kafesë te Stoku.';
  if (delta < 0 && current < -delta) return 'Nuk ka mjaftueshëm kafe në stok.';
  const next = exactQuantity(current, delta);
  db.prepare('UPDATE inventory_balances SET quantity=?,updated_at=? WHERE product_id=?').run(
    next,
    now,
    COFFEE_STOCK_ID,
  );
  db.prepare(
    'INSERT INTO inventory_movements(id,product_id,type,quantity_delta,related_order_id,note,created_at) VALUES (?,?,?,?,?,?,?)',
  ).run(
    randomUUID(),
    COFFEE_STOCK_ID,
    delta < 0 ? 'MANUAL_ADJUSTMENT' : 'REVERSAL',
    delta,
    orderId,
    delta < 0 ? 'Kafe e konfirmuar në porosi' : 'Kafe e kthyer në stok',
    now,
  );
  return null;
}
