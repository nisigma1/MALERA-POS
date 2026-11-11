import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { backupName, createBackup, durableWrite, validateBackup } from './backups';
import { inspectDatabase } from './health';
import { openDatabase } from './connection';
declare const FOX_RELEASE: boolean;

const journalName = 'fox-restore-journal.json';
const oldName = 'fox-restore-original.sqlite';
const stageName = 'fox-restore-stage.sqlite';
const databaseFiles = ['', '-wal', '-shm'] as const;
type DatabaseSuffix = (typeof databaseFiles)[number];
type Preservation = { name: string; files: DatabaseSuffix[] };

function paths(directory: string) {
  return {
    current: path.join(directory, 'fox.sqlite'),
    old: path.join(directory, oldName),
    stage: path.join(directory, stageName),
    journal: path.join(directory, journalName),
  };
}
function removeFile(filename: string) {
  if (fs.existsSync(filename)) {
    if (!fs.lstatSync(filename).isFile() || fs.lstatSync(filename).isSymbolicLink())
      throw Error('FOX_RESTORE_PATH');
    fs.unlinkSync(filename);
  }
}

function regularFileExists(filename: string): boolean {
  const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (!stat) return false;
  if (!stat.isFile()) throw Error('FOX_RESTORE_PATH');
  return true;
}

function isPreservation(value: unknown): value is Preservation {
  if (!value || typeof value !== 'object') return false;
  const { name, files } = value as Partial<Preservation>;
  return (
    typeof name === 'string' &&
    /^FOX-unreadable-preserved-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{6}\.sqlite$/.test(
      name,
    ) &&
    Array.isArray(files) &&
    files.every((suffix) => databaseFiles.includes(suffix)) &&
    new Set(files).size === files.length
  );
}

function preserveOriginal(directory: string, original: string, preservation: Preservation): void {
  const archive = path.join(directory, preservation.name);
  const remaining = databaseFiles.filter((suffix) => {
    const sourceExists = regularFileExists(original + suffix);
    const archiveExists = regularFileExists(archive + suffix);
    const expected = preservation.files.includes(suffix);
    // Each expected file must still be at exactly one of its two locations.
    if (expected ? sourceExists === archiveExists : sourceExists || archiveExists)
      throw Error('FOX_RESTORE_PRESERVATION_STATE');
    return sourceExists;
  });
  for (const suffix of remaining) fs.renameSync(original + suffix, archive + suffix);
}

