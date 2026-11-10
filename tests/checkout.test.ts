import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/database/connection';
import { createRepositories } from '../electron/database/repositories';
import { createOrderService } from '../electron/database/orders';
import { createCheckoutService } from '../electron/database/checkout';
import { readSalesReport, reportBounds } from '../electron/database/salesReports';
import { migrate } from '../electron/database/migrations';
let db: Database.Database;
const services = () => {
  const repo = createRepositories(db);
  const orders = createOrderService(db, repo);
  return { repo, orders, checkout: createCheckoutService(db, orders) };
};
const configure = (
  id = 'KAFE-1',
  stock: number | null = 10,
  tracked: number | null = 1,
  price = 100,
  cost: number | null = 30,
) => {
  db.prepare(
    'UPDATE products SET selling_price_cents=?,purchase_cost_cents=?,track_inventory=? WHERE id=?',
  ).run(price, cost, tracked, id);
  db.prepare('UPDATE inventory_balances SET quantity=? WHERE product_id=?').run(stock, id);
};
const add = (tableId = 'M5', productId = 'KAFE-1') => {
  const result = services().orders.addProduct({ tableId, productId });
  if (!result.ok) throw new Error(result.message);
  return result.data.order!;
};
const finish = (orderId: string) => services().checkout.completeOrder({ orderId });
// Historical fixture bypasses the current command; never a supported CARD checkout.
const legacy = (orderId: string, method: 'CARD' | null) => {
  if (method)
    db.prepare('INSERT INTO order_payments VALUES (?,?,?)').run(
      orderId,
      method,
      '2020-01-01T10:00:00.000Z',
    );
  db.prepare(
    "UPDATE orders SET status='CLOSED',closed_at='2020-01-01T10:00:00.000Z',sale_number=(SELECT COALESCE(MAX(sale_number),0)+1 FROM orders) WHERE id=?",
  ).run(orderId);
};
const snapshotV1 = () =>
  ['orders', 'order_items', 'inventory_balances', 'inventory_movements', 'cafe_tables'].map((t) =>
    db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
  );
const snapshot = () =>
  [
    'orders',
    'order_items',
    'order_payments',
    'inventory_balances',
    'inventory_movements',
    'cafe_tables',
  ].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
