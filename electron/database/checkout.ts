import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { CheckoutErrorCode, CheckoutResult } from '../../src/domain/types';
import type { createOrderService } from './orders';

class CheckoutError extends Error { constructor(readonly code: CheckoutErrorCode, message: string) { super(message); } }
const fail = (code: CheckoutErrorCode, message: string): never => { throw new CheckoutError(code, message); };
export function createCheckoutService(db: Database.Database, orders: ReturnType<typeof createOrderService>) {
  return {
    completeOrder(input: unknown): CheckoutResult {
      try {
        return { ok: true, data: db.transaction(() => {
          if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_REQUEST', 'Kërkesa e pagesës nuk është e vlefshme.');
          const request = input as Record<string, unknown>;
          if (Object.keys(request).some(k => !['orderId','expectedRevision'].includes(k)) || typeof request.orderId !== 'string' || !request.orderId || request.orderId.length > 200 || (request.expectedRevision !== undefined && typeof request.expectedRevision !== 'string')) return fail('INVALID_REQUEST', 'Kërkesa e pagesës nuk është e vlefshme.');
          const row = db.prepare('SELECT id,table_id,status FROM orders WHERE id=?').get(request.orderId) as { id: string; table_id: string; status: string } | undefined;
          if (row?.status === 'CLOSED') return fail('ALREADY_COMPLETED', 'Kjo porosi është paguar tashmë. Rifresko gjendjen.');
          if (!row || row.status !== 'OPEN') return fail('ORDER_NOT_OPEN', 'Porosia nuk është më aktive. Rifresko gjendjen.');
          const workspace = orders.getForTable(row.table_id);
          if (!workspace.order || workspace.order.id !== row.id || workspace.table.status !== 'ACTIVE') return fail('ORDER_NOT_OPEN', 'Gjendja e tavolinës ka ndryshuar. Rifresko gjendjen.');
          if (!workspace.order.items.length) return fail('ORDER_EMPTY', 'Porosia është bosh.');
          if (request.expectedRevision !== undefined && request.expectedRevision !== workspace.order.revision) return fail('ORDER_CHANGED', 'Porosia ka ndryshuar. Kontrollo totalin dhe konfirmo përsëri.');
          // No renderer total is accepted. getForTable validates integer quantities and sums snapshots with BigInt.
          const totalCents = workspace.order.totalCents;
          const costs = db.prepare('SELECT quantity,unit_cost_cents FROM order_items WHERE order_id=?').all(row.id) as { quantity: number; unit_cost_cents: number | null }[];
          const knownCost = costs.reduce((total,item) => total + BigInt(item.quantity)*BigInt(item.unit_cost_cents ?? 0),0n);
          if (knownCost > BigInt(Number.MAX_SAFE_INTEGER)) return fail('CHECKOUT_FAILED', 'Kosto e porosisë tejkalon kufirin e lejuar.');
          const quantities = new Map<string, { name: string; quantity: number }>();
          for (const item of workspace.order.items) {
            const previous = quantities.get(item.productId)?.quantity ?? 0;
            const quantity = previous + item.quantity;
            if (!Number.isSafeInteger(quantity)) return fail('CHECKOUT_FAILED', 'Sasia tejkalon kufirin e lejuar.');
            quantities.set(item.productId, { name: item.name, quantity });
          }
          const deductions: { productId: string; quantity: number; balance: number }[] = [];
          // Preflight every product before any write. Existing inactive lines retain their snapshots.
          for (const [productId, item] of quantities) {
            const product = db.prepare('SELECT p.track_inventory,b.quantity FROM products p LEFT JOIN inventory_balances b ON b.product_id=p.id WHERE p.id=?').get(productId) as { track_inventory: number | null; quantity: number | null } | undefined;
            if (!product) return fail('CHECKOUT_FAILED', 'Produkti i porosisë nuk u gjet.');
            if (product.track_inventory === null) return fail('INVENTORY_UNCONFIGURED', `Nuk mund të mbyllet llogaria. Konfiguro “Ndjek stokun” për ${item.name}: zgjidh Po ose Jo te Inventari.`);
            if (product.track_inventory === 0) continue;
            if (product.quantity === null || product.quantity === undefined) return fail('STOCK_UNKNOWN', `${item.name}: stok pa vendosur. Vendos stokun te Inventari.`);
            if (!Number.isFinite(product.quantity) || product.quantity < item.quantity) return fail('INSUFFICIENT_STOCK', `${item.name}: stok i pamjaftueshëm. Kërkohen ${item.quantity}, në stok ${product.quantity}.`);
            deductions.push({ productId, quantity: item.quantity, balance: product.quantity });
          }
          const now = new Date().toISOString();
          const paymentMethod = 'CASH' as const;
          const sequence = db.prepare('SELECT COALESCE(MAX(sale_number),0)+1 AS number FROM orders').get() as { number: number };
          if (!Number.isSafeInteger(sequence.number)) return fail('CHECKOUT_FAILED', 'Numri i shitjes tejkalon kufirin e lejuar.');
          for (const item of deductions) {
            const update = db.prepare('UPDATE inventory_balances SET quantity=quantity-?,updated_at=? WHERE product_id=? AND quantity>=?').run(item.quantity,now,item.productId,item.quantity);
            if (update.changes !== 1) return fail('INSUFFICIENT_STOCK', 'Stoku ka ndryshuar. Kontrollo Inventarin.');
            db.prepare("INSERT INTO inventory_movements(id,product_id,type,quantity_delta,related_order_id,note,created_at) VALUES (?,?,'SALE',?,?,NULL,?)").run(randomUUID(),item.productId,-item.quantity,row.id,now);
          }
          db.prepare('INSERT INTO order_payments(order_id,payment_method,completed_at) VALUES (?,?,?)').run(row.id,paymentMethod,now);
          const update = db.prepare("UPDATE orders SET status='CLOSED',closed_at=?,updated_at=?,sale_number=? WHERE id=? AND status='OPEN'").run(now,now,sequence.number,row.id);
          if (update.changes !== 1) return fail('ALREADY_COMPLETED', 'Kjo porosi është paguar tashmë.');
          db.prepare("UPDATE cafe_tables SET status='FREE',updated_at=? WHERE id=?").run(now,row.table_id);
          return { orderId: row.id, saleNumber: sequence.number, paymentMethod, totalCents, completedAt: now, workspace: orders.getForTable(row.table_id) };
        }).immediate() };
      } catch (error) {
        if (error instanceof CheckoutError) return { ok: false, code: error.code, message: error.message };
        console.error('FOX checkout rolled back', error);
        return { ok: false, code: 'CHECKOUT_FAILED', message: 'Pagesa nuk u ruajt. Porosia mbetet aktive. Provo përsëri.' };
      }
    },
  };
}
