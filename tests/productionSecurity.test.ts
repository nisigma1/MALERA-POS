import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { allowedResource } from '../electron/main/security';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fox-security-'));
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
describe('local assets and remote navigation boundary', () => {
  it('allows local bundle and rejects sibling files and remote/UNC/malformed targets', () => {
    const root = path.join(directory, 'dist');
    fs.mkdirSync(root, { recursive: true });
    const local = path.join(root, 'index.html'),
      sibling = path.join(directory, 'secret.txt');
    fs.writeFileSync(local, 'local');
    fs.writeFileSync(sibling, 'outside');
    expect(allowedResource(pathToFileURL(local).href, root)).toBe(true);
    for (const target of [
      pathToFileURL(sibling).href,
      'https://example.com',
      'file://server/share/file',
      'javascript:alert(1)',
      'not a URL',
    ])
      expect(allowedResource(target, root)).toBe(false);
  });
  it('development host is explicit and cannot authorize another origin', () => {
    const root = path.join(directory, 'dist');
    expect(
      allowedResource('http://127.0.0.1:5173/src/main.tsx', root, 'http://127.0.0.1:5173'),
    ).toBe(true);
    expect(allowedResource('http://127.0.0.1:5174/', root, 'http://127.0.0.1:5173')).toBe(false);
    expect(allowedResource('http://127.0.0.1:5173/', root)).toBe(false);
  });
});
