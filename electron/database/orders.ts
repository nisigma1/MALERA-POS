import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ActiveOrder, ActiveOrderItem, OrderWorkspace } from '../../src/domain/types';
import type { MutationResult } from '../../src/domain/configuration';
import type { createRepositories } from './repositories';
import { bookedReservation } from './reservations';

// Includes quantities and immutable snapshots; timestamps alone can collide within a millisecond.
export const orderRevision = (lines: ActiveOrderItem[]) => JSON.stringify(lines.map(i => [i.id, i.quantity, i.unitPriceCents, i.name]));
class OrderError extends Error {}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new OrderError('Identifikuesi nuk është i vlefshëm.');
  return value;
}
function command(value: unknown, field: 'productId' | 'itemId') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OrderError('Kërkesa nuk është e vlefshme.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['tableId',field].includes(key))) throw new OrderError('Kërkesa përmban të dhëna të palejuara.');
  return { tableId: id(input.tableId), targetId: id(input[field]) };
}
function safe(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new OrderError('Sasia ose totali tejkalon kufirin teknik të lejuar.');
  return Number(value);
}
export function createOrderService(db: Database.Database, repositories: ReturnType<typeof createRepositories>) {
  const activeRow = (tableId: string) => db.prepare("SELECT id,created_at AS createdAt,updated_at AS updatedAt FROM orders WHERE table_id=? AND status='OPEN'").get(tableId) as { id: string; createdAt: string; updatedAt: string } | undefined;
  const items = (orderId: string): ActiveOrderItem[] => {
    const rows = db.prepare(`SELECT id,product_id AS productId,product_name_snapshot AS name,quantity,
      unit_price_cents AS unitPriceCents FROM order_items WHERE order_id=? ORDER BY rowid`).all(orderId) as Omit<ActiveOrderItem,'lineTotalCents'>[];
    return rows.map(row => {
      if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || !Number.isSafeInteger(row.unitPriceCents)) throw new OrderError('Të dhënat e porosisë nuk janë të vlefshme.');
      return { ...row, lineTotalCents: safe(BigInt(row.quantity)*BigInt(row.unitPriceCents)) };
    });
  };
  const read = (tableId: string): OrderWorkspace => {
    const table = repositories.listTables().find(t => t.id === tableId);
    if (!table) throw new OrderError('Tavolina nuk u gjet.');
    const row = activeRow(tableId);
    let order: ActiveOrder | null = null;
    if (row) {
      const lines = items(row.id);
      order = { ...row, revision: orderRevision(lines), tableId, status: 'OPEN', items: lines, totalCents: safe(lines.reduce((total,line)=>total+BigInt(line.lineTotalCents),0n)) };
    }
    return { table, order, reservation: bookedReservation(db,tableId) };
  };
  const writable = (view: OrderWorkspace) => {
    if (!view.table.enabled) throw new OrderError('Ky pozicion shërbimi është joaktiv.');
    if (!['FREE','ACTIVE'].includes(view.table.status)) throw new OrderError('Porositë nuk janë të disponueshme për këtë status tavoline.');
    if ((view.table.status === 'ACTIVE') !== Boolean(view.order)) throw new OrderError('Gjendja e tavolinës nuk përputhet me porosinë. Rifresko gjendjen.');
  };
  // Validation failures throw inside the transaction so no partial writes can commit.
  const mutate = (action: () => OrderWorkspace): MutationResult<OrderWorkspace> => {
    try { return { ok: true, data: db.transaction(action).immediate() }; }
    catch (error) { if (!(error instanceof OrderError)) throw error; return { ok: false, errors: { form: error.message }, message: error.message }; }
  };
  const tableStatus = (tableId: string, status: 'FREE' | 'ACTIVE', now: string) => db.prepare('UPDATE cafe_tables SET status=?,updated_at=? WHERE id=?').run(status,now,tableId);
  const touch = (orderId: string, now: string) => db.prepare('UPDATE orders SET updated_at=? WHERE id=?').run(now,orderId);
  const changeItem = (input: unknown, action: 'increment' | 'decrement' | 'remove') => mutate(() => {
    const { tableId,targetId } = command(input,'itemId');
    const view = read(tableId); writable(view);
    const line = view.order?.items.find(item => item.id === targetId);
    if (!view.order || !line) throw new OrderError('Artikulli nuk i përket porosisë aktive të kësaj tavoline.');
    const now = new Date().toISOString();
    if (action === 'remove') {
      db.prepare('DELETE FROM order_items WHERE id=? AND order_id=?').run(line.id,view.order.id);
      if (view.order.items.length === 1) {
        db.prepare("UPDATE orders SET status='CANCELLED',updated_at=? WHERE id=? AND status='OPEN'").run(now,view.order.id);
        tableStatus(tableId,'FREE',now);
      } else touch(view.order.id,now);
    } else {
      const quantity = action === 'increment' ? safe(BigInt(line.quantity)+1n) : Math.max(1,line.quantity-1);
      safe(BigInt(view.order.totalCents)+BigInt(quantity-line.quantity)*BigInt(line.unitPriceCents));
      if (quantity !== line.quantity) {
        db.prepare('UPDATE order_items SET quantity=? WHERE id=? AND order_id=?').run(quantity,line.id,view.order.id);
        touch(view.order.id,now);
      }
    }
    return read(tableId);
  });
  return {
    getForTable(input: unknown): OrderWorkspace { const tableId=id(input); return db.transaction(()=>read(tableId))(); },
    addProduct(input: unknown): MutationResult<OrderWorkspace> {
      return mutate(() => {
        const { tableId,targetId } = command(input,'productId');
        const view=read(tableId); writable(view);
        const product=repositories.listProducts().find(p=>p.id===targetId);
        if (!product) throw new OrderError('Produkti nuk u gjet.');
        if (product.trackInventory === null) throw new OrderError('Stoku pa konfiguruar. Zgjidh Po ose Jo te Inventari.');
        if (product.trackInventory === true && product.stockQuantity === null) throw new OrderError('Stok pa vendosur. Vendos stokun te Inventari.');
        if (product.trackInventory === true && product.stockQuantity! <= 0) throw new OrderError('Pa stok. Shto furnizim te Inventari.');
        if (!product.active) throw new OrderError('Produkti nuk është aktiv.');
        if (product.sellingPriceCents===null) throw new OrderError('Ky produkt nuk ka çmim të vendosur. Vendos çmimin te Inventari.');
        safe(BigInt(view.order?.totalCents ?? 0)+BigInt(product.sellingPriceCents));
        const now=new Date().toISOString();
        let orderId=view.order?.id;
        if (!orderId) {
          orderId=randomUUID();
          db.prepare("INSERT INTO orders (id,table_id,status,created_at,updated_at,closed_at) VALUES (?,?,'OPEN',?,?,NULL)").run(orderId,tableId,now,now);
          tableStatus(tableId,'ACTIVE',now);
        }
        const existing=db.prepare(`SELECT id,quantity FROM order_items WHERE order_id=? AND product_id=?
          AND product_name_snapshot=? AND unit_price_cents=? AND unit_cost_cents IS ? ORDER BY rowid LIMIT 1`).get(orderId,product.id,product.name,product.sellingPriceCents,product.purchaseCostCents) as {id:string;quantity:number} | undefined;
        if (existing) db.prepare('UPDATE order_items SET quantity=? WHERE id=?').run(safe(BigInt(existing.quantity)+1n),existing.id);
        else db.prepare(`INSERT INTO order_items (id,order_id,product_id,product_name_snapshot,quantity,unit_price_cents,unit_cost_cents,created_at)
          VALUES (?,?,?,?,1,?,?,?)`).run(randomUUID(),orderId,product.id,product.name,product.sellingPriceCents,product.purchaseCostCents,now);
        touch(orderId,now);
        return read(tableId);
      });
    },
    incrementItem: (input: unknown) => changeItem(input,'increment'),
    decrementItem: (input: unknown) => changeItem(input,'decrement'),
    removeItem: (input: unknown) => changeItem(input,'remove'),
  };
}
