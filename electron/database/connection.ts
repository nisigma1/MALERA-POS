import Database from 'better-sqlite3';
import { migrate } from './migrations';
import { seed } from './seed';
import { assertTestDatabasePath } from './safety';
export function openDatabase(filename: string): Database.Database {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) assertTestDatabasePath(filename);
  const db = new Database(filename);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    if (filename !== ':memory:') db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    migrate(db);
    seed(db);
    return db;
  } catch (error) { db.close(); throw error; }
}
