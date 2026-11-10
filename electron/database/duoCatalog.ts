import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import type Database from 'better-sqlite3';
import { INITIAL_PRODUCTS } from '../../src/domain/definitions';
import type { CategoryCode } from '../../src/domain/types';

// Purchase costs in cents per supplier unit, rounded to the nearest cent.
const drinks = [
  ['Coca-Cola 0.25 L', 'PIJE', 50],
  ['Fanta 0.25 L', 'PIJE', 50],
  ['Sprite 0.25 L', 'PIJE', 50],
  ['Coca-Cola Zero 0.25 L', 'PIJE', 50],
  ['Schweppes 0.25 L', 'PIJE', 54],
  ['Schweppes Tonic 0.25 L', 'PIJE', 54],
  ['Çaj i ftohtë 0.33 L', 'PIJE', 48],
  ['Santal Portokall 100% 0.20 L', 'PIJE', 83],
  ['Alexandria Verë e Kuqe 0.187 L', 'ALKOOL', 180],
  ['Alexandria Verë e Bardhë 0.187 L', 'ALKOOL', 180],
  ['Badel Vigor Vodka 1 L', 'ALKOOL', 990],
  ['Tequila Rio Club 0.70 L', 'ALKOOL', 990],
  ['Red Bull 0.25 L', 'PIJE', 116],
  ['Jägermeister 1 L', 'ALKOOL', 1890],
  ['Baileys 0.70 L', 'ALKOOL', 2290],
  ['Tuborg 0.33 L', 'ALKOOL', 104],
  ['Fructal Dredhëz 0.20 L', 'PIJE', 72],
  ['Malibu 1 L', 'ALKOOL', 1910],
  ['Heineken', 'ALKOOL', null],
] as const satisfies ReadonlyArray<readonly [string, CategoryCode, number | null]>;

export function isDuoCatalogTerminal(): boolean {
  // Windows computer name of the DUO terminal, stored as a normalized digest.
  return (
    process.platform === 'win32' &&
    createHash('sha256').update(hostname().toLowerCase()).digest('hex') ===
      '093c398232d67bae6e4b8ee594e7444b513f93494407309234fd7a9019fa7cad'
  );
}

// Called inside the immediate seed transaction, before normal seeding.
export function addDuoCatalog(db: Database.Database, now: string): void {
  const business = db.prepare("SELECT value FROM settings WHERE key='business_name'").pluck().get();
  if (typeof business !== 'string' || business.trim().toUpperCase() !== 'DUO') return;

  const products = db.prepare('SELECT id,name,category_id FROM products').all() as {
    id: string;
    name: string;
    category_id: CategoryCode;
  }[];
  const byId = new Map(products.map((product) => [product.id, product]));
  // Exact baseline also prevents a second import and avoids guessing after local catalog edits.
  if (
    products.length !== INITIAL_PRODUCTS.length ||
    !INITIAL_PRODUCTS.every(({ id, name, categoryId }) => {
      const existing = byId.get(id);
      return existing?.name.normalize('NFC') === name && existing.category_id === categoryId;
    })
  )
    return;

  const insert = db.prepare(
    'INSERT INTO products (id,name,category_id,purchase_cost_cents,active,created_at,updated_at) VALUES (?,?,?,?,0,?,?)',
  );
  const balance = db.prepare('INSERT INTO inventory_balances VALUES (?,NULL,?)');
  for (const [index, [name, category, purchaseCost]] of drinks.entries()) {
    const id = 'duo-drinks-v1-' + (index + 1);
    insert.run(id, name, category, purchaseCost, now, now);
    balance.run(id, now);
  }
}
