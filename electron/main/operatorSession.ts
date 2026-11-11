import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { durableWrite } from '../database/backups';
import { OPERATORS, type OperatorId, type OperatorSession } from '../../src/domain/operators';

export const OPERATOR_FILE = 'duo-operators-v1.json';
const ENROLLMENT_FILE = 'duo-operator-enrollment-v1';

export function requiresOperatorLogin(directory: string) {
  // Both files stay outside SQLite backups. After enrollment, a missing or
  // damaged credential file must never restore the old unrestricted login.
  return [ENROLLMENT_FILE, OPERATOR_FILE].some((file) => {
    try {
      fs.lstatSync(path.join(directory, file));
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ENOENT';
    }
  });
}
const ATTEMPTS_FILE = 'duo-operator-attempts.json';
const WAIT_MS = 60_000;
const PIN_ITERATIONS = 600000;
const identifiers = Object.keys(OPERATORS) as OperatorId[];

type Verifier = { salt: string; hash: string };
type Attempts = { failures: number; lockedUntil: number };
const unprotect = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$encrypted = [Convert]::FromBase64String([Console]::In.ReadLine())
$bytes = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
try { [Console]::Write([Text.Encoding]::UTF8.GetString($bytes)) }
finally { [Array]::Clear($bytes, 0, $bytes.Length) }
`;

const protect = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadLine())
try {
  $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Write([Convert]::ToBase64String($encrypted))
} finally { [Array]::Clear($bytes, 0, $bytes.Length) }
`;

function runDpapi(script: string, input: string) {
  if (process.platform !== 'win32' || !process.env.SystemRoot)
    throw Error('Mbrojtja e PIN-eve kërkon Windows.');
  const powershell = path.join(
    process.env.SystemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return execFileSync(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      input: input + '\n',
      env: { ...process.env, PSModulePath: path.join(path.dirname(powershell), 'Modules') },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 8192,
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  );
}

function readVerifiers(file: string): Record<OperatorId, Verifier> | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return null;
    const envelope = fs.readFileSync(file, 'ascii').trim();
    if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(envelope)) return null;
    const json = runDpapi(unprotect, envelope);
    const data = JSON.parse(json) as { version: unknown; users: Record<OperatorId, Verifier> };
    if (
      data.version !== 1 ||
      !data.users ||
      !identifiers.every(
        (id) =>
          /^[a-f0-9]{32}$/.test(data.users[id]?.salt) &&
          /^[a-f0-9]{64}$/.test(data.users[id]?.hash),
      ) ||
      new Set(identifiers.map((id) => data.users[id].salt)).size !== identifiers.length
    )
      return null;
    return data.users;
  } catch {
    return null;
  }
}

