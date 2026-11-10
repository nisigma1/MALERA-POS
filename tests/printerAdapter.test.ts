import { describe, it, expect, vi, beforeEach } from 'vitest';
const state = vi.hoisted(() => ({
  windows: [] as {
    destroyed: boolean;
    options: Record<string, unknown>;
    url: string;
    printOptions: Record<string, unknown> | null;
  }[],
  rejectPrint: false,
  failLoad: false,
}));
vi.mock('electron', () => ({
  BrowserWindow: class {
    entry: {
      destroyed: boolean;
      options: Record<string, unknown>;
      url: string;
      printOptions: Record<string, unknown> | null;
    };
    constructor(options: Record<string, unknown>) {
      this.entry = { destroyed: false, options, url: '', printOptions: null };
      state.windows.push(this.entry);
    }
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() },
      },
      executeJavaScript: async () => 600,
      print: (options: Record<string, unknown>, callback: (success: boolean) => void) => {
        this.entry.printOptions = options;
        callback(!state.rejectPrint);
      },
    };
    async loadURL(url: string) {
      this.entry.url = url;
      if (state.failLoad) throw Error('QA load failure');
    }
    isDestroyed() {
      return this.entry.destroyed;
    }
    destroy() {
      this.entry.destroyed = true;
    }
  },
}));
import { WindowsPrinterAdapter } from '../electron/receipts/windowsAdapter';
import type { BrowserWindow } from 'electron';
beforeEach(() => {
  state.windows = [];
  state.rejectPrint = false;
  state.failLoad = false;
});
const adapter = () =>
  new WindowsPrinterAdapter({
    webContents: {
      getPrintersAsync: async () => [
        {
          name: 'Exact-system-name',
          displayName: 'Friendly',
          description: 'Driver',
          options: { secret: 'not exposed' },
        },
      ],
    },
  } as unknown as BrowserWindow);
describe('Windows adapter contract and cleanup', () => {
  it('discovery exposes only exact name, display name and description', async () => {
    expect(await adapter().list()).toEqual([
      { deviceName: 'Exact-system-name', displayName: 'Friendly', description: 'Driver' },
    ]);
  });
  it('uses secured hidden renderer, explicit 80mm page and exact printer without fallback', async () => {
    await adapter().submit('<html>Çaj</html>', 'Exact-system-name', new AbortController().signal);
    const window = state.windows[0]!;
    expect(window.options).toMatchObject({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    expect(window.url).toMatch(/^data:text\/html/);
    expect(window.printOptions).toMatchObject({
      silent: true,
      deviceName: 'Exact-system-name',
      copies: 1,
      pageSize: { width: 80000 },
      header: '',
      footer: '',
    });
    expect(window.printOptions).not.toHaveProperty('usePrinterDefaultPageSize');
    expect(window.destroyed).toBe(true);
  });
  it('cleans up 50 windows after accepted submissions', async () => {
    for (let i = 0; i < 50; i++)
      await adapter().submit(
        '<html>test</html>',
        'Exact-system-name',
        new AbortController().signal,
      );
    expect(state.windows).toHaveLength(50);
    expect(state.windows.every((w) => w.destroyed)).toBe(true);
  });
  it('known spooler rejection is FAILED-safe and window is destroyed', async () => {
    state.rejectPrint = true;
    await expect(
      adapter().submit('x', 'Exact-system-name', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'SPOOLER_REJECTED', uncertain: false });
    expect(state.windows[0]?.destroyed).toBe(true);
  });
  it('load failure is pre-submission failure and does not leak window', async () => {
    state.failLoad = true;
    await expect(
      adapter().submit('x', 'Exact-system-name', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'WINDOW_LOAD_FAILED', uncertain: false });
    expect(state.windows[0]?.destroyed).toBe(true);
  });
  it('missing printer name and cancelled submission never create a print renderer', async () => {
    await expect(adapter().submit('x', '', new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_PRINTER',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter().submit('x', 'Exact-system-name', controller.signal),
    ).rejects.toMatchObject({ code: 'PRINT_CANCELLED' });
    expect(state.windows).toHaveLength(0);
  });
  it('bounds stalled Windows discovery and cleans its timer', async () => {
    vi.useFakeTimers();
    try {
      const stalled = new WindowsPrinterAdapter({
        webContents: { getPrintersAsync: () => new Promise(() => {}) },
      } as unknown as BrowserWindow);
      const check = expect(stalled.list()).rejects.toMatchObject({
        code: 'PRINTER_DISCOVERY_FAILED',
      });
      await vi.advanceTimersByTimeAsync(10000);
      await check;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
