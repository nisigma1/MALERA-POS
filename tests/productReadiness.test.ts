import { describe, it, expect } from 'vitest';
import { productReadiness } from '../src/domain/readiness';
import { formatMoney, moneyInput, parseEuro } from '../src/domain/money';
import { formatLocalDateTime } from '../src/domain/display';
import { openDatabase } from '../electron/database/connection';
import { createRepositories } from '../electron/database/repositories';
describe('owner configuration and display', () => {
  it('keeps missing cost and optional threshold informational; distinguishes unknown and zero stock', () => {
    const db = openDatabase(':memory:');
    try {
      const p = createRepositories(db).listProducts()[0]!;
      expect(
        productReadiness([{ ...p, sellingPriceCents: 0, trackInventory: false }]),
      ).toMatchObject({
        configured: true,
        missingPrices: 0,
        missingStockConfiguration: 0,
        missingCosts: 1,
        missingThresholds: 0,
      });
      expect(
        productReadiness([
          { ...p, sellingPriceCents: 100, trackInventory: true, stockQuantity: null },
        ]),
      ).toMatchObject({ configured: false, missingStockConfiguration: 1, outOfStock: 0 });
      expect(
        productReadiness([
          { ...p, sellingPriceCents: 100, trackInventory: true, stockQuantity: 0 },
        ]),
      ).toMatchObject({
        configured: true,
        missingStockConfiguration: 0,
        outOfStock: 1,
        missingThresholds: 1,
      });
      expect(productReadiness([{ ...p, active: false }])).toMatchObject({
        configured: true,
        missingPrices: 0,
        missingCosts: 0,
      });
      expect(
        productReadiness([{ ...p, sellingPriceCents: 100, trackInventory: null }]),
      ).toMatchObject({ configured: false, missingStockConfiguration: 1 });
    } finally {
      db.close();
    }
  });
  it('uses one euro convention without breaking editable value roundtrips', () => {
    for (const cents of [0, 1, 50, 120, 99999, Number.MAX_SAFE_INTEGER]) {
      expect(parseEuro(moneyInput(cents))).toBe(cents);
      expect(formatMoney(cents)).toMatch(/^\d+\.\d{2} €$/);
    }
    expect(moneyInput(null)).toBe('');
    expect(formatMoney(-50)).toBe('-0.50 €');
    for (const [value, expected] of [
      ['1', 100],
      ['1.2', 120],
      ['1.20', 120],
      ['0.50', 50],
      ['1,50', 150],
      ['', null],
    ] as const)
      expect(parseEuro(value)).toBe(expected);
    for (const value of ['abc', '1.2.3', '1,2.3', 'NaN', 'Infinity', '-1'])
      expect(() => parseEuro(value)).toThrow();
  });
  it('formats local midnight, month and year boundaries without US dates', () => {
    for (const date of [
      new Date(2026, 0, 1, 0, 0),
      new Date(2026, 9, 31, 23, 59),
      new Date(2026, 10, 1, 0, 0),
      new Date(2026, 11, 31, 23, 59),
    ]) {
      const pad = (v: number) => String(v).padStart(2, '0');
      expect(formatLocalDateTime(date)).toBe(
        `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
      );
    }
    expect(formatLocalDateTime('bad')).toBe('—');
  });
});
