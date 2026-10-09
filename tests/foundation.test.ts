import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/database/connection';
import { migrate } from '../electron/database/migrations';
import { seed } from '../electron/database/seed';
import { createRepositories } from '../electron/database/repositories';
import { formatMoney } from '../src/domain/money';

let db: Database.Database;
beforeEach(() => { db = openDatabase(':memory:'); });
afterEach(() => { if (db.open) db.close(); });
const now = '2026-01-01T10:00:00.000Z';
function order(id: string, table = 'M1', status = 'OPEN') {
  db.prepare('INSERT INTO orders(id,table_id,status,created_at,updated_at,closed_at,sale_number) VALUES (?,?,?,?,?,?,?)').run(id, table, status, now, now, status === 'CLOSED' ? now : null, status === 'CLOSED' ? (db.prepare('SELECT COALESCE(MAX(sale_number),0)+1 AS n FROM orders').get() as {n:number}).n : null);
}
function item(id: string, orderId: string, cost: number | null = 30) {
  // Deliberate isolated test values, never production seed data.
  db.prepare('INSERT INTO order_items VALUES (?,?,?,?,?,?,?,?)').run(id, orderId, 'KAFE-1', 'Espresso', 2, 100, cost, now);
}
function close(id: string) { db.prepare("UPDATE orders SET status='CLOSED',sale_number=(SELECT COALESCE(MAX(sale_number),0)+1 FROM orders),closed_at=? WHERE id=?").run(now, id); }

