import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/database/connection';
import { migrate, migrations } from '../electron/database/migrations';
import { seed } from '../electron/database/seed';
import {
  assertQaDirectory,
  assertTestDatabasePath,
  verificationDirectory,
} from '../electron/database/safety';
import { createRepositories } from '../electron/database/repositories';
import { createOrderService } from '../electron/database/orders';
import { createCheckoutService } from '../electron/database/checkout';
import { createConfigurationService } from '../electron/database/configuration';
import { readSalesReport } from '../electron/database/salesReports';
import { stockState, STOCK_LABELS } from '../src/domain/configuration';
import { formatLocalDateTime, formatSaleNumber } from '../src/domain/display';
let db: Database.Database;
const context = () => {
  const repo = createRepositories(db),
    orders = createOrderService(db, repo);
  return {
    repo,
    orders,
    checkout: createCheckoutService(db, orders),
    config: createConfigurationService(db, repo),
  };
};
const configure = (tracking: number | null = 1, stock: number | null = 10) => {
  db.prepare(
    "UPDATE products SET selling_price_cents=100,purchase_cost_cents=50,track_inventory=? WHERE id='KAFE-1'",
  ).run(tracking);
  db.prepare("UPDATE inventory_balances SET quantity=? WHERE product_id='KAFE-1'").run(stock);
};
const add = (tableId = 'M5') => {
  const r = context().orders.addProduct({ tableId, productId: 'KAFE-1' });
  if (!r.ok) throw Error(r.message);
  return r.data.order!;
};
const dump = () =>
  Object.fromEntries(
    [
      'products',
      'orders',
      'order_items',
      'order_payments',
      'inventory_balances',
      'inventory_movements',
      'cafe_tables',
    ].map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
  );
