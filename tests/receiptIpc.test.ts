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
import { IPC } from '../src/types/api';
import type { ReceiptService, PrintManager } from '../electron/receipts/manager';
import type { createRepositories } from '../electron/database/repositories';
import type { createConfigurationService } from '../electron/database/configuration';
import type { createOrderService } from '../electron/database/orders';
import type { createCheckoutService } from '../electron/database/checkout';
const contents = { mainFrame: {} };
const receiptCalls = {
  copy: vi.fn(async () => ({ ok: true })),
  state: vi.fn(async () => ({ ok: true })),
  listPrinters: vi.fn(async () => ({ ok: true })),
  recentJobs: vi.fn(() => []),
  getSettings: vi.fn(() => ({})),
  saveSettings: vi.fn(),
  testPrint: vi.fn(),
  retry: vi.fn(),
};
const event = () =>
  ({ sender: contents, senderFrame: contents.mainFrame }) as unknown as IpcMainInvokeEvent;
beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  registerIpc(
    { webContents: contents } as unknown as BrowserWindow,
    {} as ReturnType<typeof createRepositories>,
    {} as ReturnType<typeof createConfigurationService>,
    {} as ReturnType<typeof createOrderService>,
    {} as ReturnType<typeof createCheckoutService>,
    receiptCalls as unknown as ReceiptService,
    { kick: vi.fn() } as unknown as PrintManager,
  );
});
describe('receipt IPC sender/frame and argument boundary', () => {
  it('accepts minimal sale-id action only from the main UI frame', async () => {
    const action = { saleId: 'sale', requestId: 'request' };
    await handlers.get(IPC.receiptCopy)!(event(), action);
    expect(receiptCalls.copy).toHaveBeenCalledWith(action);
  });
  it('rejects another webContents, including hidden print renderer', async () => {
    await expect(
      handlers.get(IPC.receiptCopy)!({ ...event(), sender: {} } as IpcMainInvokeEvent, {}),
    ).rejects.toThrow('Unauthorized');
    expect(receiptCalls.copy).not.toHaveBeenCalled();
  });
  it('rejects iframe sender', async () => {
    await expect(
      handlers.get(IPC.receiptCopy)!({ ...event(), senderFrame: {} } as IpcMainInvokeEvent, {}),
    ).rejects.toThrow('Unauthorized');
    expect(receiptCalls.copy).not.toHaveBeenCalled();
  });
  it('rejects extra parameters to read and copy APIs', async () => {
    await expect(handlers.get(IPC.receiptPrinters)!(event(), 'arbitrary html')).rejects.toThrow(
      'Unauthorized',
    );
    await expect(handlers.get(IPC.receiptCopy)!(event(), {}, 'extra')).rejects.toThrow(
      'Unauthorized',
    );
  });
  it('does not expose raw HTML/printer execution channel', () => {
    expect([...handlers.keys()]).not.toContain('fox:receipts:raw-print');
    expect([...handlers.keys()].filter((k) => k.startsWith('fox:receipts:'))).toHaveLength(8);
  });
});
