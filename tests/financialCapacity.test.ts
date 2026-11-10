import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../electron/database/connection';
import { services, accepted, configure, sale, snapshot, assertAll } from './support/reliability';
const expense = (amountCents: number) => ({
  requestId: randomUUID(),
  amountCents,
  category: 'OTHER' as const,
  occurredAt: new Date().toISOString(),
  description: 'QA',
  paidFromTill: false,
  note: '',
});
it('capacity cache detects append-only SQL changes on its own connection', () => {
  const db = openDatabase(':memory:');
  try {
    const s = services(db);
    accepted(s.finance.saveExpense(expense(1)));
    db.prepare('INSERT INTO expenses VALUES (?,?,?,?,?)').run(
      'QA legacy',
      Number.MAX_SAFE_INTEGER - 1,
      'QA',
      '2026-10-12',
      new Date().toISOString(),
    );
    const before = snapshot(db);
    expect(s.finance.saveExpense(expense(1)).ok).toBe(false);
    expect(snapshot(db)).toEqual(before);
    expect(s.finance.report({ period: 'ALL' }).operatingResultCents).toBe(-Number.MAX_SAFE_INTEGER);
  } finally {
    db.close();
  }
});
it('capacity cache observes another operational connection before accepting a mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fox-capacity-')),
    file = path.join(root, 'fox.sqlite'),
    db = openDatabase(file),
    peer = openDatabase(file);
  try {
    accepted(services(db).finance.saveExpense(expense(1)));
    accepted(services(peer).finance.saveExpense(expense(Number.MAX_SAFE_INTEGER - 1)));
    const before = snapshot(db);
    expect(services(db).finance.saveExpense(expense(1)).ok).toBe(false);
    expect(snapshot(db)).toEqual(before);
  } finally {
    peer.close();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it('rolled-back checkout never advances the financial capacity cache', () => {
  const db = openDatabase(':memory:');
  try {
    configure(db);
    sale(db);
    const s = services(db),
      o = accepted(s.orders.addProduct({ tableId: 'M5', productId: 'KAFE-1' })).order!,
      before = snapshot(db);
    db.exec(
      "CREATE TEMP TRIGGER fail_checkout BEFORE INSERT ON receipt_documents BEGIN SELECT RAISE(ABORT,'QA');END",
    );
    expect(s.checkout.completeOrder({ orderId: o.id }).ok).toBe(false);
    expect(snapshot(db)).toEqual(before);
    db.exec('DROP TRIGGER fail_checkout');
    accepted(s.checkout.completeOrder({ orderId: o.id }));
    expect(assertAll(db).revenue).toBe(200);
  } finally {
    db.close();
  }
});
it('effective expense correction frees capacity without changing historical originals', () => {
  const db = openDatabase(':memory:');
  try {
    const s = services(db),
      e = expense(Number.MAX_SAFE_INTEGER);
    accepted(s.finance.saveExpense(e));
    accepted(
      s.finance.saveExpense({
        ...expense(Number.MAX_SAFE_INTEGER - 1),
        expenseId: e.requestId,
        expectedRevision: e.requestId,
      }),
    );
    accepted(s.finance.saveExpense(expense(1)));
    expect(s.finance.report({ period: 'ALL' }).sales.summary.expensesCents).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(db.prepare('SELECT amount_cents n FROM expenses WHERE id=?').get(e.requestId)).toEqual({
      n: Number.MAX_SAFE_INTEGER,
    });
  } finally {
    db.close();
  }
});
it('normal serial checkout capacity checks do not rescan all historical sales', () => {
  const db = openDatabase(':memory:');
  try {
    configure(db);
    const original = db.prepare.bind(db);
    let scans = 0;
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      if (sql.startsWith('SELECT COALESCE(SUM(i.quantity*i.unit_price_cents),0) revenue')) scans++;
      return original(sql);
    });
    for (let i = 0; i < 20; i++) sale(db);
    expect(scans).toBe(1);
    assertAll(db);
  } finally {
    vi.restoreAllMocks();
    db.close();
  }
});
