export interface TableReservation {
  id: string;
  tableId: string;
  customerName: string;
  phone: string;
  startsAt: string;
  guests: number;
  note: string;
  status: 'BOOKED' | 'ARRIVED' | 'CANCELLED';
  createdAt: string;
  resolvedAt: string | null;
}
export interface ReserveTableInput {
  requestId: string;
  tableId: string;
  customerName: string;
  phone: string;
  startsAt: string;
  guests: number;
  note: string;
}
export interface ResolveReservationInput { tableId: string; reservationId: string }

export function formatReservationTime(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2,'0');
  return `${pad(date.getDate())}.${pad(date.getMonth()+1)}.${date.getFullYear()} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
