import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../electron/database/connection';
import { migrations } from '../electron/database/migrations';
import { seed } from '../electron/database/seed';
import { currentSchemaVersion, inspectDatabase } from '../electron/database/health';
import {
  assertDestination,
  createBackup,
  validateBackup,
  fileHash,
  createMigrationBackup,
  durableWrite,
} from '../electron/database/backups';
import {
  replaceDatabase,
  recoverInterruptedRestore,
  prepareRestore,
  restoreUnreadableDatabase,
} from '../electron/database/restore';
import { createRepositories } from '../electron/database/repositories';
import { createOrderService } from '../electron/database/orders';
import { createCheckoutService } from '../electron/database/checkout';
import { readSalesReport } from '../electron/database/salesReports';
import { initializeLogging, logError } from '../electron/main/logging';
let directory: string, db: Database.Database, filename: string;
const version = '0.5.0-qa.1';
function dump(database = db) {
  return Object.fromEntries(
    (
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map(({ name }) => [name, database.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]),
  );
}
function sale(table = 'M5', complete = true) {
  const orders = createOrderService(db, createRepositories(db));
  const added = orders.addProduct({ tableId: table, productId: 'KAFE-1' });
  if (!added.ok) throw Error('fixture');
  if (complete) {
    const result = createCheckoutService(db, orders).completeOrder({
      orderId: added.data.order!.id,
    });
    expect(result.ok).toBe(true);
  }
  return added.data;
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fox-protection-'));
  filename = path.join(directory, 'fox.sqlite');
  db = openDatabase(filename);
  db.prepare(
    "UPDATE products SET selling_price_cents=100,purchase_cost_cents=50,track_inventory=1 WHERE id='KAFE-1'",
  ).run();
  db.prepare("UPDATE inventory_balances SET quantity=100 WHERE product_id='KAFE-1'").run();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (db.open) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
describe('consistent backup and integrity', () => {
  it('backs up committed WAL data with exact records, reports, receipt documents and checksum', async () => {
    sale();
    sale('M6', false);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    const before = dump(),
      report = readSalesReport(db, 'ALL'),
      file = path.join(directory, 'manual.sqlite');
    const manifest = await createBackup(db, file, version);
    expect(manifest.sha256).toBe(await fileHash(file));
    expect(manifest.schemaVersion).toBe(7);
    const copy = new Database(file, { readonly: true });
    try {
      expect(dump(copy)).toEqual(before);
      expect(readSalesReport(copy, 'ALL')).toEqual(report);
      expect(inspectDatabase(copy, true)).toBe(7);
    } finally {
      copy.close();
    }
    expect(dump()).toEqual(before);
    expect(await validateBackup(file)).toEqual(manifest);
  });
  it('does not capture uncommitted transaction', async () => {
    const file = path.join(directory, 'backup.sqlite');
    const creating = createBackup(db, file, version);
    expect(
      db.transaction(() => {
        db.prepare("UPDATE products SET name='UNCOMMITTED' WHERE id='KAFE-1'").run();
        throw Error('rollback');
      }),
    ).toThrow('rollback');
    await creating;
    const copy = new Database(file);
    try {
      expect(
        (copy.prepare("SELECT name FROM products WHERE id='KAFE-1'").get() as { name: string })
          .name,
      ).not.toBe('UNCOMMITTED');
    } finally {
      copy.close();
    }
  });
  it('invalid destination and failed write preserve every current row', async () => {
    sale();
    const before = dump();
    await expect(
      createBackup(db, path.join(directory, 'missing', 'a.sqlite'), version),
    ).rejects.toThrow();
    expect(dump()).toEqual(before);
  });
  it('refuses overwrite, live database, wrong extension and install subtree', () => {
    expect(() => assertDestination(filename, filename)).toThrow();
    expect(() => assertDestination(path.join(directory, 'app.exe'), filename)).toThrow();
    expect(() =>
      assertDestination(path.join(directory, 'inside.sqlite'), filename, directory),
    ).toThrow();
  });
  it('rejects checksum changes and missing manifest', async () => {
    const file = path.join(directory, 'backup.sqlite');
    await createBackup(db, file, version);
    fs.appendFileSync(file, 'tampered');
    await expect(validateBackup(file)).rejects.toThrow('CHECKSUM');
    fs.unlinkSync(file + '.json');
    await expect(validateBackup(file)).rejects.toThrow();
  });
  it('rejects foreign schema despite valid SQLite and forged matching checksum', async () => {
    const file = path.join(directory, 'foreign.sqlite');
    const foreign = new Database(file);
    foreign.exec('CREATE TABLE unrelated(value TEXT)');
    foreign.close();
    fs.writeFileSync(
      file + '.json',
      JSON.stringify({
        format: 'FOX_SQLITE_BACKUP',
        formatVersion: 1,
        applicationVersion: version,
        schemaVersion: 4,
        createdAt: new Date().toISOString(),
        sha256: await fileHash(file),
      }),
    );
    await expect(validateBackup(file)).rejects.toThrow();
  });
  it('rejects newer schema and altered FOX trigger definitions', () => {
    db.prepare('INSERT INTO schema_migrations VALUES (99,?)').run('future');
    expect(() => inspectDatabase(db)).toThrow('VERSION');
    db.prepare('DELETE FROM schema_migrations WHERE version=99').run();
    db.exec('DROP TRIGGER closed_order_no_update');
    expect(() => inspectDatabase(db)).toThrow('IDENTITY');
  });
  it('detects FK violations and refuses corrupt/zero existing DB without reseeding', () => {
    db.pragma('foreign_keys=OFF');
    db.prepare("INSERT INTO inventory_balances VALUES ('UNKNOWN',1,'now')").run();
    expect(() => inspectDatabase(db)).toThrow('FOREIGN');
    db.close();
    fs.writeFileSync(filename, 'not SQLite');
    expect(() => openDatabase(filename)).toThrow();
    expect(fs.readFileSync(filename, 'utf8')).toBe('not SQLite');
    fs.writeFileSync(filename, '');
    expect(() => openDatabase(filename)).toThrow('EXISTING_INVALID');
    expect(fs.statSync(filename).size).toBe(0);
  });
});
describe('safe restore', () => {
  it('roundtrips A after B, retaining pre-restore safety backup and immutable history', async () => {
    sale();
    const file = path.join(directory, 'A.sqlite'),
      a = dump(),
      report = readSalesReport(db, 'ALL');
    await createBackup(db, file, version);
    sale('M6');
    const b = dump(),
      stop = vi.fn();
    const safety = await replaceDatabase(db, file, directory, version, stop);
    expect(stop).toHaveBeenCalledOnce();
    db = openDatabase(filename);
    expect(dump()).toEqual(a);
    expect(readSalesReport(db, 'ALL')).toEqual(report);
    const previous = new Database(safety, { readonly: true });
    try {
      expect(dump(previous)).toEqual(b);
    } finally {
      previous.close();
    }
    sale('M7');
    expect(readSalesReport(db, 'ALL').summary.completedOrders).toBe(2);
  });
  it('blocks restore with OPEN orders and leaves state unchanged', async () => {
    const file = path.join(directory, 'A.sqlite');
    await createBackup(db, file, version);
    sale('M5', false);
    const before = dump();
    await expect(replaceDatabase(db, file, directory, version, vi.fn())).rejects.toThrow(
      'OPEN_ORDERS',
    );
    expect(dump()).toEqual(before);
  });
  it('rejects truncated/non-SQLite/invalid backups without closing current DB', async () => {
    for (const contents of ['', 'garbage']) {
      const file = path.join(directory, 'invalid.sqlite');
      fs.writeFileSync(file, contents);
      const before = dump();
      await expect(replaceDatabase(db, file, directory, version, vi.fn())).rejects.toThrow();
      expect(db.open).toBe(true);
      expect(dump()).toEqual(before);
    }
  });
  it.each(['SAFETY_BACKUP', 'ORIGINAL_RENAMED', 'CANDIDATE_RENAMED'])(
    'failure at %s preserves exact B and recoverability',
    async (stage) => {
      sale();
      const file = path.join(directory, 'A.sqlite');
      await createBackup(db, file, version);
      sale('M6');
      const before = dump();
      await expect(
        replaceDatabase(db, file, directory, version, vi.fn(), (point) => {
          if (point === stage) throw Error('injected');
        }),
      ).rejects.toThrow('injected');
      if (!db.open) db = openDatabase(filename);
      expect(dump()).toEqual(before);
      expect(inspectDatabase(db, true)).toBe(7);
      expect(
        fs
          .readdirSync(path.join(directory, 'backups'))
          .some((name) => name.startsWith('FOX-before-restore-')),
      ).toBe(true);
    },
  );
  it('destination rename failure rolls back original file', async () => {
    const file = path.join(directory, 'A.sqlite');
    await createBackup(db, file, version);
    sale();
    const before = dump(),
      rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
      if (String(a).endsWith('fox-restore-stage.sqlite')) throw Error('read-only destination');
      return rename(a, b);
    });
    await expect(replaceDatabase(db, file, directory, version, vi.fn())).rejects.toThrow(
      'read-only',
    );
    db = openDatabase(filename);
    expect(dump()).toEqual(before);
  });
  it('recovers interrupted file replacement before normal startup', async () => {
    const file = path.join(directory, 'A.sqlite');
    await createBackup(db, file, version);
    sale();
    const before = dump();
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    await prepareRestore(file, directory);
    durableWrite(
      path.join(directory, 'fox-restore-journal.json'),
      JSON.stringify({ format: 1, state: 'REPLACING' }),
    );
    fs.renameSync(filename, path.join(directory, 'fox-restore-original.sqlite'));
    fs.renameSync(path.join(directory, 'fox-restore-stage.sqlite'), filename);
    recoverInterruptedRestore(directory);
    db = openDatabase(filename);
    expect(dump()).toEqual(before);
  });
  it('recovers unreadable data by preserving corrupt bytes and installing validated backup', async () => {
    sale();
    const file = path.join(directory, 'A.sqlite'),
      before = dump();
    await createBackup(db, file, version);
    db.close();
    fs.writeFileSync(filename, 'CORRUPT EVIDENCE');
    await restoreUnreadableDatabase(file, directory);
    db = openDatabase(filename);
    expect(dump()).toEqual(before);
    const preserved = fs
      .readdirSync(directory)
      .find((n) => n.startsWith('FOX-unreadable-preserved-') && n.endsWith('.sqlite'))!;
    expect(fs.readFileSync(path.join(directory, preserved), 'utf8')).toBe('CORRUPT EVIDENCE');
  });
  it('migrates older compatible backup forward before replacing current state', async () => {
    const legacyFile = path.join(directory, 'legacy.sqlite'),
      legacy = new Database(legacyFile);
    legacy.pragma('foreign_keys=ON');
    legacy.exec(
      'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL) STRICT',
    );
    for (const migration of migrations.filter((m) => m.version <= 3)) {
      legacy
        .transaction(() => {
          legacy.exec(migration.sql);
          legacy
            .prepare('INSERT INTO schema_migrations VALUES (?,?)')
            .run(migration.version, 'old');
        })
        .immediate();
    }
    seed(legacy);
    await createBackup(legacy, path.join(directory, 'oldbackup.sqlite'), version);
    legacy.close();
    await replaceDatabase(
      db,
      path.join(directory, 'oldbackup.sqlite'),
      directory,
      version,
      vi.fn(),
    );
    db = openDatabase(filename);
    expect(inspectDatabase(db)).toBe(7);
    expect(db.prepare('SELECT COUNT(*) AS n FROM receipt_documents').get()).toEqual({ n: 0 });
  });
});
describe('migration and bounded diagnostics', () => {
  it('creates verified pre-upgrade snapshot before upgrading real v3 file', () => {
    db.close();
    fs.unlinkSync(filename);
    const legacy = new Database(filename);
    legacy.exec(
      'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL) STRICT',
    );
    for (const m of migrations.filter((m) => m.version <= 3)) {
      legacy
        .transaction(() => {
          legacy.exec(m.sql);
          legacy.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(m.version, 'old');
        })
        .immediate();
    }
    seed(legacy);
    legacy.close();
    db = openDatabase(filename);
    const file = fs
      .readdirSync(path.join(directory, 'backups'))
      .find((n) => n.endsWith('.sqlite'))!;
    const copy = new Database(path.join(directory, 'backups', file), { readonly: true });
    try {
      expect(inspectDatabase(copy)).toBe(3);
    } finally {
      copy.close();
    }
  });
  it('failed migration leaves verified safety backup and transaction rollback', () => {
    const before = dump();
    db.close();
    migrations.push({
      version: currentSchemaVersion() + 1,
      sql: 'CREATE TABLE temporary_failure(id TEXT); INVALID SQL;',
    });
    try {
      expect(() => openDatabase(filename)).toThrow();
      const copy = new Database(filename, { readonly: true });
      try {
        expect(dump(copy)).toEqual(before);
      } finally {
        copy.close();
      }
      const file = fs
        .readdirSync(path.join(directory, 'backups'))
        .find((n) => n.endsWith('.sqlite'))!;
      expect(fs.existsSync(path.join(directory, 'backups', file + '.json'))).toBe(true);
    } finally {
      migrations.pop();
    }
    db = openDatabase(filename);
  });
  it('backup failure prevents future migration from starting', () => {
    db.close();
    fs.writeFileSync(path.join(directory, 'backups'), 'not a directory');
    migrations.push({
      version: currentSchemaVersion() + 1,
      sql: 'CREATE TABLE future_table(id TEXT);',
    });
    try {
      expect(() => openDatabase(filename)).toThrow();
    } finally {
      migrations.pop();
    }
    db = openDatabase(filename);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name='future_table'").get(),
    ).toBeUndefined();
  });
  it('retains latest five owned migration backups, preserves manual backups', async () => {
    const folder = path.join(directory, 'backups');
    fs.mkdirSync(folder);
    await createBackup(db, path.join(folder, 'manual.sqlite'), version);
    const collision = path.join(folder, 'FOX-before-v4-0000-manual.sqlite');
    await createBackup(db, collision, version);
    const automatic = [];
    for (let i = 0; i < 7; i++) automatic.push(createMigrationBackup(db, folder, version, 5));
    expect(automatic.filter((file) => fs.existsSync(file))).toHaveLength(5);
    expect(fs.existsSync(path.join(folder, 'manual.sqlite'))).toBe(true);
    expect(fs.existsSync(collision)).toBe(true);
  });
  it('rotates bounded local logs without arbitrary error text or secrets', () => {
    initializeLogging(directory);
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(
        path.join(directory, 'logs', 'fox.log'),
        'previous log line\n'.repeat(15000),
      );
      const error = new Error('secret token and sales data');
      error.name = 'secret token in type';
      logError('QA_EVENT', error);
    }
    const files = fs.readdirSync(path.join(directory, 'logs'));
    expect(files).toHaveLength(5);
    for (const file of files) {
      const text = fs.readFileSync(path.join(directory, 'logs', file), 'utf8');
      expect(text).not.toContain('secret token');
      expect(fs.statSync(path.join(directory, 'logs', file)).size).toBeLessThan(271000);
    }
  });
});
