import type Database from 'better-sqlite3';
import type { TableReservation } from '../../src/domain/reservations';
import type { OrderWorkspace } from '../../src/domain/types';
import type { MutationResult } from '../../src/domain/configuration';
import type { createOrderService } from './orders';

const columns = `id,table_id AS tableId,customer_name AS customerName,phone,starts_at AS startsAt,
  guests,note,status,created_at AS createdAt,resolved_at AS resolvedAt`;
export function bookedReservation(db: Database.Database, tableId: string): TableReservation | null {
  // Read-only legacy fixtures/backups can precede the additive reservation migration.
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='table_reservations'").get()) return null;
  return db.prepare(`SELECT ${columns} FROM table_reservations WHERE table_id=? AND status='BOOKED'`).get(tableId) as TableReservation | undefined ?? null;
}
class ReservationError extends Error {}
function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw new ReservationError('Kërkesa nuk është e vlefshme.');
  return input as Record<string, unknown>;
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) throw new ReservationError('Kontrollo emrin, telefonin dhe shënimin.');
  return value.trim();
}
export function createReservationService(db: Database.Database, orders: ReturnType<typeof createOrderService>, clock = () => new Date()) {
  const read = (tableId: string) => {
    if (!db.prepare('SELECT 1 FROM cafe_tables WHERE id=?').get(tableId)) throw new ReservationError('Tavolina nuk u gjet.');
    return orders.getForTable(tableId);
  };
  const mutate = (action: () => OrderWorkspace): MutationResult<OrderWorkspace> => {
    try { return { ok: true, data: db.transaction(action).immediate() }; }
    catch (error) { if (!(error instanceof ReservationError)) throw error; return { ok: false, message: error.message, errors: { form: error.message } }; }
  };
  function resolve(input: unknown, status: 'ARRIVED' | 'CANCELLED') {
    return mutate(() => {
      const value = object(input, ['tableId','reservationId']);
      const tableId = text(value.tableId, 200, true), reservationId = text(value.reservationId, 200, true);
      const reservation = db.prepare(`SELECT ${columns} FROM table_reservations WHERE id=? AND table_id=?`).get(reservationId,tableId) as TableReservation | undefined;
      if (!reservation) throw new ReservationError('Rezervimi nuk u gjet. Rifresko tavolinën.');
      // A retry must never free an order that was started after arrival.
      if (reservation.status === status) return orders.getForTable(tableId);
      if (reservation.status !== 'BOOKED') throw new ReservationError('Ky rezervim është mbyllur tashmë.');
      const view = read(tableId);
      if (view.table.status !== 'RESERVED' || view.order) throw new ReservationError('Gjendja e tavolinës ka ndryshuar. Rifresko tavolinën.');
      const now = clock().toISOString();
      db.prepare('UPDATE table_reservations SET status=?,resolved_at=? WHERE id=?').run(status,now,reservationId);
      db.prepare("UPDATE cafe_tables SET status='FREE',updated_at=? WHERE id=?").run(now,tableId);
      return orders.getForTable(tableId);
    });
  }
  return {
    reserve(input: unknown): MutationResult<OrderWorkspace> {
      return mutate(() => {
        const value = object(input, ['requestId','tableId','customerName','phone','startsAt','guests','note']);
        const requestId = text(value.requestId, 36, true);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new ReservationError('Identifikuesi i rezervimit nuk është i vlefshëm.');
        const tableId = text(value.tableId,200,true), customerName = text(value.customerName,100,true), phone = text(value.phone,40), note = text(value.note,500);
        if (phone && !/^[+\d\s().-]{3,40}$/.test(phone)) throw new ReservationError('Numri i telefonit nuk është i vlefshëm.');
        if (typeof value.startsAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.startsAt) || !Number.isFinite(Date.parse(value.startsAt)) || new Date(value.startsAt).toISOString() !== value.startsAt) throw new ReservationError('Vendos datën dhe orën e rezervimit.');
        const startsAt = value.startsAt;
        if (typeof value.guests !== 'number' || !Number.isInteger(value.guests) || value.guests < 1 || value.guests > 30) throw new ReservationError('Vendos numrin e personave (1–30).');
        const previous = db.prepare(`SELECT ${columns} FROM table_reservations WHERE id=?`).get(requestId) as TableReservation | undefined;
        if (previous) {
          if (previous.tableId !== tableId || previous.customerName !== customerName || previous.phone !== phone || previous.startsAt !== startsAt || previous.guests !== value.guests || previous.note !== note || previous.status !== 'BOOKED') throw new ReservationError('Kjo kërkesë rezervimi është përdorur tashmë. Rifresko tavolinën.');
          return orders.getForTable(tableId);
        }
        if (Date.parse(startsAt) < clock().getTime()) throw new ReservationError('Ora e rezervimit duhet të jetë në të ardhmen.');
        const view = read(tableId);
        if (!view.table.enabled || view.table.status !== 'FREE' || view.order || bookedReservation(db,tableId)) throw new ReservationError('Mund të rezervosh vetëm një tavolinë të lirë dhe aktive.');
        const now = clock().toISOString();
        db.prepare(`INSERT INTO table_reservations(id,table_id,customer_name,phone,starts_at,guests,note,status,created_at,resolved_at)
          VALUES (?,?,?,?,?,?,?,'BOOKED',?,NULL)`).run(requestId,tableId,customerName,phone,startsAt,value.guests,note,now);
        db.prepare("UPDATE cafe_tables SET status='RESERVED',updated_at=? WHERE id=?").run(now,tableId);
        return orders.getForTable(tableId);
      });
    },
    arrive: (input: unknown) => resolve(input,'ARRIVED'),
    cancel: (input: unknown) => resolve(input,'CANCELLED'),
  };
}
