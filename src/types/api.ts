import type { CompleteOrderRequest, CheckoutResult, ReportPeriod, SalesReport, TableSummary, OrderWorkspace, AddOrderProduct, OrderItemCommand, CatalogProduct, ReportSummary, Settings } from '../domain/types';
import type { MutationResult, ProductUpdate, SupplyRequest } from '../domain/configuration';
export interface FoxApi {
  tables: { list(): Promise<TableSummary[]> };
  orders: {
    completeOrder(input: CompleteOrderRequest): Promise<CheckoutResult>;
    getForTable(tableId: string): Promise<OrderWorkspace>;
    addProduct(input: AddOrderProduct): Promise<MutationResult<OrderWorkspace>>;
    incrementItem(input: OrderItemCommand): Promise<MutationResult<OrderWorkspace>>;
    decrementItem(input: OrderItemCommand): Promise<MutationResult<OrderWorkspace>>;
    removeItem(input: OrderItemCommand): Promise<MutationResult<OrderWorkspace>>;
  };
  products: { list(): Promise<CatalogProduct[]>; update(input: ProductUpdate): Promise<MutationResult<CatalogProduct>> };
  inventory: { addSupply(input: SupplyRequest): Promise<MutationResult<CatalogProduct>> };
  settings: { get(): Promise<Settings> };
  reports: { getSalesReport(period: ReportPeriod): Promise<SalesReport>; getSummary(): Promise<ReportSummary> };
}
export const IPC = { completeOrder: 'fox:orders:complete', salesReport: 'fox:reports:sales', tables: 'fox:tables:list', products: 'fox:products:list', settings: 'fox:settings:get', reports: 'fox:reports:summary', updateProduct: 'fox:products:update', addSupply: 'fox:inventory:add-supply', getOrder: 'fox:orders:get-for-table', addProduct: 'fox:orders:add-product', incrementItem: 'fox:orders:increment-item', decrementItem: 'fox:orders:decrement-item', removeItem: 'fox:orders:remove-item' } as const;
