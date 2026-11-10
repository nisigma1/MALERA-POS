import type { Area } from '../domain/types';

// Owner-facing numbering; persisted IDs stay stable for orders and reservations.
export function tableDisplayCode(code: string): string {
  if (code === 'M13') return 'J11';
  if (/^M([1-9]|1[0-2])$/.test(code)) return `B${code.slice(1)}`;
  if (/^T([1-9]|10)$/.test(code)) return `J${code.slice(1)}`;
  return code;
}

export function tableDisplayArea(code: string, area: Area): string {
  if (code === 'M13' || area === 'TERRACE') return 'Jashtë';
  return area === 'BAR' ? 'Shanku' : 'Brenda';
}
