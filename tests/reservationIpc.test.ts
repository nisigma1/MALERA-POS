import { beforeEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
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
import { IPC, RESERVATION_IPC } from '../src/types/api';
import { openDatabase } from '../electron/database/connection';
import { createRepositories } from '../electron/database/repositories';
import { createOrderService } from '../electron/database/orders';
import { createCheckoutService } from '../electron/database/checkout';
import { createReservationService } from '../electron/database/reservations';
import type { OperatorAccess } from '../electron/main/operatorSession';
import type { OperatorId } from '../src/domain/operators';
const contents = { mainFrame: {} },
  reservations = { reserve: vi.fn(), arrive: vi.fn(), cancel: vi.fn() },
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
    undefined,
    reservations as unknown as ReturnType<typeof createReservationService>,
  );
});
describe('reservation IPC authority', () => {
  it.each(Object.values(RESERVATION_IPC))(
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
      expect(Object.values(reservations).every((f) => f.mock.calls.length === 0)).toBe(true);
    },
  );
  it('blocks all reservation writes during restore maintenance', () => {
    maintenance.isMaintenance.mockReturnValue(true);
    for (const channel of Object.values(RESERVATION_IPC))
      expect(() => handlers.get(channel)!(event(), {})).toThrow('MAINTENANCE');
  });
  it('routes booking through the validated service only', () => {
    const input = { tableId: 'M5' };
    handlers.get(RESERVATION_IPC.reserve)!(event(), input);
    expect(reservations.reserve).toHaveBeenCalledWith(input);
    expect(reservations.reserve).toHaveBeenCalledOnce();
  });
  it('keeps contact details private when a worker retries a draft after the table is booked', () => {
    const db = openDatabase(':memory:');
    try {
      db.prepare(
        "UPDATE products SET selling_price_cents=150,track_inventory=0 WHERE id='PIJE-1'",
      ).run();
      let operator: OperatorId = 'AM';
      const access: OperatorAccess = {
        required: true,
        current: () => operator,
        status: vi.fn(),
        login: vi.fn(),
        logout: vi.fn(),
        enroll: vi.fn(),
      };
      const repo = createRepositories(db, true);
      const orders = createOrderService(db, repo, { operator: access.current });
      const checkout = createCheckoutService(db, orders, true);
      const bookings = createReservationService(
        db,
        orders,
        () => new Date('2026-10-11T12:00:00.000Z'),
      );
      registerIpc(
        { webContents: contents } as unknown as BrowserWindow,
        repo,
        {} as never,
        orders,
        checkout,
        {} as never,
        { kick: vi.fn() } as never,
        undefined,
        undefined,
        bookings,
        access,
      );
      const tableId = 'M5';
      const draft = {
        requestId: randomUUID(),
        tableId,
        orderId: null,
        expectedRevision: null,
        items: [{ productId: 'PIJE-1', quantity: 1 }],
      };
      const call = (channel: string, input: unknown) => handlers.get(channel)!(event(), input);
      expect(call(IPC.addProduct, draft)).toMatchObject({ ok: true });
      const orderId = orders.getForTable(tableId).order!.id;
      operator = 'OWNER';
      expect(call(IPC.completeOrder, { orderId })).toMatchObject({ ok: true });
      const privateDetails = {
        customerName: 'Klient sintetik',
        phone: '000 000 000',
        note: 'Shënim sintetik',
      };
      expect(
        call(RESERVATION_IPC.reserve, {
          requestId: randomUUID(),
          tableId,
          startsAt: '2026-10-11T19:30:00.000Z',
          guests: 4,
          ...privateDetails,
        }),
      ).toMatchObject({ ok: true });
      expect(call(IPC.getOrder, tableId)).toMatchObject({ reservation: privateDetails });

      operator = 'AM';
      const masked = { customerName: '', phone: '', note: '', status: 'BOOKED' };
      expect(call(IPC.getOrder, tableId)).toMatchObject({ reservation: masked });
      expect(call(IPC.addProduct, draft)).toMatchObject({
        ok: true,
        data: { order: null, reservation: masked },
      });
      expect(db.prepare('SELECT COUNT(*) FROM order_payments').pluck().get()).toBe(1);
      expect(orders.getForTable(tableId).reservation).toMatchObject(privateDetails);
    } finally {
      db.close();
    }
  });
});