describe('authoritative seeds', () => {
  it('contains the exact 27 unique codes and correct groups, with no extras', () => {
    const tables = createRepositories(db).listTables();
    const expected = [
      ...Array.from({ length: 13 }, (_, i) => `M${i + 1}`),
      ...Array.from({ length: 4 }, (_, i) => `SH${i + 1}`),
      ...Array.from({ length: 10 }, (_, i) => `T${i + 1}`),
    ];
    expect(tables.map(table => table.code)).toEqual(expected);
    expect(tables.filter(t => t.area === 'MAIN')).toHaveLength(13);
    expect(tables.filter(t => t.area === 'BAR')).toHaveLength(4);
    expect(tables.filter(t => t.area === 'TERRACE')).toHaveLength(10);
    expect(new Set(tables.map(t => t.code)).size).toBe(27);
    for (const code of ['M1', 'M13', 'SH1', 'SH4', 'T1', 'T10']) expect(expected).toContain(code);
    for (const code of ['M14', 'SH5', 'T11']) expect(tables.some(t => t.code === code)).toBe(false);
    expect(tables.every(t => t.status === 'FREE' && t.enabled)).toBe(true);
  });
  it('enforces table identity, area and uniqueness at the database level', () => {
    const insert = db.prepare('INSERT INTO cafe_tables VALUES (?,?,?,\'FREE\',1,1,?,?)');
    for (const code of ['M14', 'SH5', 'T11', '']) expect(() => insert.run('new', code, 'MAIN', now, now)).toThrow();
    expect(() => insert.run('duplicate', 'M1', 'MAIN', now, now)).toThrow();
    expect(() => db.prepare("UPDATE cafe_tables SET area='BAR' WHERE code='M1'").run()).toThrow();
  });
  it('has precisely the five categories, with beer under Alkool', () => {
    const categories = db.prepare('SELECT id,name FROM categories ORDER BY sort_order').all();
    expect(categories).toEqual([
      { id: 'KAFE', name: 'Kafe' }, { id: 'CAJ', name: 'Çaj' }, { id: 'PIJE', name: 'Pije' },
      { id: 'UJE', name: 'Ujë' }, { id: 'ALKOOL', name: 'Alkool' },
    ]);
    const products = createRepositories(db).listProducts();
    for (const name of ['Birra Peja', 'Birra Laško']) expect(products.find(p => p.name === name)?.categoryName).toBe('Alkool');
    expect(categories).not.toContainEqual(expect.objectContaining({ name: 'Birra' }));
  });
  it('preserves all 21 names, with no invented price, cost, stock or tracking rule', () => {
    const products = createRepositories(db).listProducts();
    expect(products.map(p => p.name)).toEqual([
      'Espresso', 'Espresso pa plum', 'Double Espresso', 'Makiato i vogël', 'Makiato i madh', 'Kapuçino', 'Latte Makiato', 'Amerikano',
      'Çaj mente', 'Çaj fruta mali', 'Çaj kamomil', 'Vishnje', 'Juice Karrot', 'Mollë', 'Pjeshkë',
      'Ujë natyral', 'Ujë mineral', 'Birra Peja', 'Birra Laško', "Jack Daniel's", 'Smirnoff Vodka',
    ]);
    expect(products.every(p => p.sellingPriceCents === null && p.purchaseCostCents === null && p.stockQuantity === null && p.lowStockThreshold === null && p.trackInventory === null)).toBe(true);
    expect(db.prepare('SELECT * FROM expenses').all()).toHaveLength(0);
    expect(db.prepare('SELECT * FROM inventory_movements').all()).toHaveLength(0);
  });
  it('repeated migration and seeding preserve configured data and open orders', () => {
    db.prepare("UPDATE products SET selling_price_cents=150,name='Configured name' WHERE id='KAFE-1'").run();
    db.prepare("UPDATE inventory_balances SET quantity=0 WHERE product_id='KAFE-1'").run();
    db.prepare("UPDATE settings SET value='Configured business' WHERE key='business_name'").run();
    db.prepare("UPDATE cafe_tables SET status='ACTIVE' WHERE id='M1'").run();
    order('persistent'); item('persistent-item', 'persistent');
    for (let i = 0; i < 20; i++) { migrate(db); seed(db); }
    const repo = createRepositories(db);
    expect(repo.listTables()).toHaveLength(27);
    expect(db.prepare('SELECT * FROM categories').all()).toHaveLength(5);
    expect(repo.listProducts()).toHaveLength(21);
    expect(db.prepare('SELECT * FROM schema_migrations').all()).toHaveLength(4);
    expect(repo.listProducts()[0]).toMatchObject({ name: 'Configured name', sellingPriceCents: 150, stockQuantity: 0 });
    expect(repo.getSettings().businessName).toBe('Configured business');
    expect(db.prepare("SELECT * FROM orders WHERE id='persistent'").get()).toMatchObject({ status: 'OPEN' });
  });
  it('persists an active order across a real database close/reopen with WAL and foreign keys', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fox-test-'));
    let disk: Database.Database | undefined;
    try {
      disk = openDatabase(path.join(directory, 'test.sqlite'));
      disk.prepare('INSERT INTO orders(id,table_id,status,created_at,updated_at,closed_at) VALUES (?,?,\'OPEN\',?,?,NULL)').run('saved', 'M1', now, now);
      disk.close();
      disk = openDatabase(path.join(directory, 'test.sqlite'));
      expect(disk.prepare('SELECT * FROM orders').all()).toHaveLength(1);
      expect(createRepositories(disk).listTables()).toHaveLength(27);
      expect(disk.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(disk.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(disk.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally { if (disk?.open) disk.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
describe('schema integrity', () => {
  it('enforces one open order per table and permits a later order after closing', () => {
    order('first');
    expect(() => order('second')).toThrow(/UNIQUE/);
    item('line', 'first'); close('first');
    expect(() => order('second')).not.toThrow();
    expect(() => close('first')).toThrow(/immutable/);
  });
  it('uses real foreign keys and rejects invalid quantity and floating money', () => {
    expect(() => order('invalid', 'M14')).toThrow(/FOREIGN KEY/);
    order('valid'); item('line', 'valid');
    expect(() => db.prepare("UPDATE order_items SET quantity=0 WHERE id='line'").run()).toThrow();
    expect(() => db.prepare("UPDATE products SET selling_price_cents=1.5 WHERE id='KAFE-1'").run()).toThrow();
    expect(() => db.prepare("UPDATE orders SET status='CLOSED' WHERE id='valid'").run()).toThrow();
  });
  it('protects historical snapshots against product changes and direct edits', () => {
    order('history'); item('line', 'history'); close('history');
    db.prepare("UPDATE products SET name='Renamed',selling_price_cents=120 WHERE id='KAFE-1'").run();
    expect(db.prepare("SELECT * FROM order_items WHERE id='line'").get()).toMatchObject({ product_name_snapshot: 'Espresso', unit_price_cents: 100 });
    expect(() => db.prepare("UPDATE order_items SET unit_price_cents=120 WHERE id='line'").run()).toThrow();
    expect(() => db.prepare("DELETE FROM order_items WHERE id='line'").run()).toThrow();
    expect(() => item('new', 'history')).toThrow();
    expect(() => db.prepare("DELETE FROM orders WHERE id='history'").run()).toThrow();
  });
  it('prevents duplicate sale deductions and preserves append-only audit history', () => {
    order('sale'); item('line', 'sale'); close('sale');
    const move = db.prepare('INSERT INTO inventory_movements VALUES (?,\'KAFE-1\',\'SALE\',-2,\'sale\',NULL,?)');
    move.run('movement', now);
    expect(() => move.run('duplicate', now)).toThrow(/UNIQUE/);
    expect(() => db.prepare("UPDATE inventory_movements SET quantity_delta=-3").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM inventory_movements').run()).toThrow(/append-only/);
  });
  it('rejects an unsupported schema version without destroying data', () => {
    db.prepare('INSERT INTO schema_migrations VALUES (99,?)').run(now);
    expect(() => migrate(db)).toThrow(/newer/);
    expect(createRepositories(db).listTables()).toHaveLength(27);
  });
  it('rolls back all writes inside a failed transaction', () => {
    expect(() => db.transaction(() => { order('rollback'); order('duplicate'); })()).toThrow();
    expect(db.prepare('SELECT * FROM orders').all()).toHaveLength(0);
  });
});
describe('reports and money', () => {
  it.each([[0, '€0.00'], [100, '€1.00'], [580, '€5.80'], [-30, '-€0.30']] as const)('formats %i cents', (cents, expected) => {
    expect(formatMoney(cents)).toBe(expected);
  });
  it('does not represent unknown money as zero and rejects fractions', () => {
    expect(formatMoney(null)).toBe('Pa vendosur');
    expect(() => formatMoney(1.5)).toThrow();
  });
  it('reads truthful empty values from SQLite', () => {
    expect(createRepositories(db).getSummary()).toEqual({ salesCents: 0, costCents: 0, grossProfitCents: 0,
      expensesCents: 0, netProfitCents: 0, completedOrders: 0, productsSold: 0, averageOrderCents: null });
  });
  it('counts only closed orders and separates gross profit from net profit', () => {
    order('closed'); item('sold', 'closed'); close('closed');
    order('active', 'M2'); item('unsold', 'active');
    order('cancelled', 'M3'); item('cancelled-line', 'cancelled');
    db.prepare("UPDATE orders SET status='CANCELLED' WHERE id='cancelled'").run();
    db.prepare('INSERT INTO expenses VALUES (?,50,?,?,?)').run('expense-test', 'Isolated test expense', '2026-01-01', now);
    expect(createRepositories(db).getSummary()).toEqual({ salesCents: 200, costCents: 60, grossProfitCents: 140,
      expensesCents: 50, netProfitCents: 90, completedOrders: 1, productsSold: 2, averageOrderCents: 200 });
  });
  it('preserves unknown cost and profit for a completed sale with unconfigured purchase cost', () => {
    order('unknown'); item('line', 'unknown', null); close('unknown');
    expect(createRepositories(db).getSummary()).toMatchObject({ salesCents: 200, costCents: null, grossProfitCents: null, netProfitCents: null });
  });
});
