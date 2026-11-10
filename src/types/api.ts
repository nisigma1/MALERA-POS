import type {
  CompleteOrderRequest,
  CheckoutResult,
  ReportPeriod,
  SalesReport,
  TableSummary,
  OrderWorkspace,
  OrderDraftResult,
  SubmitOrderDraft,
  AddOrderProduct,
  OrderItemCommand,
  CatalogProduct,
  ReportSummary,
  Settings,
} from '../domain/types';
import type { MutationResult, ProductUpdate, SupplyRequest } from '../domain/configuration';
import type {
  Printer,
  ReceiptSettings,
  ReceiptSettingsInput,
  ReceiptSettingsResult,
  ReceiptAction,
  ReceiptResult,
  PrintJob,
  ReceiptState,
} from '../domain/receipts';
import type { DataDiagnostics, DataActionResult } from '../domain/protection';
import type {
  FinanceQuery,
  FinanceReport,
  ExpenseInput,
  ExpenseRecord,
  LossInput,
  LossRecord,
  CashInput,
  CashClose,
  CashPreview,
  CashMovementInput,
  CashEvent,
} from '../domain/finance';
import type { ReserveTableInput, ResolveReservationInput } from '../domain/reservations';
export const RESERVATION_IPC = {
  reserve: 'fox:reservations:reserve',
  arrive: 'fox:reservations:arrive',
  cancel: 'fox:reservations:cancel',
} as const;
export const FINANCE_IPC = {
  report: 'fox:finance:report',
  expense: 'fox:finance:expense',
  history: 'fox:finance:expense-history',
  loss: 'fox:finance:loss',
  preview: 'fox:finance:cash-preview',
  close: 'fox:finance:cash-close',
  movement: 'fox:finance:cash-movement',
} as const;
export const DATA_IPC = {
  diagnostics: 'fox:data:diagnostics',
  copy: 'fox:data:copy-diagnostics',
  backup: 'fox:data:backup',
  restore: 'fox:data:restore',
  error: 'fox:data:renderer-error',
} as const;
import type { OperatorId, OperatorSession, ShiftPeriod, ShiftSales } from '../domain/operators';

export const OPERATOR_IPC = {
  status: 'fox:operators:status',
  login: 'fox:operators:login',
  logout: 'fox:operators:logout',
  report: 'fox:operators:report',
  catalog: 'fox:operators:catalog',
} as const;

export interface FoxApi {
  operators: {
    status(): Promise<OperatorSession>;
    login(input: { id: OperatorId; pin: string }): Promise<OperatorSession>;
    logout(): Promise<OperatorSession>;
    report(period: ShiftPeriod): Promise<ShiftSales>;
    catalog(): Promise<CatalogProduct[]>;
  };
  reservations: {
    reserve(input: ReserveTableInput): Promise<MutationResult<OrderWorkspace>>;
    arrive(input: ResolveReservationInput): Promise<MutationResult<OrderWorkspace>>;
    cancel(input: ResolveReservationInput): Promise<MutationResult<OrderWorkspace>>;
  };
  finance: {
    report(input: FinanceQuery): Promise<FinanceReport>;
    saveExpense(input: ExpenseInput): Promise<MutationResult<ExpenseRecord>>;
    expenseHistory(id: string): Promise<ExpenseRecord[]>;
    recordLoss(input: LossInput): Promise<MutationResult<LossRecord>>;
    recordCashMovement(input: CashMovementInput): Promise<MutationResult<CashEvent>>;
    cashPreview(input: { openingCents: number; countedCents?: number }): Promise<CashPreview>;
    closeCash(input: CashInput): Promise<MutationResult<CashClose>>;
  };
  data: {
    diagnostics(): Promise<DataDiagnostics>;
    copyDiagnostics(): Promise<DataActionResult>;
    backup(): Promise<DataActionResult>;
    restore(): Promise<DataActionResult>;
    rendererError(input: 'RENDERER_FAILURE'): Promise<DataActionResult>;
  };
  tables: { list(): Promise<TableSummary[]> };
  orders: {
    completeOrder(input: CompleteOrderRequest): Promise<CheckoutResult>;
    getForTable(tableId: string): Promise<OrderWorkspace>;
    submitDraft(input: SubmitOrderDraft): Promise<OrderDraftResult<OrderWorkspace>>;
    addProduct(input: AddOrderProduct): Promise<MutationResult<OrderWorkspace>>;
    incrementItem(input: OrderItemCommand): Promise<MutationResult<OrderWorkspace>>;
    decrementItem(input: OrderItemCommand): Promise<MutationResult<OrderWorkspace>>;
    removeItem(input: OrderItemCommand): Promise<MutationResult<OrderWorkspace>>;
  };
  products: {
    list(): Promise<CatalogProduct[]>;
    update(input: ProductUpdate): Promise<MutationResult<CatalogProduct>>;
  };
  inventory: { addSupply(input: SupplyRequest): Promise<MutationResult<CatalogProduct>> };
  settings: {
    get(): Promise<Settings>;
    updateBusinessName(input: { businessName: string }): Promise<MutationResult<Settings>>;
  };
  receipts: {
    listPrinters(): Promise<ReceiptResult<Printer[]>>;
    getSettings(): Promise<ReceiptSettings>;
    saveSettings(input: ReceiptSettingsInput): Promise<ReceiptSettingsResult>;
    testPrint(): Promise<ReceiptResult<PrintJob>>;
    printCopy(input: ReceiptAction): Promise<ReceiptResult<PrintJob>>;
    retry(jobId: string): Promise<ReceiptResult<PrintJob>>;
    getState(saleId: string): Promise<ReceiptResult<ReceiptState>>;
    recentJobs(): Promise<PrintJob[]>;
  };
  reports: {
    getSalesReport(period: ReportPeriod): Promise<SalesReport>;
    getSummary(): Promise<ReportSummary>;
  };
}
export const IPC = {
  receiptPrinters: 'fox:receipts:printers',
  receiptSettings: 'fox:receipts:settings',
  receiptSaveSettings: 'fox:receipts:save-settings',
  receiptTest: 'fox:receipts:test',
  receiptCopy: 'fox:receipts:copy',
  receiptRetry: 'fox:receipts:retry',
  receiptState: 'fox:receipts:state',
  receiptJobs: 'fox:receipts:jobs',
  completeOrder: 'fox:orders:complete',
  salesReport: 'fox:reports:sales',
  tables: 'fox:tables:list',
  products: 'fox:products:list',
  settings: 'fox:settings:get',
  reports: 'fox:reports:summary',
  updateProduct: 'fox:products:update',
  addSupply: 'fox:inventory:add-supply',
  getOrder: 'fox:orders:get-for-table',
  addProduct: 'fox:orders:add-product',
  incrementItem: 'fox:orders:increment-item',
  decrementItem: 'fox:orders:decrement-item',
  removeItem: 'fox:orders:remove-item',
} as const;
