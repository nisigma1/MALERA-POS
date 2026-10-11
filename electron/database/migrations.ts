import type Database from 'better-sqlite3';
import { SERVICE_POSITIONS } from '../../src/domain/definitions';

// These constants are application-owned, never renderer input.
const allowedCodes = SERVICE_POSITIONS.map(position => `'${position.code}'`).join(',');
const areaRules = (['MAIN', 'BAR', 'TERRACE'] as const).map(area =>
  `(area = '${area}' AND code IN (${SERVICE_POSITIONS.filter(p => p.area === area).map(p => `'${p.code}'`).join(',')}))`,
).join(' OR ');
const moneyCheck = 'BETWEEN 0 AND 9007199254740991';
export const migrations = [{ version: 1, sql: `
CREATE TABLE cafe_tables (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK(code IN (${allowedCodes})),
  area TEXT NOT NULL CHECK(${areaRules}),
  status TEXT NOT NULL DEFAULT 'FREE' CHECK(status IN ('FREE','ACTIVE','AWAITING_PAYMENT','RESERVED')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE categories (
  id TEXT PRIMARY KEY CHECK(id IN ('KAFE','CAJ','PIJE','UJE','ALKOOL')),
  name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) > 0), sort_order INTEGER NOT NULL
) STRICT;
CREATE TABLE products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  category_id TEXT NOT NULL REFERENCES categories(id),
  selling_price_cents INTEGER CHECK(selling_price_cents ${moneyCheck}),
  purchase_cost_cents INTEGER CHECK(purchase_cost_cents ${moneyCheck}),
  track_inventory INTEGER CHECK(track_inventory IN (0,1)),
  low_stock_threshold REAL CHECK(low_stock_threshold >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE orders (
  id TEXT PRIMARY KEY, table_id TEXT NOT NULL REFERENCES cafe_tables(id),
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED','CANCELLED')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT,
  CHECK((status = 'CLOSED' AND closed_at IS NOT NULL) OR (status != 'CLOSED' AND closed_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX one_open_order_per_table ON orders(table_id) WHERE status = 'OPEN';
CREATE TABLE order_items (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL CHECK(length(trim(product_name_snapshot)) > 0),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents ${moneyCheck}),
  unit_cost_cents INTEGER CHECK(unit_cost_cents ${moneyCheck}), created_at TEXT NOT NULL
) STRICT;
CREATE INDEX order_items_by_order ON order_items(order_id);
CREATE TABLE inventory_balances (
  product_id TEXT PRIMARY KEY REFERENCES products(id), quantity REAL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK(type IN ('SUPPLY','SALE','MANUAL_ADJUSTMENT','REVERSAL')),
  quantity_delta REAL NOT NULL CHECK(quantity_delta != 0),
  related_order_id TEXT REFERENCES orders(id), note TEXT, created_at TEXT NOT NULL,
  CHECK(type != 'SALE' OR (related_order_id IS NOT NULL AND quantity_delta < 0))
) STRICT;
CREATE UNIQUE INDEX one_sale_movement_per_product_order
  ON inventory_movements(related_order_id, product_id) WHERE type = 'SALE';
CREATE TABLE expenses (
  id TEXT PRIMARY KEY, amount_cents INTEGER NOT NULL CHECK(amount_cents ${moneyCheck}),
  description TEXT NOT NULL CHECK(length(trim(description)) > 0),
  expense_date TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;

-- Completed transaction history and inventory audit records are append-only.
CREATE TRIGGER closed_order_no_update BEFORE UPDATE ON orders WHEN OLD.status = 'CLOSED'
BEGIN SELECT RAISE(ABORT, 'Closed orders are immutable'); END;
CREATE TRIGGER closed_order_no_delete BEFORE DELETE ON orders WHEN OLD.status = 'CLOSED'
BEGIN SELECT RAISE(ABORT, 'Closed orders are immutable'); END;
CREATE TRIGGER order_item_insert_open BEFORE INSERT ON order_items
WHEN COALESCE((SELECT status FROM orders WHERE id = NEW.order_id), '') != 'OPEN'
BEGIN SELECT RAISE(ABORT, 'Items require an open order'); END;
CREATE TRIGGER order_item_update_open BEFORE UPDATE ON order_items
WHEN COALESCE((SELECT status FROM orders WHERE id = OLD.order_id), '') != 'OPEN'
  OR COALESCE((SELECT status FROM orders WHERE id = NEW.order_id), '') != 'OPEN'
BEGIN SELECT RAISE(ABORT, 'Items require an open order'); END;
CREATE TRIGGER order_item_delete_open BEFORE DELETE ON order_items
WHEN (SELECT status FROM orders WHERE id = OLD.order_id) != 'OPEN'
BEGIN SELECT RAISE(ABORT, 'Historical items are immutable'); END;
CREATE TRIGGER movement_no_update BEFORE UPDATE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'Inventory audit is append-only'); END;
CREATE TRIGGER movement_no_delete BEFORE DELETE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'Inventory audit is append-only'); END;
` }, { version: 2, sql: `
CREATE TABLE order_payments (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH','CARD')),
  completed_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER payment_open_order BEFORE INSERT ON order_payments
WHEN (SELECT status FROM orders WHERE id=NEW.order_id) != 'OPEN'
BEGIN SELECT RAISE(ABORT, 'Payment requires an open order'); END;
CREATE TRIGGER payment_no_update BEFORE UPDATE ON order_payments
BEGIN SELECT RAISE(ABORT, 'Payment is immutable'); END;
CREATE TRIGGER payment_no_delete BEFORE DELETE ON order_payments
BEGIN SELECT RAISE(ABORT, 'Payment is immutable'); END;
CREATE INDEX completed_orders_by_date ON orders(closed_at) WHERE status='CLOSED';
` }, { version: 3, sql: `
ALTER TABLE orders ADD COLUMN sale_number INTEGER CHECK(sale_number BETWEEN 1 AND 9007199254740991);
-- Only the new presentation identity is backfilled, in the migration's immediate transaction.
DROP TRIGGER closed_order_no_update;
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY closed_at ASC, id ASC) AS number FROM orders WHERE status='CLOSED'
)
UPDATE orders SET sale_number=(SELECT number FROM numbered WHERE numbered.id=orders.id) WHERE status='CLOSED';
CREATE UNIQUE INDEX unique_sale_number ON orders(sale_number) WHERE sale_number IS NOT NULL;
CREATE TRIGGER closed_order_no_update BEFORE UPDATE ON orders WHEN OLD.status='CLOSED'
BEGIN SELECT RAISE(ABORT, 'Closed orders are immutable'); END;
CREATE TRIGGER sale_number_on_completion BEFORE UPDATE ON orders
WHEN (NEW.status='CLOSED' AND NEW.sale_number IS NULL)
  OR (NEW.status!='CLOSED' AND NEW.sale_number IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Sale number requires completion'); END;
CREATE TRIGGER sale_number_on_insert BEFORE INSERT ON orders
WHEN (NEW.status='CLOSED' AND NEW.sale_number IS NULL)
  OR (NEW.status!='CLOSED' AND NEW.sale_number IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Sale number requires completion'); END;
` }, { version: 4, sql: `
CREATE TABLE receipt_documents (
 id TEXT PRIMARY KEY, sale_id TEXT NOT NULL UNIQUE REFERENCES orders(id), schema_version INTEGER NOT NULL CHECK(schema_version=1),
 receipt_kind TEXT NOT NULL CHECK(receipt_kind='NON_FISCAL'), payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL,
 generated_from_legacy INTEGER NOT NULL CHECK(generated_from_legacy IN (0,1)), created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER receipt_document_closed BEFORE INSERT ON receipt_documents
WHEN COALESCE((SELECT status FROM orders WHERE id=NEW.sale_id),'')!='CLOSED'
BEGIN SELECT RAISE(ABORT,'Receipt requires a closed sale'); END;
CREATE TRIGGER receipt_document_no_update BEFORE UPDATE ON receipt_documents BEGIN SELECT RAISE(ABORT,'Receipt immutable'); END;
CREATE TRIGGER receipt_document_no_delete BEFORE DELETE ON receipt_documents BEGIN SELECT RAISE(ABORT,'Receipt immutable'); END;
CREATE TABLE receipt_print_jobs (
 id TEXT PRIMARY KEY, receipt_document_id TEXT REFERENCES receipt_documents(id), sale_id TEXT REFERENCES orders(id),
 job_kind TEXT NOT NULL CHECK(job_kind IN ('ORIGINAL_AUTO','ORIGINAL_RETRY','COPY','TEST')), reason TEXT NOT NULL,
 printer_device_name TEXT NOT NULL CHECK(length(printer_device_name)>0), printer_display_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING','SUBMITTING','SUBMITTED','FAILED','UNKNOWN','CANCELLED')),
 test_payload_json TEXT, created_at TEXT NOT NULL, queued_at TEXT NOT NULL, started_at TEXT, submitted_at TEXT, finished_at TEXT,
 last_error_code TEXT, attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 CHECK((job_kind='TEST' AND sale_id IS NULL AND receipt_document_id IS NULL AND test_payload_json IS NOT NULL)
 OR (job_kind!='TEST' AND sale_id IS NOT NULL AND receipt_document_id IS NOT NULL AND test_payload_json IS NULL))
) STRICT;
CREATE UNIQUE INDEX receipt_original_auto_once ON receipt_print_jobs(sale_id) WHERE job_kind IN ('ORIGINAL_AUTO','ORIGINAL_RETRY');
CREATE UNIQUE INDEX receipt_active_sale_job ON receipt_print_jobs(sale_id) WHERE status IN ('PENDING','SUBMITTING');
CREATE INDEX receipt_pending_queue ON receipt_print_jobs(status,queued_at);
CREATE TABLE receipt_print_attempts (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES receipt_print_jobs(id), attempt_number INTEGER NOT NULL,
 started_at TEXT NOT NULL, finished_at TEXT, outcome TEXT NOT NULL CHECK(outcome IN ('SUBMITTING','SUBMITTED','FAILED','UNKNOWN')),
 error_code TEXT, UNIQUE(job_id,attempt_number)
) STRICT;
CREATE TRIGGER receipt_attempt_no_delete BEFORE DELETE ON receipt_print_attempts BEGIN SELECT RAISE(ABORT,'Print audit retained'); END;
CREATE TRIGGER receipt_attempt_finished BEFORE UPDATE ON receipt_print_attempts WHEN OLD.outcome!='SUBMITTING' BEGIN SELECT RAISE(ABORT,'Print audit immutable'); END;
CREATE TABLE receipt_generation_errors (sale_id TEXT PRIMARY KEY REFERENCES orders(id), code TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
INSERT INTO settings(key,value) VALUES ('receipt_printer','null'),('receipt_auto_print','false');
` }, { version: 5, sql: `
CREATE TABLE expense_revisions (
 id TEXT PRIMARY KEY, expense_id TEXT NOT NULL REFERENCES expenses(id),
 previous_revision_id TEXT UNIQUE REFERENCES expense_revisions(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 0 AND 9007199254740991),
 category TEXT NOT NULL CHECK(category IN ('RENT','SALARIES','ELECTRICITY','WATER','INTERNET','SUPPLIES','MAINTENANCE','TRANSPORT','OTHER')),
 occurred_at TEXT NOT NULL, expense_date TEXT NOT NULL, description TEXT NOT NULL,
 paid_from_till INTEGER NOT NULL CHECK(paid_from_till IN (0,1)), note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, request_json TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX expense_original_once ON expense_revisions(expense_id) WHERE previous_revision_id IS NULL;
CREATE INDEX expense_revision_date ON expense_revisions(expense_date);
CREATE TRIGGER expense_revision_chain BEFORE INSERT ON expense_revisions
WHEN NEW.previous_revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM expense_revisions WHERE id=NEW.previous_revision_id AND expense_id=NEW.expense_id)
BEGIN SELECT RAISE(ABORT,'Expense revision requires its own original'); END;
CREATE TRIGGER expense_no_update BEFORE UPDATE ON expenses BEGIN SELECT RAISE(ABORT,'Expense history immutable'); END;
CREATE TRIGGER expense_no_delete BEFORE DELETE ON expenses BEGIN SELECT RAISE(ABORT,'Expense history retained'); END;
CREATE TRIGGER expense_revision_no_update BEFORE UPDATE ON expense_revisions BEGIN SELECT RAISE(ABORT,'Expense revision immutable'); END;
CREATE TRIGGER expense_revision_no_delete BEFORE DELETE ON expense_revisions BEGIN SELECT RAISE(ABORT,'Expense revision retained'); END;
CREATE TABLE stock_losses (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), product_name_snapshot TEXT NOT NULL,
 quantity REAL NOT NULL CHECK(quantity>0 AND quantity<=9007199254740991), reason TEXT NOT NULL CHECK(reason IN ('DAMAGED','EXPIRED','WASTE','MISSING','OTHER')),
 note TEXT NOT NULL, unit_cost_cents INTEGER CHECK(unit_cost_cents BETWEEN 0 AND 9007199254740991),
 total_cost_cents INTEGER CHECK(total_cost_cents BETWEEN 0 AND 9007199254740991),
 movement_id TEXT NOT NULL UNIQUE REFERENCES inventory_movements(id), occurred_at TEXT NOT NULL, business_date TEXT NOT NULL, request_json TEXT NOT NULL,
 CHECK((unit_cost_cents IS NULL AND total_cost_cents IS NULL) OR (unit_cost_cents IS NOT NULL AND total_cost_cents IS NOT NULL))
) STRICT;
CREATE INDEX stock_loss_date ON stock_losses(business_date);
CREATE TRIGGER stock_loss_movement BEFORE INSERT ON stock_losses
WHEN NOT EXISTS(SELECT 1 FROM inventory_movements WHERE id=NEW.movement_id AND product_id=NEW.product_id AND type='MANUAL_ADJUSTMENT' AND quantity_delta=-NEW.quantity AND related_order_id IS NULL)
BEGIN SELECT RAISE(ABORT,'Loss requires matching stock movement'); END;
CREATE TRIGGER stock_loss_no_update BEFORE UPDATE ON stock_losses BEGIN SELECT RAISE(ABORT,'Stock loss immutable'); END;
CREATE TRIGGER stock_loss_no_delete BEFORE DELETE ON stock_losses BEGIN SELECT RAISE(ABORT,'Stock loss retained'); END;
CREATE TABLE cash_sessions (
 id TEXT PRIMARY KEY, started_at TEXT NOT NULL
) STRICT;
CREATE TABLE cash_closes (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE REFERENCES cash_sessions(id), business_date TEXT NOT NULL,
 opening_cents INTEGER NOT NULL CHECK(opening_cents BETWEEN 0 AND 9007199254740991),
 cash_sales_cents INTEGER NOT NULL CHECK(cash_sales_cents BETWEEN 0 AND 9007199254740991),
 cash_expenses_cents INTEGER NOT NULL,
 supply_cents INTEGER NOT NULL CHECK(supply_cents BETWEEN 0 AND 9007199254740991),
 manual_in_cents INTEGER NOT NULL CHECK(manual_in_cents BETWEEN 0 AND 9007199254740991),
 manual_out_cents INTEGER NOT NULL CHECK(manual_out_cents BETWEEN 0 AND 9007199254740991),
 expected_cents INTEGER NOT NULL, counted_cents INTEGER NOT NULL CHECK(counted_cents BETWEEN 0 AND 9007199254740991),
 difference_cents INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('MATCHED','SHORT','OVER')),
 created_at TEXT NOT NULL, note TEXT NOT NULL, fingerprint TEXT NOT NULL, request_json TEXT NOT NULL,
 CHECK(expected_cents=opening_cents+cash_sales_cents+manual_in_cents-cash_expenses_cents-supply_cents-manual_out_cents),
 CHECK(difference_cents=counted_cents-expected_cents),
 CHECK((difference_cents=0 AND status='MATCHED') OR (difference_cents<0 AND status='SHORT') OR (difference_cents>0 AND status='OVER'))
) STRICT;
CREATE INDEX cash_close_date ON cash_closes(business_date);
CREATE TRIGGER cash_session_one_open BEFORE INSERT ON cash_sessions
WHEN EXISTS(SELECT 1 FROM cash_sessions s WHERE NOT EXISTS(SELECT 1 FROM cash_closes c WHERE c.session_id=s.id))
BEGIN SELECT RAISE(ABORT,'Only one open cash session'); END;
CREATE TRIGGER cash_session_no_update BEFORE UPDATE ON cash_sessions BEGIN SELECT RAISE(ABORT,'Cash session immutable'); END;
CREATE TRIGGER cash_session_no_delete BEFORE DELETE ON cash_sessions BEGIN SELECT RAISE(ABORT,'Cash session retained'); END;
CREATE TRIGGER cash_close_no_update BEFORE UPDATE ON cash_closes BEGIN SELECT RAISE(ABORT,'Cash close immutable'); END;
CREATE TRIGGER cash_close_no_delete BEFORE DELETE ON cash_closes BEGIN SELECT RAISE(ABORT,'Cash close retained'); END;
CREATE TABLE cash_events (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES cash_sessions(id),
 kind TEXT NOT NULL CHECK(kind IN ('CASH_SALE_IN','OPERATING_EXPENSE_OUT','INVENTORY_SUPPLY_OUT','MANUAL_CASH_IN','MANUAL_CASH_OUT')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN -9007199254740991 AND 9007199254740991 AND amount_cents!=0),
 sale_id TEXT UNIQUE REFERENCES order_payments(order_id), expense_revision_id TEXT UNIQUE REFERENCES expense_revisions(id),
 supply_id TEXT UNIQUE REFERENCES inventory_movements(id), reason TEXT NOT NULL, note TEXT NOT NULL,
 created_at TEXT NOT NULL, request_json TEXT NOT NULL,
 CHECK((kind='CASH_SALE_IN' AND sale_id IS NOT NULL AND expense_revision_id IS NULL AND supply_id IS NULL AND amount_cents>0)
 OR (kind='OPERATING_EXPENSE_OUT' AND expense_revision_id IS NOT NULL AND sale_id IS NULL AND supply_id IS NULL)
 OR (kind='INVENTORY_SUPPLY_OUT' AND supply_id IS NOT NULL AND sale_id IS NULL AND expense_revision_id IS NULL AND amount_cents<0)
 OR (kind IN ('MANUAL_CASH_IN','MANUAL_CASH_OUT') AND sale_id IS NULL AND expense_revision_id IS NULL AND supply_id IS NULL AND length(trim(reason))>0
 AND ((kind='MANUAL_CASH_IN' AND amount_cents>0) OR (kind='MANUAL_CASH_OUT' AND amount_cents<0))))
) STRICT;
CREATE INDEX cash_events_session ON cash_events(session_id);
CREATE TRIGGER cash_event_open BEFORE INSERT ON cash_events
WHEN EXISTS(SELECT 1 FROM cash_closes WHERE session_id=NEW.session_id)
BEGIN SELECT RAISE(ABORT,'Cash session already closed'); END;
CREATE TRIGGER cash_event_supply BEFORE INSERT ON cash_events WHEN NEW.kind='INVENTORY_SUPPLY_OUT' AND NOT EXISTS(SELECT 1 FROM inventory_movements WHERE id=NEW.supply_id AND type='SUPPLY')
BEGIN SELECT RAISE(ABORT,'Cash requires successful supply'); END;
CREATE TRIGGER cash_event_no_update BEFORE UPDATE ON cash_events BEGIN SELECT RAISE(ABORT,'Cash event immutable'); END;
CREATE TRIGGER cash_event_no_delete BEFORE DELETE ON cash_events BEGIN SELECT RAISE(ABORT,'Cash event retained'); END;
-- Automatic sale effect is in the checkout transaction, without changing checkout inputs.
CREATE TRIGGER cash_sale_event AFTER INSERT ON order_payments WHEN NEW.payment_method='CASH'
BEGIN
 INSERT INTO cash_sessions SELECT lower(hex(randomblob(16))),NEW.completed_at WHERE NOT EXISTS(SELECT 1 FROM cash_sessions s WHERE NOT EXISTS(SELECT 1 FROM cash_closes c WHERE c.session_id=s.id));
 INSERT INTO cash_events SELECT 'sale:'||NEW.order_id,s.id,'CASH_SALE_IN',SUM(i.quantity*i.unit_price_cents),NEW.order_id,NULL,NULL,'Shitje CASH','',NEW.completed_at,''
 FROM cash_sessions s,order_items i WHERE i.order_id=NEW.order_id AND NOT EXISTS(SELECT 1 FROM cash_closes c WHERE c.session_id=s.id)
 GROUP BY s.id HAVING SUM(i.quantity*i.unit_price_cents)>0;
END;
CREATE TRIGGER cash_expense_event AFTER INSERT ON expense_revisions
WHEN NEW.amount_cents*NEW.paid_from_till!=COALESCE((SELECT amount_cents*paid_from_till FROM expense_revisions WHERE id=NEW.previous_revision_id),0)
BEGIN
 INSERT INTO cash_sessions SELECT lower(hex(randomblob(16))),NEW.created_at WHERE NOT EXISTS(SELECT 1 FROM cash_sessions s WHERE NOT EXISTS(SELECT 1 FROM cash_closes c WHERE c.session_id=s.id));
 INSERT INTO cash_events SELECT 'expense:'||NEW.id,s.id,'OPERATING_EXPENSE_OUT',
 COALESCE((SELECT amount_cents*paid_from_till FROM expense_revisions WHERE id=NEW.previous_revision_id),0)-NEW.amount_cents*NEW.paid_from_till,
 NULL,NEW.id,NULL,'Shpenzim / korrigjim','',NEW.created_at,'' FROM cash_sessions s WHERE NOT EXISTS(SELECT 1 FROM cash_closes c WHERE c.session_id=s.id);
END;
` }];

export function migrate(db: Database.Database, beforeMigration?:()=>void): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
  ) STRICT`);
  const applied = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  if (applied.some(row => !migrations.some(m => m.version === row.version))) {
    throw new Error('Database schema is newer than this application');
  }
  if(applied.length && migrations.some(m=>!applied.some(row=>row.version===m.version))) {
    if(db.name!==':memory:'&&!beforeMigration)throw Error('FOX_MIGRATION_BACKUP_REQUIRED');
    beforeMigration?.();
  }
  for (const migration of migrations) {
    db.transaction(() => {
      if (db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version)) return;
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(migration.version, new Date().toISOString());
    }).immediate();
  }
}
