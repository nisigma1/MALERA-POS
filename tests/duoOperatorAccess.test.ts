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
import { openDatabase } from '../electron/database/connection';
import { createOrderService } from '../electron/database/orders';
import { createRepositories } from '../electron/database/repositories';
import { createCheckoutService } from '../electron/database/checkout';
import { readShiftSales } from '../electron/database/duoReports';

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
    const submitDraft = vi.fn(() => ({ ok: true, data: { reservation: null } }));
    const db = openDatabase(':memory:');
    try {
      db.prepare(
        "UPDATE products SET selling_price_cents=150,track_inventory=0 WHERE id='KAFE-1'",
      ).run();
      const orders = createOrderService(db, createRepositories(db));
      const added = orders.addProduct({ tableId: 'M5', productId: 'KAFE-1' });
      if (!added.ok || !added.data.order) throw Error('Could not prepare an existing order');
      const { id: orderId, revision: expectedRevision } = added.data.order;
      const checkout = createCheckoutService(db, orders);
      const kick = vi.fn();
      const shiftReport = vi.fn((period: unknown) => readShiftSales(db, period));
      const repo = { listTables: () => [], listProducts: () => [{ purchaseCostCents: 30 }] };
      registerIpc(
        { webContents: contents } as unknown as BrowserWindow,
        repo as never,
        {} as never,
        { submitDraft } as never,
        checkout,
        {} as never,
        { kick } as never,
        undefined,
        {} as never,
        undefined,
        access,
        shiftReport,
      );

      expect(() => call(IPC.tables)).toThrow('nuk lejohet');
      expect(() => call(IPC.completeOrder, { orderId, expectedRevision })).toThrow('nuk lejohet');
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
      expect(call(IPC.completeOrder, { orderId })).toMatchObject({
        ok: false,
        code: 'INVALID_REQUEST',
      });
      expect(call(IPC.completeOrder, { orderId, expectedRevision: 'stale' })).toMatchObject({
        ok: false,
        code: 'ORDER_CHANGED',
      });
      expect(call(IPC.completeOrder, { orderId, expectedRevision })).toMatchObject({
        ok: true,
        data: { workspace: { table: { status: 'FREE' } } },
      });
      expect(call(IPC.completeOrder, { orderId, expectedRevision })).toMatchObject({
        ok: false,
        code: 'ALREADY_COMPLETED',
      });
      expect(kick).toHaveBeenCalledTimes(1);
      expect(db.prepare('SELECT payment_method FROM order_payments').pluck().all()).toEqual([
        'CASH',
      ]);
      expect(
        db.prepare("SELECT amount_cents FROM cash_events WHERE kind='CASH_SALE_IN'").pluck().all(),
      ).toEqual([150]);
      expect(db.prepare('SELECT count(*) FROM receipt_documents').pluck().get()).toBe(1);
      for (const channel of [IPC.products, IPC.settings, FINANCE_IPC.report, OPERATOR_IPC.report]) {
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
      expect(call(OPERATOR_IPC.report, 'DAY')).toMatchObject({ totalCents: 150 });
      expect(shiftReport).toHaveBeenCalledExactlyOnceWith('DAY');
    } finally {
      db.close();
    }

    rmSync(path.join(profile, OPERATOR_FILE));
    expect(requiresOperatorLogin(profile)).toBe(true);
    expect(createOperatorSession(profile, true).status()).toMatchObject({
      required: true,
      configured: false,
    });
  },
  60000,
);

it.runIf(process.platform === 'win32')(
  'enrolls only an unconfigured DUO terminal and reopens with the PINs saved from the app',
  () => {
    const firstRun = path.join(root, 'first-run');
    mkdirSync(firstRun);
    const pins = { OWNER: ownerPin, AM: workerPin, PM: workerPin };
    const access = createOperatorSession(firstRun, true, Date.now, true);
    expect(access.status()).toEqual({
      required: true,
      configured: false,
      operator: null,
      setupPending: true,
    });
    expect(() => createOperatorSession(firstRun, false).enroll(pins)).toThrow('nuk është');
    expect(() => access.login({ id: 'OWNER', pin: ownerPin })).toThrow('konfigurohet');
    expect(() => access.enroll({ ...pins, OWNER: workerPin })).toThrow('i ndryshëm');
    expect(() => access.enroll({ OWNER: ownerPin })).toThrow('katër shifra');
    expect(requiresOperatorLogin(firstRun)).toBe(false);

    const webContents = { mainFrame: {} };
    const event = {
      sender: webContents,
      senderFrame: webContents.mainFrame,
    } as unknown as IpcMainInvokeEvent;
    registerIpc(
      { webContents } as unknown as BrowserWindow,
      { listTables: () => [] } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      access,
    );
    const enroll = handlers.get(OPERATOR_IPC.enroll)!;
    expect(() => enroll({ ...event, senderFrame: {} } as IpcMainInvokeEvent, pins)).toThrow(
      'Unauthorized',
    );
    expect(() => handlers.get(IPC.tables)!(event)).toThrow('nuk lejohet');
    expect(enroll(event, pins)).toEqual({ required: true, configured: true, operator: null });
    expect(() => enroll(event, { ...pins, OWNER: wrongPin })).toThrow('nuk është');
    expect(() => handlers.get(IPC.tables)!(event)).toThrow('nuk lejohet');

    const restarted = createOperatorSession(firstRun, true);
    expect(restarted.login({ id: 'OWNER', pin: ownerPin })).toMatchObject({ operator: 'OWNER' });
    restarted.logout();
    expect(restarted.login({ id: 'PM', pin: workerPin })).toMatchObject({ operator: 'PM' });

    rmSync(path.join(firstRun, OPERATOR_FILE));
    expect(requiresOperatorLogin(firstRun)).toBe(true);
    expect(() => createOperatorSession(firstRun, true, Date.now, true).enroll(pins)).toThrow(
      'nuk është',
    );
  },
  30000,
);
