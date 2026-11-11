import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ActiveOrder,
  ActiveOrderItem,
  OrderDraftResult,
  OrderProductSnapshot,
  OrderWorkspace,
  SubmitOrderDraft,
} from '../../src/domain/types';
import type { MutationResult } from '../../src/domain/configuration';
import type { createRepositories } from './repositories';
import { bookedReservation } from './reservations';
import { isCoffee, type OperatorId } from '../../src/domain/operators';
import { changeCoffeeStock, coffeeBalance } from './duoCoffee';

// Includes quantities and immutable snapshots; timestamps alone can collide within a millisecond.
export const orderRevision = (lines: ActiveOrderItem[]) =>
  JSON.stringify(lines.map((i) => [i.id, i.quantity, i.unitPriceCents, i.name]));
class OrderError extends Error {}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200)
    throw new OrderError('Identifikuesi nuk është i vlefshëm.');
  return value;
}
function command(value: unknown, field: 'productId' | 'itemId') {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OrderError('Kërkesa nuk është e vlefshme.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['tableId', field].includes(key)))
    throw new OrderError('Kërkesa përmban të dhëna të palejuara.');
  return { tableId: id(input.tableId), targetId: id(input[field]) };
}
function draftCommand(value: unknown): SubmitOrderDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OrderError('Kërkesa nuk është e vlefshme.');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !['requestId', 'tableId', 'orderId', 'expectedRevision', 'items'].includes(key),
    )
  )
    throw new OrderError('Kërkesa përmban të dhëna të palejuara.');
  if (
    typeof input.requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)
  )
    throw new OrderError('Identifikuesi i kërkesës nuk është i vlefshëm.');
  const draftId = (value: unknown) => {
    const identifier = id(value);
    if (/[\u0000-\u001f]/.test(identifier))
      throw new OrderError('Identifikuesi nuk është i vlefshëm.');
    return identifier;
  };
  const tableId = draftId(input.tableId),
    orderId = input.orderId === null ? null : draftId(input.orderId);
  const expectedRevision = input.expectedRevision;
  if (
    (orderId === null) !== (expectedRevision === null) ||
    (expectedRevision !== null &&
      (typeof expectedRevision !== 'string' || expectedRevision.length > 1000000))
  )
    throw new OrderError('Rifresko gjendjen e porosisë.');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100)
    throw new OrderError('Zgjidh nga 1 deri në 100 produkte.');
  const items = Array.from(input.items, (item: unknown): SubmitOrderDraft['items'][number] => {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      Object.keys(item).some((key) => !['productId', 'quantity', 'expectedProduct'].includes(key))
    )
      throw new OrderError('Artikulli nuk është i vlefshëm.');
    const { productId, quantity, expectedProduct } = item as Record<string, unknown>;
    if (
      typeof quantity !== 'number' ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 999
    )
      throw new OrderError('Sasia nuk është e vlefshme.');
    const line = { productId: draftId(productId), quantity };
    if (expectedProduct === undefined) return line;
    if (
      !expectedProduct ||
      typeof expectedProduct !== 'object' ||
      Array.isArray(expectedProduct) ||
      Object.keys(expectedProduct).some(
        (key) => !['name', 'categoryId', 'unitPriceCents'].includes(key),
      )
    )
      throw new OrderError('Kontrollo të dhënat e produktit.');
    const { name, categoryId, unitPriceCents } = expectedProduct as Record<string, unknown>;
    if (
      typeof unitPriceCents !== 'number' ||
      !Number.isSafeInteger(unitPriceCents) ||
      unitPriceCents < 0
    )
      throw new OrderError('Çmimi nuk është i vlefshëm.');
    const productName = id(name);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(productName))
      throw new OrderError('Kontrollo të dhënat e produktit.');
    return {
      ...line,
      expectedProduct: { name: productName, categoryId: draftId(categoryId), unitPriceCents },
    };
  });
  if (new Set(items.map((item) => item.productId)).size !== items.length)
    throw new OrderError('Secili produkt duhet të jetë vetëm një herë.');
  return { requestId: input.requestId.toLowerCase(), tableId, orderId, expectedRevision, items };
}
function safe(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new OrderError('Sasia ose totali tejkalon kufirin teknik të lejuar.');
  return Number(value);
}
export function createOrderService(
  db: Database.Database,
  repositories: ReturnType<typeof createRepositories>,
  duo?: { operator: () => OperatorId | null },
) {
  const activeRow = (tableId: string) =>
    db
      .prepare(
        "SELECT id,created_at AS createdAt,updated_at AS updatedAt FROM orders WHERE table_id=? AND status='OPEN'",
      )
      .get(tableId) as { id: string; createdAt: string; updatedAt: string } | undefined;
  const items = (orderId: string): ActiveOrderItem[] => {
    const rows = db
      .prepare(
        `SELECT id,product_id AS productId,product_name_snapshot AS name,quantity,
      unit_price_cents AS unitPriceCents FROM order_items WHERE order_id=? ORDER BY rowid`,
      )
      .all(orderId) as Omit<ActiveOrderItem, 'lineTotalCents'>[];
    return rows.map((row) => {
      if (
        !Number.isSafeInteger(row.quantity) ||
        row.quantity < 1 ||
        !Number.isSafeInteger(row.unitPriceCents)
      )
        throw new OrderError('Të dhënat e porosisë nuk janë të vlefshme.');
      return { ...row, lineTotalCents: safe(BigInt(row.quantity) * BigInt(row.unitPriceCents)) };
    });
  };
  const read = (tableId: string): OrderWorkspace => {
    const table = repositories.listTables().find((t) => t.id === tableId);
    if (!table) throw new OrderError('Tavolina nuk u gjet.');
    const row = activeRow(tableId);
    let order: ActiveOrder | null = null;
    if (row) {
      const lines = items(row.id);
      order = {
        ...row,
        revision: orderRevision(lines),
        tableId,
        status: 'OPEN',
        items: lines,
        totalCents: safe(lines.reduce((total, line) => total + BigInt(line.lineTotalCents), 0n)),
      };
    }
    return { table, order, reservation: bookedReservation(db, tableId) };
  };
  const writable = (view: OrderWorkspace) => {
    if (!view.table.enabled) throw new OrderError('Ky pozicion shërbimi është joaktiv.');
    if (!['FREE', 'ACTIVE'].includes(view.table.status))
      throw new OrderError('Porositë nuk janë të disponueshme për këtë status tavoline.');
    if ((view.table.status === 'ACTIVE') !== Boolean(view.order))
      throw new OrderError('Gjendja e tavolinës nuk përputhet me porosinë. Rifresko gjendjen.');
  };
  // Validation failures throw inside the transaction so no partial writes can commit.
  const mutate = (action: () => OrderWorkspace): MutationResult<OrderWorkspace> => {
    try {
      return { ok: true, data: db.transaction(action).immediate() };
    } catch (error) {
      if (!(error instanceof OrderError)) throw error;
      return { ok: false, errors: { form: error.message }, message: error.message };
    }
  };
  const tableStatus = (tableId: string, status: 'FREE' | 'ACTIVE', now: string) =>
    db.prepare('UPDATE cafe_tables SET status=?,updated_at=? WHERE id=?').run(status, now, tableId);
  const touch = (orderId: string, now: string) =>
    db.prepare('UPDATE orders SET updated_at=? WHERE id=?').run(now, orderId);
  const changeItem = (input: unknown, action: 'increment' | 'decrement' | 'remove') =>
    mutate(() => {
      const { tableId, targetId } = command(input, 'itemId');
      const view = read(tableId);
      writable(view);
      const line = view.order?.items.find((item) => item.id === targetId);
      if (!view.order || !line)
        throw new OrderError('Artikulli nuk i përket porosisë aktive të kësaj tavoline.');
      const now = new Date().toISOString();
      const coffee = Boolean(duo && isCoffee(line.productId));
      const reserved = coffee
        ? ((db
            .prepare('SELECT coffee_portions FROM duo_order_lines WHERE item_id=?')
            .pluck()
            .get(line.id) as number | undefined) ?? 0)
        : 0;
      const changeCoffee = (delta: number) => {
        if (!delta) return;
        const issue = changeCoffeeStock(db, view.order!.id, delta, now);
        if (issue) throw new OrderError(issue);
      };
      if (action === 'remove') {
        changeCoffee(reserved);
        db.prepare('DELETE FROM order_items WHERE id=? AND order_id=?').run(line.id, view.order.id);
        if (view.order.items.length === 1) {
          db.prepare(
            "UPDATE orders SET status='CANCELLED',updated_at=? WHERE id=? AND status='OPEN'",
          ).run(now, view.order.id);
          tableStatus(tableId, 'FREE', now);
        } else touch(view.order.id, now);
      } else {
        const quantity =
          action === 'increment'
            ? safe(BigInt(line.quantity) + 1n)
            : Math.max(1, line.quantity - 1);
        safe(
          BigInt(view.order.totalCents) +
            BigInt(quantity - line.quantity) * BigInt(line.unitPriceCents),
        );
        if (quantity !== line.quantity) {
          db.prepare('UPDATE order_items SET quantity=? WHERE id=? AND order_id=?').run(
            quantity,
            line.id,
            view.order.id,
          );
          if (coffee) {
            const delta = quantity > line.quantity ? 1 : reserved > 0 ? -1 : 0;
            changeCoffee(-delta);
            if (delta) {
              const actor = duo?.operator();
              if (!actor) throw new OrderError('Hyr me PIN për të ruajtur porosinë.');
              db.prepare(
                'INSERT INTO duo_order_lines VALUES (?,?,?) ON CONFLICT(item_id) DO UPDATE SET coffee_portions=excluded.coffee_portions',
              ).run(line.id, actor, reserved + delta);
            }
          }
          touch(view.order.id, now);
        }
      }
      return read(tableId);
    });
  const service = {
    getForTable(input: unknown): OrderWorkspace {
      const tableId = id(input);
      return db.transaction(() => read(tableId))();
    },
    addProduct(
      input: unknown,
      quantity = 1,
      expected?: OrderProductSnapshot,
    ): MutationResult<OrderWorkspace> {
      return mutate(() => {
        const { tableId, targetId } = command(input, 'productId');
        const view = read(tableId);
        writable(view);
        const product = repositories.listProducts(true).find((p) => p.id === targetId);
        if (!product) throw new OrderError('Produkti nuk u gjet.');
        const actor = duo?.operator();
        if (duo && !actor) throw new OrderError('Hyr me PIN për të ruajtur porosinë.');
        const coffee = Boolean(duo && isCoffee(product.id));
        const stock = coffee ? coffeeBalance(db) : null;
        if (coffee && (stock === null || stock < quantity))
          throw new OrderError('Stoku i kafesë nuk është i mjaftueshëm ose nuk është vendosur.');
        if (!coffee && product.trackInventory === null)
          throw new OrderError('Stoku pa konfiguruar. Zgjidh Po ose Jo te Inventari.');
        if (!coffee && product.trackInventory === true && product.stockQuantity === null)
          throw new OrderError('Stok pa vendosur. Vendos stokun te Inventari.');
        if (!coffee && product.trackInventory === true && product.stockQuantity! <= 0)
          throw new OrderError('Pa stok. Shto furnizim te Inventari.');
        if (!product.active) throw new OrderError('Produkti nuk është aktiv.');
        if (product.sellingPriceCents === null)
          throw new OrderError('Ky produkt nuk ka çmim të vendosur. Vendos çmimin te Inventari.');
        if (
          expected &&
          (expected.name !== product.name ||
            expected.categoryId !== product.categoryId ||
            expected.unitPriceCents !== product.sellingPriceCents)
        )
          throw new OrderError('Produkti ka ndryshuar. Hiqe dhe zgjidhe përsëri.');
        safe(
          BigInt(view.order?.totalCents ?? 0) +
            BigInt(product.sellingPriceCents) * BigInt(quantity),
        );
        const now = new Date().toISOString();
        let orderId = view.order?.id;
        if (!orderId) {
          orderId = randomUUID();
          db.prepare(
            "INSERT INTO orders (id,table_id,status,created_at,updated_at,closed_at) VALUES (?,?,'OPEN',?,?,NULL)",
          ).run(orderId, tableId, now, now);
          tableStatus(tableId, 'ACTIVE', now);
        }
        const existing = db
          .prepare(
            `SELECT id,quantity FROM order_items WHERE order_id=? AND product_id=?
          AND product_name_snapshot=? AND unit_price_cents=? AND unit_cost_cents IS ?
          ${duo ? 'AND (SELECT operator_id FROM duo_order_lines WHERE item_id=order_items.id)=?' : ''}
          ORDER BY rowid LIMIT 1`,
          )
          .get(
            orderId,
            product.id,
            product.name,
            product.sellingPriceCents,
            product.purchaseCostCents,
            ...(duo ? [actor] : []),
          ) as { id: string; quantity: number } | undefined;
        const itemId = existing?.id ?? randomUUID();
        if (existing)
          db.prepare('UPDATE order_items SET quantity=? WHERE id=?').run(
            safe(BigInt(existing.quantity) + BigInt(quantity)),
            existing.id,
          );
        else
          db.prepare(
            `INSERT INTO order_items (id,order_id,product_id,product_name_snapshot,quantity,unit_price_cents,unit_cost_cents,created_at)
          VALUES (?,?,?,?,?,?,?,?)`,
          ).run(
            itemId,
            orderId,
            product.id,
            product.name,
            quantity,
            product.sellingPriceCents,
            product.purchaseCostCents,
            now,
          );
        if (coffee) {
          const issue = changeCoffeeStock(db, orderId, -quantity, now);
          if (issue) throw new OrderError(issue);
        }
        if (actor)
          db.prepare(
            'INSERT INTO duo_order_lines VALUES (?,?,?) ON CONFLICT(item_id) DO UPDATE SET coffee_portions=coffee_portions+excluded.coffee_portions',
          ).run(itemId, actor, coffee ? quantity : 0);
        touch(orderId, now);
        return read(tableId);
      });
    },
    submitDraft(input: unknown): OrderDraftResult<OrderWorkspace> {
      let noPreviousCommit = false;
      const result = mutate(() => {
        const { requestId, tableId, orderId, expectedRevision, items } = draftCommand(input);
        const key = 'fox_order_draft_v1:' + requestId;
        const fingerprint = createHash('sha256')
          .update(
            JSON.stringify(
              duo
                ? [tableId, orderId, expectedRevision, items, duo.operator()]
                : [tableId, orderId, expectedRevision, items],
            ),
          )
          .digest('hex');
        const previous = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
          | { value: string }
          | undefined;
        if (previous) {
          if (previous.value !== fingerprint)
            throw new OrderError('Kjo kërkesë është përdorur me të dhëna të tjera.');
          return read(tableId);
        }
        noPreviousCommit = true;
        let view = read(tableId);
        if (
          (view.order?.id ?? null) !== orderId ||
          (view.order?.revision ?? null) !== expectedRevision
        )
          throw new OrderError('Porosia ka ndryshuar. Rifresko gjendjen.');
        for (const { productId, quantity, expectedProduct } of items) {
          const added = service.addProduct({ tableId, productId }, quantity, expectedProduct);
          if (!added.ok) throw new OrderError(added.message);
          view = added.data;
        }
        db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(key, fingerprint);
        return view;
      });
      return !result.ok && noPreviousCommit ? { ...result, notCommitted: true } : result;
    },
    incrementItem: (input: unknown) => changeItem(input, 'increment'),
    decrementItem: (input: unknown) => changeItem(input, 'decrement'),
    removeItem: (input: unknown) => changeItem(input, 'remove'),
  };
  return service;
}
