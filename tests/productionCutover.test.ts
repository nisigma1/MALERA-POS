import { it, expect } from 'vitest';
import { openDatabase } from '../electron/database/connection';
import { createRepositories } from '../electron/database/repositories';
import { productReadiness } from '../src/domain/readiness';
import { inspectDatabase } from '../electron/database/health';
it('initializes approved references with zero business history and truthful unconfigured readiness', () => {
  const db = openDatabase(':memory:');
  try {
    const repository = createRepositories(db),
      products = repository.listProducts();
    expect(repository.listTables()).toHaveLength(27);
    expect(products).toHaveLength(21);
    expect(
      products.every(
        (p) =>
          p.sellingPriceCents === null &&
          p.purchaseCostCents === null &&
          p.trackInventory === null &&
          p.stockQuantity === null &&
          p.lowStockThreshold === null,
      ),
    ).toBe(true);
    for (const table of [
      'orders',
      'order_items',
      'order_payments',
      'expenses',
      'inventory_movements',
      'receipt_documents',
      'receipt_print_jobs',
      'receipt_print_attempts',
      'receipt_generation_errors',
      'expense_revisions',
      'stock_losses',
      'cash_closes',
    ])
      expect(db.prepare('SELECT COUNT(*) n FROM ' + table).get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT key,value FROM settings ORDER BY key').all()).toEqual([
      { key: 'business_name', value: 'FOX' },
      { key: 'receipt_auto_print', value: 'false' },
      { key: 'receipt_printer', value: 'null' },
    ]);
    expect(productReadiness(products)).toMatchObject({
      configured: false,
      missingPrices: 21,
      missingStockConfiguration: 21,
    });
    expect(repository.getSalesReport('ALL')).toMatchObject({
      summary: { salesCents: 0, completedOrders: 0 },
      cashCents: 0,
    });
    expect(inspectDatabase(db, true)).toBe(7);
  } finally {
    db.close();
  }
});
