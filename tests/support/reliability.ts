import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { createRepositories } from '../../electron/database/repositories';
import { createOrderService } from '../../electron/database/orders';
import { createCheckoutService } from '../../electron/database/checkout';
import { createConfigurationService } from '../../electron/database/configuration';
import { createFinanceService } from '../../electron/database/finance';
import { createReservationService } from '../../electron/database/reservations';
import {
  createReceiptRepository,
  receiptHash,
  validatePayload,
} from '../../electron/receipts/repository';
import type { ReceiptPayload } from '../../src/domain/receipts';

export const canonical = [
  'M1',
  'M2',
  'M3',
  'M4',
  'M5',
  'M6',
  'M7',
  'M8',
  'M9',
  'M10',
  'M11',
  'M12',
  'M13',
  'SH1',
  'SH2',
  'SH3',
  'SH4',
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
  'T6',
  'T7',
  'T8',
  'T9',
  'T10',
];
export function services(db: Database.Database, clock = () => new Date()) {
  const repo = createRepositories(db),
    orders = createOrderService(db, repo);
  return {
    repo,
    orders,
    checkout: createCheckoutService(db, orders),
    configuration: createConfigurationService(db, repo),
    finance: createFinanceService(db, clock),
    reservations: createReservationService(db, orders, clock),
    receipts: createReceiptRepository(db),
  };
}
export function snapshot(db: Database.Database) {
  return Object.fromEntries(
    (
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]),
  );
}
export const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function streamDigest(db: Database.Database) {
  const h = createHash('sha256');
  h.update('{');
  let firstTable = true;
  for (const { name } of db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .iterate() as IterableIterator<{ name: string }>) {
    if (!firstTable) h.update(',');
    firstTable = false;
    h.update(JSON.stringify(name) + ':[');
    let firstRow = true;
    for (const row of db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).iterate()) {
      if (!firstRow) h.update(',');
      firstRow = false;
      h.update(JSON.stringify(row));
    }
    h.update(']');
  }
  h.update('}');
  return h.digest('hex');
}
export function accepted<R extends { ok: true; data: unknown } | { ok: false; message: string }>(
  r: R,
): Extract<R, { ok: true }>['data'] {
  assert.equal(r.ok, true, !r.ok ? r.message : '');
  if (!r.ok) throw Error('Rejected');
  return r.data as Extract<R, { ok: true }>['data'];
}
export function configure(
  db: Database.Database,
  price = 100,
  cost: number | null = 50,
  stock = 10000,
) {
  const s = services(db),
    p = s.repo.listProducts().find((p) => p.id === 'KAFE-1')!;
  accepted(
    s.configuration.updateProduct({
      ...p,
      sellingPriceCents: price,
      purchaseCostCents: cost,
      trackInventory: true,
    }),
  );
  accepted(
    s.configuration.addSupply({ requestId: randomUUID(), productId: p.id, quantity: stock }),
  );
}
export function sale(db: Database.Database, tableId = 'M5', quantity = 1) {
  const s = services(db);
  let view = accepted(s.orders.addProduct({ tableId, productId: 'KAFE-1' }));
  for (let i = 1; i < quantity; i++)
    view = accepted(s.orders.incrementItem({ tableId, itemId: view.order!.items[0]!.id }));
  return accepted(
    s.checkout.completeOrder({ orderId: view.order!.id, expectedRevision: view.order!.revision }),
  );
}
const sum = (values: (number | bigint)[]) => values.reduce<bigint>((n, v) => n + BigInt(v), 0n);
const number = (v: bigint) => {
  assert.ok(
    v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER),
    'Independent oracle exceeds supported cents',
  );
  return Number(v);
};
export function independentFinance(db: Database.Database) {
  let revenueTotal = 0n,
    costTotal = 0n,
    missingCost = false;
  for (const i of db
    .prepare(
      "SELECT i.quantity,i.unit_price_cents,i.unit_cost_cents FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status='CLOSED'",
    )
    .iterate() as IterableIterator<{
    quantity: number;
    unit_price_cents: number;
    unit_cost_cents: number | null;
  }>) {
    revenueTotal += BigInt(i.quantity) * BigInt(i.unit_price_cents);
    if (i.unit_cost_cents === null) missingCost = true;
    else costTotal += BigInt(i.quantity) * BigInt(i.unit_cost_cents);
  }
  const expenses = db
    .prepare(
      'SELECT COALESCE(r.amount_cents,e.amount_cents) amount FROM expenses e LEFT JOIN expense_revisions r ON r.expense_id=e.id AND NOT EXISTS(SELECT 1 FROM expense_revisions next WHERE next.previous_revision_id=r.id)',
    )
    .all() as { amount: number }[];
  const losses = db.prepare('SELECT total_cost_cents cost FROM stock_losses').all() as {
    cost: number | null;
  }[];
  const revenue = number(revenueTotal);
  const cogs = missingCost ? null : number(costTotal);
  const expense = number(sum(expenses.map((e) => e.amount))),
    loss = losses.some((i) => i.cost === null) ? null : number(sum(losses.map((i) => i.cost!)));
  const gross = cogs === null ? null : number(BigInt(revenue) - BigInt(cogs));
  const operating =
    gross === null || loss === null ? null : number(BigInt(gross) - BigInt(expense) - BigInt(loss));
  return { revenue, cogs, expense, loss, gross, operating };
}
export function assertDatabaseIntegrity(db: Database.Database) {
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
}
export function assertCanonicalPositionInvariants(db: Database.Database) {
  assert.deepEqual(
    services(db)
      .repo.listTables()
      .map((t) => t.code),
    canonical,
  );
}
export function assertOrderInvariants(db: Database.Database) {
  assert.deepEqual(
    db
      .prepare(
        "SELECT table_id FROM orders WHERE status='OPEN' GROUP BY table_id HAVING COUNT(*)>1",
      )
      .all(),
    [],
  );
  assert.deepEqual(
    db
      .prepare(
        "SELECT t.id FROM cafe_tables t WHERE (t.status='ACTIVE') != EXISTS(SELECT 1 FROM orders o WHERE o.table_id=t.id AND o.status='OPEN')",
      )
      .all(),
    [],
  );
  assert.deepEqual(
    db
      .prepare(
        "SELECT id FROM orders WHERE status='OPEN' AND NOT EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=orders.id)",
      )
      .all(),
    [],
  );
}
export function assertCheckoutInvariants(db: Database.Database) {
  assert.deepEqual(
    db
      .prepare(
        "SELECT id FROM orders o WHERE status='CLOSED' AND (sale_number IS NULL OR NOT EXISTS(SELECT 1 FROM order_payments p WHERE p.order_id=o.id) OR NOT EXISTS(SELECT 1 FROM receipt_documents d WHERE d.sale_id=o.id))",
      )
      .all(),
    [],
  );
  assert.deepEqual(
    db
      .prepare(
        'SELECT sale_number FROM orders WHERE sale_number IS NOT NULL GROUP BY sale_number HAVING COUNT(*)>1',
      )
      .all(),
    [],
  );
  for (const d of db
    .prepare('SELECT payload_json json,payload_hash hash FROM receipt_documents')
    .iterate() as IterableIterator<{ json: string; hash: string }>) {
    assert.equal(receiptHash(d.json), d.hash);
    validatePayload(JSON.parse(d.json) as ReceiptPayload);
  }
  assert.deepEqual(
    db
      .prepare(
        "SELECT order_id FROM order_payments p WHERE NOT EXISTS(SELECT 1 FROM orders o WHERE o.id=p.order_id AND o.status='CLOSED')",
      )
      .all(),
    [],
  );
  assert.deepEqual(
    db
      .prepare(
        "SELECT related_order_id,product_id FROM inventory_movements WHERE type='SALE' GROUP BY related_order_id,product_id HAVING COUNT(*)>1",
      )
      .all(),
    [],
  );
}
export function assertInventoryInvariants(db: Database.Database) {
  const rational = (value: number) => {
    const [mantissa, power = '0'] = String(value).split('e'),
      fraction = (mantissa!.split('.')[1] ?? '').length,
      shift = Number(power) - fraction;
    let n = BigInt(mantissa!.replace('.', '')),
      d = 1n;
    if (shift < 0) d = 10n ** BigInt(-shift);
    else n *= 10n ** BigInt(shift);
    return { n, d };
  };
  for (const p of db
    .prepare('SELECT product_id,quantity FROM inventory_balances WHERE quantity IS NOT NULL')
    .all() as { product_id: string; quantity: number }[]) {
    let total = 0n,
      denominator = 1n;
    for (const m of db
      .prepare('SELECT quantity_delta FROM inventory_movements WHERE product_id=?')
      .iterate(p.product_id) as IterableIterator<{ quantity_delta: number }>) {
      const r = rational(m.quantity_delta),
        common = denominator > r.d ? denominator : r.d;
      total = total * (common / denominator) + r.n * (common / r.d);
      denominator = common;
    }
    const actual = rational(p.quantity);
    assert.equal(
      actual.n * denominator,
      total * actual.d,
      'Stock differs from exact decimal movement history',
    );
    assert.ok(p.quantity >= 0);
  }
  assert.deepEqual(
    db
      .prepare(
        "SELECT m.id FROM inventory_movements m WHERE type='SALE' AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.id=m.related_order_id AND o.status='CLOSED')",
      )
      .all(),
    [],
  );
  assert.deepEqual(
    db
      .prepare(
        'SELECT l.id FROM stock_losses l LEFT JOIN inventory_movements m ON m.id=l.movement_id WHERE m.id IS NULL OR m.product_id!=l.product_id OR m.quantity_delta!=-l.quantity',
      )
      .all(),
    [],
  );
}
export function assertFinancialInvariants(db: Database.Database) {
  const a = independentFinance(db),
    r = services(db).finance.report({ period: 'ALL' });
  assert.equal(r.sales.summary.salesCents, a.revenue);
  assert.equal(r.sales.summary.costCents, a.cogs);
  assert.equal(r.sales.summary.grossProfitCents, a.gross);
  assert.equal(r.sales.summary.expensesCents, a.expense);
  assert.equal(r.stockLossCents, a.loss);
  assert.equal(r.operatingResultCents, a.operating);
  return a;
}
export function assertCashInvariants(db: Database.Database) {
  const sales = new Map<string, bigint>();
  for (const i of db
    .prepare(
      "SELECT o.id,i.quantity,i.unit_price_cents price FROM orders o JOIN order_payments p ON p.order_id=o.id JOIN order_items i ON i.order_id=o.id WHERE o.status='CLOSED' AND p.payment_method='CASH'",
    )
    .iterate() as IterableIterator<{ id: string; quantity: number; price: number }>) {
    sales.set(i.id, (sales.get(i.id) ?? 0n) + BigInt(i.quantity) * BigInt(i.price));
  }
  const revisions = new Map(
    (
      db
        .prepare(
          'SELECT id,previous_revision_id previous,amount_cents amount,paid_from_till paid FROM expense_revisions',
        )
        .all() as { id: string; previous: string | null; amount: number; paid: number | null }[]
    ).map((r) => [r.id, r]),
  );
  const components = new Map<string, Map<string, bigint>>();
  for (const e of db
    .prepare(
      'SELECT session_id session,kind,amount_cents amount,sale_id sale,expense_revision_id revision,request_json request FROM cash_events',
    )
    .iterate() as IterableIterator<{
    session: string;
    kind: string;
    amount: number;
    sale: string | null;
    revision: string | null;
    request: string;
  }>) {
    let expected: bigint;
    if (e.kind === 'CASH_SALE_IN') {
      assert.ok(e.sale && sales.has(e.sale));
      expected = sales.get(e.sale!)!;
    } else if (e.kind === 'OPERATING_EXPENSE_OUT') {
      const r = revisions.get(e.revision!)!;
      assert.ok(r);
      const prior = r.previous ? revisions.get(r.previous) : undefined;
      expected = BigInt(prior?.paid === 1 ? prior.amount : 0) - BigInt(r.paid === 1 ? r.amount : 0);
    } else {
      const request = JSON.parse(e.request) as {
        amountCents: number;
        direction: string;
        drawerPaymentCents: number;
      };
      expected =
        e.kind === 'INVENTORY_SUPPLY_OUT'
          ? -BigInt(request.drawerPaymentCents)
          : BigInt(request.amountCents) * (request.direction === 'OUT' ? -1n : 1n);
    }
    assert.equal(BigInt(e.amount), expected, 'Cash event must match independent business source');
    const group = components.get(e.session) ?? new Map<string, bigint>();
    group.set(e.kind, (group.get(e.kind) ?? 0n) + expected);
    components.set(e.session, group);
  }
  assert.deepEqual(
    db
      .prepare(
        'SELECT count(*) n FROM cash_sessions s WHERE NOT EXISTS(SELECT 1 FROM cash_closes c WHERE c.session_id=s.id) HAVING count(*)>1',
      )
      .all(),
    [],
  );
  for (const c of db.prepare('SELECT * FROM cash_closes').all() as {
    session_id: string;
    opening_cents: number;
    expected_cents: number;
    counted_cents: number;
    difference_cents: number;
    cash_sales_cents: number;
    cash_expenses_cents: number;
    supply_cents: number;
    manual_in_cents: number;
    manual_out_cents: number;
  }[]) {
    const group = components.get(c.session_id) ?? new Map<string, bigint>(),
      value = (kind: string) => group.get(kind) ?? 0n;
    const expected = number(BigInt(c.opening_cents) + sum([...group.values()]));
    assert.equal(c.cash_sales_cents, number(value('CASH_SALE_IN')));
    assert.equal(c.cash_expenses_cents, number(-value('OPERATING_EXPENSE_OUT')));
    assert.equal(c.supply_cents, number(-value('INVENTORY_SUPPLY_OUT')));
    assert.equal(c.manual_in_cents, number(value('MANUAL_CASH_IN')));
    assert.equal(c.manual_out_cents, number(-value('MANUAL_CASH_OUT')));
    assert.equal(c.expected_cents, expected);
    assert.equal(c.difference_cents, number(BigInt(c.counted_cents) - BigInt(expected)));
  }
  const p = services(db).finance.cashPreview({ openingCents: 0 }),
    events = p.sessionId
      ? (db
          .prepare('SELECT amount_cents amount FROM cash_events WHERE session_id=?')
          .all(p.sessionId) as { amount: number }[])
      : [];
  assert.equal(p.expectedCents, number(sum(events.map((e) => e.amount))));
  assert.deepEqual(
    db
      .prepare(
        "SELECT o.id FROM orders o JOIN order_payments p ON p.order_id=o.id WHERE o.status='CLOSED' AND p.payment_method='CASH' AND EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=o.id AND i.unit_price_cents>0) AND NOT EXISTS(SELECT 1 FROM cash_events e WHERE e.sale_id=o.id)",
      )
      .all(),
    [],
  );
}
export function assertReservationInvariants(db: Database.Database) {
  assert.deepEqual(
    db
      .prepare(
        "SELECT t.id FROM cafe_tables t WHERE (t.status='RESERVED') != EXISTS(SELECT 1 FROM table_reservations r WHERE r.table_id=t.id AND r.status='BOOKED')",
      )
      .all(),
    [],
  );
  assert.deepEqual(
    db
      .prepare(
        "SELECT table_id FROM table_reservations WHERE status='BOOKED' GROUP BY table_id HAVING COUNT(*)>1",
      )
      .all(),
    [],
  );
}
export function assertAll(db: Database.Database) {
  assertDatabaseIntegrity(db);
  assertCanonicalPositionInvariants(db);
  assertOrderInvariants(db);
  assertCheckoutInvariants(db);
  assertInventoryInvariants(db);
  assertCashInvariants(db);
  assertReservationInvariants(db);
  return assertFinancialInvariants(db);
}
export function random(seed: number) {
  let state = seed >>> 0;
  return (bound: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % bound;
  };
}

// Proxy exists only under tests/. No production import, switch, API or hook is added.
export function injected(db: Database.Database, pattern: RegExp, when: 'before' | 'after') {
  let fired = false;
  return new Proxy(db, {
    get(target, key) {
      if (key === 'prepare')
        return (sql: string) => {
          const st = target.prepare(sql);
          return new Proxy(st, {
            get(stmt, op) {
              const fn = Reflect.get(stmt, op);
              if (typeof fn !== 'function') return fn;
              return (...args: unknown[]) => {
                const hit = !fired && pattern.test(sql) && ['run', 'get'].includes(String(op));
                if (hit && when === 'before') {
                  fired = true;
                  throw Error('QA_INJECTED');
                }
                const result = fn.apply(stmt, args);
                if (hit && when === 'after') {
                  fired = true;
                  throw Error('QA_INJECTED');
                }
                return result;
              };
            },
          });
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Database.Database;
}
