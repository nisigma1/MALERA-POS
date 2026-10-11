import type Database from 'better-sqlite3';
import type {ExpenseRecord} from '../../src/domain/finance';
// One effective row per expense; original records and every correction remain immutable.
export const effectiveExpenses = `SELECT e.id,COALESCE(r.id,e.id) AS revisionId,COALESCE(r.amount_cents,e.amount_cents) AS amountCents,
 COALESCE(r.category,'OTHER') AS category,COALESCE(r.occurred_at,e.created_at) AS occurredAt,
 COALESCE(r.description,e.description) AS description,COALESCE(r.note,'') AS note,COALESCE(r.paid_from_till,0) AS paidFromTill,
 COALESCE(r.expense_date,e.expense_date) AS expenseDate,COALESCE(r.created_at,e.created_at) AS createdAt,
 CASE WHEN r.previous_revision_id IS NOT NULL THEN 1 ELSE 0 END AS correction
 FROM expenses e LEFT JOIN expense_revisions r ON r.expense_id=e.id
 AND NOT EXISTS(SELECT 1 FROM expense_revisions n WHERE n.previous_revision_id=r.id)`;
export function safeMoney(value:number|bigint):number {const n=Number(value);if(!Number.isSafeInteger(n))throw Error('Shuma tejkalon kufirin e lejuar.');return n;}
export function expenseTotals(db:Database.Database,startDate:string,endDate:string) {
 const current=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='expense_revisions'").get();
 const source=current?effectiveExpenses:'SELECT amount_cents AS amountCents,0 AS paidFromTill,expense_date AS expenseDate FROM expenses';
 const r=db.prepare(`SELECT COALESCE(SUM(amountCents),0) AS total,COALESCE(SUM(CASE WHEN paidFromTill=1 THEN amountCents ELSE 0 END),0) AS cash FROM (${source}) WHERE expenseDate>=? AND expenseDate<?`).get(startDate,endDate) as {total:number;cash:number};safeMoney(r.total);safeMoney(r.cash);return r;
}
export function mapExpense(row:ExpenseRecord):ExpenseRecord {return {...row,paidFromTill:Boolean(row.paidFromTill),correction:Boolean(row.correction)};}
