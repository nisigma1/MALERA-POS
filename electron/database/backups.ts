import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { inspectDatabase } from './health';

export interface BackupManifest {
  format: 'FOX_SQLITE_BACKUP';
  formatVersion: 1;
  createdAt: string;
  applicationVersion: string;
  schemaVersion: number;
  sha256: string;
  kind?: 'MANUAL' | 'PRE_MIGRATION' | 'PRE_RESTORE';
}
const maxSize = 8 * 1024 * 1024 * 1024;
export function assertRegularFile(filename: string): void {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 512 || stat.size > maxSize)
    throw Error('FOX_BACKUP_FILE');
}
export async function fileHash(filename: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
function syncHash(filename: string): string {
  const hash = crypto.createHash('sha256'),
    buffer = Buffer.alloc(1024 * 1024),
    fd = fs.openSync(filename, 'r');
  try {
    let bytes: number;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, bytes));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}
export function durableWrite(filename: string, content: string): void {
  const fd = fs.openSync(filename, 'wx');
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function flush(filename: string): void {
  const fd = fs.openSync(filename, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
export function backupName(kind: string): string {
  return `FOX-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.sqlite`;
}
export function assertDestination(
  filename: string,
  databaseFile: string,
  installRoot?: string,
): void {
  if (
    !path.isAbsolute(filename) ||
    path.extname(filename).toLowerCase() !== '.sqlite' ||
    /[\x00-\x1f]/.test(filename)
  )
    throw Error('FOX_BACKUP_PATH');
  const parent = fs.realpathSync.native(path.dirname(filename));
  const target = path.join(parent, path.basename(filename));
  const same = (a: string, b: string) =>
    path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  if (same(target, databaseFile) || fs.existsSync(target) || fs.existsSync(target + '.json'))
    throw Error('FOX_BACKUP_OVERWRITE');
  if (installRoot) {
    const rel = path.relative(fs.realpathSync.native(installRoot), target);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw Error('FOX_BACKUP_INSTALL_PATH');
  }
}
function finalize(
  dbFile: string,
  applicationVersion: string,
  hash: string,
  kind: NonNullable<BackupManifest['kind']>,
): BackupManifest {
  assertRegularFile(dbFile);
  const snapshot = new Database(dbFile, { readonly: true, fileMustExist: true });
  let schemaVersion: number;
  try {
    schemaVersion = inspectDatabase(snapshot, true);
  } finally {
    snapshot.close();
  }
  const manifest: BackupManifest = {
    format: 'FOX_SQLITE_BACKUP',
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    applicationVersion,
    schemaVersion,
    sha256: hash,
    kind,
  };
  flush(dbFile);
  durableWrite(dbFile + '.json', JSON.stringify(manifest, null, 2));
  return manifest;
}
export async function createBackup(
  db: Database.Database,
  filename: string,
  version: string,
  kind: 'MANUAL' | 'PRE_RESTORE' = 'MANUAL',
): Promise<BackupManifest> {
  assertDestination(filename, db.name);
  const stage = filename + `.partial-${crypto.randomUUID()}`;
  let published = false,
    publishedMetadata = false;
  try {
    await db.backup(stage);
    const manifest = finalize(stage, version, await fileHash(stage), kind);
    // Source is a closed verified SQLite snapshot; exclusive copy supports USB/FAT too.
    fs.copyFileSync(stage, filename, fs.constants.COPYFILE_EXCL);
    published = true;
    flush(filename);
    fs.copyFileSync(stage + '.json', filename + '.json', fs.constants.COPYFILE_EXCL);
    publishedMetadata = true;
    flush(filename + '.json');
    await validateBackup(filename);
    return manifest;
  } catch (error) {
    if (published) fs.unlinkSync(filename);
    if (publishedMetadata) fs.unlinkSync(filename + '.json');
    throw error;
  } finally {
    for (const candidate of [stage, stage + '.json'])
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
  }
}
export function createMigrationBackup(
  db: Database.Database,
  directory: string,
  version: string,
  targetVersion: number,
): string {
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, backupName(`before-v${targetVersion}`));
  // VACUUM INTO is SQLite's transactional consistent snapshot, including committed WAL data.
  // Startup has no competing services; manual/restore backups use the asynchronous backup API.
  db.prepare('VACUUM INTO ?').run(filename);
  finalize(filename, version, syncHash(filename), 'PRE_MIGRATION');
  const retained: { name: string; createdAt: number }[] = [];
  for (const name of fs
    .readdirSync(directory)
    .filter((name) => /^FOX-before-v\d+-.*\.sqlite$/.test(name))) {
    const candidate = path.join(directory, name);
    try {
      assertRegularFile(candidate);
      const stat = fs.lstatSync(candidate + '.json');
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) continue;
      const metadata = JSON.parse(fs.readFileSync(candidate + '.json', 'utf8')) as BackupManifest;
      if (
        metadata.format === 'FOX_SQLITE_BACKUP' &&
        metadata.kind === 'PRE_MIGRATION' &&
        Number.isFinite(Date.parse(metadata.createdAt)) &&
        metadata.sha256 === syncHash(candidate)
      )
        retained.push({ name, createdAt: Date.parse(metadata.createdAt) });
    } catch {
      /* Unknown, legacy and incomplete files remain available for support. */
    }
  }
  retained.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
  for (const { name } of retained.slice(5)) {
    const old = path.join(directory, name);
    fs.unlinkSync(old);
    fs.unlinkSync(old + '.json');
  }
  return filename;
}
export async function validateBackup(filename: string): Promise<BackupManifest> {
  if (!path.isAbsolute(filename) || path.extname(filename).toLowerCase() !== '.sqlite')
    throw Error('FOX_BACKUP_PATH');
  assertRegularFile(filename);
  const metadataStat = fs.lstatSync(filename + '.json');
  if (!metadataStat.isFile() || metadataStat.isSymbolicLink() || metadataStat.size > 4096)
    throw Error('FOX_BACKUP_MANIFEST');
  const metadata = JSON.parse(fs.readFileSync(filename + '.json', 'utf8')) as BackupManifest;
  if (
    metadata.format !== 'FOX_SQLITE_BACKUP' ||
    metadata.formatVersion !== 1 ||
    !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(metadata.applicationVersion) ||
    !Number.isFinite(Date.parse(metadata.createdAt)) ||
    !/^[a-f0-9]{64}$/.test(metadata.sha256)
  )
    throw Error('FOX_BACKUP_MANIFEST');
  if (
    metadata.kind !== undefined &&
    !['MANUAL', 'PRE_MIGRATION', 'PRE_RESTORE'].includes(metadata.kind)
  )
    throw Error('FOX_BACKUP_MANIFEST');
  if ((await fileHash(filename)) !== metadata.sha256) throw Error('FOX_BACKUP_CHECKSUM');
  const snapshot = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    if (inspectDatabase(snapshot, true) !== metadata.schemaVersion)
      throw Error('FOX_BACKUP_SCHEMA');
  } finally {
    snapshot.close();
  }
  return metadata;
}
