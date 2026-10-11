import type Database from 'better-sqlite3';
import { assertCanonicalServicePositions, CATEGORIES, INITIAL_PRODUCTS, SERVICE_POSITIONS } from '../../src/domain/definitions';
export function seed(db: Database.Database): void {
  db.transaction(() => {
    const now = new Date().toISOString();
    const table = db.prepare(`INSERT INTO cafe_tables (id,code,area,sort_order,created_at,updated_at)
      VALUES (@code,@code,@area,@sortOrder,@now,@now) ON CONFLICT(code) DO NOTHING`);
    for (const position of SERVICE_POSITIONS) table.run({ ...position, now });
    const category = db.prepare('INSERT INTO categories VALUES (@id,@name,@sortOrder) ON CONFLICT(id) DO NOTHING');
    for (const item of CATEGORIES) category.run(item);
    const product = db.prepare(`INSERT INTO products (id,name,category_id,created_at,updated_at)
      VALUES (@id,@name,@categoryId,@now,@now) ON CONFLICT(id) DO NOTHING`);
    const balance = db.prepare('INSERT INTO inventory_balances VALUES (?,NULL,?) ON CONFLICT(product_id) DO NOTHING');
    for (const item of INITIAL_PRODUCTS) { product.run({ ...item, now }); balance.run(item.id, now); }
    db.prepare("INSERT INTO settings VALUES ('business_name','FOX') ON CONFLICT(key) DO NOTHING").run();
    const positions = db.prepare('SELECT code,area FROM cafe_tables').all() as { code: string; area: string }[];
    assertCanonicalServicePositions(positions);
  }).immediate();
}
