export function formatMoney(cents: number | null): string {
  if (cents === null) return 'Pa vendosur';
  if (!Number.isSafeInteger(cents)) throw new Error('Money must use safe integer cents');
  const magnitude = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')} €`;
}
export function parseEuro(text: string): number | null {
  const input = text.trim();
  if (!input) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(input)) throw new Error('Vendos çmimin në euro, me deri në dy shifra dhjetore.');
  const [whole = '0', fraction = ''] = input.replace(',', '.').split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Çmimi është jashtë kufirit të lejuar.');
  return Number(cents);
}
export function moneyInput(cents: number | null): string { return cents === null ? '' : formatMoney(cents).replace(' €', ''); }
