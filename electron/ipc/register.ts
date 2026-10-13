import { ipcMain, type BrowserWindow } from 'electron';
import type { createCheckoutService } from '../database/checkout';
import { IPC, DATA_IPC, FINANCE_IPC, RESERVATION_IPC } from '../../src/types/api';
import type { createReservationService } from '../database/reservations';
import type {createFinanceService} from '../database/finance';
import type {DataProtectionService} from '../main/dataProtection';
import {logError} from '../main/logging';
import type { createRepositories } from '../database/repositories';
import type { createConfigurationService } from '../database/configuration';
import type { createOrderService } from '../database/orders';
import type { ReceiptService, PrintManager } from '../receipts/manager';
export function registerIpc(window: BrowserWindow, repositories: ReturnType<typeof createRepositories>, configuration: ReturnType<typeof createConfigurationService>, orders: ReturnType<typeof createOrderService>, checkout: ReturnType<typeof createCheckoutService>, receipts: ReceiptService, printManager: PrintManager, data?:DataProtectionService, finance?:ReturnType<typeof createFinanceService>, reservations?:ReturnType<typeof createReservationService>): void {
  const handle:typeof ipcMain.handle=(channel,listener)=>ipcMain.handle(channel,(event,...args:unknown[])=>{
    if(data?.isMaintenance())throw Error('FOX_DATA_MAINTENANCE');
    return listener(event,...args);
  });
  if (reservations) for (const [channel,action] of [[RESERVATION_IPC.reserve,reservations.reserve],[RESERVATION_IPC.arrive,reservations.arrive],[RESERVATION_IPC.cancel,reservations.cancel]] as const) handle(channel,(event,...args:unknown[])=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||args.length!==1)throw Error('Unauthorized FOX request');
    try { return action(args[0]); } catch(error) { logError('RESERVATION_IPC',error); return {ok:false,errors:{form:'Rezervimi nuk u konfirmua. Rifresko tavolinën.'},message:'Rezervimi nuk u konfirmua. Rifresko tavolinën.'}; }
  });
  if(finance)for(const [channel,action] of [[FINANCE_IPC.report,finance.report],[FINANCE_IPC.expense,finance.saveExpense],[FINANCE_IPC.history,finance.expenseHistory],[FINANCE_IPC.loss,finance.recordLoss],[FINANCE_IPC.preview,finance.cashPreview],[FINANCE_IPC.close,finance.closeCash],[FINANCE_IPC.movement,finance.recordCashMovement]] as const)handle(channel,(event,...args:unknown[])=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||args.length!==1)throw Error('Unauthorized FOX request');
    try{return action(args[0]);}catch(error){logError('FINANCE_IPC',error);throw Error('Të dhënat financiare nuk mund të lexohen. Kontrollo periudhën dhe provo përsëri.');}
  });
  if(data)for(const [channel,count,action] of [
    [DATA_IPC.diagnostics,0,()=>data.diagnostics()],[DATA_IPC.copy,0,()=>data.copyDiagnostics()],
    [DATA_IPC.backup,0,()=>data.backup()],[DATA_IPC.restore,0,()=>data.restore()],
    [DATA_IPC.error,1,(input:unknown)=>data.rendererError(input)],
  ] as const)handle(channel,(event,...args:unknown[])=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||args.length!==count)throw Error('Unauthorized FOX request');
    try{return action(args[0]);}catch(error){logError('DATA_IPC',error);throw Error('Diagnostika nuk mund të lexohet.');}
  });
  for (const [channel,count,handler] of [
    [IPC.receiptPrinters,0,()=>receipts.listPrinters()], [IPC.receiptSettings,0,()=>receipts.getSettings()],
    [IPC.receiptJobs,0,()=>receipts.recentJobs()], [IPC.receiptTest,0,()=>receipts.testPrint()],
    [IPC.receiptSaveSettings,1,(input:unknown)=>receipts.saveSettings(input)],
    [IPC.receiptCopy,1,(input:unknown)=>receipts.copy(input)], [IPC.receiptRetry,1,(input:unknown)=>receipts.retry(input)],
    [IPC.receiptState,1,(input:unknown)=>receipts.state(input)],
  ] as const) {
    handle(channel,async(event,...args:unknown[])=>{
      if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||args.length!==count)throw Error('Unauthorized FOX request');
      try{return await handler(args[0]);}catch(error){logError('RECEIPT_IPC',error);throw Error('Kuponët nuk mund të lexohen. Provo përsëri.');}
    });
  }
  const handlers = [
    [IPC.tables, () => repositories.listTables()], [IPC.products, () => repositories.listProducts()],
    [IPC.settings, () => repositories.getSettings()], [IPC.reports, () => repositories.getSummary()],
  ] as const;
  for (const [channel, handler] of handlers) {
    handle(channel, (event, ...args: unknown[]) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || args.length) {
        throw new Error('Unauthorized FOX request');
      }
      try { return handler(); }
      catch (error) { logError('READ_IPC',error); throw new Error('Të dhënat nuk mund të lexohen.'); }
    });
  }
  handle(IPC.completeOrder, (event, ...args: unknown[]) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || args.length !== 1) throw new Error('Unauthorized FOX request');
    const result=checkout.completeOrder(args[0]);
    if(result.ok)printManager.kick();
    return result;
  });
  handle('fox:settings:business-name',(event,...args:unknown[])=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||args.length!==1)throw Error('Unauthorized FOX request');
    try{return configuration.updateBusinessName(args[0]);}
    catch(error){logError('BUSINESS_SETTINGS',error);return {ok:false,errors:{form:'Emri nuk u ruajt. Provo përsëri.'},message:'Emri nuk u ruajt. Provo përsëri.'};}
  });
  handle(IPC.salesReport, (event, ...args: unknown[]) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || args.length !== 1) throw new Error('Unauthorized FOX request');
    try { return repositories.getSalesReport(args[0]); }
    catch (error) { logError('REPORT_IPC',error); throw new Error('Raporti nuk mund të lexohet. Provo përsëri.'); }
  });
  handle(IPC.getOrder, (event, ...args: unknown[]) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || args.length !== 1) throw new Error('Unauthorized FOX request');
    try { return orders.getForTable(args[0]); }
    catch (error) { logError('ORDER_IPC',error); throw new Error('Porosia nuk mund të lexohet. Provo përsëri.'); }
  });
  for (const [channel, handler] of [[IPC.updateProduct, configuration.updateProduct], [IPC.addSupply, configuration.addSupply], [IPC.addProduct, orders.addProduct], [IPC.incrementItem, orders.incrementItem], [IPC.decrementItem, orders.decrementItem], [IPC.removeItem, orders.removeItem]] as const) {
    handle(channel, (event, ...args: unknown[]) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || args.length !== 1) throw new Error('Unauthorized FOX request');
      try { return handler(args[0]); }
      catch (error) {
        logError('MUTATION_IPC',error);
        return { ok: false, errors: { form: 'Ndryshimet nuk u ruajtën. Provo përsëri.' }, message: 'Ndryshimet nuk u ruajtën.' };
      }
    });
  }
}
