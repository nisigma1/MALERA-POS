import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/database/connection';
import { createRepositories } from '../electron/database/repositories';
import { createOrderService } from '../electron/database/orders';
import type { MutationResult } from '../src/domain/configuration';
import type { OrderWorkspace } from '../src/domain/types';
let db: Database.Database;
const context = () => {
  const repositories = createRepositories(db);
  return { repositories, service: createOrderService(db, repositories) };
};
const configure = (price: number | null = 120, cost: number | null = 30) =>
  db
    .prepare(
      "UPDATE products SET selling_price_cents=?,purchase_cost_cents=?,track_inventory=0 WHERE id='KAFE-1'",
    )
    .run(price, cost);
const unwrap = (result: MutationResult<OrderWorkspace>) => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.data;
};
const add = (tableId = 'M5', productId = 'KAFE-1') =>
  unwrap(context().service.addProduct({ tableId, productId }));
const dump = () =>
  ['orders', 'order_items', 'cafe_tables', 'inventory_balances', 'inventory_movements'].map(
    (table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  );
beforeEach(() => {
  db = openDatabase(':memory:');
  configure();
});
afterEach(() => {
  if (db.open) db.close();
});

describe('active table order commands', () => {
  it('rolls back a rejected draft and saves a retry exactly once', () => {
    const request = {
      requestId: crypto.randomUUID(),
      tableId: 'M5',
      orderId: null,
      expectedRevision: null,
      items: [
        { productId: 'KAFE-1', quantity: 2 },
        { productId: 'KAFE-2', quantity: 1 },
      ],
    };
    const before = dump();
    expect(context().service.submitDraft(request)).toMatchObject({ ok: false, notCommitted: true });
    expect(dump()).toEqual(before);

    db.prepare(
      "UPDATE products SET active=1,selling_price_cents=130,track_inventory=0 WHERE id='KAFE-2'",
    ).run();
    const saved = unwrap(context().service.submitDraft(request));
    expect(saved.order?.totalCents).toBe(370);
    expect(saved.order?.items.map((item) => item.quantity)).toEqual([2, 1]);
    const committed = dump();
    expect(unwrap(context().service.submitDraft(request))).toEqual(saved);
    expect(dump()).toEqual(committed);
  });
  it('selects a free table without writing any row', () => {
    const before = dump();
    expect(context().service.getForTable('M5')).toMatchObject({
      table: { status: 'FREE', activeOrderTotalCents: null },
      order: null,
    });
    expect(dump()).toEqual(before);
  });
  it('atomically creates the first order, snapshots the item and activates the table', () => {
    expect(add()).toMatchObject({
      table: { status: 'ACTIVE', activeOrderTotalCents: 120 },
      order: {
        status: 'OPEN',
        totalCents: 120,
        items: [{ name: 'Espresso', quantity: 1, unitPriceCents: 120, lineTotalCents: 120 }],
      },
    });
    expect(db.prepare('SELECT unit_cost_cents FROM order_items').get()).toEqual({
      unit_cost_cents: 30,
    });
  });
  it('merges identical snapshots and maintains a single open order', () => {
    const first = add();
    for (let i = 0; i < 12; i++) add();
    const view = context().service.getForTable('M5');
    expect(view.order?.id).toBe(first.order?.id);
    expect(view.order?.items).toHaveLength(1);
    expect(view.order?.items[0]!.quantity).toBe(13);
    expect(view.order?.totalCents).toBe(1560);
    expect(db.prepare("SELECT COUNT(*) n FROM orders WHERE status='OPEN'").get()).toEqual({ n: 1 });
  });
  it.each([null, 0])('preserves a cost snapshot of %s', (cost) => {
    configure(120, cost);
    add();
    expect(db.prepare('SELECT unit_cost_cents FROM order_items').get()).toEqual({
      unit_cost_cents: cost,
    });
  });
  it.each(['name', 'price', 'cost'])(
    'creates a separate line when the %s snapshot changes',
    (field) => {
      const first = add().order!.items[0]!;
      if (field === 'name')
        db.prepare("UPDATE products SET name='Espresso i ri' WHERE id='KAFE-1'").run();
      if (field === 'price') configure(135, 30);
      if (field === 'cost') configure(120, null);
      const next = add();
      expect(next.order?.items).toHaveLength(2);
      expect(next.order?.items[0]!).toEqual(first);
    },
  );
  it('adds a zero-priced product as a real order with a zero total', () => {
    configure(0, null);
    expect(add()).toMatchObject({
      table: { status: 'ACTIVE', activeOrderTotalCents: 0 },
      order: { totalCents: 0 },
    });
  });
  it.each(['unknown', 'inactive', 'unpriced'])(
    'rejects an %s product without opening a draft',
    (kind) => {
      if (kind === 'inactive') db.prepare("UPDATE products SET active=0 WHERE id='KAFE-1'").run();
      if (kind === 'unpriced') configure(null);
      const before = dump();
      expect(
        context().service.addProduct({
          tableId: 'M5',
          productId: kind === 'unknown' ? 'missing' : 'KAFE-1',
        }).ok,
      ).toBe(false);
      expect(dump()).toEqual(before);
    },
  );
  it.each(['RESERVED', 'AWAITING_PAYMENT', 'DISABLED'])(
    'does not convert or order a %s position',
    (status) => {
      if (status === 'DISABLED') db.prepare("UPDATE cafe_tables SET enabled=0 WHERE id='M5'").run();
      else db.prepare("UPDATE cafe_tables SET status=? WHERE id='M5'").run(status);
      const before = dump();
      expect(context().service.addProduct({ tableId: 'M5', productId: 'KAFE-1' }).ok).toBe(false);
      expect(dump()).toEqual(before);
    },
  );
  it('rejects unknown tables and malformed or client-controlled financial commands', () => {
    const { service } = context();
    const before = dump();
    for (const input of [
      null,
      [],
      {},
      { tableId: 5, productId: 'KAFE-1' },
      { tableId: 'missing', productId: 'KAFE-1' },
      { tableId: 'M5', productId: '' },
      { tableId: 'M5', productId: 'KAFE-1', quantity: 2 },
      { tableId: 'M5', productId: 'KAFE-1', totalCents: 1 },
    ])
      expect(service.addProduct(input).ok).toBe(false);
    expect(() => service.getForTable({ tableId: 'M5' })).toThrow();
    expect(dump()).toEqual(before);
  });
  it('increments and decrements the immutable line snapshot after catalog changes', () => {
    const item = add().order!.items[0]!;
    configure(300, 100);
    db.prepare(
      "UPDATE products SET name='Tjetër',active=0,selling_price_cents=NULL WHERE id='KAFE-1'",
    ).run();
    const { service } = context();
    const input = { tableId: 'M5', itemId: item.id };
    expect(unwrap(service.incrementItem(input)).order?.items[0]!).toMatchObject({
      name: 'Espresso',
      quantity: 2,
      unitPriceCents: 120,
      lineTotalCents: 240,
    });
    expect(unwrap(service.decrementItem(input)).order?.items[0]!.quantity).toBe(1);
    expect(unwrap(service.decrementItem(input)).order?.items[0]!.quantity).toBe(1);
    expect(service.addProduct({ tableId: 'M5', productId: 'KAFE-1' }).ok).toBe(false);
    expect(unwrap(service.removeItem(input)).order).toBeNull();
  });
  it('removes one line while preserving the other and its exact total', () => {
    const first = add().order!.items[0]!;
    configure(135);
    add();
    expect(unwrap(context().service.removeItem({ tableId: 'M5', itemId: first.id }))).toMatchObject(
      {
        table: { status: 'ACTIVE', activeOrderTotalCents: 135 },
        order: { totalCents: 135, items: [{ unitPriceCents: 135 }] },
      },
    );
  });
  it('cancels the last-item draft, frees the table and preserves the cancelled order', () => {
    const view = add();
    const { service } = context();
    const command = { tableId: 'M5', itemId: view.order!.items[0]!.id };
    expect(unwrap(service.removeItem(command))).toMatchObject({
      table: { status: 'FREE', activeOrderTotalCents: null },
      order: null,
    });
    expect(db.prepare('SELECT id,status,closed_at FROM orders').get()).toEqual({
      id: view.order!.id,
      status: 'CANCELLED',
      closed_at: null,
    });
    expect(service.removeItem(command).ok).toBe(false);
    expect(add().order?.id).not.toBe(view.order?.id);
  });
  it('rejects item commands for another table, unknown IDs and cancelled orders', () => {
    const item = add().order!.items[0]!;
    const { service } = context();
    const before = dump();
    for (const handler of [service.incrementItem, service.decrementItem, service.removeItem]) {
      expect(handler({ tableId: 'M6', itemId: item.id }).ok).toBe(false);
      expect(handler({ tableId: 'M5', itemId: 'missing' }).ok).toBe(false);
      expect(handler({ tableId: 'M5', itemId: item.id, quantity: 0 }).ok).toBe(false);
    }
    expect(dump()).toEqual(before);
  });
  it('does not mutate a closed order or count a new open draft in reports', () => {
    const view = add();
    db.prepare(
      "UPDATE orders SET status='CLOSED',sale_number=(SELECT COALESCE(MAX(sale_number),0)+1 FROM orders),closed_at='2026-10-05' WHERE id=?",
    ).run(view.order!.id);
    db.prepare("UPDATE cafe_tables SET status='FREE' WHERE id='M5'").run();
    const { service, repositories } = context();
    const before = repositories.getSummary();
    expect(service.incrementItem({ tableId: 'M5', itemId: view.order!.items[0]!.id }).ok).toBe(
      false,
    );
    add();
    expect(repositories.getSummary()).toEqual(before);
  });
  it('rolls back the order, item and table if an item insert fails after order creation', () => {
    db.exec(
      "CREATE TRIGGER verify_failure BEFORE INSERT ON order_items BEGIN SELECT RAISE(ABORT,'Injected item failure'); END",
    );
    const before = dump();
    expect(() => context().service.addProduct({ tableId: 'M5', productId: 'KAFE-1' })).toThrow(
      'Injected item failure',
    );
    expect(dump()).toEqual(before);
  });
  it('rolls back a last-line delete when cancellation fails', () => {
    const item = add().order!.items[0]!;
    db.exec(
      "CREATE TRIGGER verify_failure BEFORE UPDATE OF status ON orders WHEN NEW.status='CANCELLED' BEGIN SELECT RAISE(ABORT,'Injected cancellation failure'); END",
    );
    const before = dump();
    expect(() => context().service.removeItem({ tableId: 'M5', itemId: item.id })).toThrow(
      'Injected cancellation failure',
    );
    expect(dump()).toEqual(before);
  });
  it('enforces exact safe-integer totals without an arbitrary quantity cap', () => {
    configure(Number.MAX_SAFE_INTEGER, null);
    const view = add();
    const before = dump();
    const { service } = context();
    expect(service.addProduct({ tableId: 'M5', productId: 'KAFE-1' }).ok).toBe(false);
    expect(service.incrementItem({ tableId: 'M5', itemId: view.order!.items[0]!.id }).ok).toBe(
      false,
    );
    expect(dump()).toEqual(before);
    configure(0, null);
    const item = add('M6').order!.items[0]!;
    db.prepare('UPDATE order_items SET quantity=? WHERE id=?').run(
      Number.MAX_SAFE_INTEGER,
      item.id,
    );
    expect(service.incrementItem({ tableId: 'M6', itemId: item.id }).ok).toBe(false);
  });
  it('leaves inventory, movements and all report values unchanged throughout the workflow', () => {
    const { repositories, service } = context();
    const before = JSON.stringify({
      products: repositories.listProducts(),
      reports: repositories.getSummary(),
      stock: db.prepare('SELECT * FROM inventory_balances').all(),
      movements: db.prepare('SELECT * FROM inventory_movements').all(),
    });
    const item = add().order!.items[0]!;
    const input = { tableId: 'M5', itemId: item.id };
    service.incrementItem(input);
    service.decrementItem(input);
    service.removeItem(input);
    expect(
      JSON.stringify({
        products: repositories.listProducts(),
        reports: repositories.getSummary(),
        stock: db.prepare('SELECT * FROM inventory_balances').all(),
        movements: db.prepare('SELECT * FROM inventory_movements').all(),
      }),
    ).toBe(before);
  });
  it('returns all 27 ordered positions and only real open-order totals', () => {
    add();
    const tables = context().repositories.listTables();
    expect(tables).toHaveLength(27);
    expect(tables.filter((t) => t.activeOrderTotalCents !== null).map((t) => t.code)).toEqual([
      'M5',
    ]);
    expect(tables.filter((t) => t.area === 'MAIN')).toHaveLength(13);
    expect(tables.filter((t) => t.area === 'BAR')).toHaveLength(4);
    expect(tables.filter((t) => t.area === 'TERRACE')).toHaveLength(10);
  });
  it('persists snapshots and quantities across connection restart and commands from a second connection', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fox-orders-'));
    const filename = path.join(directory, 'fox.sqlite');
    let second: Database.Database | undefined;
    try {
      db.close();
      db = openDatabase(filename);
      configure();
      const first = add();
      second = openDatabase(filename);
      const other = createOrderService(second, createRepositories(second));
      unwrap(other.addProduct({ tableId: 'M5', productId: 'KAFE-1' }));
      configure(170, null);
      const expected = add();
      expect(expected.order?.items).toHaveLength(2);
      expect(expected.order?.id).toBe(first.order?.id);
      second.close();
      db.close();
      db = openDatabase(filename);
      expect(context().service.getForTable('M5')).toEqual(expected);
    } finally {
      if (second?.open) second.close();
      if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
