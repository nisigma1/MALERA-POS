import { contextBridge, ipcRenderer } from 'electron';
import { IPC, DATA_IPC, type FoxApi } from '../../src/types/api';
const api: FoxApi = {
  data: { diagnostics:()=>ipcRenderer.invoke(DATA_IPC.diagnostics),copyDiagnostics:()=>ipcRenderer.invoke(DATA_IPC.copy),backup:()=>ipcRenderer.invoke(DATA_IPC.backup),restore:()=>ipcRenderer.invoke(DATA_IPC.restore),rendererError:input=>ipcRenderer.invoke(DATA_IPC.error,input) },
  tables: { list: () => ipcRenderer.invoke(IPC.tables) },
  orders: {
    completeOrder: input => ipcRenderer.invoke(IPC.completeOrder, input),
    getForTable: tableId => ipcRenderer.invoke(IPC.getOrder, tableId),
    addProduct: input => ipcRenderer.invoke(IPC.addProduct, input),
    incrementItem: input => ipcRenderer.invoke(IPC.incrementItem, input),
    decrementItem: input => ipcRenderer.invoke(IPC.decrementItem, input),
    removeItem: input => ipcRenderer.invoke(IPC.removeItem, input),
  },
  products: { list: () => ipcRenderer.invoke(IPC.products), update: input => ipcRenderer.invoke(IPC.updateProduct, input) },
  inventory: { addSupply: input => ipcRenderer.invoke(IPC.addSupply, input) },
  settings: { get: () => ipcRenderer.invoke(IPC.settings) },
  receipts: {
    listPrinters: () => ipcRenderer.invoke(IPC.receiptPrinters),
    getSettings: () => ipcRenderer.invoke(IPC.receiptSettings),
    saveSettings: input => ipcRenderer.invoke(IPC.receiptSaveSettings,input),
    testPrint: () => ipcRenderer.invoke(IPC.receiptTest),
    printCopy: input => ipcRenderer.invoke(IPC.receiptCopy,input),
    retry: jobId => ipcRenderer.invoke(IPC.receiptRetry,jobId),
    getState: saleId => ipcRenderer.invoke(IPC.receiptState,saleId),
    recentJobs: () => ipcRenderer.invoke(IPC.receiptJobs),
  },
  reports: { getSalesReport: period => ipcRenderer.invoke(IPC.salesReport, period), getSummary: () => ipcRenderer.invoke(IPC.reports) },
};
contextBridge.exposeInMainWorld('fox', api);