beforeEach(() => {
  db = openDatabase(':memory:');
  configure();
});
afterEach(() => {
  if (db.open) db.close();
});
describe('atomic checkout', () => {
  it('completes without a selector and persists authoritative CASH', () => {
    const order = add();
    const result = services().checkout.completeOrder({
      orderId: order.id,
      expectedRevision: order.revision,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        paymentMethod: 'CASH',
        totalCents: 100,
        workspace: { order: null, table: { status: 'FREE' } },
      },
    });
    expect(db.prepare('SELECT payment_method FROM order_payments').all()).toEqual([
      { payment_method: 'CASH' },
    ]);
    expect(readSalesReport(db, 'ALL')).toMatchObject({
      cashCents: 100,
      cardCents: 0,
      unknownPaymentCents: 0,
      summary: { salesCents: 100, completedOrders: 1 },
      recentSales: [{ id: order.id, paymentMethod: 'CASH', totalCents: 100 }],
    });
    const before = snapshot();
    expect(services().checkout.completeOrder({ orderId: order.id })).toMatchObject({
      ok: false,
      code: 'ALREADY_COMPLETED',
    });
    expect(snapshot()).toEqual(before);
  });
  it('rolls back method-free checkout after financial writes when table release fails', () => {
    const order = add();
    db.exec(
      "CREATE TRIGGER fail_unclassified_release BEFORE UPDATE OF status ON cafe_tables WHEN NEW.status='FREE' BEGIN SELECT RAISE(ABORT,'injected failure'); END",
    );
    const before = snapshot();
    expect(services().checkout.completeOrder({ orderId: order.id })).toMatchObject({
      ok: false,
      code: 'CHECKOUT_FAILED',
    });
    expect(snapshot()).toEqual(before);
  });
  it.each([false, true])(
    'persists CASH and authoritative snapshots with revision check %s',
    (revisionCheck) => {
      const order = add();
      add();
      configure('KAFE-1', 10, 1, 900, 800);
      const result = services().checkout.completeOrder({
        orderId: order.id,
        ...(revisionCheck
          ? { expectedRevision: services().orders.getForTable('M5').order!.revision }
          : {}),
      });
      const method = 'CASH';
      expect(result).toMatchObject({
        ok: true,
        data: {
          orderId: order.id,
          paymentMethod: method,
          totalCents: 200,
          workspace: { order: null, table: { status: 'FREE' } },
        },
      });
      expect(
        db.prepare('SELECT status,closed_at FROM orders WHERE id=?').get(order.id),
      ).toMatchObject({ status: 'CLOSED', closed_at: expect.any(String) });
      expect(db.prepare('SELECT * FROM order_payments').get()).toMatchObject({
        order_id: order.id,
        payment_method: method,
        completed_at: expect.any(String),
      });
      expect(
        db.prepare("SELECT quantity FROM inventory_balances WHERE product_id='KAFE-1'").get(),
      ).toEqual({ quantity: 8 });
      expect(
        db.prepare('SELECT type,quantity_delta,related_order_id FROM inventory_movements').all(),
      ).toEqual([{ type: 'SALE', quantity_delta: -2, related_order_id: order.id }]);
      expect(readSalesReport(db, 'ALL').summary).toMatchObject({
        salesCents: 200,
        costCents: 60,
        grossProfitCents: 140,
        completedOrders: 1,
      });
    },
  );
  it('aggregates multiple price/cost lines into one movement per product', () => {
    const order = add();
    configure('KAFE-1', 10, 1, 150, 40);
    add();
    expect(finish(order.id).ok).toBe(true);
    expect(db.prepare('SELECT quantity_delta FROM inventory_movements').all()).toEqual([
      { quantity_delta: -2 },
    ]);
    expect(readSalesReport(db, 'ALL').summary).toMatchObject({ salesCents: 250, costCents: 70 });
  });
  it.each([null, 0])('does not deduct deliberately untracked products with stock %s', (stock) => {
    configure('KAFE-1', stock, 0);
    const order = add();
    const before = db.prepare('SELECT * FROM inventory_balances').all();
    expect(finish(order.id).ok).toBe(true);
    expect(db.prepare('SELECT * FROM inventory_balances').all()).toEqual(before);
    expect(db.prepare('SELECT * FROM inventory_movements').all()).toEqual([]);
  });
  it('rejects duplicate completion without a second deduction or payment', () => {
    const order = add();
    finish(order.id);
    const before = snapshot();
    expect(finish(order.id)).toMatchObject({ ok: false, code: 'ALREADY_COMPLETED' });
    expect(snapshot()).toEqual(before);
  });
  it('keeps completed order, lines and payment immutable at the DB boundary', () => {
    const order = add();
    finish(order.id);
    for (const sql of [
      'UPDATE orders SET updated_at=updated_at',
      'DELETE FROM orders',
      'UPDATE order_items SET quantity=2',
      'DELETE FROM order_items',
      "UPDATE order_payments SET payment_method='CARD'",
      'DELETE FROM order_payments',
    ])
      expect(() => db.exec(sql)).toThrow();
    expect(() =>
      db
        .prepare("INSERT INTO order_items VALUES ('late',?,'KAFE-1','late',1,100,30,'now')")
        .run(order.id),
    ).toThrow();
  });
  it.each(['', null, 'WIRE', false])(
    'requires a valid payment method %s with zero writes',
    (paymentMethod) => {
      const order = add();
      const before = snapshot();
      expect(services().checkout.completeOrder({ orderId: order.id, paymentMethod })).toMatchObject(
        { ok: false, code: 'INVALID_REQUEST' },
      );
      expect(snapshot()).toEqual(before);
    },
  );
  it('rejects unknown and cancelled orders', () => {
    expect(finish('missing')).toMatchObject({ ok: false, code: 'ORDER_NOT_OPEN' });
    const order = add();
    services().orders.removeItem({ tableId: 'M5', itemId: order.items[0]!.id });
    expect(finish(order.id)).toMatchObject({ ok: false, code: 'ORDER_NOT_OPEN' });
  });
  it('rejects empty open orders without releasing the table', () => {
    const order = add();
    db.prepare('DELETE FROM order_items WHERE order_id=?').run(order.id);
    const before = snapshot();
    expect(finish(order.id)).toMatchObject({ ok: false, code: 'ORDER_EMPTY' });
    expect(snapshot()).toEqual(before);
  });
  it('rejects renderer money and malformed requests', () => {
    const order = add();
    const before = snapshot();
    for (const input of [null, [], { orderId: order.id, paymentMethod: 'CASH', totalCents: 1 }])
      expect(services().checkout.completeOrder(input)).toMatchObject({
        ok: false,
        code: 'INVALID_REQUEST',
      });
    expect(snapshot()).toEqual(before);
  });
  it('requires reconfirmation if the order changed after opening checkout', () => {
    const order = add();
    add();
    const before = snapshot();
    expect(
      services().checkout.completeOrder({ orderId: order.id, expectedRevision: order.revision }),
    ).toMatchObject({ ok: false, code: 'ORDER_CHANGED' });
    expect(snapshot()).toEqual(before);
  });
  it('permits an inactive existing line but rejects adding the product again', () => {
    const order = add();
    db.prepare("UPDATE products SET active=0 WHERE id='KAFE-1'").run();
    expect(services().orders.addProduct({ tableId: 'M5', productId: 'KAFE-1' }).ok).toBe(false);
    expect(finish(order.id).ok).toBe(true);
  });
  it.each([null, 0])('blocks unknown/zero tracked stock in the catalog command (%s)', (stock) => {
    configure('KAFE-1', stock);
    const before = snapshot();
    expect(services().orders.addProduct({ tableId: 'M5', productId: 'KAFE-1' }).ok).toBe(false);
    expect(snapshot()).toEqual(before);
  });
  it.each([null, 0, 1])(
    'rolls back all state when a second tracked product has stock %s',
    (stock) => {
      configure('KAFE-2', 10);
      const order = add();
      add('M5', 'KAFE-2');
      add('M5', 'KAFE-2');
      db.prepare("UPDATE inventory_balances SET quantity=? WHERE product_id='KAFE-2'").run(stock);
      const before = snapshot();
      expect(finish(order.id)).toMatchObject({
        ok: false,
        code: stock === null ? 'STOCK_UNKNOWN' : 'INSUFFICIENT_STOCK',
      });
      expect(snapshot()).toEqual(before);
      expect(services().orders.getForTable('M5').order?.id).toBe(order.id);
    },
  );
  it('rolls back earlier deductions, movements and payment after a real SQLite failure', () => {
    configure('KAFE-2');
    const order = add();
    add('M5', 'KAFE-2');
    db.exec(
      "CREATE TRIGGER fail_release BEFORE UPDATE OF status ON cafe_tables WHEN NEW.status='FREE' BEGIN SELECT RAISE(ABORT,'injected failure after all financial writes'); END",
    );
    const before = snapshot();
    expect(finish(order.id)).toMatchObject({ ok: false, code: 'CHECKOUT_FAILED' });
    expect(snapshot()).toEqual(before);
  });
  it('does not deduct below zero and allows the exact remaining balance', () => {
    configure('KAFE-1', 1);
    const order = add();
    expect(finish(order.id).ok).toBe(true);
    expect(
      db.prepare("SELECT quantity FROM inventory_balances WHERE product_id='KAFE-1'").get(),
    ).toEqual({ quantity: 0 });
  });
  it('rejects unsafe historical cost totals without completing or deducting', () => {
    configure('KAFE-1', 10, 1, 100, Number.MAX_SAFE_INTEGER);
    const order = add();
    add();
    const before = snapshot();
    expect(finish(order.id)).toMatchObject({ ok: false, code: 'CHECKOUT_FAILED' });
    expect(snapshot()).toEqual(before);
  });
  it('handles a zero price and a known zero cost truthfully', () => {
    configure('KAFE-1', 10, 1, 0, 0);
    const order = add();
    finish(order.id);
    expect(readSalesReport(db, 'ALL').summary).toMatchObject({
      salesCents: 0,
      costCents: 0,
      grossProfitCents: 0,
      completedOrders: 1,
    });
  });
});
describe('completed sales reports', () => {
  it('excludes OPEN/CANCELLED, includes cash/card and sums payment breakdown exactly', () => {
    const cash = add();
    finish(cash.id);
    const card = add('M6');
    legacy(card.id, 'CARD');
    add('M7');
    const cancelled = add('M8');
    services().orders.removeItem({ tableId: 'M8', itemId: cancelled.items[0]!.id });
    const report = readSalesReport(db, 'ALL');
    expect(report.summary).toMatchObject({ salesCents: 200, completedOrders: 2 });
    expect(report.cashCents).toBe(100);
    expect(report.cardCents).toBe(100);
    expect(report.cashCents + report.cardCents + report.unknownPaymentCents).toBe(
      report.summary.salesCents,
    );
    expect(report.recentSales.map((s) => s.id).sort()).toEqual([cash.id, card.id].sort());
  });
  it('retains historical prices/costs/names when catalog values change after completion', () => {
    const order = add();
    finish(order.id);
    const before = readSalesReport(db, 'ALL');
    configure('KAFE-1', 40, 0, 9999, null);
    db.prepare("UPDATE products SET name='Changed' WHERE id='KAFE-1'").run();
    expect(readSalesReport(db, 'ALL')).toEqual(before);
  });
  it('keeps unknown snapshot COGS and profits NULL even after a later catalog cost is set', () => {
    configure('KAFE-1', 10, 1, 100, null);
    const order = add();
    finish(order.id);
    configure();
    expect(readSalesReport(db, 'ALL').summary).toMatchObject({
      salesCents: 100,
      costCents: null,
      grossProfitCents: null,
      netProfitCents: null,
    });
  });
  it('filters expenses and sales using local calendar boundaries', () => {
    const now = new Date(2026, 9, 8, 15);
    const bounds = reportBounds('TODAY', now);
    const order = add();
    db.prepare('UPDATE orders SET created_at=? WHERE id=?').run(bounds.start, order.id);
    finish(order.id);
    db.prepare(
      "INSERT INTO expenses VALUES ('today',20,'fixture','2026-10-08','now'),('old',90,'fixture','2026-09-01','now')",
    ).run();
    expect(readSalesReport(db, 'TODAY', now).summary.expensesCents).toBe(20);
    expect(readSalesReport(db, 'ALL', now).summary.expensesCents).toBe(110);
    expect(new Date(bounds.start).getHours()).toBe(0);
    expect(new Date(reportBounds('7_DAYS', now).start).getDate()).toBe(2);
    expect(new Date(reportBounds('30_DAYS', now).start).getDate()).toBe(9);
  });
  it('preserves legacy closed sales without inventing a historical payment', () => {
    const order = add();
    db.prepare(
      "UPDATE orders SET status='CLOSED',sale_number=(SELECT COALESCE(MAX(sale_number),0)+1 FROM orders),closed_at='2020-01-01T10:00:00.000Z' WHERE id=?",
    ).run(order.id);
    expect(readSalesReport(db, 'ALL')).toMatchObject({
      unknownPaymentCents: 100,
      summary: { salesCents: 100, completedOrders: 1 },
    });
    expect(readSalesReport(db, 'TODAY').summary.salesCents).toBe(0);
  });
  it('rejects arbitrary report filters', () => {
    expect(() => readSalesReport(db, 'SQL')).toThrow();
  });
  it('includes the start and excludes the end of a local report day', () => {
    const now = new Date(2026, 9, 8, 15);
    const bounds = reportBounds('TODAY', now);
    for (const [table, date] of [
      ['M5', bounds.start],
      ['M6', bounds.end],
      ['M7', new Date(new Date(bounds.start).getTime() - 1).toISOString()],
    ]) {
      const order = add(table);
      db.prepare(
        "UPDATE orders SET status='CLOSED',sale_number=(SELECT COALESCE(MAX(sale_number),0)+1 FROM orders),closed_at=? WHERE id=?",
      ).run(date, order.id);
    }
    expect(readSalesReport(db, 'TODAY', now).summary).toMatchObject({
      salesCents: 100,
      completedOrders: 1,
    });
    expect(readSalesReport(db, '7_DAYS', now).summary.completedOrders).toBe(2);
    expect(readSalesReport(db, 'ALL', now).summary.completedOrders).toBe(3);
  });
  it('migrates existing v1 orders/items/balances without changing their values', () => {
    const open = add();
    const cancelled = add('M6');
    services().orders.removeItem({ tableId: 'M6', itemId: cancelled.items[0]!.id });
    const legacy = add('M7');
    db.prepare(
      "UPDATE orders SET status='CLOSED',sale_number=1,closed_at='2020-01-01T00:00:00.000Z' WHERE id=?",
    ).run(legacy.id);
    db.exec(
      'DROP TABLE order_payments; DROP INDEX completed_orders_by_date; DELETE FROM schema_migrations WHERE version=2',
    );
    const before = snapshotV1();
    migrate(db);
    migrate(db);
    expect(snapshotV1()).toEqual(before);
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
    ]);
    expect(services().orders.getForTable('M5').order?.id).toBe(open.id);
  });
  it('uses calendar arithmetic across daylight saving transitions', () => {
    const now = new Date(2026, 9, 25, 15);
    const bounds = reportBounds('TODAY', now);
    expect(new Date(bounds.start).getHours()).toBe(0);
    expect(new Date(bounds.end).getHours()).toBe(0);
    expect(new Date(bounds.end).getDate()).toBe(26);
  });
  it('persists sale, stock and immutable reports through closing and reopening SQLite', () => {
    db.close();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fox-checkout-'));
    try {
      db = openDatabase(path.join(dir, 'fox.sqlite'));
      configure();
      const order = add();
      finish(order.id);
      const before = snapshot();
      const report = readSalesReport(db, 'ALL');
      db.close();
      db = openDatabase(path.join(dir, 'fox.sqlite'));
      migrate(db);
      expect(snapshot()).toEqual(before);
      expect(readSalesReport(db, 'ALL')).toEqual(report);
      expect(finish(order.id)).toMatchObject({ code: 'ALREADY_COMPLETED' });
      expect(snapshot()).toEqual(before);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
