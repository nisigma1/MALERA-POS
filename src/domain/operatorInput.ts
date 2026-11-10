import { parseEuro } from './money';

export function amountError(value: string, allowZero = false): string | undefined {
  const text = value.trim();
  if (!text) return 'Plotëso këtë fushë.';
  if (/^-\d+(?:[.,]\d{1,2})?$/.test(text))
    return allowZero ? 'Shuma nuk mund të jetë negative.' : 'Shuma duhet të jetë më e madhe se 0.';
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return 'Shkruaj shumën me numra.';
  if (/[.,]\d{3,}$/.test(text)) return 'Përdor deri në dy shifra pas presjes.';
  try {
    const cents = parseEuro(text);
    if (cents === null) return 'Plotëso këtë fushë.';
    if (!allowZero && cents === 0) return 'Shuma duhet të jetë më e madhe se 0.';
  } catch {
    return 'Shuma është shumë e madhe.';
  }
}

// Local wall-clock values: validate against the host timezone, including DST gaps.
export function parseOperatorDate(value: string, withTime = true): Date | null {
  const pattern = withTime
    ? /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/
    : /^(\d{2})\.(\d{2})\.(\d{4})$/;
  const match = value.match(pattern);
  if (!match) return null;
  const [, d, m, y, h = '0', min = '0'] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min));
  return date.getFullYear() === Number(y) &&
    date.getMonth() === Number(m) - 1 &&
    date.getDate() === Number(d) &&
    date.getHours() === Number(h) &&
    date.getMinutes() === Number(min)
    ? date
    : null;
}

export function localInputDisplay(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  return match
    ? `${match[3]}.${match[2]}.${match[1]}${match[4] ? ` ${match[4]}:${match[5]}` : ''}`
    : value;
}

export function localInputValue(value: string, withTime = true): string {
  const date = parseOperatorDate(value, withTime);
  if (!date) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}${withTime ? `T${pad(date.getHours())}:${pad(date.getMinutes())}` : ''}`;
}

export function parseLocalInput(value: string): Date | null {
  return parseOperatorDate(localInputDisplay(value));
}
