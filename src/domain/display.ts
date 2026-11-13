export function formatLocalDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function productDisplayName(name: string, hideVolume: boolean): string {
  if (!hideVolume) return name;
  return name.replace(/\s+\d+(?:[.,]\d+)?\s*(?:ml|cl|l)\s*$/iu, '') || name;
}
export function formatSaleNumber(number: number): string {
  return Number.isSafeInteger(number) && number > 0
    ? `#${String(number).padStart(6, '0')}`
    : 'Shitje historike';
}
