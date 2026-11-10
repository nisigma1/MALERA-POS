import {
  RECEIPT_PROFILE,
  type Printer,
  type ReceiptSettings,
  type ReceiptResult,
  type PrintJob,
} from '../../src/domain/receipts';
import type { ReceiptRepository } from './repository';
import { renderReceipt } from './render';
import { logError } from '../main/logging';
export class PrintError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain = false,
  ) {
    super(code);
  }
}
export interface PrinterAdapter {
  list(): Promise<Printer[]>;
  submit(html: string, deviceName: string, signal: AbortSignal): Promise<void>;
}
export class PrintManager {
  private running?: Promise<void>;
  private stopped = false;
  private abort?: AbortController;
  constructor(
    private readonly repository: ReceiptRepository,
    private readonly adapter: PrinterAdapter,
    private readonly timeoutMs: number = RECEIPT_PROFILE.submissionTimeoutMs,
  ) {}
  start(): void {
    this.repository.recover();
    this.kick();
  }
  stop(): void {
    this.stopped = true;
    this.abort?.abort();
  }
  kick(): void {
    if (!this.stopped && !this.running) {
      this.running = this.drain()
        .catch((error) => logError('PRINT_QUEUE_FAILURE', error))
        .finally(() => {
          this.running = undefined;
        });
    }
  }
  async idle(): Promise<void> {
    await this.running;
  }
  private async drain(): Promise<void> {
    // Never enter Windows printing while an IPC checkout transaction is on the stack.
    await new Promise<void>((resolve) => setImmediate(resolve));
    while (!this.stopped) {
      const job = this.repository.claim();
      if (!job) return;
      let status: 'SUBMITTED' | 'FAILED' | 'UNKNOWN' = 'FAILED',
        code: string | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      this.abort = controller;
      let submissionStarted = false;
      try {
        const payload = this.repository.payload(job),
          html = renderReceipt(payload, job.kind === 'COPY');
        const operation = (async () => {
          const printers = await this.adapter.list();
          if (controller.signal.aborted) throw new PrintError('PRINT_TIMEOUT', submissionStarted);
          if (!printers.some((p) => p.deviceName === job.deviceName))
            throw new PrintError('PRINTER_NOT_FOUND');
          submissionStarted = true;
          await this.adapter.submit(html, job.deviceName, controller.signal);
        })();
        await Promise.race([
          operation,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new PrintError('PRINT_TIMEOUT', submissionStarted));
            }, this.timeoutMs);
          }),
        ]);
        status = 'SUBMITTED';
      } catch (error) {
        code =
          error instanceof PrintError
            ? error.code
            : submissionStarted
              ? 'PRINT_CALL_FAILED'
              : 'RENDER_FAILED';
        status =
          error instanceof PrintError
            ? error.uncertain
              ? 'UNKNOWN'
              : 'FAILED'
            : submissionStarted
              ? 'UNKNOWN'
              : 'FAILED';
        logError('RECEIPT_SUBMISSION', new Error('FOX_' + code));
      } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
        this.abort = undefined;
      }
      if (this.stopped) return; // Startup will mark an unfinished attempt UNKNOWN.
      this.repository.finish(job, status, code);
    }
  }
}
const messages: Record<string, string> = {
  NO_PRINTER_CONFIGURED: 'Printeri i kuponit nuk është konfiguruar.',
  PRINTER_NOT_FOUND: 'Printeri i zgjedhur nuk u gjet.',
};
export function createReceiptService(
  repository: ReceiptRepository,
  adapter: PrinterAdapter,
  manager: PrintManager,
) {
  async function result<T>(operation: () => T | Promise<T>): Promise<ReceiptResult<T>> {
    try {
      return { ok: true, data: await operation() };
    } catch (error) {
      logError('RECEIPT_REQUEST', error);
      return {
        ok: false,
        message:
          error instanceof Error && messages[error.message]
            ? messages[error.message]!
            : 'Veprimi i kuponit nuk u krye. Kontrollo printerin dhe provo përsëri.',
      };
    }
  }
  return {
    listPrinters: () => result(() => adapter.list()),
    getSettings: () => repository.settings(),
    saveSettings: (input: unknown) =>
      result(async () => {
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw Error('Invalid settings');
        const config = input as ReceiptSettings;
        if (
          Object.keys(config).some(
            (key) => !['deviceName', 'autoPrint', 'paperWidth', 'copies'].includes(key),
          ) ||
          !(
            config.deviceName === null ||
            (typeof config.deviceName === 'string' &&
              config.deviceName.length > 0 &&
              config.deviceName.length <= 512)
          ) ||
          typeof config.autoPrint !== 'boolean' ||
          config.paperWidth !== 80 ||
          config.copies !== 1
        )
          throw Error('Invalid printer settings');
        const printer = config.deviceName
          ? (await adapter.list()).find((p) => p.deviceName === config.deviceName)
          : undefined;
        if (config.deviceName && !printer) throw Error('PRINTER_NOT_FOUND');
        if (config.autoPrint && (!config.deviceName || !repository.tested(config.deviceName)))
          return {
            saved: false,
            message: 'Zgjidh printerin dhe testo printimin para aktivizimit automatik.',
          } as const;
        repository.saveSettings({ ...config, displayName: printer?.displayName ?? null });
        return { saved: true, settings: repository.settings() } as const;
      }),
    testPrint: () =>
      result(() => {
        const job = repository.enqueueTest();
        manager.kick();
        return job;
      }),
    copy: (input: unknown) =>
      result(() => {
        const job = repository.enqueueCopy(input);
        manager.kick();
        return job;
      }),
    retry: (input: unknown) =>
      result(() => {
        const job = repository.retry(input);
        manager.kick();
        return job;
      }),
    state: (input: unknown) => result(() => repository.state(input)),
    recentJobs: () => repository.recentJobs(),
  };
}
export type ReceiptService = ReturnType<typeof createReceiptService>;
export type SaveReceiptSettings = Pick<
  ReceiptSettings,
  'deviceName' | 'autoPrint' | 'paperWidth' | 'copies'
>;
export type SaveSettingsResult = ReceiptResult<
  { saved: false; message: string } | { saved: true; settings: ReceiptSettings }
>;
export type PrintActionResult = ReceiptResult<PrintJob>;
