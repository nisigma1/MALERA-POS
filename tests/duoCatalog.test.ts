import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDatabase } from '../electron/database/connection';
import { createRepositories } from '../electron/database/repositories';
import { createOrderService } from '../electron/database/orders';
import { createCheckoutService } from '../electron/database/checkout';
import { inspectDatabase } from '../electron/database/health';
import { addDuoCatalog } from '../electron/database/duoCatalog';
import { createConfigurationService } from '../electron/database/configuration';

let directory: string;
let file: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fox-duo-catalog-'));
  file = path.join(directory, 'fox.sqlite');
});
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

it('adds 19 priced products once to the DUO catalog without changing history or stock', () => {
  const original = openDatabase(file);
  const readHistory = (db: typeof original) =>
    [
      'orders',
      'order_items',
      'order_payments',
      'cash_events',
      'receipt_documents',
      'inventory_movements',
      'cafe_tables',
    ].map((table) => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all());
  let products;
  let history;
  try {
    original.prepare("UPDATE settings SET value='DUO' WHERE key='business_name'").run();
    original
      .prepare(
        "UPDATE products SET purchase_cost_cents=30,selling_price_cents=100,track_inventory=1 WHERE id='KAFE-1'",
      )
      .run();
    original.prepare("UPDATE inventory_balances SET quantity=5 WHERE product_id='KAFE-1'").run();
    const repo = createRepositories(original);
    const orders = createOrderService(original, repo);
    const order = orders.addProduct({ tableId: 'M1', productId: 'KAFE-1' });
    if (!order.ok || !order.data.order) throw new Error('Expected an open synthetic order');
    expect(
      createCheckoutService(original, orders).completeOrder({ orderId: order.data.order.id }).ok,
    ).toBe(true);
    products = repo.listProducts();
    history = readHistory(original);
    // An empty v7-only table can be removed here to represent the exact v6 fixture.
    original.exec('DROP TABLE duo_order_lines; DELETE FROM schema_migrations WHERE version=7');
    expect(inspectDatabase(original, true)).toBe(6);
  } finally {
    original.close();
  }

  const updated = openDatabase(file, '0.7.2-rc.4', true);
  try {
    expect(inspectDatabase(updated, true)).toBe(7);
    expect(
      fs.readdirSync(path.join(directory, 'backups')).some((name) => name.endsWith('.sqlite')),
    ).toBe(true);
    const all = createRepositories(updated).listProducts();
    const imported = all.filter(({ id }) => id.startsWith('duo-drinks-v1-'));
    expect(all.filter(({ id }) => !id.startsWith('duo-drinks-v1-'))).toEqual(products);
    expect(imported).toHaveLength(19);
    expect(imported.find(({ name }) => name === 'Tuborg 0.33 L')?.purchaseCostCents).toBe(104);
    expect(imported.find(({ name }) => name === 'Heineken')?.purchaseCostCents).toBeNull();
    for (const product of imported) {
      expect(product.sellingPriceCents).toBeGreaterThan(0);
      expect(product).toMatchObject({
        active: true,
        trackInventory: false,
        stockQuantity: null,
      });
    }
    expect(readHistory(updated)).toEqual(history);
    expect(updated.pragma('foreign_key_check')).toEqual([]);
  } finally {
    updated.close();
  }

  const reopened = openDatabase(file, '0.7.2-rc.4', true);
  try {
    expect(createRepositories(reopened).listProducts()).toHaveLength(40);
    expect(readHistory(reopened)).toEqual(history);
  } finally {
    reopened.close();
  }
});

it('keeps fresh, other business, non-target and locally changed catalogs out of the rollout', () => {
  const fresh = openDatabase(file, '0.7.2-rc.4', true);
  expect(createRepositories(fresh).listProducts()).toHaveLength(21);
  fresh.close();

  const otherBusiness = openDatabase(file, '0.7.2-rc.4', true);
  expect(createRepositories(otherBusiness).listProducts()).toHaveLength(21);
  otherBusiness.prepare("UPDATE settings SET value='DUO' WHERE key='business_name'").run();
  otherBusiness.close();

  const otherTerminal = openDatabase(file);
  expect(createRepositories(otherTerminal).listProducts()).toHaveLength(21);
  otherTerminal.prepare("UPDATE products SET name='Heineken' WHERE id='ALKOOL-1'").run();
  otherTerminal.close();

  const changed = openDatabase(file, '0.7.2-rc.4', true);
  try {
    const products = createRepositories(changed).listProducts();
    expect(products).toHaveLength(21);
    expect(products.filter(({ name }) => name === 'Heineken')).toHaveLength(1);
  } finally {
    changed.close();
  }
});

it('updates the existing 40-row HP catalog, preserves owner prices and starts stock with a real count', () => {
  const original = openDatabase(file);
  original.prepare("UPDATE settings SET value='DUO' WHERE key='business_name'").run();
  original.transaction(() => addDuoCatalog(original, new Date().toISOString()))();
  const cola = 'duo-drinks-v1-1';
  original.prepare('UPDATE products SET selling_price_cents=? WHERE id=?').run(160, cola);
  original.close();

  const upgraded = openDatabase(file, '0.7.2-rc.4', true);
  try {
    const repo = createRepositories(upgraded, true, true);
    const config = createConfigurationService(upgraded, repo, true, true);
    const menu = repo.listProducts(true);
    expect(menu).toHaveLength(19);
    expect(menu.every((product) => product.active && product.sellingPriceCents !== null)).toBe(
      true,
    );
    expect(menu.find((product) => product.id === cola)).toMatchObject({
      sellingPriceCents: 160,
      trackInventory: false,
      stockQuantity: null,
    });
    expect(repo.listProducts().some((product) => product.id === 'KAFE-1')).toBe(true);
    expect(upgraded.prepare('SELECT count(*) FROM products').pluck().get()).toBe(40);
    expect(upgraded.prepare('SELECT count(*) FROM inventory_movements').pluck().get()).toBe(0);

    const count = { requestId: randomUUID(), productId: cola, quantity: 12 };
    expect(config.addSupply(count)).toMatchObject({
      ok: true,
      data: { stockQuantity: 12, trackInventory: true },
    });
    expect(config.addSupply(count)).toMatchObject({ ok: true, data: { stockQuantity: 12 } });
    const orders = createOrderService(upgraded, repo, { operator: () => 'OWNER' });
    expect(orders.addProduct({ tableId: 'M1', productId: 'KAFE-1' }).ok).toBe(false);
    const order = orders.addProduct({ tableId: 'M1', productId: cola });
    if (!order.ok || !order.data.order) throw Error('Expected a priced order');
    expect(order.data.order.totalCents).toBe(160);
    expect(
      createCheckoutService(upgraded, orders, true).completeOrder({ orderId: order.data.order.id })
        .ok,
    ).toBe(true);
    expect(repo.listProducts(true).find((p) => p.id === cola)?.stockQuantity).toBe(11);
    upgraded.prepare('UPDATE products SET active=0,selling_price_cents=200 WHERE id=?').run(cola);
  } finally {
    upgraded.close();
  }

  const reopened = openDatabase(file, '0.7.2-rc.4', true);
  try {
    expect(
      createRepositories(reopened, true, true)
        .listProducts(true)
        .find((p) => p.id === cola),
    ).toMatchObject({ active: false, sellingPriceCents: 200, stockQuantity: 11 });
  } finally {
    reopened.close();
  }
});
