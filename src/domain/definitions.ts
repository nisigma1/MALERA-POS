import type { Area, Category, CategoryCode, TableStatus } from './types';
export const AREA_LABELS: Record<Area, string> = { MAIN: 'Brenda', BAR: 'Shanku', TERRACE: 'Jashtë' };
export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  FREE: 'E lirë', ACTIVE: 'Porosi aktive', AWAITING_PAYMENT: 'Pret pagesë', RESERVED: 'E rezervuar',
};
// The only authoritative position definition; React reads the seeded database.
export const SERVICE_POSITIONS: ReadonlyArray<{ code: string; area: Area; sortOrder: number }> = [
  ...Array.from({ length: 13 }, (_, i) => ({ code: `M${i + 1}`, area: 'MAIN' as const, sortOrder: i + 1 })),
  ...Array.from({ length: 4 }, (_, i) => ({ code: `SH${i + 1}`, area: 'BAR' as const, sortOrder: i + 14 })),
  ...Array.from({ length: 10 }, (_, i) => ({ code: `T${i + 1}`, area: 'TERRACE' as const, sortOrder: i + 18 })),
];
export const CATEGORIES: ReadonlyArray<Category> = [
  { id: 'KAFE', name: 'Kafe', sortOrder: 1 }, { id: 'CAJ', name: 'Çaj', sortOrder: 2 },
  { id: 'PIJE', name: 'Pije', sortOrder: 3 }, { id: 'UJE', name: 'Ujë', sortOrder: 4 },
  { id: 'ALKOOL', name: 'Alkool', sortOrder: 5 },
];
const names: Record<CategoryCode, readonly string[]> = {
  KAFE: ['Espresso', 'Espresso pa plum', 'Double Espresso', 'Makiato i vogël', 'Makiato i madh', 'Kapuçino', 'Latte Makiato', 'Amerikano'],
  CAJ: ['Çaj mente', 'Çaj fruta mali', 'Çaj kamomil'],
  PIJE: ['Vishnje', 'Juice Karrot', 'Mollë', 'Pjeshkë'],
  UJE: ['Ujë natyral', 'Ujë mineral'],
  ALKOOL: ['Birra Peja', 'Birra Laško', "Jack Daniel's", 'Smirnoff Vodka'],
};
export const INITIAL_PRODUCTS = CATEGORIES.flatMap(category => names[category.id].map((name, i) => ({
  id: `${category.id}-${i + 1}`, name, categoryId: category.id,
})));
