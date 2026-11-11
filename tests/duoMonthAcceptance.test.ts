import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it, vi } from 'vitest';
import { openDatabase } from '../electron/database/connection';
import { createRepositories } from '../electron/database/repositories';
import { createOrderService } from '../electron/database/orders';
import { createCheckoutService } from '../electron/database/checkout';
import { createConfigurationService } from '../electron/database/configuration';
import { readShiftSales } from '../electron/database/duoReports';
import { readSalesReport } from '../electron/database/salesReports';
import { createBackup, validateBackup } from '../electron/database/backups';
import { replaceDatabase } from '../electron/database/restore';
import { inspectDatabase } from '../electron/database/health';
import type { OperatorId } from '../src/domain/operators';

function createQaDirectory(kind: string) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `fox-qa-${kind}-`)));
  fs.writeFileSync(path.join(directory, '.fox-qa.json'), JSON.stringify({ version: 1, directory }));
  return directory;
}

it('reconciles a 6,000-order DUO month through checkout, reopening and owned restore', async () => {
  const root = createQaDirectory('duo-month');
  const restoreRoot = createQaDirectory('duo-month-restore');
  const dbPath = path.join(root, 'fox.sqlite');
  const restorePath = path.join(restoreRoot, 'fox.sqlite');
  const espresso = 'KAFE-1';
  const drink = 'duo-drinks-v1-1';
  const expected = { paid: 0, cancelled: 0, cents: 0, coffee: 0, drinks: 0 };
  const orderTimes: number[] = [];
  const paymentTimes: number[] = [];
  const reportTimes: number[] = [];
  const reopenTimes: number[] = [];
  let retries = 0;
  let actor: OperatorId = 'OWNER';
  let db = openDatabase(dbPath);
  const started = performance.now();
  const services = () => {
    const repo = createRepositories(db, true, true);
    const orders = createOrderService(db, repo, { operator: () => actor });
    return { repo, orders, checkout: createCheckoutService(db, orders, true) };
  };
  const measured = <T>(timings: number[], fn: () => T): T => {
    const before = performance.now();
    const value = fn();
    timings.push(performance.now() - before);
    return value;
  };
  const digest = () => {
    const hash = createHash('sha256');
    for (const table of [
      'cafe_tables',
      'orders',
      'order_items',
      'order_payments',
      'receipt_documents',
      'cash_events',
      'inventory_balances',
      'inventory_movements',
      'duo_order_lines',
    ]) {
      hash.update(table + '\n');
      for (const row of db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').iterate())
        hash.update(JSON.stringify(row) + '\n');
    }
    return hash.digest('hex');
  };
  try {
    assert.ok(
      createConfigurationService(db, createRepositories(db)).updateBusinessName({
        businessName: 'DUO',
      }).ok,
    );
    db.close();
    db = openDatabase(dbPath, '0.7.2-rc.4', true);
    let { repo, orders, checkout } = services();
    const config = createConfigurationService(db, repo, true, true);
    const coffee = repo.listProducts().find(({ id }) => id === espresso)!;
    assert.ok(
      config.updateProduct({
        ...coffee,
        sellingPriceCents: 120,
        purchaseCostCents: 30,
        trackInventory: true,
      }).ok,
    );
    const supply = { requestId: randomUUID(), productId: espresso, quantity: 150 };
    const supplied = config.addSupply(supply);
    assert.ok(supplied.ok);
    assert.equal(supplied.data.stockQuantity, 16_500);
    assert.ok(config.addSupply(supply).ok);
    const drinks = config.addSupply({ requestId: randomUUID(), productId: drink, quantity: 6_000 });
    assert.ok(drinks.ok);
    assert.equal(drinks.data.sellingPriceCents, 150);
    assert.equal(repo.listProducts(true).length, 20);
    const tableIds = repo.listTables().map(({ id }) => id);
    assert.equal(tableIds.length, 27);

    vi.useFakeTimers({ toFake: ['Date'] });
    for (let day = 1; day <= 30; day++) {
      const byShift = { AM: 0, PM: 0 };
      for (let batch = 0; batch < 25; batch++) {
        const shift = batch < 12 ? 'AM' : 'PM';
        actor = shift;
        const now = new Date(2026, 10, day, shift === 'AM' ? 9 : 17, batch * 2);
        vi.setSystemTime(now);
        const tickets = Array.from({ length: 8 }, (_, position) => {
          const index = (day - 1) * 200 + batch * 8 + position;
          const tableId = tableIds[index % tableIds.length]!;
          const quantity = 1 + (index % 3);
          const cancelled = index % 20 === 0;
          const items = [{ productId: espresso, quantity }];
          if (!cancelled && index % 2 === 0) items.push({ productId: drink, quantity: 1 });
          const draft = {
            requestId: randomUUID(),
            tableId,
            orderId: null,
            expectedRevision: null,
            items,
          };
          const saved = measured(orderTimes, () => orders.submitDraft(draft));
          if (!saved.ok) throw Error(saved.message);
          assert.ok(saved.data.order);
          if (index % 97 === 0) {
            const retry = orders.submitDraft(draft);
            assert.ok(retry.ok);
            assert.equal(retry.data.order?.id, saved.data.order.id);
            assert.equal(retry.data.order?.items.length, items.length);
            retries++;
          }
          return {
            order: saved.data.order,
            tableId,
            quantity,
            cancelled,
            includesDrink: items.length === 2,
          };
        });
        if (batch === 12 && day % 6 === 0) {
          db.close();
          db = measured(reopenTimes, () => openDatabase(dbPath, '0.7.2-rc.4', true));
          ({ repo, orders, checkout } = services());
          for (const { order, tableId } of tickets)
            assert.deepEqual(orders.getForTable(tableId).order, order);
        }
        actor = 'OWNER';
        for (const ticket of tickets) {
          const { order, tableId, quantity, cancelled, includesDrink } = ticket;
          if (cancelled) {
            assert.ok(orders.removeItem({ tableId, itemId: order.items[0]!.id }).ok);
            expected.cancelled++;
            continue;
          }
          const request = { orderId: order.id, expectedRevision: order.revision };
          const paid = measured(paymentTimes, () => checkout.completeOrder(request));
          if (!paid.ok) throw Error(paid.message);
          if (expected.paid % 113 === 0) assert.equal(checkout.completeOrder(request).ok, false);
          expected.paid++;
          const cents = quantity * 120 + (includesDrink ? 150 : 0);
          byShift[shift] += cents;
          expected.cents += cents;
          expected.coffee += quantity;
          expected.drinks += Number(includesDrink);
        }
      }
      assert.equal(measured(reportTimes, () => readShiftSales(db, 'AM')).totalCents, byShift.AM);
      assert.equal(measured(reportTimes, () => readShiftSales(db, 'PM')).totalCents, byShift.PM);
      assert.equal(readShiftSales(db, 'DAY').totalCents, byShift.AM + byShift.PM);
    }
    vi.useRealTimers();

    const check = () => {
      const scalar = (sql: string) => db.prepare(sql).pluck().get();
      assert.equal(inspectDatabase(db, true), 7);
      assert.equal(scalar('SELECT COUNT(*) FROM orders'), 6_000);
      assert.equal(
        scalar("SELECT COUNT(*) FROM orders WHERE status='CANCELLED'"),
        expected.cancelled,
      );
      assert.equal(scalar("SELECT COUNT(*) FROM orders WHERE status='OPEN'"), 0);
      assert.equal(scalar('SELECT COUNT(*) FROM order_payments'), expected.paid);
      assert.equal(scalar('SELECT COUNT(*) FROM receipt_documents'), expected.paid);
      assert.equal(scalar('SELECT COUNT(*) FROM receipt_generation_errors'), 0);
      assert.equal(
        scalar("SELECT SUM(amount_cents) FROM cash_events WHERE kind='CASH_SALE_IN'"),
        expected.cents,
      );
      const report = measured(reportTimes, () => readSalesReport(db, 'ALL'));
      assert.equal(report.cashCents, expected.cents);
      assert.equal(report.summary.salesCents, expected.cents);
      assert.equal(report.summary.completedOrders, expected.paid);
      const stock = (id: string) =>
        db.prepare('SELECT quantity FROM inventory_balances WHERE product_id=?').pluck().get(id);
      assert.equal(stock(espresso), 16_500 - expected.coffee);
      assert.equal(stock(drink), 6_000 - expected.drinks);
      for (const id of [espresso, drink])
        assert.equal(
          db
            .prepare('SELECT SUM(quantity_delta) FROM inventory_movements WHERE product_id=?')
            .pluck()
            .get(id),
          stock(id),
        );
      const receipts = db
        .prepare('SELECT payload_json, payload_hash FROM receipt_documents')
        .iterate() as Iterable<{ payload_json: string; payload_hash: string }>;
      for (const receipt of receipts)
        assert.equal(
          createHash('sha256').update(receipt.payload_json).digest('hex'),
          receipt.payload_hash,
        );
    };
    check();
    const snapshot = digest();
    const backup = path.join(root, 'month-end.sqlite');
    const backupStarted = performance.now();
    await createBackup(db, backup, '0.7.2-rc.4');
    await validateBackup(backup);
    const backupMs = performance.now() - backupStarted;
    db.close();
    db = openDatabase(restorePath);
    const restoreStarted = performance.now();
    await replaceDatabase(db, backup, restoreRoot, '0.7.2-rc.4', () => {});
    db = openDatabase(restorePath, '0.7.2-rc.4', true);
    const restoreMs = performance.now() - restoreStarted;
    assert.equal(digest(), snapshot);
    check();
    const stats = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        count: sorted.length,
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        maxMs: sorted.at(-1),
      };
    };
    const evidence = {
      passed: true,
      root,
      restoreRoot,
      orders: 6_000,
      days: 30,
      expected,
      retries,
      espressoPortionsRemaining: 16_500 - expected.coffee,
      receiptHashesChecked: expected.paid,
      order: stats(orderTimes),
      payment: stats(paymentTimes),
      report: stats(reportTimes),
      reopening: stats(reopenTimes),
      backupMs,
      restoreMs,
      snapshot,
      elapsedMs: performance.now() - started,
    };
    fs.writeFileSync(path.join(root, 'duo-month-result.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally {
    vi.useRealTimers();
    if (db.open) db.close();
  }
}, 180_000);
