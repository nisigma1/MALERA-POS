import type Database from 'better-sqlite3';
export { exactQuantity, exactQuantityCost } from '../../src/domain/quantity';

export function assertCashTotals(db: Database.Database): void {
  // Legacy migration fixtures predate the cash domain. Operational connections
  // are always inspected/migrated before commands and must have the current schema.
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='cash_events'").get())
    return;
  const groups = db
    .prepare(
      `SELECT kind,SUM(amount_cents) amount FROM cash_events WHERE session_id IN
 (SELECT id FROM cash_sessions s WHERE NOT EXISTS(SELECT 1 FROM cash_closes c WHERE c.session_id=s.id)) GROUP BY kind`,
    )
    .safeIntegers()
    .all() as { kind: string; amount: bigint }[];
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  let total = 0n;
  for (const group of groups) {
    if (group.amount > limit || group.amount < -limit)
      throw Error('Shuma tejkalon kufirin e lejuar.');
    total += group.amount;
  }
  if (total > limit || total < -limit) throw Error('Shuma tejkalon kufirin e lejuar.');
}
