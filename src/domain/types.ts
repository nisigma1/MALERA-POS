export type Area = 'MAIN' | 'BAR' | 'TERRACE';
export type TableStatus = 'FREE' | 'ACTIVE' | 'AWAITING_PAYMENT' | 'RESERVED';
export type CategoryCode = 'KAFE' | 'CAJ' | 'PIJE' | 'UJE' | 'ALKOOL';
export type OrderStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';
export type MovementType = 'SUPPLY' | 'SALE' | 'MANUAL_ADJUSTMENT' | 'REVERSAL';
export interface CafeTable {
  id: string; code: string; area: Area; status: TableStatus; enabled: boolean;
  sortOrder: number; createdAt: string; updatedAt: string;
}
export interface TableSummary extends CafeTable { activeOrderTotalCents: number | null }
export interface ActiveOrderItem {
  id: string; productId: string; name: string; quantity: number; unitPriceCents: number; lineTotalCents: number;
}
export interface ActiveOrder {
  id: string; tableId: string; status: 'OPEN'; revision: string; createdAt: string; items: ActiveOrderItem[]; totalCents: number;
}
export interface OrderWorkspace { table: TableSummary; order: ActiveOrder | null }
export interface AddOrderProduct { tableId: string; productId: string }
export interface OrderItemCommand { tableId: string; itemId: string }
export interface Category { id: CategoryCode; name: string; sortOrder: number }
export interface Product {
  id: string; name: string; categoryId: CategoryCode;
  sellingPriceCents: number | null; purchaseCostCents: number | null;
  trackInventory: boolean | null; lowStockThreshold: number | null;
  active: boolean; createdAt: string; updatedAt: string;
}
export interface InventoryBalance { productId: string; quantity: number | null; updatedAt: string }
export interface CatalogProduct extends Product { categoryName: string; stockQuantity: number | null }
export interface Order {
  id: string; tableId: string; status: OrderStatus;
  createdAt: string; updatedAt: string; closedAt: string | null;
}
export interface OrderItem {
  id: string; orderId: string; productId: string; productNameSnapshot: string;
  quantity: number; unitPriceCents: number; unitCostCents: number | null; createdAt: string;
}
export interface InventoryMovement {
  id: string; productId: string; type: MovementType; quantityDelta: number;
  relatedOrderId: string | null; note: string | null; createdAt: string;
}
export interface Expense { id: string; amountCents: number; description: string; expenseDate: string; createdAt: string }
export interface Settings { businessName: string }
export interface ReportSummary {
  salesCents: number; costCents: number | null; grossProfitCents: number | null;
  expensesCents: number; netProfitCents: number | null;
  completedOrders: number; productsSold: number; averageOrderCents: number | null;
}
export type HistoricalPaymentMethod = 'CASH' | 'CARD';
export type ReportPeriod = 'TODAY' | '7_DAYS' | '30_DAYS' | 'ALL';
export interface CompleteOrderRequest { orderId: string; expectedRevision?: string }
export type CheckoutErrorCode = 'INVALID_REQUEST' | 'ORDER_NOT_OPEN' | 'ORDER_EMPTY' | 'INVENTORY_UNCONFIGURED' | 'STOCK_UNKNOWN' | 'INSUFFICIENT_STOCK' | 'ALREADY_COMPLETED' | 'ORDER_CHANGED' | 'CHECKOUT_FAILED';
export type CheckoutResult = { ok: true; data: { orderId: string; saleNumber: number; paymentMethod: 'CASH'; totalCents: number; completedAt: string; receiptWarning?: boolean; workspace: OrderWorkspace } } | { ok: false; code: CheckoutErrorCode; message: string };
export interface SaleReportItem { id: string; name: string; quantity: number; unitPriceCents: number; unitCostCents: number | null; totalCents: number; costCents: number | null; profitCents: number | null }
export interface SalesReport {
  summary: ReportSummary; period: ReportPeriod | import('./finance').FinanceQuery; cashCents: number; cardCents: number; unknownPaymentCents: number;
  costCoverage: { knownCostCents: number; missingCostLines: number; missingCostUnits: number; salesWithoutCostCents: number };
  recentSales: { id: string; saleNumber: number; tableCode: string; completedAt: string; paymentMethod: HistoricalPaymentMethod | null; totalCents: number; items: SaleReportItem[] }[];
}
