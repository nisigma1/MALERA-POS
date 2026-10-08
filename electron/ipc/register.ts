import { ipcMain, type BrowserWindow } from 'electron';
import type { createCheckoutService } from '../database/checkout';
import { IPC } from '../../src/types/api';
import type { createRepositories } from '../database/repositories';
import type { createConfigurationService } from '../database/configuration';
import type { createOrderService } from '../database/orders';
export function registerIpc(window: BrowserWindow, repositories: ReturnType<typeof createRepositories>, configuration: ReturnType<typeof createConfigurationService>, orders: ReturnType<typeof createOrderService>, checkout: ReturnType<typeof createCheckoutService>): void {
  const handlers = [
    [IPC.tables, () => repositories.listTables()], [IPC.products, () => repositories.listProducts()],
    [IPC.settings, () => repositories.getSettings()], [IPC.reports, () => repositories.getSummary()],
  ] as const;
  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || args.length) {
        throw new Error('Unauthorized FOX request');
      }
      try { return handler(); }
      catch (error) { console.error(`FOX IPC ${channel} failed`, error); throw new Error('Të dhënat nuk mund të lexohen.'); }
    });
  }
  ipcMain.handle(IPC.completeOrder, (event, ...args: unknown[]) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || args.length !== 1) throw new Error('Unauthorized FOX request');
    return checkout.completeOrder(args[0]);
  });
  ipcMain.handle(IPC.salesReport, (event, ...args: unknown[]) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || args.length !== 1) throw new Error('Unauthorized FOX request');
    try { return repositories.getSalesReport(args[0]); }
    catch (error) { console.error('FOX sales report failed', error); throw new Error('Raporti nuk mund të lexohet. Provo përsëri.'); }
  });
  ipcMain.handle(IPC.getOrder, (event, ...args: unknown[]) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || args.length !== 1) throw new Error('Unauthorized FOX request');
    try { return orders.getForTable(args[0]); }
    catch (error) { console.error('FOX order read failed', error); throw new Error('Porosia nuk mund të lexohet. Provo përsëri.'); }
  });
  for (const [channel, handler] of [[IPC.updateProduct, configuration.updateProduct], [IPC.addSupply, configuration.addSupply], [IPC.addProduct, orders.addProduct], [IPC.incrementItem, orders.incrementItem], [IPC.decrementItem, orders.decrementItem], [IPC.removeItem, orders.removeItem]] as const) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || args.length !== 1) throw new Error('Unauthorized FOX request');
      try { return handler(args[0]); }
      catch (error) {
        console.error(`FOX IPC ${channel} failed`, error);
        return { ok: false, errors: { form: 'Ndryshimet nuk u ruajtën. Provo përsëri.' }, message: 'Ndryshimet nuk u ruajtën.' };
      }
    });
  }
}