export function recoverInterruptedRestore(directory: string): void {
  const p = paths(directory);
  const journalStat = fs.lstatSync(p.journal, { throwIfNoEntry: false });
  if (!journalStat) return;
  if (!journalStat.isFile() || journalStat.size > 1024) throw Error('FOX_RESTORE_JOURNAL');
  const journal = JSON.parse(fs.readFileSync(p.journal, 'utf8')) as {
    format?: unknown;
    state?: unknown;
    preservation?: unknown;
  } | null;
  if (journal?.format !== 1 || (journal.state !== 'REPLACING' && journal.state !== 'COMPLETE'))
    throw Error('FOX_RESTORE_JOURNAL');
  const preservation = journal.preservation;
  if (preservation !== undefined && (journal.state !== 'COMPLETE' || !isPreservation(preservation)))
    throw Error('FOX_RESTORE_JOURNAL');
  if (journal.state === 'COMPLETE') {
    const db = new Database(p.current, { readonly: true, fileMustExist: true });
    try {
      inspectDatabase(db, true);
    } finally {
      db.close();
    }
    if (preservation) preserveOriginal(directory, p.old, preservation);
    else removeFile(p.old);
  } else if (fs.existsSync(p.old)) {
    // A verified pre-restore backup also exists. Preserve failed candidate rather than repairing it.
    if (fs.existsSync(p.current))
      fs.renameSync(p.current, path.join(directory, backupName('failed-restore')));
    fs.renameSync(p.old, p.current);
    for (const suffix of ['-wal', '-shm'])
      if (fs.existsSync(p.old + suffix)) fs.renameSync(p.old + suffix, p.current + suffix);
  } else if (!fs.existsSync(p.current)) throw Error('FOX_RESTORE_MISSING_ORIGINAL');
  removeFile(p.stage);
  removeFile(p.journal + '.next');
  removeFile(p.journal);
}
export async function prepareRestore(
  backup: string,
  directory: string,
  applicationVersion?: string,
): Promise<string> {
  await validateBackup(backup);
  const p = paths(directory);
  if ([p.stage, p.old, p.journal].some((file) => fs.existsSync(file)))
    throw Error('FOX_RESTORE_IN_PROGRESS');
  const source = new Database(backup, { readonly: true, fileMustExist: true });
  try {
    await source.backup(p.stage);
  } finally {
    source.close();
  }
  try {
    // Revalidate staged bytes/schema and perform only the existing forward migrations.
    const candidate = openDatabase(p.stage, applicationVersion);
    try {
      inspectDatabase(candidate, true);
      candidate.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      candidate.close();
    }
    return p.stage;
  } catch (error) {
    removeFile(p.stage);
    throw error;
  }
}
export async function replaceDatabase(
  db: Database.Database,
  backup: string,
  directory: string,
  version: string,
  stopServices: () => void,
  inject?: (stage: string) => void,
): Promise<string> {
  if ((db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='OPEN'").get() as { n: number }).n)
    throw Error('FOX_RESTORE_OPEN_ORDERS');
  if (
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM receipt_print_jobs WHERE status IN ('PENDING','SUBMITTING')",
        )
        .get() as { n: number }
    ).n
  )
    throw Error('FOX_RESTORE_PRINT_ACTIVE');
  const p = paths(directory);
  await prepareRestore(backup, directory, version);
  let closed = false;
  try {
    const backupDirectory = path.join(directory, 'backups');
    fs.mkdirSync(backupDirectory, { recursive: true });
    const safety = path.join(backupDirectory, backupName('before-restore'));
    await createBackup(db, safety, version, 'PRE_RESTORE');
    if (typeof FOX_RELEASE === 'undefined' || !FOX_RELEASE) inject?.('SAFETY_BACKUP');
    // Ensure all committed pages are in the original main file before renaming it.
    const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
    if (checkpoint[0]?.busy) throw Error('FOX_RESTORE_CHECKPOINT_BUSY');
    stopServices();
    db.close();
    closed = true;
    durableWrite(p.journal, JSON.stringify({ format: 1, state: 'REPLACING' }));
    fs.renameSync(p.current, p.old);
    if (typeof FOX_RELEASE === 'undefined' || !FOX_RELEASE) inject?.('ORIGINAL_RENAMED');
    fs.renameSync(p.stage, p.current);
    if (typeof FOX_RELEASE === 'undefined' || !FOX_RELEASE) inject?.('CANDIDATE_RENAMED');
    const restored = new Database(p.current, { readonly: true, fileMustExist: true });
    try {
      inspectDatabase(restored, true);
    } finally {
      restored.close();
    }
    // Replace journal via a flushed temp then atomic rename; a pre-COMPLETE crash rolls back.
    durableWrite(p.journal + '.next', JSON.stringify({ format: 1, state: 'COMPLETE' }));
    fs.renameSync(p.journal + '.next', p.journal);
    recoverInterruptedRestore(directory);
    return safety;
  } catch (error) {
    if (closed) recoverInterruptedRestore(directory);
    else removeFile(p.stage);
    throw error;
  }
}
export async function restoreUnreadableDatabase(
  backup: string,
  directory: string,
  applicationVersion?: string,
): Promise<void> {
  // Used only with the operational connection closed and explicit native confirmation.
  const p = paths(directory);
  const preservation: Preservation = {
    name: backupName('unreadable-preserved'),
    files: databaseFiles.filter((suffix) => regularFileExists(p.current + suffix)),
  };
  const archive = path.join(directory, preservation.name);
  for (const suffix of databaseFiles)
    if (regularFileExists(p.old + suffix) || regularFileExists(archive + suffix))
      throw Error('FOX_RESTORE_PRESERVATION_STATE');
  await prepareRestore(backup, directory, applicationVersion);
  try {
    durableWrite(p.journal, JSON.stringify({ format: 1, state: 'REPLACING' }));
    for (const suffix of preservation.files) fs.renameSync(p.current + suffix, p.old + suffix);
    fs.renameSync(p.stage, p.current);
    // Publish the archive identity before any move that startup may need to resume.
    durableWrite(
      p.journal + '.next',
      JSON.stringify({ format: 1, state: 'COMPLETE', preservation }),
    );
    fs.renameSync(p.journal + '.next', p.journal);
  } catch (error) {
    recoverInterruptedRestore(directory);
    throw error;
  }
  recoverInterruptedRestore(directory);
}