beforeEach(() => {
  db = openDatabase(':memory:');
  configure();
});
afterEach(() => {
  if (db.open) db.close();
});
describe('Phase 4.1 cash and identity integrity', () => {
  it.each(['CARD', 'CASH', null, undefined])(
    'rejects renderer paymentMethod %s with absolutely zero writes',
    (method) => {
      const order = add(),
        before = dump();
      expect(
        context().checkout.completeOrder({ orderId: order.id, paymentMethod: method }),
      ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
      expect(dump()).toEqual(before);
    },
  );
  it('assigns unique increasing numbers exactly once inside completion', () => {
    const a = add(),
      b = add('M6');
    expect(context().checkout.completeOrder({ orderId: a.id })).toMatchObject({
      ok: true,
      data: { saleNumber: 1, paymentMethod: 'CASH' },
    });
    const before = dump();
    expect(context().checkout.completeOrder({ orderId: a.id })).toMatchObject({
      ok: false,
      code: 'ALREADY_COMPLETED',
    });
    expect(dump()).toEqual(before);
    expect(context().checkout.completeOrder({ orderId: b.id })).toMatchObject({
      ok: true,
      data: { saleNumber: 2 },
    });
    expect(() => db.prepare('UPDATE orders SET sale_number=3 WHERE id=?').run(a.id)).toThrow();
    expect(
      readSalesReport(db, 'ALL')
        .recentSales.map((s) => formatSaleNumber(s.saleNumber))
        .sort(),
    ).toEqual(['#000001', '#000002']);
  });
  it('rolls back number, CASH record and stock on late failure, then reuses the number safely', () => {
    const order = add(),
      before = dump();
    db.exec(
      "CREATE TRIGGER fail_release BEFORE UPDATE OF status ON cafe_tables WHEN NEW.status='FREE' BEGIN SELECT RAISE(ABORT,'fixture'); END",
    );
    expect(context().checkout.completeOrder({ orderId: order.id })).toMatchObject({
      ok: false,
      code: 'CHECKOUT_FAILED',
    });
    expect(dump()).toEqual(before);
    db.exec('DROP TRIGGER fail_release');
    expect(context().checkout.completeOrder({ orderId: order.id })).toMatchObject({
      ok: true,
      data: { saleNumber: 1 },
    });
  });
  it('migrates actual v2 history deterministically without changing any financial or stock field', () => {
    db.close();
    db = new Database(':memory:');
    db.pragma('foreign_keys=ON');
    db.exec(
      'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL) STRICT',
    );
    for (const migration of migrations.filter((m) => m.version <= 2)) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(migration.version, 'before');
    }
    seed(db);
    for (const [id, status, date, method] of [
      ['b', 'CLOSED', '2020-01-02T10:00:00.000Z', 'CARD'],
      ['a', 'CLOSED', '2020-01-02T10:00:00.000Z', null],
      ['z', 'CLOSED', '2020-01-01T10:00:00.000Z', 'CASH'],
      ['open', 'OPEN', null, null],
    ] as const) {
      db.prepare("INSERT INTO orders VALUES (?,?,'OPEN','created','updated',NULL)").run(
        id,
        id === 'open' ? 'M6' : 'M5',
      );
      db.prepare(
        "INSERT INTO order_items VALUES (?,?,'KAFE-1','History',1,45400,NULL,'created')",
      ).run('line-' + id, id);
      if (method) db.prepare('INSERT INTO order_payments VALUES (?,?,?)').run(id, method, date);
      if (status === 'CLOSED')
        db.prepare("UPDATE orders SET status='CLOSED',closed_at=? WHERE id=?").run(date, id);
    }
    db.prepare(
      "INSERT INTO inventory_movements VALUES ('legacy-sale','KAFE-1','SALE',-1,'b',NULL,'old')",
    ).run();
    const before = dump();
    migrate(db);
    migrate(db);
    const after = dump();
    expect(after.orders).toEqual(
      (before.orders as Record<string, unknown>[]).map((o) => ({
        ...o,
        sale_number: o.id === 'z' ? 1 : o.id === 'a' ? 2 : o.id === 'b' ? 3 : null,
      })),
    );
    for (const key of Object.keys(before).filter((k) => k !== 'orders'))
      expect(after[key]).toEqual(before[key]);
    const report = readSalesReport(db, 'ALL');
    expect(report).toMatchObject({
      cashCents: 45400,
      cardCents: 45400,
      unknownPaymentCents: 45400,
      summary: { salesCents: 136200, costCents: null, completedOrders: 3 },
    });
    expect(report.cashCents + report.cardCents + report.unknownPaymentCents).toBe(
      report.summary.salesCents,
    );
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(() => db.exec('UPDATE orders SET sale_number=99')).toThrow();
  });
  it('preserves cash identity and immutable reports across database reopen', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fox-identity-'));
    try {
      db.close();
      db = openDatabase(path.join(directory, 'fox.sqlite'));
      configure();
      const order = add();
      context().checkout.completeOrder({ orderId: order.id });
      const before = dump(),
        report = readSalesReport(db, 'ALL');
      db.close();
      db = openDatabase(path.join(directory, 'fox.sqlite'));
      expect(dump()).toEqual(before);
      expect(readSalesReport(db, 'ALL')).toEqual(report);
      expect(report.recentSales[0]).toMatchObject({ saleNumber: 1, paymentMethod: 'CASH' });
    } finally {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
describe('explicit inventory semantics', () => {
  it.each([null, 0, 1])('distinguishes tracking %s from the other two states', (tracking) => {
    configure(tracking, null);
    const product = context()
      .repo.listProducts()
      .find((p) => p.id === 'KAFE-1')!;
    expect(product.trackInventory).toBe(tracking === null ? null : tracking === 1);
    expect(stockState(product)).toBe(
      tracking === null ? 'UNCONFIGURED' : tracking === 0 ? 'UNTRACKED' : 'UNKNOWN_STOCK',
    );
    expect(STOCK_LABELS[stockState(product)]).toBe(
      tracking === null ? 'Pa konfiguruar' : tracking === 0 ? 'Nuk ndiqet' : 'Stok pa vendosur',
    );
  });
  it('blocks unconfigured new ordering without creating a draft or changing stock', () => {
    configure(null);
    const before = dump();
    expect(context().orders.addProduct({ tableId: 'M5', productId: 'KAFE-1' })).toMatchObject({
      ok: false,
      message: expect.stringContaining('Po ose Jo'),
    });
    expect(dump()).toEqual(before);
  });
  it('keeps an existing unconfigured line OPEN until the operator deliberately chooses Jo', () => {
    const order = add();
    configure(null);
    const before = dump();
    expect(context().checkout.completeOrder({ orderId: order.id })).toMatchObject({
      ok: false,
      code: 'INVENTORY_UNCONFIGURED',
      message: expect.stringContaining('Espresso'),
    });
    expect(dump()).toEqual(before);
    const product = context()
      .repo.listProducts()
      .find((p) => p.id === 'KAFE-1')!;
    expect(context().config.updateProduct({ ...product, trackInventory: false })).toMatchObject({
      ok: true,
    });
    expect(context().checkout.completeOrder({ orderId: order.id })).toMatchObject({ ok: true });
    expect(db.prepare('SELECT * FROM inventory_movements').all()).toEqual([]);
    expect(
      db.prepare("SELECT quantity FROM inventory_balances WHERE product_id='KAFE-1'").get(),
    ).toEqual({ quantity: 10 });
  });
  it('requires explicit tracking for an active priced editor save, preserving zero prices', () => {
    const product = context()
        .repo.listProducts()
        .find((p) => p.id === 'KAFE-1')!,
      before = dump();
    expect(
      context().config.updateProduct({ ...product, sellingPriceCents: 0, trackInventory: null }),
    ).toMatchObject({ ok: false, errors: { trackInventory: expect.any(String) } });
    expect(dump()).toEqual(before);
    expect(
      context().config.updateProduct({ ...product, active: false, trackInventory: null }),
    ).toMatchObject({ ok: true, data: { trackInventory: null } });
  });
  it('retains original SALE movements after tracking is deliberately disabled', () => {
    const order = add();
    context().checkout.completeOrder({ orderId: order.id });
    const report = readSalesReport(db, 'ALL'),
      movement = db.prepare('SELECT * FROM inventory_movements').all();
    configure(0, 9);
    expect(readSalesReport(db, 'ALL')).toEqual(report);
    expect(db.prepare('SELECT * FROM inventory_movements').all()).toEqual(movement);
  });
});
describe('operator formatting and QA path safety', () => {
  it('formats a local calendar date deterministically using 24h time', () => {
    expect(formatLocalDateTime(new Date(2026, 9, 8, 18, 4, 59))).toBe('08.10.2026 18:04');
    expect(formatLocalDateTime(new Date(2026, 0, 2, 0, 5))).toBe('02.01.2026 00:05');
    expect(formatLocalDateTime('invalid')).toBe('—');
  });
  it('formats stable backend identity without exposing UUID', () => {
    expect(formatSaleNumber(123)).toBe('#000123');
    expect(formatSaleNumber(1234567)).toBe('#1234567');
    expect(formatSaleNumber(0)).toBe('Shitje historike');
  });
  it('refuses production-like paths before SQLite can open/create them', () => {
    const interactive = path.join(os.tmpdir(), 'interactive-fox', 'fox.sqlite');
    expect(() => assertTestDatabasePath(interactive)).toThrow();
    expect(() => openDatabase(interactive)).toThrow();
    expect(fs.existsSync(interactive)).toBe(false);
    expect(() =>
      verificationDirectory(path.dirname(interactive), { FOX_VERIFY_CHECKOUT: '1' }),
    ).toThrow();
    expect(() => verificationDirectory(path.dirname(interactive), { NODE_ENV: 'test' })).toThrow();
  });
  it('requires marked temporary QA paths distinct from normal userData and owns only its fixtures', () => {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fox-qa-guard-'))),
      normal = path.join(os.tmpdir(), 'interactive-fox');
    try {
      expect(() => assertQaDirectory(directory, normal)).toThrow();
      fs.writeFileSync(
        path.join(directory, '.fox-qa.json'),
        JSON.stringify({ version: 1, directory }),
      );
      expect(
        verificationDirectory(normal, { FOX_VERIFY_DIR: directory, FOX_VERIFY_CHECKOUT: '1' }),
      ).toBe(directory);
      expect(() => verificationDirectory(directory, { FOX_VERIFY_DIR: directory })).toThrow();
      expect(() => assertQaDirectory(path.join(directory, '..'), normal)).toThrow();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    expect(fs.existsSync(normal)).toBe(false);
  });
});
