import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/database/connection';
import { createRepositories } from '../electron/database/repositories';
import { createConfigurationService } from '../electron/database/configuration';
import { inventorySummary, stockState, unitProfit, validateProductUpdate, type ProductUpdate } from '../src/domain/configuration';
import { formatMoney, parseEuro } from '../src/domain/money';
let db: Database.Database;
beforeEach(() => { db = openDatabase(':memory:'); });
afterEach(() => { if (db.open) db.close(); });
function context() {
  const repositories = createRepositories(db);
  const service = createConfigurationService(db, repositories);
  const product = repositories.listProducts().find(p => p.id === 'UJE-1')!;
  return { repositories, service, product };
}
const update = (changes: Partial<ProductUpdate> = {}): ProductUpdate => ({
  id: 'UJE-1', name: 'Ujë natyral', categoryId: 'UJE', sellingPriceCents: null,
  purchaseCostCents: null, trackInventory: true, lowStockThreshold: null, active: true, ...changes,
});
describe('deterministic euro inputs', () => {
  it('preserves NULL and converts euro strings using exact cents', () => {
    expect(parseEuro('')).toBeNull(); expect(parseEuro('  ')).toBeNull();
    expect(parseEuro('1.20')).toBe(120); expect(parseEuro('1,20')).toBe(120);
    expect(parseEuro('0.29')).toBe(29); expect(parseEuro('0')).toBe(0);
    expect(formatMoney(120)).toBe('€1.20');
  });
  it.each(['-1', '1.234', 'NaN', 'Infinity', '1e2', '1..2', '1,2.3', '900719925474099.99'])('rejects invalid price %s', value => { expect(() => parseEuro(value)).toThrow(); });
});
describe('product configuration', () => {
  it('updates all supported fields without duplicates and preserves nullable prices', () => {
    const { service, repositories } = context();
    const result = service.updateProduct(update({ name: ' Ujë i konfiguruar ', active: false, categoryId: 'PIJE', sellingPriceCents: 120, lowStockThreshold: 3 }));
    expect(result).toMatchObject({ ok: true, data: { name: 'Ujë i konfiguruar', active: false, categoryId: 'PIJE', categoryName: 'Pije', sellingPriceCents: 120, purchaseCostCents: null, lowStockThreshold: 3 } });
    expect(repositories.listProducts()).toHaveLength(21);
    expect(service.updateProduct(update({ trackInventory: false }))).toMatchObject({ ok: true, data: { trackInventory: false, sellingPriceCents: null } });
    expect(service.updateProduct(update({ trackInventory: null }))).toMatchObject({ ok: true, data: { trackInventory: null } });
  });
  it('validates every incoming field at the main-process boundary', () => {
    const { service } = context();
    for (const changes of [{ name: '' }, { sellingPriceCents: -1 }, { purchaseCostCents: 1.2 }, { lowStockThreshold: -1 }]) expect(service.updateProduct(update(changes)).ok).toBe(false);
    expect(service.updateProduct({ ...update(), active: 'false', categoryId: 'BIRRA', trackInventory: 1 }).ok).toBe(false);
    expect(service.updateProduct(null).ok).toBe(false);
    expect(service.updateProduct(update({ id: 'missing' })).ok).toBe(false);
    expect(validateProductUpdate(update())).toEqual({});
  });
  it('profit is unavailable unless both prices are configured', () => {
    expect(unitProfit({ sellingPriceCents: 120, purchaseCostCents: null })).toBeNull();
    expect(unitProfit({ sellingPriceCents: null, purchaseCostCents: 50 })).toBeNull();
    expect(unitProfit({ sellingPriceCents: 120, purchaseCostCents: 50 })).toBe(70);
  });
});
describe('atomic inventory supply', () => {
  it('leaves stock unknown until a deliberate first supply, then records additions', () => {
    const { service, repositories } = context();
    service.updateProduct(update());
    expect(repositories.listProducts().find(p => p.id === 'UJE-1')?.stockQuantity).toBeNull();
    expect(service.addSupply({ requestId: randomUUID(), productId: 'UJE-1', quantity: 5 })).toMatchObject({ ok: true, data: { stockQuantity: 5 } });
    expect(service.addSupply({ requestId: randomUUID(), productId: 'UJE-1', quantity: 3 })).toMatchObject({ ok: true, data: { stockQuantity: 8 } });
    const movements = db.prepare('SELECT type,quantity_delta,note FROM inventory_movements ORDER BY rowid').all();
    expect(movements).toEqual([{ type: 'SUPPLY', quantity_delta: 5, note: 'Vendosja fillestare e stokut përmes furnizimit' }, { type: 'SUPPLY', quantity_delta: 3, note: null }]);
  });
  it('distinguishes a known zero from unconfigured stock', () => {
    const { repositories, service } = context();
    service.updateProduct(update());
    db.prepare("UPDATE inventory_balances SET quantity=0 WHERE product_id='UJE-1'").run();
    expect(stockState(repositories.listProducts().find(p => p.id === 'UJE-1')!)).toBe('OUT');
    expect(service.addSupply({ requestId: randomUUID(), productId: 'UJE-1', quantity: 2 })).toMatchObject({ ok: true, data: { stockQuantity: 2 } });
  });
  it.each([0, -1, NaN, Infinity])('rejects supply quantity %s without changing stock', quantity => {
    const { service } = context(); service.updateProduct(update());
    expect(service.addSupply({ requestId: randomUUID(), productId: 'UJE-1', quantity }).ok).toBe(false);
    expect(db.prepare('SELECT * FROM inventory_movements').all()).toHaveLength(0);
  });
  it('rejects missing products, disabled tracking, unconfigured tracking and inactive products', () => {
    const { service } = context();
    expect(service.addSupply({ requestId: randomUUID(), productId: 'missing', quantity: 2 }).ok).toBe(false);
    for (const config of [{ trackInventory: false }, { trackInventory: null }, { active: false }]) {
      service.updateProduct(update(config));
      expect(service.addSupply({ requestId: randomUUID(), productId: 'UJE-1', quantity: 2 }).ok).toBe(false);
    }
    expect(db.prepare('SELECT * FROM inventory_movements').all()).toHaveLength(0);
  });
  it('deduplicates retries and rejects altered reuse of the same request token', () => {
    const { service } = context(); service.updateProduct(update());
    const request = { requestId: randomUUID(), productId: 'UJE-1', quantity: 2 };
    expect(service.addSupply(request)).toMatchObject({ ok: true, data: { stockQuantity: 2 } });
    expect(service.addSupply(request)).toMatchObject({ ok: true, data: { stockQuantity: 2 } });
    expect(service.addSupply({ ...request, quantity: 3 }).ok).toBe(false);
    expect(db.prepare('SELECT * FROM inventory_movements').all()).toHaveLength(1);
  });
  it('rolls back the movement when updating the balance fails', () => {
    const { service } = context(); service.updateProduct(update());
    db.exec("CREATE TRIGGER fail_balance BEFORE UPDATE ON inventory_balances BEGIN SELECT RAISE(ABORT,'Test balance failure'); END");
    expect(() => service.addSupply({ requestId: randomUUID(), productId: 'UJE-1', quantity: 2 })).toThrow(/Test balance failure/);
    expect(db.prepare('SELECT * FROM inventory_movements').all()).toHaveLength(0);
    expect(db.prepare("SELECT quantity FROM inventory_balances WHERE product_id='UJE-1'").get()).toEqual({ quantity: null });
  });
  it('persists edits, supplies and request deduplication across restart without reseeding over them', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fox-config-'));
    let disk: Database.Database | undefined;
    try {
      const filename = path.join(directory, 'test.sqlite');
      const request = { requestId: randomUUID(), productId: 'UJE-1', quantity: 4 };
      disk = openDatabase(filename);
      const service = createConfigurationService(disk, createRepositories(disk));
      service.updateProduct(update({ sellingPriceCents: 120, purchaseCostCents: 50, categoryId: 'PIJE' }));
      service.addSupply(request); disk.close();
      disk = openDatabase(filename);
      const repo = createRepositories(disk);
      expect(repo.listProducts().find(p => p.id === 'UJE-1')).toMatchObject({ sellingPriceCents: 120, purchaseCostCents: 50, categoryId: 'PIJE', stockQuantity: 4 });
      expect(createConfigurationService(disk, repo).addSupply(request)).toMatchObject({ ok: true, data: { stockQuantity: 4 } });
      expect(repo.listTables()).toHaveLength(27); expect(repo.listProducts()).toHaveLength(21);
    } finally { if (disk?.open) disk.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
describe('truthful stock states and inventory summary', () => {
  it('counts complete price pairs without treating a selling-only price as unconfigured selling data', () => {
    const { product } = context();
    const sellingOnly = { ...product, sellingPriceCents: 120, purchaseCostCents: null };
    const bothPrices = { ...product, id: 'both', sellingPriceCents: 120, purchaseCostCents: 30 };
    const neitherPrice = { ...product, id: 'neither', sellingPriceCents: null, purchaseCostCents: null };
    const summary = inventorySummary([sellingOnly, bothPrices, neitherPrice]);
    expect(summary.total).toBe(3); expect(summary.fullyPriced).toBe(1);
    expect(inventorySummary([sellingOnly]).fullyPriced).toBe(0);
    expect(inventorySummary([{ ...bothPrices, sellingPriceCents: 0, purchaseCostCents: 0 }]).fullyPriced).toBe(1);
  });
  it('applies only configured thresholds and respects tracking state', () => {
    const { product } = context();
    const base = { ...product, trackInventory: true, stockQuantity: 5, lowStockThreshold: null };
    expect(stockState(base)).toBe('KNOWN');
    expect(stockState({ ...base, lowStockThreshold: 3 })).toBe('IN_STOCK');
    expect(stockState({ ...base, lowStockThreshold: 5 })).toBe('LOW');
    expect(stockState({ ...base, stockQuantity: 0 })).toBe('OUT');
    expect(stockState({ ...base, stockQuantity: null })).toBe('UNKNOWN_STOCK');
    expect(stockState({ ...base, trackInventory: false, lowStockThreshold: 10 })).toBe('UNTRACKED');
  });
  it('does not present partial stock value as complete', () => {
    const { repositories, product } = context();
    expect(inventorySummary(repositories.listProducts()).inventoryValueCents).toBeNull();
    const configured = { ...product, trackInventory: true, stockQuantity: 5, purchaseCostCents: 50 };
    expect(inventorySummary([configured]).inventoryValueCents).toBe(250);
    expect(inventorySummary([configured, { ...configured, id: 'unknown', purchaseCostCents: null }]).inventoryValueCents).toBeNull();
    expect(inventorySummary([{ ...configured, stockQuantity: 0 }]).inventoryValueCents).toBe(0);
  });
});
