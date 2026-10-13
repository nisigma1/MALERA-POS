import type Database from 'better-sqlite3';
import { validateProductUpdate, validateSupply, type MutationResult, type ProductUpdate, type SupplyRequest } from '../../src/domain/configuration';
import type { CatalogProduct, Settings } from '../../src/domain/types';
import type { createRepositories } from './repositories';
import {exactQuantity,assertCashTotals} from './numericSafety';
export function createConfigurationService(db: Database.Database, repositories: ReturnType<typeof createRepositories>) {
  const find = (id: string) => repositories.listProducts().find(product => product.id === id);
  const failure = (errors: Record<string, string>): MutationResult<CatalogProduct> => ({ ok: false, errors, message: 'Kontrollo të dhënat e vendosura.' });
  return {
    updateBusinessName(input: unknown): MutationResult<Settings> {
      const invalid = (): MutationResult<Settings> => ({ok:false,errors:{businessName:'Shkruaj emrin e biznesit, deri në 100 shkronja.'},message:'Kontrollo emrin e biznesit.'});
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input,'businessName')) return invalid();
      const raw = (input as {businessName:unknown}).businessName;
      if (typeof raw !== 'string') return invalid();
      const name = raw.trim();
      if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return invalid();
      return db.transaction(() => {
        const updated = db.prepare("UPDATE settings SET value=? WHERE key='business_name'").run(name);
        if (updated.changes !== 1) throw Error('FOX_BUSINESS_SETTING_MISSING');
        return {ok:true,data:repositories.getSettings()} as const;
      }).immediate();
    },
    updateProduct(input: unknown): MutationResult<CatalogProduct> {
      const errors = validateProductUpdate(input);
      if (Object.keys(errors).length) return failure(errors);
      const value = input as ProductUpdate;
      return db.transaction(() => {
        if (!find(value.id)) return failure({ form: 'Produkti nuk u gjet.' });
        db.prepare(`UPDATE products SET name=@name, category_id=@categoryId,
          purchase_cost_cents=@purchaseCostCents,selling_price_cents=@sellingPriceCents,
          track_inventory=@trackInventory,low_stock_threshold=@lowStockThreshold,
          active=@active,updated_at=@now WHERE id=@id`).run({
          id: value.id, name: value.name.trim(), categoryId: value.categoryId,
          purchaseCostCents: value.purchaseCostCents, sellingPriceCents: value.sellingPriceCents,
          trackInventory: value.trackInventory === null ? null : Number(value.trackInventory),
          lowStockThreshold: value.lowStockThreshold, active: Number(value.active), now: new Date().toISOString(),
        });
        return { ok: true, data: find(value.id)! } as const;
      }).immediate();
    },
    addSupply(input: unknown): MutationResult<CatalogProduct> {
      const errors = validateSupply(input);
      if (Object.keys(errors).length) return failure(errors);
      const value = input as SupplyRequest;
      return db.transaction(() => {
        const product = find(value.productId);
        if (!product) return failure({ productId: 'Produkti nuk u gjet.' });
        // The movement's primary key is the submission token: a retry cannot add stock twice.
        const existing = db.prepare('SELECT product_id,type,quantity_delta FROM inventory_movements WHERE id=?').get(value.requestId) as { product_id: string; type: string; quantity_delta: number } | undefined;
        if (existing) {
          const cash=db.prepare('SELECT -amount_cents AS paid FROM cash_events WHERE supply_id=?').get(value.requestId) as {paid:number}|undefined;
          if(cash?.paid!==value.drawerPaymentCents)return failure({form:'Ky furnizim është regjistruar me pagesë tjetër.'});
          if (existing.product_id !== value.productId || existing.type !== 'SUPPLY' || existing.quantity_delta !== value.quantity) return failure({ form: 'Ky furnizim është regjistruar me të dhëna të tjera. Hap një furnizim të ri.' });
          return { ok: true, data: product } as const;
        }
        if (!product.active) return failure({ productId: 'Aktivizo produktin para furnizimit.' });
        if (product.trackInventory !== true) return failure({ productId: 'Aktivizo ndjekjen e stokut te produkti para furnizimit.' });
        let quantity:number;
        try {quantity=exactQuantity(product.stockQuantity ?? 0,value.quantity);}catch {return failure({quantity:'Sasia nuk mund të ruhet saktë.'});}
        if (!Number.isFinite(quantity) || quantity > Number.MAX_SAFE_INTEGER || quantity <= (product.stockQuantity ?? 0)) return failure({ quantity: 'Sasia është jashtë kufirit të lejuar.' });
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO inventory_movements (id,product_id,type,quantity_delta,related_order_id,note,created_at)
          VALUES (?,?,'SUPPLY',?,NULL,?,?)`).run(value.requestId, product.id, value.quantity, product.stockQuantity === null ? 'Vendosja fillestare e stokut përmes furnizimit' : null, now);
        const result = db.prepare('UPDATE inventory_balances SET quantity=?,updated_at=? WHERE product_id=?').run(quantity, now, product.id);
        if (result.changes !== 1) throw new Error('Inventory balance is missing');
        if(value.drawerPaymentCents!==undefined){
          db.prepare('INSERT INTO cash_sessions SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM cash_sessions s WHERE NOT EXISTS(SELECT 1 FROM cash_closes c WHERE c.session_id=s.id))').run('supply-session:'+value.requestId,now);
          db.prepare(`INSERT INTO cash_events(id,session_id,kind,amount_cents,supply_id,reason,note,created_at,request_json) SELECT ?,id,'INVENTORY_SUPPLY_OUT',?,?,'Furnizim nga arka','',?,? FROM cash_sessions s WHERE NOT EXISTS(SELECT 1 FROM cash_closes c WHERE c.session_id=s.id)`).run('supply:'+value.requestId,-value.drawerPaymentCents,value.requestId,now,JSON.stringify(value));
          assertCashTotals(db);
        }
        return { ok: true, data: find(product.id)! } as const;
      }).immediate();
    },
  };
}
