import { it, expect, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { openDatabase } from '../electron/database/connection';
import {
  assertAll,
  accepted,
  configure,
  services,
  sale,
  snapshot,
  random,
  injected,
} from './support/reliability';

const opened: Database.Database[] = [];
const fresh = () => {
  const db = openDatabase(':memory:');
  opened.push(db);
  configure(db);
  return db;
};
afterEach(() => {
  for (const db of opened.splice(0)) if (db.open) db.close();
});
const expense = () => ({
  requestId: randomUUID(),
  amountCents: 37,
  category: 'OTHER' as const,
  occurredAt: new Date().toISOString(),
  description: 'QA reliability',
  paidFromTill: true,
  note: '',
});
const loss = () => ({
  requestId: randomUUID(),
  productId: 'KAFE-1',
  quantity: 1,
  reason: 'DAMAGED' as const,
  note: '',
});
const cash = (db: Database.Database) => {
  const p = services(db).finance.cashPreview({ openingCents: 10000 });
  return {
    requestId: randomUUID(),
    sessionId: p.sessionId,
    openingCents: 10000,
    countedCents: p.expectedCents,
    expectedFingerprint: p.fingerprint,
    note: '',
  };
};

it('required receipt document and outbox are atomic with the sale', () => {
  const db = fresh(),
    s = services(db);
  s.receipts.saveSettings({
    deviceName: 'QA isolated printer',
    displayName: 'QA',
    autoPrint: true,
    paperWidth: 80,
    copies: 1,
  });
  const order = accepted(s.orders.addProduct({ tableId: 'M5', productId: 'KAFE-1' })).order!;
  const before = snapshot(db);
  db.exec(
    "CREATE TEMP TRIGGER fail_doc BEFORE INSERT ON receipt_documents BEGIN SELECT RAISE(ABORT,'QA'); END",
  );
  expect(s.checkout.completeOrder({ orderId: order.id }).ok).toBe(false);
  expect(snapshot(db)).toEqual(before);
  assertAll(db);
});

for (const boundary of [
  /UPDATE inventory_balances/,
  /INSERT INTO inventory_movements/,
  /INSERT INTO order_payments/,
  /UPDATE orders SET status='CLOSED'/,
  /UPDATE cafe_tables SET status='FREE'/,
  /INSERT INTO receipt_documents/,
  /INSERT INTO receipt_print_jobs/,
])
  for (const when of ['before', 'after'] as const) {
    it(`checkout rollback ${when} ${boundary.source}`, () => {
      const db = fresh(),
        base = services(db);
      base.receipts.saveSettings({
        deviceName: 'QA isolated printer',
        displayName: 'QA',
        autoPrint: true,
        paperWidth: 80,
        copies: 1,
      });
      const order = accepted(base.orders.addProduct({ tableId: 'M5', productId: 'KAFE-1' })).order!;
      const before = snapshot(db),
        s = services(injected(db, boundary, when));
      expect(s.checkout.completeOrder({ orderId: order.id }).ok).toBe(false);
      expect(snapshot(db)).toEqual(before);
      assertAll(db);
      accepted(base.checkout.completeOrder({ orderId: order.id }));
      assertAll(db);
    });
  }
for (const [kind, patterns] of [
  ['expense', [/INSERT INTO expenses/, /INSERT INTO expense_revisions/]],
  [
    'loss',
    [/UPDATE inventory_balances/, /INSERT INTO inventory_movements/, /INSERT INTO stock_losses/],
  ],
  [
    'supply',
    [/INSERT INTO inventory_movements/, /UPDATE inventory_balances/, /INSERT INTO cash_events/],
  ],
  ['close', [/INSERT INTO cash_closes/]],
] as const)
  for (const boundary of patterns)
    for (const when of ['before', 'after'] as const) {
      it(`${kind} rollback ${when} ${boundary.source}`, () => {
        const db = fresh(),
          e = expense(),
          l = loss(),
          supply = {
            requestId: randomUUID(),
            productId: 'KAFE-1',
            quantity: 3,
            drawerPaymentCents: 75,
          },
          close = cash(db),
          before = snapshot(db),
          s = services(injected(db, boundary, when));
        const act = () =>
          kind === 'expense'
            ? s.finance.saveExpense(e)
            : kind === 'loss'
              ? s.finance.recordLoss(l)
              : kind === 'supply'
                ? s.configuration.addSupply(supply)
                : s.finance.closeCash(close);
        try {
          expect(act().ok).toBe(false);
        } catch (error) {
          if (kind !== 'supply' || !(error instanceof Error) || error.message !== 'QA_INJECTED')
            throw error;
        }
        expect(snapshot(db)).toEqual(before);
        assertAll(db);
        const base = services(db);
        accepted(
          kind === 'expense'
            ? base.finance.saveExpense(e)
            : kind === 'loss'
              ? base.finance.recordLoss(l)
              : kind === 'supply'
                ? base.configuration.addSupply(supply)
                : base.finance.closeCash(close),
        );
        assertAll(db);
      });
    }
it.each([2, 5, 10, 25])('backend checkout storm %i has one authoritative effect', async (count) => {
  const db = fresh(),
    s = services(db),
    o = accepted(s.orders.addProduct({ tableId: 'M5', productId: 'KAFE-1' })).order!;
  const results = await Promise.all(
    Array.from({ length: count }, () =>
      Promise.resolve().then(() => s.checkout.completeOrder({ orderId: o.id })),
    ),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(db.prepare('SELECT count(*) n FROM order_payments').get()).toEqual({ n: 1 });
  assertAll(db);
});
it('two stale orders competing for stock1 never deduct below zero', () => {
  const db = openDatabase(':memory:');
  opened.push(db);
  configure(db, 100, 50, 1);
  const s = services(db),
    a = accepted(s.orders.addProduct({ tableId: 'M1', productId: 'KAFE-1' })).order!,
    b = accepted(s.orders.addProduct({ tableId: 'M2', productId: 'KAFE-1' })).order!;
  accepted(s.checkout.completeOrder({ orderId: a.id }));
  expect(s.checkout.completeOrder({ orderId: b.id })).toMatchObject({
    ok: false,
    code: 'INSUFFICIENT_STOCK',
  });
  assertAll(db);
});
it('25 overlapping OPEN creations produce one order, with each deliberate item action', async () => {
  const db = fresh(),
    s = services(db);
  await Promise.all(
    Array.from({ length: 25 }, () =>
      Promise.resolve().then(() =>
        accepted(s.orders.addProduct({ tableId: 'M1', productId: 'KAFE-1' })),
      ),
    ),
  );
  expect(db.prepare("SELECT count(*) n FROM orders WHERE status='OPEN'").get()).toEqual({ n: 1 });
  expect(s.orders.getForTable('M1').order?.items[0]?.quantity).toBe(25);
  assertAll(db);
});
it.each(['expense', 'loss', 'close'] as const)(
  '%s committed response lost and 25 retries are idempotent',
  (kind) => {
    const db = fresh(),
      s = services(db),
      e = expense(),
      l = loss(),
      c = cash(db);
    const act = () =>
      kind === 'expense'
        ? s.finance.saveExpense(e)
        : kind === 'loss'
          ? s.finance.recordLoss(l)
          : s.finance.closeCash(c);
    accepted(act());
    const committed = snapshot(db);
    for (let i = 0; i < 25; i++) accepted(act());
    expect(snapshot(db)).toEqual(committed);
    assertAll(db);
  },
);
it.each([1, 99, 100, 9999, 99999, 999999, 9999999, Math.floor(Number.MAX_SAFE_INTEGER / 4)])(
  'exact boundary cents %i',
  (price) => {
    const db = openDatabase(':memory:');
    opened.push(db);
    configure(db, price, Math.floor(price / 2), 5);
    sale(db, 'M13', 2);
    expect(assertAll(db).revenue).toBe(price * 2);
  },
);
it('large quantity price/cost reject overflow without a partial sale', () => {
  const db = openDatabase(':memory:');
  opened.push(db);
  configure(db, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 5);
  const s = services(db),
    v = accepted(s.orders.addProduct({ tableId: 'M5', productId: 'KAFE-1' }));
  const before = snapshot(db);
  expect(s.orders.incrementItem({ tableId: 'M5', itemId: v.order!.items[0]!.id }).ok).toBe(false);
  expect(snapshot(db)).toEqual(before);
  assertAll(db);
});
it('1000 generated scenarios reconcile independent cents and inventory after each operation sequence', () => {
  const seed = 0xf0102026,
    next = random(seed),
    start = performance.now();
  const samples: number[] = [];
  for (let index = 0; index < 1000; index++) {
    const db = openDatabase(':memory:');
    const trace: unknown[] = [];
    try {
      const t = performance.now(),
        price = 1 + next(10000),
        cost = next(7) === 0 ? null : next(5000),
        quantity = 1 + next(5),
        lossQty = 1 + next(3),
        amount = 1 + next(1000),
        drawer = next(2) === 1;
      trace.push({ price, cost, quantity, lossQty, amount, drawer });
      configure(db, price, cost, 30);
      const s = services(db);
      sale(db, 'M5', quantity);
      accepted(
        s.configuration.addSupply({
          requestId: randomUUID(),
          productId: 'KAFE-1',
          quantity: 7,
          drawerPaymentCents: 300,
        }),
      );
      accepted(s.finance.saveExpense({ ...expense(), amountCents: amount, paidFromTill: drawer }));
      accepted(s.finance.recordLoss({ ...loss(), quantity: lossQty }));
      accepted(
        s.finance.recordCashMovement({
          requestId: randomUUID(),
          direction: 'IN',
          amountCents: 99,
          reason: 'QA',
          note: '',
        }),
      );
      accepted(
        s.finance.recordCashMovement({
          requestId: randomUUID(),
          direction: 'OUT',
          amountCents: 11,
          reason: 'QA',
          note: '',
        }),
      );
      const before = snapshot(db);
      const b = accepted(
        s.reservations.reserve({
          requestId: randomUUID(),
          tableId: 'M13',
          customerName: 'QA',
          phone: '',
          startsAt: '2099-01-01T10:00:00.000Z',
          guests: 2,
          note: '',
        }),
      );
      accepted(s.reservations.cancel({ tableId: 'M13', reservationId: b.reservation!.id }));
      const after = snapshot(db);
      for (const key of Object.keys(before))
        if (!['cafe_tables', 'table_reservations'].includes(key))
          expect(after[key]).toEqual(before[key]);
      const expectedRevenue = price * quantity,
        expectedCost = cost === null ? null : cost * quantity,
        expectedLoss = cost === null ? null : cost * lossQty;
      expect(assertAll(db)).toEqual({
        revenue: expectedRevenue,
        cogs: expectedCost,
        gross: expectedCost === null ? null : expectedRevenue - expectedCost,
        expense: amount,
        loss: expectedLoss,
        operating:
          expectedCost === null || expectedLoss === null
            ? null
            : expectedRevenue - expectedCost - amount - expectedLoss,
      });
      const p = s.finance.cashPreview({
        openingCents: 10000,
        countedCents: 10000 + expectedRevenue - (drawer ? amount : 0) - 300 + 99 - 11 - 2,
      });
      expect(p.expectedCents).toBe(10000 + expectedRevenue - (drawer ? amount : 0) - 300 + 99 - 11);
      expect(p.differenceCents).toBe(-2);
      accepted(s.finance.closeCash({ ...cash(db), countedCents: p.expectedCents - 2 }));
      assertAll(db);
      samples.push(performance.now() - t);
    } catch (error) {
      throw Error(JSON.stringify({ seed, index, trace, cause: String(error) }), { cause: error });
    } finally {
      db.close();
    }
  }
  samples.sort((a, b) => a - b);
  fs.mkdirSync('outputs', { recursive: true });
  fs.writeFileSync(
    'outputs/fox-phase10-property-tests.json',
    JSON.stringify(
      {
        passed: true,
        seed,
        scenarios: 1000,
        totalMs: performance.now() - start,
        p50: samples[500],
        p95: samples[950],
        max: samples[999],
        independentOracle:
          'integer cents; independent financial and cash formulas; stock movement ledger; no tolerances',
      },
      null,
      2,
    ),
  );
}, 120000);
