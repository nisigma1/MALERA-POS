import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import {
  createOperatorSession,
  OPERATOR_FILE,
  requiresOperatorLogin,
} from '../electron/main/operatorSession';
import { IPC, FINANCE_IPC, OPERATOR_IPC } from '../src/types/api';
import { registerIpc } from '../electron/ipc/register';

const handlers = vi.hoisted(
  () => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
);
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: never) => handlers.set(channel, handler) },
}));

let root: string;
let profile: string;
const uniquePins = new Set<string>();
while (uniquePins.size < 3) uniquePins.add(String(randomInt(10000)).padStart(4, '0'));
const [ownerPin, workerPin, wrongPin] = [...uniquePins] as [string, string, string];

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'fox-duo-pin-'));
  profile = path.join(root, 'FOX Kafeteri');
  mkdirSync(profile);
});
afterAll(() => {
  if (!root || !existsSync(root)) return;
  const relative = path.relative(realpathSync.native(tmpdir()), realpathSync.native(root));
  if (!/^fox-duo-pin-[^\\/]+$/.test(relative)) throw Error('Unexpected fixture directory');
  rmSync(root, { recursive: true });
});

it('keeps the terminal usable until enrollment and locks a required profile without credentials', () => {
  expect(requiresOperatorLogin(profile)).toBe(false);
  expect(createOperatorSession(profile, false, Date.now, true).status()).toMatchObject({
    required: false,
    setupPending: true,
  });
  expect(createOperatorSession(profile, true).status()).toEqual({
    required: true,
    configured: false,
    operator: null,
  });
  expect(createOperatorSession(profile, false).status()).toEqual({
    required: false,
    configured: true,
    operator: null,
  });
});

it.runIf(process.platform === 'win32')(
  'provisions with native DPAPI and enforces separate identities and backend permissions',
  () => {
    writeFileSync(path.join(profile, 'fox.sqlite'), 'synthetic check fixture', { flag: 'wx' });
    // Only the prompt and process check are simulated. The script writes and protects actual
    // verifier bytes under an isolated APPDATA root. The desktop implementation unprotects them.
    const provision = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$global:duoFixtureInputs = [System.Collections.Queue]::new(([Console]::In.ReadLine() -split ','))
function Read-Host {
  $value = [Security.SecureString]::new()
  foreach ($ch in $global:duoFixtureInputs.Dequeue().ToCharArray()) { $value.AppendChar($ch) }
  return $value
}
function Get-Process { return }
function Write-Host { return }
try { & './scripts/release/provision-duo-pins.ps1' } catch {
  [Console]::Error.WriteLine("Provision test failure: " + $_.Exception.GetType().Name + ' ' + $_.FullyQualifiedErrorId + ' line ' + $_.InvocationInfo.ScriptLineNumber)
  exit 1
}
`;
    execFileSync(
      path.join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(provision, 'utf16le').toString('base64'),
      ],
      {
        env: {
          ...process.env,
          APPDATA: root,
          PSModulePath: path.join(
            process.env.SystemRoot!,
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'Modules',
          ),
        },
        input: [ownerPin, workerPin, workerPin].join(',') + '\n',
        timeout: 45000,
        stdio: ['pipe', 'ignore', 'inherit'],
        windowsHide: true,
      },
    );
    expect(existsSync(path.join(profile, OPERATOR_FILE))).toBe(true);
    expect(requiresOperatorLogin(profile)).toBe(true);

    let now = Date.now();
    const access = createOperatorSession(profile, true, () => now);
    expect(access.status().configured).toBe(true);
    const contents = { mainFrame: {} };
    const event = {
      sender: contents,
      senderFrame: contents.mainFrame,
    } as unknown as IpcMainInvokeEvent;
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args);
    const submitDraft = vi.fn(() => ({ ok: true }));
    const shiftReport = vi.fn();
    const repo = { listTables: () => [], listProducts: () => [{ purchaseCostCents: 30 }] };
    registerIpc(
      { webContents: contents } as unknown as BrowserWindow,
      repo as never,
      {} as never,
      { submitDraft } as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      {} as never,
      undefined,
      access,
      shiftReport,
    );

    expect(() => call(IPC.tables)).toThrow('nuk lejohet');
    for (let attempt = 0; attempt < 4; attempt++) {
      expect(() => call(OPERATOR_IPC.login, { id: 'OWNER', pin: workerPin })).toThrow(
        'nuk përputhet',
      );
    }
    expect(call(OPERATOR_IPC.login, { id: 'AM', pin: workerPin })).toMatchObject({
      operator: 'AM',
    });
    expect(call(IPC.tables)).toEqual([]);
    expect(call(OPERATOR_IPC.catalog)).toMatchObject([{ purchaseCostCents: null }]);
    expect(() =>
      handlers.get(IPC.tables)!({ ...event, senderFrame: {} } as IpcMainInvokeEvent),
    ).toThrow('Unauthorized');
    expect(() => call(IPC.addProduct, { tableId: 'M5' })).toThrow('POROSIT');
    expect(call(IPC.addProduct, { requestId: 'test-only' })).toMatchObject({ ok: true });
    expect(submitDraft).toHaveBeenCalledTimes(1);
    for (const channel of [
      IPC.products,
      IPC.completeOrder,
      IPC.settings,
      FINANCE_IPC.report,
      OPERATOR_IPC.report,
    ]) {
      expect(() => call(channel, {})).toThrow('nuk lejohet');
    }
    expect(() => call(OPERATOR_IPC.login, { id: 'OWNER', pin: ownerPin })).toThrow(
      'Dil nga llogaria',
    );
    call(OPERATOR_IPC.logout);
    expect(call(OPERATOR_IPC.login, { id: 'PM', pin: workerPin })).toMatchObject({
      operator: 'PM',
    });
    call(OPERATOR_IPC.logout);
    expect(() => call(OPERATOR_IPC.login, { id: 'OWNER', pin: wrongPin })).toThrow(
      'Prit një minutë',
    );

    const restarted = createOperatorSession(profile, true, () => now);
    expect(() => restarted.login({ id: 'OWNER', pin: ownerPin })).toThrow('Prit një minutë');
    now += 60001;
    expect(call(OPERATOR_IPC.login, { id: 'OWNER', pin: ownerPin })).toMatchObject({
      operator: 'OWNER',
    });
    call(OPERATOR_IPC.report, 'DAY');
    expect(shiftReport).toHaveBeenCalledExactlyOnceWith('DAY');

    rmSync(path.join(profile, OPERATOR_FILE));
    expect(requiresOperatorLogin(profile)).toBe(true);
    expect(createOperatorSession(profile, true).status()).toMatchObject({
      required: true,
      configured: false,
    });
  },
  60000,
);
