import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  EXPENSE_CATEGORIES,
  LOSS_REASONS,
  financeBounds,
  localDate,
  validDate,
  type CashClose,
  type CashInput,
  type CashPreview,
  type CashEvent,
  type CashMovementInput,
  type ExpenseInput,
  type ExpenseRecord,
  type FinanceReport,
  type LossInput,
  type LossRecord,
} from '../../src/domain/finance';
import type { MutationResult } from '../../src/domain/configuration';
import { readSalesReport } from './salesReports';
import { COFFEE_STOCK_ID, coffeePortions, isCoffee } from '../../src/domain/operators';
import { effectiveExpenses, mapExpense, safeMoney } from './financeQueries';
import { logError } from '../main/logging';
import { exactQuantity, exactQuantityCost, assertCashTotals } from './numericSafety';
import {
  prepareFinancialCapacity,
  sealFinancialCapacity,
  commitFinancialCapacity,
  type FinancialCapacity,
} from './financialCapacity';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireInput(input: unknown, keys: string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    throw Error('Kërkesa nuk është e vlefshme.');
  return input as Record<string, unknown>;
}
function money(n: unknown, positive = false): asserts n is number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < (positive ? 1 : 0))
    throw Error('Vendos një shumë të vlefshme në euro.');
}
function text(n: unknown, max = 500): asserts n is string {
  if (typeof n !== 'string' || n.length > max)
    throw Error('Teksti është jashtë kufirit të lejuar.');
}
function token(n: unknown): asserts n is string {
  if (typeof n !== 'string' || !UUID.test(n)) throw Error('Identifikuesi nuk është i vlefshëm.');
}
function result<T>(action: () => T): MutationResult<T> {
  try {
    return { ok: true, data: action() };
  } catch (e) {
    logError('FINANCE_MUTATION', e);
    const message =
      e instanceof Error &&
      !/SQLITE|constraint|trigger|immutable|matching|requires|FOREIGN|UNIQUE/i.test(e.message)
        ? e.message
        : 'Veprimi nuk u ruajt. Gjendja e mëparshme është ruajtur.';
    return { ok: false, message, errors: { form: message } };
  }
}
const cashSelect = `SELECT id,session_id AS sessionId,business_date AS businessDate,opening_cents AS openingCents,cash_sales_cents AS cashSalesCents,cash_expenses_cents AS cashExpensesCents,supply_cents AS supplyCents,manual_in_cents AS manualInCents,manual_out_cents AS manualOutCents,expected_cents AS expectedCents,counted_cents AS countedCents,difference_cents AS differenceCents,status,created_at AS createdAt,note,fingerprint FROM cash_closes`;
const eventSelect = `SELECT id,kind,amount_cents AS amountCents,reason,note,created_at AS createdAt FROM cash_events`;
const lossSelect = `SELECT id,product_id AS productId,product_name_snapshot AS name,quantity,reason,note,unit_cost_cents AS unitCostCents,total_cost_cents AS totalCostCents,occurred_at AS occurredAt FROM stock_losses`;
export function createFinanceService(
  db: Database.Database,
  clock: () => Date = () => new Date(),
  duo = false,
) {
  const expense = (id: string) =>
    mapExpense(
      db.prepare(`SELECT * FROM (${effectiveExpenses}) WHERE id=?`).get(id) as ExpenseRecord,
    );
  function cashPreview(input: unknown): CashPreview {
    const q = requireInput(input, ['openingCents', 'countedCents']);
    money(q.openingCents);
    if (q.countedCents !== undefined) money(q.countedCents);
    return db.transaction(() => {
      const session = db
        .prepare(
          'SELECT id,started_at FROM cash_sessions s WHERE NOT EXISTS(SELECT 1 FROM cash_closes c WHERE c.session_id=s.id)',
        )
        .get() as { id: string; started_at: string } | undefined;
      const events = session
        ? (db
            .prepare(`${eventSelect} WHERE session_id=? ORDER BY rowid`)
            .all(session.id) as CashEvent[])
        : [];
      const sum = (kind: CashEvent['kind']) =>
        safeMoney(
          events.filter((e) => e.kind === kind).reduce((n, e) => n + BigInt(e.amountCents), 0n),
        );
      const cashSalesCents = sum('CASH_SALE_IN'),
        cashExpensesCents = -sum('OPERATING_EXPENSE_OUT'),
        supplyCents = -sum('INVENTORY_SUPPLY_OUT'),
        manualInCents = sum('MANUAL_CASH_IN'),
        manualOutCents = -sum('MANUAL_CASH_OUT');
      const expectedCents = safeMoney(
        BigInt(q.openingCents as number) +
          BigInt(cashSalesCents) +
          BigInt(manualInCents) -
          BigInt(cashExpensesCents) -
          BigInt(supplyCents) -
          BigInt(manualOutCents),
      );
      const lastClose = db.prepare(`${cashSelect} ORDER BY rowid DESC LIMIT 1`).get() as
        | CashClose
        | undefined;
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            session: session?.id ?? null,
            opening: q.openingCents,
            lastClose: lastClose?.id ?? null,
            events,
          }),
        )
        .digest('hex');
      const openOrderCount = (
        db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='OPEN'").get() as { n: number }
      ).n;
      const differenceCents =
        q.countedCents === undefined
          ? null
          : safeMoney(BigInt(q.countedCents as number) - BigInt(expectedCents));
      return {
        differenceCents,
        varianceStatus:
          differenceCents === null
            ? null
            : differenceCents === 0
              ? ('MATCHED' as const)
              : differenceCents < 0
                ? ('SHORT' as const)
                : ('OVER' as const),
        sessionId: session?.id ?? null,
        startedAt: session?.started_at ?? null,
        openingCents: q.openingCents as number,
        cashSalesCents,
        cashExpensesCents,
        supplyCents,
        manualInCents,
        manualOutCents,
        expectedCents,
        fingerprint,
        lastClose: lastClose ?? null,
        openOrderCount,
        events,
      };
    })();
  }
  return {
    report(input: unknown): FinanceReport {
      return db.transaction(() => {
        const b = financeBounds(input, clock()),
          sales = readSalesReport(db, input, clock());
        const loss = db
          .prepare(
            'SELECT COALESCE(SUM(total_cost_cents),0) AS known,COUNT(CASE WHEN total_cost_cents IS NULL THEN 1 END) AS missing,COUNT(*) AS count FROM stock_losses WHERE business_date>=? AND business_date<?',
          )
          .get(b.startDate, b.endDateExclusive) as {
          known: number;
          missing: number;
          count: number;
        };
        safeMoney(loss.known);
        const stockLossCents = loss.missing ? null : loss.known,
          gross = sales.summary.grossProfitCents,
          operatingResultCents =
            gross === null || stockLossCents === null
              ? null
              : safeMoney(
                  BigInt(gross) - BigInt(sales.summary.expensesCents) - BigInt(stockLossCents),
                );
        const expenses = (
          db
            .prepare(
              `SELECT * FROM (${effectiveExpenses}) WHERE expenseDate>=? AND expenseDate<? ORDER BY expenseDate DESC,occurredAt DESC,id LIMIT 100`,
            )
            .all(b.startDate, b.endDateExclusive) as ExpenseRecord[]
        ).map(mapExpense);
        const expenseCount = (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM (${effectiveExpenses}) WHERE expenseDate>=? AND expenseDate<?`,
            )
            .get(b.startDate, b.endDateExclusive) as { n: number }
        ).n;
        const closes = db
          .prepare(
            `${cashSelect} WHERE business_date>=? AND business_date<? ORDER BY business_date DESC,created_at DESC,rowid DESC LIMIT 100`,
          )
          .all(b.startDate, b.endDateExclusive) as CashClose[];
        const closeCount = (
          db
            .prepare(
              'SELECT COUNT(*) AS n FROM cash_closes WHERE business_date>=? AND business_date<?',
            )
            .get(b.startDate, b.endDateExclusive) as { n: number }
        ).n;
        const expenseCategories = db
          .prepare(
            `SELECT category,SUM(amountCents) AS amountCents FROM (${effectiveExpenses}) WHERE expenseDate>=? AND expenseDate<? GROUP BY category`,
          )
          .all(b.startDate, b.endDateExclusive) as FinanceReport['expenseCategories'];
        for (const e of expenseCategories) safeMoney(e.amountCents);
        return {
          expenseCategories,
          completeness:
            operatingResultCents === null
              ? ('INCOMPLETE_COST_DATA' as const)
              : ('COMPLETE' as const),
          sales,
          stockLossCents,
          missingLossCosts: loss.missing,
          operatingResultCents,
          expenses,
          expenseCount,
          lossCount: loss.count,
          closes,
          closeCount,
          losses: db
            .prepare(
              `${lossSelect} WHERE business_date>=? AND business_date<? ORDER BY occurred_at DESC,id LIMIT 100`,
            )
            .all(b.startDate, b.endDateExclusive) as LossRecord[],
          startDate: b.startDate,
          endDate: b.endDate,
        };
      })();
    },
    expenseHistory(input: unknown): ExpenseRecord[] {
      text(input, 200);
      return (
        db
          .prepare(
            `SELECT expense_id AS id,id AS revisionId,amount_cents AS amountCents,category,occurred_at AS occurredAt,description,note,paid_from_till AS paidFromTill,created_at AS createdAt,previous_revision_id IS NOT NULL AS correction FROM expense_revisions WHERE expense_id=? ORDER BY rowid`,
          )
          .all(input) as ExpenseRecord[]
      ).map(mapExpense);
    },
    saveExpense(input: unknown): MutationResult<ExpenseRecord> {
      return result(() => {
        const v = requireInput(input, [
          'requestId',
          'amountCents',
          'category',
          'occurredAt',
          'description',
          'paidFromTill',
          'note',
          'expenseId',
          'expectedRevision',
        ]);
        token(v.requestId);
        money(v.amountCents, true);
        text(v.description);
        if (v.note !== undefined) text(v.note);
        if (
          !(typeof v.category === 'string' && Object.hasOwn(EXPENSE_CATEGORIES, v.category)) ||
          typeof v.paidFromTill !== 'boolean'
        )
          throw Error('Zgjidh kategorinë dhe mënyrën e pagesës nga kasa.');
        if (
          typeof v.occurredAt !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.occurredAt) ||
          !Number.isFinite(Date.parse(v.occurredAt))
        )
          throw Error('Vendos datën dhe orën e vlefshme.');
        const time = new Date(v.occurredAt);
        if (time.toISOString() !== v.occurredAt || !validDate(localDate(time)) || time > clock())
          throw Error('Data e shpenzimit duhet të jetë sot ose më herët.');
        if (v.expenseId !== undefined) {
          text(v.expenseId, 200);
          text(v.expectedRevision, 200);
        } else if (v.expectedRevision !== undefined)
          throw Error('Korrigjimi kërkon shpenzimin origjinal.');
        const request = JSON.stringify(v),
          value = v as unknown as ExpenseInput;
        let capacity: FinancialCapacity | undefined;
        const saved = db
          .transaction(() => {
            const existing = db
              .prepare('SELECT expense_id,request_json FROM expense_revisions WHERE id=?')
              .get(value.requestId) as { expense_id: string; request_json: string } | undefined;
            if (existing) {
              if (existing.request_json !== request)
                throw Error('Ky veprim është regjistruar me të dhëna të tjera.');
              return expense(existing.expense_id);
            }
            let previous: string | null = null;
            const id = value.expenseId ?? value.requestId,
              now = clock().toISOString();
            if (value.expenseId && !db.prepare('SELECT 1 FROM expenses WHERE id=?').get(id))
              throw Error('Shpenzimi nuk u gjet.');
            capacity = prepareFinancialCapacity(db, {
              expense:
                BigInt(value.amountCents) - BigInt(value.expenseId ? expense(id).amountCents : 0),
            });
            if (value.expenseId) {
              const original = db.prepare('SELECT * FROM expenses WHERE id=?').get(id) as
                | {
                    amount_cents: number;
                    description: string;
                    created_at: string;
                    expense_date: string;
                  }
                | undefined;
              if (!original) throw Error('Shpenzimi nuk u gjet.');
              const current = expense(id);
              if (current.revisionId !== value.expectedRevision)
                throw Error('Shpenzimi ka ndryshuar. Rifresko para korrigjimit.');
              previous = current.revisionId;
              if (!db.prepare('SELECT 1 FROM expense_revisions WHERE id=?').get(previous)) {
                previous = randomUUID();
                db.prepare(
                  'INSERT INTO expense_revisions(id,expense_id,previous_revision_id,amount_cents,category,occurred_at,expense_date,description,paid_from_till,created_at,request_json) VALUES (?,?,NULL,?,?,?,?,?,?,?,?)',
                ).run(
                  previous,
                  id,
                  original.amount_cents,
                  'OTHER',
                  original.created_at,
                  original.expense_date,
                  original.description,
                  null,
                  now,
                  'legacy-original',
                );
              }
            } else
              db.prepare('INSERT INTO expenses VALUES (?,?,?,?,?)').run(
                id,
                value.amountCents,
                value.description.trim() || EXPENSE_CATEGORIES[value.category],
                localDate(time),
                now,
              );
            db.prepare(
              'INSERT INTO expense_revisions(id,expense_id,previous_revision_id,amount_cents,category,occurred_at,expense_date,description,paid_from_till,created_at,request_json,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            ).run(
              value.requestId,
              id,
              previous,
              value.amountCents,
              value.category,
              value.occurredAt,
              localDate(time),
              value.description.trim(),
              Number(value.paidFromTill),
              now,
              request,
              value.note?.trim() ?? '',
            );
            assertCashTotals(db);
            sealFinancialCapacity(db, capacity);
            return expense(id);
          })
          .immediate();
        commitFinancialCapacity(db, capacity);
        return saved;
      });
    },
    recordLoss(input: unknown): MutationResult<LossRecord> {
      return result(() => {
        const v = requireInput(input, ['requestId', 'productId', 'quantity', 'reason', 'note']);
        token(v.requestId);
        text(v.productId, 200);
        text(v.note);
        if (typeof v.reason !== 'string' || !Object.hasOwn(LOSS_REASONS, v.reason))
          throw Error('Zgjidh arsyen e humbjes.');
        if (
          typeof v.quantity !== 'number' ||
          !Number.isFinite(v.quantity) ||
          v.quantity <= 0 ||
          v.quantity > Number.MAX_SAFE_INTEGER
        )
          throw Error('Sasia duhet të jetë më e madhe se zero.');
        const inputValue = v as unknown as LossInput;
        const coffee = duo && isCoffee(inputValue.productId);
        if (coffee && inputValue.productId !== COFFEE_STOCK_ID)
          throw Error('Përdor stokun e përbashkët të kafesë.');
        const value = coffee
          ? { ...inputValue, quantity: coffeePortions(inputValue.quantity) }
          : inputValue;
        const request = JSON.stringify(v);
        let capacity: FinancialCapacity | undefined;
        const saved = db
          .transaction(() => {
            const existing = db
              .prepare('SELECT request_json FROM stock_losses WHERE id=?')
              .get(value.requestId) as { request_json: string } | undefined;
            if (existing) {
              if (existing.request_json !== request)
                throw Error('Ky veprim është regjistruar me të dhëna të tjera.');
              return db.prepare(`${lossSelect} WHERE id=?`).get(value.requestId) as LossRecord;
            }
            const p = db
              .prepare(
                'SELECT p.name,p.purchase_cost_cents AS cost,p.track_inventory AS tracking,b.quantity FROM products p JOIN inventory_balances b ON b.product_id=p.id WHERE p.id=?',
              )
              .get(value.productId) as
              | {
                  name: string;
                  cost: number | null;
                  tracking: number | null;
                  quantity: number | null;
                }
              | undefined;
            if (!p || p.tracking !== 1) throw Error('Zgjidh produkt me ndjekje stoku.');
            if (p.quantity === null) throw Error('Stoku është pa vendosur.');
            if (p.quantity < value.quantity || p.quantity - value.quantity === p.quantity)
              throw Error('Stok i pamjaftueshëm ose sasi jashtë kufirit.');
            const balance = exactQuantity(p.quantity, value.quantity, true);
            const total =
              p.cost === null
                ? null
                : coffee
                  ? Number((BigInt(Math.round(value.quantity * 100)) * BigInt(p.cost) + 50n) / 100n)
                  : exactQuantityCost(value.quantity, p.cost);
            if (total !== null && !Number.isSafeInteger(total))
              throw Error('Kostoja është jashtë kufirit të lejuar.');
            capacity = prepareFinancialCapacity(db, {
              loss: BigInt(total ?? 0),
              missingLoss: total === null ? 1n : 0n,
            });
            const now = clock(),
              stamp = now.toISOString();
            const update = db
              .prepare(
                'UPDATE inventory_balances SET quantity=?,updated_at=? WHERE product_id=? AND quantity>=?',
              )
              .run(balance, stamp, value.productId, value.quantity);
            if (update.changes !== 1)
              throw Error('Stoku ka ndryshuar. Rifresko dhe provo përsëri.');
            db.prepare(
              "INSERT INTO inventory_movements VALUES (?,?,'MANUAL_ADJUSTMENT',?,NULL,?,?)",
            ).run(
              value.requestId,
              value.productId,
              -value.quantity,
              `Humbje malli: ${LOSS_REASONS[value.reason]}${value.note ? ' — ' + value.note : ''}`,
              stamp,
            );
            db.prepare('INSERT INTO stock_losses VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
              value.requestId,
              value.productId,
              p.name,
              value.quantity,
              value.reason,
              value.note.trim(),
              p.cost,
              total,
              value.requestId,
              stamp,
              localDate(now),
              request,
            );
            sealFinancialCapacity(db, capacity);
            return db.prepare(`${lossSelect} WHERE id=?`).get(value.requestId) as LossRecord;
          })
          .immediate();
        commitFinancialCapacity(db, capacity);
        return saved;
      });
    },
    cashPreview,
    recordCashMovement(input: unknown): MutationResult<CashEvent> {
      return result(() => {
        const v = requireInput(input, ['requestId', 'direction', 'amountCents', 'reason', 'note']);
        token(v.requestId);
        money(v.amountCents, true);
        text(v.reason, 200);
        text(v.note);
        if (!['IN', 'OUT'].includes(v.direction as string) || !(v.reason as string).trim())
          throw Error('Zgjidh hyrje/dalje dhe shkruaj arsyen.');
        const value = v as unknown as CashMovementInput,
          request = JSON.stringify(v);
        return db
          .transaction(() => {
            const prior = db
              .prepare('SELECT request_json FROM cash_events WHERE id=?')
              .get(value.requestId) as { request_json: string } | undefined;
            if (prior) {
              if (prior.request_json !== request)
                throw Error('Ky veprim është regjistruar me të dhëna të tjera.');
              return db.prepare(`${eventSelect} WHERE id=?`).get(value.requestId) as CashEvent;
            }
            const now = clock().toISOString();
            db.prepare(
              'INSERT INTO cash_sessions SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM cash_sessions s WHERE NOT EXISTS(SELECT 1 FROM cash_closes c WHERE c.session_id=s.id))',
            ).run(randomUUID(), now);
            db.prepare(
              `INSERT INTO cash_events(id,session_id,kind,amount_cents,reason,note,created_at,request_json) SELECT ?,id,?,?,?,?,?,? FROM cash_sessions s WHERE NOT EXISTS(SELECT 1 FROM cash_closes c WHERE c.session_id=s.id)`,
            ).run(
              value.requestId,
              value.direction === 'IN' ? 'MANUAL_CASH_IN' : 'MANUAL_CASH_OUT',
              value.amountCents * (value.direction === 'IN' ? 1 : -1),
              value.reason.trim(),
              value.note.trim(),
              now,
              request,
            );
            assertCashTotals(db);
            return db.prepare(`${eventSelect} WHERE id=?`).get(value.requestId) as CashEvent;
          })
          .immediate();
      });
    },
    closeCash(input: unknown): MutationResult<CashClose> {
      return result(() => {
        const v = requireInput(input, [
          'requestId',
          'sessionId',
          'openingCents',
          'countedCents',
          'expectedFingerprint',
          'note',
        ]);
        token(v.requestId);
        money(v.openingCents);
        money(v.countedCents);
        text(v.note);
        if (v.sessionId !== null) text(v.sessionId, 200);
        if (
          typeof v.expectedFingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/.test(v.expectedFingerprint)
        )
          throw Error('Rifresko përmbledhjen e arkës.');
        const value = v as unknown as CashInput,
          request = JSON.stringify(v);
        return db
          .transaction(() => {
            const existing = db
              .prepare('SELECT request_json FROM cash_closes WHERE id=?')
              .get(value.requestId) as { request_json: string } | undefined;
            if (existing) {
              if (existing.request_json !== request)
                throw Error('Ky veprim është regjistruar me të dhëna të tjera.');
              return db.prepare(`${cashSelect} WHERE id=?`).get(value.requestId) as CashClose;
            }
            const preview = cashPreview({ openingCents: value.openingCents });
            if (preview.openOrderCount)
              throw Error('Ka porosi aktive. Mbylli ose anuloji para mbylljes së arkës.');
            if (
              preview.sessionId !== value.sessionId ||
              preview.fingerprint !== value.expectedFingerprint
            )
              throw Error('Arka ka ndryshuar. Rifresko para konfirmimit.');
            const stamp = clock(),
              sessionId = preview.sessionId ?? randomUUID();
            if (!preview.sessionId)
              db.prepare('INSERT INTO cash_sessions VALUES (?,?)').run(
                sessionId,
                stamp.toISOString(),
              );
            const difference = safeMoney(
                BigInt(value.countedCents) - BigInt(preview.expectedCents),
              ),
              status = difference === 0 ? 'MATCHED' : difference < 0 ? 'SHORT' : 'OVER';
            db.prepare('INSERT INTO cash_closes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
              value.requestId,
              sessionId,
              localDate(stamp),
              value.openingCents,
              preview.cashSalesCents,
              preview.cashExpensesCents,
              preview.supplyCents,
              preview.manualInCents,
              preview.manualOutCents,
              preview.expectedCents,
              value.countedCents,
              difference,
              status,
              stamp.toISOString(),
              value.note.trim(),
              preview.fingerprint,
              request,
            );
            return db.prepare(`${cashSelect} WHERE id=?`).get(value.requestId) as CashClose;
          })
          .immediate();
      });
    },
  };
}
