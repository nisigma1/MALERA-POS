import Database from 'better-sqlite3';
import { migrate } from './migrations';
import { seed } from './seed';
import { assertTestDatabasePath } from './safety';
import fs from 'node:fs';
import path from 'node:path';
import { inspectDatabase, currentSchemaVersion } from './health';
import { createMigrationBackup } from './backups';
export function openDatabase(
  filename: string,
  applicationVersion = process.env.npm_package_version ?? '0.5.0-qa.1',
): Database.Database {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) assertTestDatabasePath(filename);
  const existing = filename !== ':memory:' && fs.existsSync(filename);
  if (
    existing &&
    (!fs.lstatSync(filename).isFile() ||
      fs.lstatSync(filename).isSymbolicLink() ||
      fs.statSync(filename).size < 512)
  )
    throw Error('FOX_DB_EXISTING_INVALID');
  const db = new Database(filename, { fileMustExist: existing });
  try {
    const oldVersion = existing ? inspectDatabase(db) : 0;
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    if (filename !== ':memory:') db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    migrate(
      db,
      oldVersion && oldVersion < currentSchemaVersion()
        ? () => {
            createMigrationBackup(
              db,
              path.join(path.dirname(filename), 'backups'),
              applicationVersion,
              currentSchemaVersion(),
            );
          }
        : undefined,
    );
    seed(db);
    inspectDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
