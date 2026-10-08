import type { CatalogProduct, CategoryCode, Product } from './types';
import { CATEGORIES } from './definitions';
export type FieldErrors = Record<string, string>;
export type MutationResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors; message: string };
export interface ProductUpdate {
  id: string; name: string; categoryId: CategoryCode; purchaseCostCents: number | null;
  sellingPriceCents: number | null; trackInventory: boolean | null;
  lowStockThreshold: number | null; active: boolean;
}
export interface SupplyRequest { requestId: string; productId: string; quantity: number }
export function validateProductUpdate(input: unknown): FieldErrors {
  if (!input || typeof input !== 'object') return { form: 'Kërkesa nuk është e vlefshme.' };
  const value = input as Record<string, unknown>;
  const errors: FieldErrors = {};
  if (typeof value.id !== 'string' || !value.id.trim()) errors.id = 'Produkti nuk është i vlefshëm.';
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 200) errors.name = 'Shkruaj emrin e produktit (deri në 200 karaktere).';
  if (!CATEGORIES.some(c => c.id === value.categoryId)) errors.categoryId = 'Zgjidh një kategori të vlefshme.';
  for (const key of ['purchaseCostCents', 'sellingPriceCents']) {
    const amount = value[key];
    if (amount !== null && (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0)) errors[key] = 'Vendos një çmim të vlefshëm, me deri në dy shifra dhjetore.';
  }
  if (value.trackInventory !== null && typeof value.trackInventory !== 'boolean') errors.trackInventory = 'Zgjidh mënyrën e ndjekjes së stokut.';
  if (value.active === true && value.sellingPriceCents !== null && value.trackInventory === null) errors.trackInventory = 'Zgjidh Po ose Jo për produktin që do të shitet.';
  const threshold = value.lowStockThreshold;
  if (threshold !== null && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > Number.MAX_SAFE_INTEGER)) errors.lowStockThreshold = 'Pragu duhet të jetë një numër jo negativ.';
  if (typeof value.active !== 'boolean') errors.active = 'Zgjidh statusin e produktit.';
  return errors;
}
export function validateSupply(input: unknown): FieldErrors {
  if (!input || typeof input !== 'object') return { form: 'Kërkesa nuk është e vlefshme.' };
  const value = input as Record<string, unknown>;
  const errors: FieldErrors = {};
  if (typeof value.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)) errors.form = 'Identifikuesi i furnizimit nuk është i vlefshëm.';
  if (typeof value.productId !== 'string' || !value.productId) errors.productId = 'Zgjidh produktin.';
  if (typeof value.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity <= 0 || value.quantity > Number.MAX_SAFE_INTEGER) errors.quantity = 'Sasia duhet të jetë një numër më i madh se zero.';
  return errors;
}
export function unitProfit(product: Pick<Product, 'sellingPriceCents' | 'purchaseCostCents'>): number | null {
  return product.sellingPriceCents === null || product.purchaseCostCents === null ? null : product.sellingPriceCents - product.purchaseCostCents;
}
export type StockState = 'UNCONFIGURED' | 'UNKNOWN_STOCK' | 'UNTRACKED' | 'KNOWN' | 'IN_STOCK' | 'LOW' | 'OUT';
export const STOCK_LABELS: Record<StockState, string> = {
  UNCONFIGURED: 'Pa konfiguruar', UNKNOWN_STOCK: 'Stok pa vendosur', UNTRACKED: 'Nuk ndiqet', KNOWN: 'Pragu pa vendosur',
  IN_STOCK: 'Në stok', LOW: 'Stok i ulët', OUT: 'Pa stok',
};
export function stockState(product: Pick<CatalogProduct, 'trackInventory' | 'stockQuantity' | 'lowStockThreshold'>): StockState {
  if (product.trackInventory === false) return 'UNTRACKED';
  if (product.trackInventory === null) return 'UNCONFIGURED';
  if (product.stockQuantity === null) return 'UNKNOWN_STOCK';
  if (product.stockQuantity === 0) return 'OUT';
  if (product.lowStockThreshold === null) return 'KNOWN';
  return product.stockQuantity <= product.lowStockThreshold ? 'LOW' : 'IN_STOCK';
}
export function inventorySummary(products: CatalogProduct[]) {
  let inventoryValueCents = 0;
  let complete = true;
  let fullyPriced = 0;
  let low = 0;
  for (const product of products) {
    if (['LOW', 'OUT'].includes(stockState(product))) low++;
    if (product.sellingPriceCents !== null && product.purchaseCostCents !== null) fullyPriced++;
    if (product.trackInventory === false) continue;
    if (product.trackInventory === null || product.stockQuantity === null || product.purchaseCostCents === null) { complete = false; continue; }
    const value = product.stockQuantity * product.purchaseCostCents;
    // Never silently round fractional stock values into a supposedly exact full value.
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(inventoryValueCents + value)) complete = false;
    else inventoryValueCents += value;
  }
  return { total: products.length, active: products.filter(p => p.active).length, low, fullyPriced,
    inventoryValueCents: complete ? inventoryValueCents : null };
}
export function parseQuantity(text: string, nullable = false): number | null {
  const input = text.trim();
  if (!input && nullable) return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(input)) throw new Error('Vendos një sasi të vlefshme.');
  const value = Number(input.replace(',', '.'));
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) throw new Error('Sasia është jashtë kufirit të lejuar.');
  return value;
}
