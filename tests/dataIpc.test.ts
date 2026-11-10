import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
const handlers = vi.hoisted(
  () => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
);
vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => handlers.set(channel, handler),
  },
}));
import { registerIpc } from '../electron/ipc/register';
import { DATA_IPC, IPC } from '../src/types/api';
import type { DataProtectionService } from '../electron/main/dataProtection';
import type { ReceiptService, PrintManager } from '../electron/receipts/manager';
import type { createRepositories } from '../electron/database/repositories';
import type { createConfigurationService } from '../electron/database/configuration';
import type { createOrderService } from '../electron/database/orders';
import type { createCheckoutService } from '../electron/database/checkout';
const contents = { mainFrame: {} },
  operations = {
    diagnostics: vi.fn(),
    copyDiagnostics: vi.fn(),
    backup: vi.fn(),
    restore: vi.fn(),
    rendererError: vi.fn(),
    isMaintenance: vi.fn(() => false),
  };
const event = () =>
  ({ sender: contents, senderFrame: contents.mainFrame }) as unknown as IpcMainInvokeEvent;
beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  operations.isMaintenance.mockReturnValue(false);
  registerIpc(
    { webContents: contents } as unknown as BrowserWindow,
    {} as ReturnType<typeof createRepositories>,
    {} as ReturnType<typeof createConfigurationService>,
    {} as ReturnType<typeof createOrderService>,
    {} as ReturnType<typeof createCheckoutService>,
    {} as ReceiptService,
    {} as PrintManager,
    operations as unknown as DataProtectionService,
  );
});
it('allows only one top-frame owner business-name request and refuses writes during restore maintenance', () => {
  const update = vi.fn(() => ({ ok: true, data: { businessName: 'FOX Kafeteri' } }));
  handlers.clear();
  registerIpc(
    { webContents: contents } as unknown as BrowserWindow,
    {} as ReturnType<typeof createRepositories>,
    { updateBusinessName: update } as unknown as ReturnType<typeof createConfigurationService>,
    {} as ReturnType<typeof createOrderService>,
    {} as ReturnType<typeof createCheckoutService>,
    {} as ReceiptService,
    {} as PrintManager,
    operations as unknown as DataProtectionService,
  );
  const handler = handlers.get('fox:settings:business-name')!,
    input = { businessName: 'FOX Kafeteri' };
  expect(handler(event(), input)).toEqual({ ok: true, data: input });
  expect(update).toHaveBeenCalledTimes(1);
  for (const bad of [
    { ...event(), sender: {} },
    { ...event(), senderFrame: {} },
  ])
    expect(() => handler(bad as IpcMainInvokeEvent, input)).toThrow();
  expect(() => handler(event())).toThrow();
  expect(() => handler(event(), input, input)).toThrow();
  operations.isMaintenance.mockReturnValue(true);
  expect(() => handler(event(), input)).toThrow('FOX_DATA_MAINTENANCE');
  expect(update).toHaveBeenCalledTimes(1);
});
describe('data protection authority', () => {
  it.each([DATA_IPC.backup, DATA_IPC.restore, DATA_IPC.copy, DATA_IPC.diagnostics])(
    'rejects arbitrary path or payload on %s',
    (channel) => {
      expect(() => handlers.get(channel)!(event(), 'C:\\Windows\\arbitrary.sqlite')).toThrow(
        'Unauthorized',
      );
    },
  );
  it('rejects other window and iframe before any native dialog or operation', () => {
    for (const channel of Object.values(DATA_IPC)) {
      expect(() =>
        handlers.get(channel)!({ ...event(), sender: {} } as IpcMainInvokeEvent),
      ).toThrow('Unauthorized');
      expect(() =>
        handlers.get(channel)!({ ...event(), senderFrame: {} } as IpcMainInvokeEvent),
      ).toThrow('Unauthorized');
    }
    expect(operations.restore).not.toHaveBeenCalled();
    expect(operations.backup).not.toHaveBeenCalled();
  });
  it('stops all business/receipt IPC while replacement owns the database', () => {
    operations.isMaintenance.mockReturnValue(true);
    for (const channel of [IPC.completeOrder, IPC.addProduct, IPC.receiptTest, DATA_IPC.backup])
      expect(() => handlers.get(channel)!(event(), {})).toThrow('MAINTENANCE');
  });
  it('exposes intentional zero-argument operations without filesystem APIs', () => {
    handlers.get(DATA_IPC.backup)!(event());
    expect(operations.backup).toHaveBeenCalledOnce();
    expect([...handlers.keys()]).not.toContain('fox:data:raw-file');
  });
});
