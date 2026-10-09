import Database from 'better-sqlite3';
import { migrations } from './migrations';

export const currentSchemaVersion = () => migrations.at(-1)!.version;
const expected = new Map<number, string>();
function definition(db: Database.Database): string {
  const rows = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all() as { type: string; name: string; tbl_name: string; sql: string }[];
  return JSON.stringify(rows.map(row => ({ ...row, sql: row.sql.replace(/\s+/g, '') })));
}
function expectedDefinition(version: number): string {
  let value = expected.get(version);
  if (!value) {
    const reference = new Database(':memory:');
    try {
      reference.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT');
      for (const migration of migrations.filter(m => m.version <= version)) reference.exec(migration.sql);
      // Normalize whitespace only; table/index/trigger definitions must remain application-owned.
      value = definition(reference).replace(/\s+/g, ' ');
      expected.set(version, value);
    } finally { reference.close(); }
  }
  return value;
}
export function inspectDatabase(db: Database.Database, full = false): number {
  const checks = db.pragma(full ? 'integrity_check' : 'quick_check') as { [key: string]: unknown }[];
  if (checks.length !== 1 || Object.values(checks[0]!)[0] !== 'ok') throw Error('FOX_DB_INTEGRITY');
  if ((db.pragma('foreign_key_check') as unknown[]).length) throw Error('FOX_DB_FOREIGN_KEYS');
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {version: number}[];
  const version = versions.at(-1)?.version ?? 0;
  if (!version || version > currentSchemaVersion() || versions.some((row, i) => row.version !== i + 1)) throw Error('FOX_DB_SCHEMA_VERSION');
  if (definition(db).replace(/\s+/g, ' ') !== expectedDefinition(version)) throw Error('FOX_DB_SCHEMA_IDENTITY');
  return version;
}
