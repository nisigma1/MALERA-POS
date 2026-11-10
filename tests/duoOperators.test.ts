import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { openDatabase } from '../electron/database/connection';
import { createRepositories } from '../electron/database/repositories';
import { createOrderService } from '../electron/database/orders';
import { createCheckoutService } from '../electron/database/checkout';
import { createConfigurationService } from '../electron/database/configuration';
import { coffeeBalance } from '../electron/database/duoCoffee';
import { readShiftSales } from '../electron/database/duoReports';
import type { OperatorId } from '../src/domain/operators';

let db: Database.Database;
let actor: OperatorId;
beforeEach(() => {
  db = openDatabase(':memory:');
  actor = 'AM';
  db.prepare(
    "UPDATE products SET selling_price_cents=120,purchase_cost_cents=30,track_inventory=1 WHERE id='KAFE-1'",
  ).run();
  db.prepare("UPDATE products SET selling_price_cents=180 WHERE id='KAFE-2'").run();
});
afterEach(() => db.close());

function services() {
  const repo = createRepositories(db, true);
  const orders = createOrderService(db, repo, { operator: () => actor });
  return {
    repo,
    orders,
    config: createConfigurationService(db, repo, true),
    checkout: createCheckoutService(db, orders, true),
  };
}
const supply = (quantity: number) => ({ requestId: randomUUID(), productId: 'KAFE-1', quantity });
function draft(orders: ReturnType<typeof createOrderService>, productId = 'KAFE-1', quantity = 1) {
  const tableId = 'M5';
  const order = orders.getForTable(tableId).order;
  return {
    requestId: randomUUID(),
    tableId,
    orderId: order?.id ?? null,
    expectedRevision: order?.revision ?? null,
    items: [{ productId, quantity }],
  };
}

describe('DUO coffee and shift accounting', () => {
  it('reserves 110 portions per kg, preserves each order-taker and reconciles after CASH', () => {
    const { config, orders, checkout } = services();
    const purchase = supply(2);
    expect(config.addSupply(purchase)).toMatchObject({ ok: true });
    expect(config.addSupply(purchase)).toMatchObject({ ok: true });
    expect(coffeeBalance(db)).toBe(220);
    const request = draft(orders, 'KAFE-1', 2);
    expect(orders.submitDraft(request)).toMatchObject({ ok: true });
    expect(orders.submitDraft(request)).toMatchObject({ ok: true });
    expect(coffeeBalance(db)).toBe(218);
    expect(readShiftSales(db, 'DAY').totalCents).toBe(0);

    actor = 'PM';
    expect(orders.submitDraft(request)).toMatchObject({ ok: false });
    expect(orders.submitDraft(draft(orders))).toMatchObject({ ok: true });
    expect(orders.submitDraft(draft(orders, 'KAFE-2'))).toMatchObject({ ok: true });
    expect(coffeeBalance(db)).toBe(216);

    actor = 'OWNER';
    const { id, revision } = orders.getForTable('M5').order!;
    expect(checkout.completeOrder({ orderId: id, expectedRevision: revision })).toMatchObject({
      ok: true,
    });
    expect(coffeeBalance(db)).toBe(216);
    expect(readShiftSales(db, 'AM')).toMatchObject({
      totalCents: 240,
      rows: [{ operator: 'AM', totalCents: 240 }],
    });
    expect(readShiftSales(db, 'PM')).toMatchObject({
      totalCents: 300,
      rows: [{ operator: 'PM', totalCents: 300 }],
    });
    expect(readShiftSales(db, 'DAY').totalCents).toBe(540);
    expect(
      db.prepare("SELECT amount_cents FROM cash_events WHERE kind='CASH_SALE_IN'").pluck().get(),
    ).toBe(540);
    expect(db.prepare('SELECT count(*) FROM receipt_documents').pluck().get()).toBe(1);
  });

  it('keeps fractional stock, rolls back insufficient orders and returns reserved portions on correction', () => {
    const { config, orders } = services();
    expect(config.addSupply(supply(0.015))).toMatchObject({ ok: true });
    expect(coffeeBalance(db)).toBe(1.65);
    const request = draft(orders);
    request.items.push({ productId: 'KAFE-2', quantity: 1 });
    expect(orders.submitDraft(request)).toMatchObject({ ok: false, notCommitted: true });
    expect(coffeeBalance(db)).toBe(1.65);
    expect(orders.getForTable('M5').order).toBeNull();
    expect(db.prepare('SELECT count(*) FROM duo_order_lines').pluck().get()).toBe(0);
    expect(orders.submitDraft(draft(orders))).toMatchObject({ ok: true });
    expect(coffeeBalance(db)).toBe(0.65);
    actor = 'OWNER';
    const order = orders.getForTable('M5').order!;
    expect(orders.removeItem({ tableId: 'M5', itemId: order.items[0]!.id })).toMatchObject({
      ok: true,
    });
    expect(coffeeBalance(db)).toBe(1.65);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('charges a pre-upgrade open coffee line once and reports it without inventing attribution', () => {
    const { config, checkout, orders } = services();
    expect(config.addSupply(supply(1))).toMatchObject({ ok: true });
    const legacy = createOrderService(db, createRepositories(db));
    expect(legacy.addProduct({ tableId: 'M5', productId: 'KAFE-1' })).toMatchObject({ ok: true });
    expect(coffeeBalance(db)).toBe(110);
    expect(checkout.completeOrder({ orderId: orders.getForTable('M5').order!.id })).toMatchObject({
      ok: true,
    });
    expect(coffeeBalance(db)).toBe(109);
    expect(readShiftSales(db, 'DAY').rows.at(-1)).toEqual({ operator: 'LEGACY', totalCents: 120 });
  });
});
