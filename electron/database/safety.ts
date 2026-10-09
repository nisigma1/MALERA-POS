import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Resolve existing ancestors too, so junctions/symlinks cannot disguise an interactive path.
function canonical(filename: string): string {
  const absolute = path.resolve(filename);
  if (fs.existsSync(absolute)) return fs.realpathSync.native(absolute);
  return path.join(canonical(path.dirname(absolute)), path.basename(absolute));
}
function inside(root: string, target: string): boolean {
  const relative = path.relative(canonical(root), canonical(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
export function assertTestDatabasePath(filename: string): void {
  if (filename === ':memory:') return;
  const relative = path.relative(canonical(os.tmpdir()), canonical(filename));
  if (relative.startsWith('..') || path.isAbsolute(relative) || !/^fox-[^\\/]+[\\/]/.test(relative)) {
    throw new Error('FOX tests require an isolated fox-* temporary database');
  }
}
export function assertQaDirectory(directory: string, normalUserData?: string): void {
  assertTestDatabasePath(path.join(directory, 'fox.sqlite'));
  if (!path.isAbsolute(directory) || !path.basename(directory).startsWith('fox-qa-') ||
      (normalUserData && (inside(normalUserData, directory) || inside(directory, normalUserData)))) {
    throw new Error('FOX verification cannot use the interactive database directory');
  }
  const marker = JSON.parse(fs.readFileSync(path.join(directory, '.fox-qa.json'), 'utf8')) as { version?: unknown; directory?: unknown };
  if (marker.version !== 1 || marker.directory !== canonical(directory)) throw new Error('FOX verification directory is not authorized');
}
export function verificationDirectory(normalUserData: string, env: NodeJS.ProcessEnv): string | undefined {
  const testing = env.NODE_ENV === 'test' || Boolean(env.VITEST) || Object.keys(env).some(key => key.startsWith('FOX_VERIFY_') && Boolean(env[key]));
  if (!testing) return undefined;
  if (!env.FOX_VERIFY_DIR) throw new Error('FOX verification requires an isolated directory');
  assertQaDirectory(env.FOX_VERIFY_DIR, normalUserData);
  return env.FOX_VERIFY_DIR;
}
