import { readSalesReport } from './salesReports';
import type Database from 'better-sqlite3';
import type { TableSummary, CatalogProduct, ReportSummary, Settings } from '../../src/domain/types';

export function createRepositories(db: Database.Database) {
  return {
    getSalesReport: (period: unknown) => readSalesReport(db, period),
    listTables(): TableSummary[] {
      const rows = db.prepare(`SELECT t.id,t.code,t.area,t.status,t.enabled,t.sort_order AS sortOrder,
        t.created_at AS createdAt,t.updated_at AS updatedAt,
        CASE WHEN o.id IS NULL THEN NULL ELSE COALESCE(SUM(i.quantity*i.unit_price_cents),0) END AS activeOrderTotalCents
        FROM cafe_tables t LEFT JOIN orders o ON o.table_id=t.id AND o.status='OPEN'
        LEFT JOIN order_items i ON i.order_id=o.id GROUP BY t.id ORDER BY t.sort_order`).all() as (Omit<TableSummary, 'enabled'> & { enabled: number })[];
      if (rows.some(row => row.activeOrderTotalCents !== null && !Number.isSafeInteger(row.activeOrderTotalCents))) throw new Error('Active order total exceeds safe integer cents');
      return rows.map(row => ({ ...row, enabled: row.enabled === 1 }));
    },
    listProducts(): CatalogProduct[] {
      const rows = db.prepare(`SELECT p.id,p.name,p.category_id AS categoryId,c.name AS categoryName,
        p.selling_price_cents AS sellingPriceCents,p.purchase_cost_cents AS purchaseCostCents,
        p.track_inventory AS trackInventory,p.low_stock_threshold AS lowStockThreshold,p.active,
        p.created_at AS createdAt,p.updated_at AS updatedAt,b.quantity AS stockQuantity
        FROM products p JOIN categories c ON c.id=p.category_id
        LEFT JOIN inventory_balances b ON b.product_id=p.id ORDER BY c.sort_order,p.rowid`).all() as (Omit<CatalogProduct, 'active' | 'trackInventory'> & { active: number; trackInventory: number | null })[];
      return rows.map(row => ({ ...row, active: row.active === 1, trackInventory: row.trackInventory === null ? null : row.trackInventory === 1 }));
    },
    getSettings(): Settings {
      const row = db.prepare("SELECT value FROM settings WHERE key='business_name'").get() as { value: string } | undefined;
      if (!row) throw new Error('Business name is missing');
      return { businessName: row.value };
    },
    getSummary(): ReportSummary {
      // Never include OPEN or CANCELLED orders. Unknown cost remains unknown, not zero.
      return db.transaction(() => {
        const orders = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status='CLOSED'").get() as { count: number };
        const totals = db.prepare(`SELECT COALESCE(SUM(i.quantity * i.unit_price_cents),0) AS sales,
          COALESCE(SUM(i.quantity * i.unit_cost_cents),0) AS cost,
          COUNT(CASE WHEN i.unit_cost_cents IS NULL THEN 1 END) AS unknownCosts,
          COALESCE(SUM(i.quantity),0) AS quantity
          FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status='CLOSED'`).get() as { sales: number; cost: number; unknownCosts: number; quantity: number };
        const expenses = db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total FROM expenses').get() as { total: number };
        for (const amount of [totals.sales, totals.cost, expenses.total]) {
          if (!Number.isSafeInteger(amount)) throw new Error('Report total exceeds safe integer cents');
        }
        const cost = totals.unknownCosts ? null : totals.cost;
        const gross = cost === null ? null : totals.sales - cost;
        return {
          salesCents: totals.sales, costCents: cost, grossProfitCents: gross,
          expensesCents: expenses.total, netProfitCents: gross === null ? null : gross - expenses.total,
          completedOrders: orders.count, productsSold: totals.quantity,
          averageOrderCents: orders.count ? Math.round(totals.sales / orders.count) : null,
        };
      })();
    },
  };
}
