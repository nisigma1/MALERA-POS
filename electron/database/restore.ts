import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { backupName, createBackup, durableWrite, validateBackup } from './backups';
import { inspectDatabase } from './health';
import { openDatabase } from './connection';

const journalName = 'fox-restore-journal.json';
const oldName = 'fox-restore-original.sqlite';
const stageName = 'fox-restore-stage.sqlite';
function paths(directory: string) { return { current: path.join(directory, 'fox.sqlite'), old: path.join(directory, oldName), stage: path.join(directory, stageName), journal: path.join(directory, journalName) }; }
function removeFile(filename: string) { if (fs.existsSync(filename)) { if (!fs.lstatSync(filename).isFile() || fs.lstatSync(filename).isSymbolicLink()) throw Error('FOX_RESTORE_PATH'); fs.unlinkSync(filename); } }
export function recoverInterruptedRestore(directory: string): void {
  const p = paths(directory);
  if (!fs.existsSync(p.journal)) return;
  if (fs.lstatSync(p.journal).isSymbolicLink() || fs.statSync(p.journal).size > 1024) throw Error('FOX_RESTORE_JOURNAL');
  const journal = JSON.parse(fs.readFileSync(p.journal, 'utf8')) as {format?:unknown; state?:unknown};
  if (journal.format !== 1 || !['REPLACING','COMPLETE'].includes(String(journal.state))) throw Error('FOX_RESTORE_JOURNAL');
  if (journal.state === 'COMPLETE') {
    const db = new Database(p.current, { readonly: true, fileMustExist: true });
    try { inspectDatabase(db, true); } finally { db.close(); }
    removeFile(p.old);
  } else if (fs.existsSync(p.old)) {
    // A verified pre-restore backup also exists. Preserve failed candidate rather than repairing it.
    if (fs.existsSync(p.current)) fs.renameSync(p.current, path.join(directory, backupName('failed-restore')));
    fs.renameSync(p.old, p.current);
    for (const suffix of ['-wal', '-shm']) if (fs.existsSync(p.old + suffix)) fs.renameSync(p.old + suffix, p.current + suffix);
  } else if (!fs.existsSync(p.current)) throw Error('FOX_RESTORE_MISSING_ORIGINAL');
  removeFile(p.stage); removeFile(p.journal + '.next'); removeFile(p.journal);
}
export async function prepareRestore(backup: string, directory: string, applicationVersion?: string): Promise<string> {
  await validateBackup(backup);
  const p = paths(directory);
  if ([p.stage, p.old, p.journal].some(file => fs.existsSync(file))) throw Error('FOX_RESTORE_IN_PROGRESS');
  const source = new Database(backup, { readonly: true, fileMustExist: true });
  try { await source.backup(p.stage); } finally { source.close(); }
  try {
    // Revalidate staged bytes/schema and perform only the existing forward migrations.
    const candidate = openDatabase(p.stage,applicationVersion);
    try { inspectDatabase(candidate, true); candidate.pragma('wal_checkpoint(TRUNCATE)'); } finally { candidate.close(); }
    return p.stage;
  } catch (error) { removeFile(p.stage); throw error; }
}
export async function replaceDatabase(db: Database.Database, backup: string, directory: string, version: string, stopServices: () => void, inject?: (stage: string) => void): Promise<string> {
  if ((db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='OPEN'").get() as {n:number}).n) throw Error('FOX_RESTORE_OPEN_ORDERS');
  if ((db.prepare("SELECT COUNT(*) AS n FROM receipt_print_jobs WHERE status IN ('PENDING','SUBMITTING')").get() as {n:number}).n) throw Error('FOX_RESTORE_PRINT_ACTIVE');
  const p = paths(directory);
  await prepareRestore(backup, directory,version);
  let closed = false;
  try {
    const backupDirectory = path.join(directory, 'backups'); fs.mkdirSync(backupDirectory, { recursive: true });
    const safety = path.join(backupDirectory, backupName('before-restore'));
    await createBackup(db, safety, version,'PRE_RESTORE');
    inject?.('SAFETY_BACKUP');
    // Ensure all committed pages are in the original main file before renaming it.
    const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)') as {busy:number}[];
    if (checkpoint[0]?.busy) throw Error('FOX_RESTORE_CHECKPOINT_BUSY');
    stopServices(); db.close(); closed = true;
    durableWrite(p.journal, JSON.stringify({format:1,state:'REPLACING'}));
    fs.renameSync(p.current, p.old); inject?.('ORIGINAL_RENAMED');
    fs.renameSync(p.stage, p.current); inject?.('CANDIDATE_RENAMED');
    const restored = new Database(p.current, { readonly: true, fileMustExist: true });
    try { inspectDatabase(restored, true); } finally { restored.close(); }
    // Replace journal via a flushed temp then atomic rename; a pre-COMPLETE crash rolls back.
    durableWrite(p.journal + '.next', JSON.stringify({format:1,state:'COMPLETE'}));
    fs.renameSync(p.journal + '.next', p.journal);
    recoverInterruptedRestore(directory);
    return safety;
  } catch (error) {
    if (closed) recoverInterruptedRestore(directory);
    else removeFile(p.stage);
    throw error;
  }
}
export async function restoreUnreadableDatabase(backup: string, directory: string, applicationVersion?: string): Promise<void> {
  // Used only with the operational connection closed and explicit native confirmation.
  await prepareRestore(backup, directory,applicationVersion);
  const p = paths(directory), preservation = path.join(directory, backupName('unreadable-preserved'));
  try {
    durableWrite(p.journal, JSON.stringify({format:1,state:'REPLACING'}));
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(p.current + suffix)) fs.renameSync(p.current + suffix, p.old + suffix);
    fs.renameSync(p.stage, p.current);
    durableWrite(p.journal + '.next', JSON.stringify({format:1,state:'COMPLETE'})); fs.renameSync(p.journal + '.next', p.journal);
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(p.old + suffix)) fs.renameSync(p.old + suffix, preservation + suffix);
    recoverInterruptedRestore(directory);
  } catch (error) {
    recoverInterruptedRestore(directory);
    throw error;
  }
}
