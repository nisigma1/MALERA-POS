import type { OrderProductSnapshot, SubmitOrderDraft } from './types';

export interface OrderDraft {
  items: { productId: string; quantity: number; expectedProduct: OrderProductSnapshot }[];
}
export type TableDraft = OrderDraft & { retry?: { request: SubmitOrderDraft; pending: boolean } };
