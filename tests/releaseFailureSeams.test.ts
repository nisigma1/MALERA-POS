import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { openDatabase } from '../electron/database/connection';
import { createBackup } from '../electron/database/backups';
import type { replaceDatabase } from '../electron/database/restore';
import { configure, sale, snapshot, assertAll } from './support/reliability';

it('release restore cannot execute a failure callback and continues with exact restored state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fox-release-seam-')),
    file = path.join(root, 'fox.sqlite');
  let db = openDatabase(file);
  try {
    configure(db);
    sale(db);
    const before = snapshot(db),
      backup = path.join(root, 'verified.sqlite');
    await createBackup(db, backup, '0.7.2-rc.1');
    sale(db, 'M6');
    const output = path.resolve('work/release-restore-security.cjs');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    buildSync({
      entryPoints: ['electron/database/restore.ts'],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['better-sqlite3'],
      define: { FOX_RELEASE: 'true' },
      minifySyntax: true,
    });
    const require = createRequire(import.meta.url);
    delete require.cache[output];
    const release = require(output) as { replaceDatabase: typeof replaceDatabase };
    let injected = 0;
    await release.replaceDatabase(
      db,
      backup,
      root,
      '0.7.2-rc.1',
      () => {},
      () => {
        injected++;
        throw Error('QA_RELEASE_FAILURE_SEAM');
      },
    );
    expect(injected).toBe(0);
    expect(/inject\?\.\(/.test(fs.readFileSync(output, 'utf8'))).toBe(false);
    db = openDatabase(file);
    expect(snapshot(db)).toEqual(before);
    sale(db, 'M6');
    assertAll(db);
  } finally {
    if (db.open) db.close();
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('fox-release-seam-'))
      throw Error('Unsafe QA cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
