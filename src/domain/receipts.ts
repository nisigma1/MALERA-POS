export type PrintStatus =
  | 'PENDING'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'CANCELLED';
export type PrintKind = 'ORIGINAL_AUTO' | 'ORIGINAL_RETRY' | 'COPY' | 'TEST';
export interface Printer {
  deviceName: string;
  displayName: string;
  description: string;
}
export interface ReceiptSettings {
  deviceName: string | null;
  displayName: string | null;
  autoPrint: boolean;
  paperWidth: 80;
  copies: 1;
}
export interface ReceiptPayload {
  schemaVersion: 1;
  kind: 'SALE' | 'TEST';
  saleNumber: number | null;
  completedAt: string;
  tableCode: string | null;
  paymentMethod: 'CASH' | 'CARD' | null;
  businessDisplayName: string;
  items: { name: string; quantity: number; unitPriceCents: number; lineTotalCents: number }[];
  totalCents: number;
  currency: 'EUR';
  nonFiscalNotice: string;
}
export interface PrintJob {
  id: string;
  saleId: string | null;
  saleNumber: number | null;
  kind: PrintKind;
  status: PrintStatus;
  errorCode: string | null;
  createdAt: string;
  attemptCount: number;
}
export interface ReceiptState {
  saleId: string;
  jobs: PrintJob[];
  generationError: boolean;
}
export interface ReceiptAction {
  saleId: string;
  requestId: string;
}
export type ReceiptSettingsInput = Pick<
  ReceiptSettings,
  'deviceName' | 'autoPrint' | 'paperWidth' | 'copies'
>;
export type ReceiptSettingsResult = ReceiptResult<
  { saved: false; message: string } | { saved: true; settings: ReceiptSettings }
>;
export type ReceiptResult<T> = { ok: true; data: T } | { ok: false; message: string };
export const PRINT_STATUS_LABELS: Record<PrintStatus, string> = {
  PENDING: 'Në pritje',
  SUBMITTING: 'Duke dërguar',
  SUBMITTED: 'Dërguar',
  FAILED: 'Dështoi',
  UNKNOWN: 'Status i paqartë',
  CANCELLED: 'Anuluar',
};
export const NON_FISCAL_NOTICE = 'Ky dokument nuk e zëvendëson kuponin fiskal.';
export const RECEIPT_PROFILE = {
  paperWidthMm: 80,
  contentWidthMm: 72,
  submissionTimeoutMs: 30000,
} as const;
