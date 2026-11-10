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
import { FINANCE_IPC } from '../src/types/api';
import type { createFinanceService } from '../electron/database/finance';
const contents = { mainFrame: {} },
  finance = {
    report: vi.fn(),
    saveExpense: vi.fn(),
    expenseHistory: vi.fn(),
    recordLoss: vi.fn(),
    cashPreview: vi.fn(),
    closeCash: vi.fn(),
    recordCashMovement: vi.fn(),
  },
  maintenance = { isMaintenance: vi.fn(() => false) };
const event = () =>
  ({ sender: contents, senderFrame: contents.mainFrame }) as unknown as IpcMainInvokeEvent;
beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  maintenance.isMaintenance.mockReturnValue(false);
  registerIpc(
    { webContents: contents } as unknown as BrowserWindow,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    maintenance as never,
    finance as unknown as ReturnType<typeof createFinanceService>,
  );
});
describe('financial IPC authority', () => {
  it.each(Object.values(FINANCE_IPC))(
    'protects %s against foreign windows, frames and wrong arity',
    (channel) => {
      const handler = handlers.get(channel)!;
      expect(() => handler({ ...event(), sender: {} } as IpcMainInvokeEvent, {})).toThrow(
        'Unauthorized',
      );
      expect(() => handler({ ...event(), senderFrame: {} } as IpcMainInvokeEvent, {})).toThrow(
        'Unauthorized',
      );
      expect(() => handler(event())).toThrow('Unauthorized');
      expect(() => handler(event(), {}, {})).toThrow('Unauthorized');
      expect(Object.values(finance).every((f) => f.mock.calls.length === 0)).toBe(true);
    },
  );
  it('blocks all financial reads and writes during restore maintenance', () => {
    maintenance.isMaintenance.mockReturnValue(true);
    for (const channel of Object.values(FINANCE_IPC))
      expect(() => handlers.get(channel)!(event(), {})).toThrow('MAINTENANCE');
  });
  it('routes finance through the canonical service only', () => {
    const query = { period: 'TODAY' };
    handlers.get(FINANCE_IPC.report)!(event(), query);
    expect(finance.report).toHaveBeenCalledWith(query);
    expect(finance.report).toHaveBeenCalledOnce();
  });
});
