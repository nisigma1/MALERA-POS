import type {CatalogProduct} from './types';
// Readiness describes catalogue configuration; it never changes order eligibility.
export function productReadiness(products: CatalogProduct[]) {
  const active = products.filter(p => p.active);
  const missingPrices = active.filter(p => p.sellingPriceCents === null).length;
  const missingStockConfiguration = active.filter(p => p.trackInventory === null || (p.trackInventory === true && p.stockQuantity === null)).length;
  return {missingPrices, missingStockConfiguration,
    missingCosts: active.filter(p => p.purchaseCostCents === null).length,
    missingThresholds: active.filter(p => p.trackInventory === true && p.lowStockThreshold === null).length,
    outOfStock: active.filter(p => p.trackInventory === true && p.stockQuantity === 0).length,
    configured: missingPrices === 0 && missingStockConfiguration === 0};
}
