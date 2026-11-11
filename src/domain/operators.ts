export const OPERATORS = {
  OWNER: 'PRONARI DUO',
  AM: 'PUNONJESI PARADITE',
  PM: 'PUNONJESI MASDITE',
} as const;
export type OperatorId = keyof typeof OPERATORS;
export type ShiftPeriod = 'AM' | 'PM' | 'DAY';
export interface OperatorSession {
  required: boolean;
  configured: boolean;
  operator: OperatorId | null;
  setupPending?: boolean;
  duoMenu?: boolean;
}
export interface ShiftSales {
  date: string;
  totalCents: number;
  rows: { operator: OperatorId | 'LEGACY'; totalCents: number }[];
}
export const COFFEE_STOCK_ID = 'KAFE-1';
export const PORTIONS_PER_KG = 110;
export function isCoffee(id: string) {
  return /^KAFE-[1-8]$/.test(id);
}
export function coffeePortions(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0 || !/^\d+(?:\.\d{1,3})?$/.test(String(kg)))
    throw Error('Shkruaj kilogramët me deri në tri shifra pas presjes.');
  const [whole, fraction = ''] = String(kg).split('.');
  const grams = BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (grams > 1000000000n) throw Error('Sasia është jashtë kufirit të lejuar.');
  return Number(grams * 11n) / 100;
}
export function coffeeStockLabel(portions: number) {
  return (
    new Intl.NumberFormat('sq-AL', { maximumFractionDigits: 3 }).format(
      portions / PORTIONS_PER_KG,
    ) +
    ' kg · ' +
    Math.floor(portions) +
    ' porcione'
  );
}