export function createOperatorSession(
  directory: string,
  required: boolean,
  clock = Date.now,
  setupPending = false,
) {
  const file = path.join(directory, OPERATOR_FILE);
  const attemptsFile = path.join(directory, ATTEMPTS_FILE);
  let operator: OperatorId | null = null;
  let verifiers = required ? readVerifiers(file) : null;
  function status(): OperatorSession {
    return {
      required,
      configured: !required || verifiers !== null,
      operator,
      ...(setupPending && !verifiers ? { setupPending: true } : {}),
    };
  }
  function writeAttempts(attempts: Partial<Record<OperatorId, Attempts>>) {
    const stage = attemptsFile + '.' + randomUUID() + '.next';
    fs.writeFileSync(stage, JSON.stringify(attempts), { mode: 0o600, flush: true, flag: 'wx' });
    try {
      fs.renameSync(stage, attemptsFile);
    } finally {
      fs.rmSync(stage, { force: true });
    }
  }
  return {
    required,
    status,
    current: () => operator,
    logout() {
      operator = null;
      return status();
    },
    enroll(input: unknown): OperatorSession {
      if (!required || !setupPending || verifiers || requiresOperatorLogin(directory))
        throw Error('Konfigurimi i PIN-eve nuk është i disponueshëm.');
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('Shkruaj nga një PIN me katër shifra për secilën llogari.');
      const pins = input as Record<OperatorId, string>;
      if (!identifiers.every((id) => typeof pins[id] === 'string' && /^\d{4}$/.test(pins[id])))
        throw Error('Shkruaj nga një PIN me katër shifra për secilën llogari.');
      if (pins.OWNER === pins.AM || pins.OWNER === pins.PM)
        throw Error('PIN-i i pronarit duhet të jetë i ndryshëm nga PIN-et e punonjësve.');

      const users = {} as Record<OperatorId, Verifier>;
      for (const id of identifiers) {
        const salt = randomBytes(16);
        const hash = pbkdf2Sync(pins[id], salt, PIN_ITERATIONS, 32, 'sha256');
        users[id] = { salt: salt.toString('hex'), hash: hash.toString('hex') };
      }
      const envelope = runDpapi(protect, JSON.stringify({ version: 1, users }));
      const stage = file + '.' + randomUUID() + '.next';
      try {
        durableWrite(stage, envelope);
        // Publish only the complete file, and never replace existing PINs.
        fs.linkSync(stage, file);
        durableWrite(path.join(directory, ENROLLMENT_FILE), '1');
      } finally {
        fs.rmSync(stage, { force: true });
      }
      verifiers = users;
      return status();
    },
    login(input: unknown): OperatorSession {
      if (!required || operator !== null)
        throw Error('Dil nga llogaria para se të ndërrosh përdoruesin.');
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('Hyrja nuk u pranua.');
      const { id, pin } = input as Record<string, unknown>;
      if (
        !identifiers.includes(id as OperatorId) ||
        typeof pin !== 'string' ||
        !/^\d{4}$/.test(pin)
      )
        throw Error('Zgjidh përdoruesin dhe shkruaj PIN-in me katër shifra.');
      const operatorId = id as OperatorId;
      const user = verifiers?.[operatorId];
      if (!user) throw Error('Hyrja me PIN duhet të konfigurohet në HP.');
      const now = clock();
      let attempts: Partial<Record<OperatorId, Attempts>> = {};
      if (fs.existsSync(attemptsFile)) {
        const stat = fs.lstatSync(attemptsFile);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512)
          throw Error('Hyrja nuk është e disponueshme.');
        attempts = JSON.parse(fs.readFileSync(attemptsFile, 'utf8'));
        if (
          !attempts ||
          typeof attempts !== 'object' ||
          Array.isArray(attempts) ||
          Object.entries(attempts).some(
            ([account, entry]) =>
              !identifiers.includes(account as OperatorId) ||
              !entry ||
              !Number.isSafeInteger(entry.failures) ||
              entry.failures < 0 ||
              entry.failures > 5 ||
              !Number.isSafeInteger(entry.lockedUntil) ||
              entry.lockedUntil < 0,
          )
        )
          throw Error('Hyrja nuk është e disponueshme.');
      }
      const prior = attempts[operatorId];
      if (prior && prior.lockedUntil > now) throw Error('Prit një minutë para provës tjetër.');
      const hash = pbkdf2Sync(pin, Buffer.from(user.salt, 'hex'), PIN_ITERATIONS, 32, 'sha256');
      if (!timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) {
        const failures = (prior?.lockedUntil ? 0 : (prior?.failures ?? 0)) + 1;
        attempts[operatorId] = { failures, lockedUntil: failures >= 5 ? now + WAIT_MS : 0 };
        writeAttempts(attempts);
        throw Error(
          failures >= 5
            ? 'Prit një minutë para provës tjetër.'
            : 'Përdoruesi ose PIN-i nuk përputhet.',
        );
      }
      delete attempts[operatorId];
      writeAttempts(attempts);
      operator = operatorId;
      return status();
    },
  };
}
export type OperatorAccess = ReturnType<typeof createOperatorSession>;
