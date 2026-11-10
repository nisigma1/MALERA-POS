import { createContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { TableDraft } from '../domain/orderDraft';

export const OrderDraftContext = createContext<{
  drafts: Map<string, TableDraft>;
  setDrafts: Dispatch<SetStateAction<Map<string, TableDraft>>>;
}>({ drafts: new Map(), setDrafts() {} });
