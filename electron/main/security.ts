import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function allowedResource(value: string, rendererRoot: string, devUrl?: string): boolean {
  try {
    const url = new URL(value);
    if (devUrl && ['http:', 'ws:'].includes(url.protocol) && url.host === new URL(devUrl).host)
      return true;
    if (url.protocol !== 'file:' || url.hostname) return false;
    const file = fs.realpathSync.native(fileURLToPath(url)),
      root = fs.realpathSync.native(rendererRoot),
      relative = path.relative(root, file);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}
