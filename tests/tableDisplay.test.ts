import { expect, it } from 'vitest';
import { SERVICE_POSITIONS } from '../src/domain/definitions';
import { FLOOR_PLAN_BY_CODE } from '../src/presentation/floorPlan';
import { tableDisplayCode, tableDisplayArea } from '../src/presentation/tableIdentity';

it('shows exactly 12 inside, 11 outside and 4 bar labels without changing storage IDs', () => {
  const labels = SERVICE_POSITIONS.map((p) => tableDisplayCode(p.code));
  expect(labels).toEqual([
    'B1',
    'B2',
    'B3',
    'B4',
    'B5',
    'B6',
    'B7',
    'B8',
    'B9',
    'B10',
    'B11',
    'B12',
    'J11',
    'SH1',
    'SH2',
    'SH3',
    'SH4',
    'J1',
    'J2',
    'J3',
    'J4',
    'J5',
    'J6',
    'J7',
    'J8',
    'J9',
    'J10',
  ]);
  expect(new Set(labels).size).toBe(27);
  expect(SERVICE_POSITIONS.find((p) => p.code === 'M13')?.code).toBe('M13');
  expect(tableDisplayArea('M13', 'MAIN')).toBe('Jashtë');
  expect(tableDisplayArea('M1', 'MAIN')).toBe('Brenda');
  expect(tableDisplayArea('T1', 'TERRACE')).toBe('Jashtë');
  expect(tableDisplayCode('SH1')).toBe('SH1');
  expect(tableDisplayCode('J11')).toBe('J11');
});

it('places J11 in the entrance triangle while keeping its outside label', () => {
  const diagonal = FLOOR_PLAN_BY_CODE.M13!;
  expect(diagonal).toMatchObject({ x: 173, y: 803, rotation: 45 });
  expect(diagonal.x).toBeGreaterThan(118);
  expect(diagonal.y).toBeLessThan(831);
  expect(diagonal.x).toBeLessThan(118 + ((diagonal.y - 705) * 122) / 126);
  expect(tableDisplayCode(diagonal.id)).toBe('J11');
  expect(diagonal.area).toBe('TERRACE');
  expect(FLOOR_PLAN_BY_CODE.T2!.x - diagonal.x).toBeGreaterThan(100);
});
