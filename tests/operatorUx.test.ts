import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amountError, localInputDisplay, localInputValue, parseLocalInput, parseOperatorDate } from '../src/domain/operatorInput';
import { formatLocalDateTime } from '../src/domain/display';
import { profitPresentation } from '../src/presentation/profit';

describe('operator money errors distinguish the real problem without changing cent parsing', () => {
  it.each(['', '  '])('requires a value for %j', input => expect(amountError(input)).toBe('Plotëso këtë fushë.'));
  it.each(['abc', '1e2', 'NaN', '12 euro'])('explains non-numeric %s', input => expect(amountError(input)).toBe('Shkruaj shumën me numra.'));
  it.each(['0', '0,00', '-1.50'])('explains non-positive %s', input => expect(amountError(input)).toBe('Shuma duhet të jetë më e madhe se 0.'));
  it.each(['1.20', '1,20', '100'])('accepts valid expense %s', input => expect(amountError(input)).toBeUndefined());
  it('allows zero for a cash count, rejects negative cash and excess decimal precision', () => {
    expect(amountError('0', true)).toBeUndefined();
    expect(amountError('-1', true)).toBe('Shuma nuk mund të jetë negative.');
    expect(amountError('1.001')).toBe('Përdor deri në dy shifra pas presjes.');
    expect(amountError('9007199254740992')).toBe('Shuma është shumë e madhe.');
  });
});

describe('operator local dates are explicit, 24-hour, and independent of OS date formatting', () => {
  it.each(['2026-10-13T23:51','2026-10-14T00:00','2026-11-01T00:00','2027-01-01T00:00','2028-02-29T12:30'])('round-trips %s across save/restart', value => {
    const shown = localInputDisplay(value), date = parseOperatorDate(shown)!;
    expect(localInputValue(shown)).toBe(value);
    expect(formatLocalDateTime(date)).toBe(shown);
    expect(formatLocalDateTime(new Date(date.toISOString()))).toBe(shown);
    expect(parseLocalInput(value)?.getTime()).toBe(date.getTime());
  });
  it.each(['31.02.2026 12:00','13.10.2026 24:00','13.10.2026 11:60','10/13/2026 11:51 PM','2026-99-99T00:00'])('rejects invalid/US input %s', value => expect(parseLocalInput(value)).toBeNull());
  it('preserves partial editing and date-only report boundaries', () => {
    expect(localInputValue('13.10.')).toBe('13.10.');
    expect(localInputValue('01.01.2027', false)).toBe('2027-01-01');
    expect(localInputDisplay('2027-01-01')).toBe('01.01.2027');
  });
});

it('never presents unknown profit as zero and retains the exact -15 euro result', () => {
  expect(profitPresentation(null,23,0)).toEqual({value:'Nuk llogaritet',reason:'Fitimi s’mund të llogaritet. 23 copë të shitura s’kanë kosto.'});
  expect(profitPresentation(-1500,0,0)).toEqual({value:'-15.00 €',reason:null});
  expect(profitPresentation(0,0,0)).toEqual({value:'0.00 €',reason:null});
  expect(profitPresentation(null,0,1).reason).toContain('1 humbje s’kanë kosto.');
});

it('daily screens use the agreed plain copy and explicit dates, not native US/AM-PM controls', () => {
  const files=['src/pages/Reports.tsx','src/components/OwnerFinance.tsx','src/components/ExpensePanel.tsx','src/components/StockLossPanel.tsx','src/components/ReservationDialog.tsx'];
  for(const file of files)expect(fs.readFileSync(file,'utf8')).not.toMatch(/Rezultati operativ|Fitimi bruto|PRONARI ·|type="datetime-local"|type="date"/);
  for(const file of ['src/components/DataProtectionPanel.tsx','src/components/ProductEditor.tsx','src/components/ReceiptSettingsPanel.tsx'])expect(fs.readFileSync(file,'utf8')).not.toMatch(/Të dhënat ekzistuese janë ruajtur|Produkti nuk u ruajt|Cilësimet nuk u ruajtën|Testi nuk u dërgua/);
  expect(fs.readFileSync('src/components/CheckoutDialog.tsx','utf8')).toContain('<strong>Para të gatshme</strong>');
  expect(fs.readFileSync('src/components/OwnerFinance.tsx','utf8')).toContain('Duhet të ketë në arkë');
  expect(fs.readFileSync('src/pages/Reports.tsx','utf8')).toContain('Shiko detajet');
});
