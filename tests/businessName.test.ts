import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../electron/database/connection';
import { createRepositories } from '../electron/database/repositories';
import { createConfigurationService } from '../electron/database/configuration';
import { createOrderService } from '../electron/database/orders';
import { createCheckoutService } from '../electron/database/checkout';
import { createReceiptRepository } from '../electron/receipts/repository';
let directory: string, db: Database.Database;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fox-business-name-test-'));
  db = openDatabase(path.join(directory, 'fox.sqlite'));
});
afterEach(() => {
  if (db.open) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
const config = () => createConfigurationService(db, createRepositories(db));
const businessRows = () =>
  Object.fromEntries(
    (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'settings' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]),
  );
describe('owner business name release blocker', () => {
  it('persists owner name across restart, uses it for new receipts and preserves all earlier business rows/documents', () => {
    db.prepare(
      "UPDATE products SET selling_price_cents=100,purchase_cost_cents=50,track_inventory=0 WHERE id='KAFE-1'",
    ).run();
    const sale = (code: string) => {
      const orders = createOrderService(db, createRepositories(db)),
        added = orders.addProduct({ tableId: code, productId: 'KAFE-1' });
      if (!added.ok || !added.data.order) throw Error('Fixture order failed');
      const paid = createCheckoutService(db, orders).completeOrder({
        orderId: added.data.order.id,
      });
      if (!paid.ok) throw Error('Fixture checkout failed');
      return added.data.order.id;
    };
    const old = sale('M5'),
      original = createReceiptRepository(db).document(old),
      before = businessRows();
    expect(config().updateBusinessName({ businessName: '  FOX Kafeteri ë ç  ' })).toEqual({
      ok: true,
      data: { businessName: 'FOX Kafeteri ë ç' },
    });
    expect(businessRows()).toEqual(before);
    db.close();
    db = openDatabase(path.join(directory, 'fox.sqlite'));
    expect(createRepositories(db).getSettings().businessName).toBe('FOX Kafeteri ë ç');
    expect(businessRows()).toEqual(before);
    expect(createReceiptRepository(db).document(old)).toEqual(original);
    const next = sale('M6');
    expect(createReceiptRepository(db).document(next).payload.businessDisplayName).toBe(
      'FOX Kafeteri ë ç',
    );
    expect(createReceiptRepository(db).document(old).payload.businessDisplayName).toBe('FOX');
    expect(db.pragma('quick_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
  it('rejects malformed/blank/control/oversized/unrelated setting writes without any database effect', () => {
    const settings = db.prepare('SELECT * FROM settings ORDER BY key').all(),
      before = businessRows();
    for (const input of [
      null,
      [],
      {},
      'FOX',
      { businessName: 1 },
      { businessName: '  ' },
      { businessName: 'x'.repeat(101) },
      { businessName: 'FOX\nother' },
      { businessName: 'FOX', receipt_auto_print: true },
      { businessName: 'FOX\0bad' },
    ]) {
      expect(config().updateBusinessName(input).ok).toBe(false);
      expect(db.prepare('SELECT * FROM settings ORDER BY key').all()).toEqual(settings);
      expect(businessRows()).toEqual(before);
    }
  });
});
