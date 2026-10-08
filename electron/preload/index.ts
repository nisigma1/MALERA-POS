import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type FoxApi } from '../../src/types/api';
const api: FoxApi = {
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
  reports: { getSalesReport: period => ipcRenderer.invoke(IPC.salesReport, period), getSummary: () => ipcRenderer.invoke(IPC.reports) },
};
contextBridge.exposeInMainWorld('fox', api);
