import {mkdtempSync, realpathSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export function createQaDirectory(kind) {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), `fox-qa-${kind}-`)));
  writeFileSync(path.join(directory, '.fox-qa.json'), JSON.stringify({version:1,directory}));
  return directory;
}
