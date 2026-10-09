import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { openDatabase } from '../database/connection';
import { createRepositories } from '../database/repositories';
import { createConfigurationService } from '../database/configuration';
import { createCheckoutService } from '../database/checkout';
import { createOrderService } from '../database/orders';
import { registerIpc } from '../ipc/register';
import { verificationDirectory } from '../database/safety';
import { createReceiptRepository } from '../receipts/repository';
import { PrintManager, createReceiptService } from '../receipts/manager';
import { WindowsPrinterAdapter } from '../receipts/windowsAdapter';
declare const FOX_RELEASE: boolean;

app.setName('FOX Kafeteri');
const qaDirectory = verificationDirectory(app.getPath('userData'), process.env);
if (qaDirectory) app.setPath('userData', qaDirectory);
let database: Database.Database | undefined;
let printManager: PrintManager | undefined;
let mainWindow: BrowserWindow | undefined;
async function start() {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  database = openDatabase(path.join(userData, 'fox.sqlite'));
  const devUrl = !app.isPackaged && /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.FOX_DEV_URL ?? '')
    ? process.env.FOX_DEV_URL : undefined;
  const window = new BrowserWindow({
    width: 1366, height: 768, minWidth: 1000, minHeight: 650,
    title: 'FOX Kafeteri', show: !process.env.FOX_VERIFY_DIR,
    backgroundColor: '#f4f3ef', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: Boolean(process.env.FOX_VERIFY_DIR), backgroundThrottling: !process.env.FOX_VERIFY_DIR },
  });
  mainWindow=window;
  window.on('closed',()=>app.quit());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const localFile = url.protocol === 'file:';
    const localDev = devUrl && ['http:', 'ws:'].includes(url.protocol) && url.host === new URL(devUrl).host;
    callback({ cancel: !localFile && !localDev });
  });
  const repositories = createRepositories(database);
  const orders = createOrderService(database, repositories);
  const receiptRepository=createReceiptRepository(database),printerAdapter=new WindowsPrinterAdapter(window);
  printManager=new PrintManager(receiptRepository,printerAdapter);
  registerIpc(window, repositories, createConfigurationService(database, repositories), orders, createCheckoutService(database, orders),createReceiptService(receiptRepository,printerAdapter,printManager),printManager);
  printManager.start();
  const rendererErrors: string[] = [];
  window.webContents.on('console-message', details => { if (details.level === 'error') { rendererErrors.push(details.message); if (process.env.FOX_VERIFY_DIR) console.error('FOX verification renderer:', details.message); } });
  window.webContents.on('preload-error', (_event, _preloadPath, error) => rendererErrors.push(error.message));
  window.webContents.on('render-process-gone', (_event, details) => rendererErrors.push(`Renderer stopped: ${details.reason}`));
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(path.join(__dirname, '../dist/index.html'));
  if (!process.env.FOX_VERIFY_DIR) window.maximize();
  // Interactive QA keeps the same isolated, hidden window open for native input.
  if (!FOX_RELEASE && process.env.FOX_VERIFY_DIR && !process.env.FOX_VERIFY_MANUAL) {
    if (process.env.FOX_VERIFY_RECEIPTS) await (await import('./verify-receipts')).verifyReceipts(window,process.env.FOX_VERIFY_DIR,database,printManager,rendererErrors);
    else if (process.env.FOX_VERIFY_CHECKOUT) await (await import('./verify-checkout')).verifyCheckout(window,process.env.FOX_VERIFY_DIR,database,rendererErrors,Boolean(process.env.FOX_VERIFY_CHECKOUT_RESTART));
    else if (process.env.FOX_VERIFY_ORDER_RESTART) await (await import('./verify-orders')).verifyOrderRestart(window,process.env.FOX_VERIFY_DIR,database,rendererErrors);
    else await (await import('./verify')).verifyRuntime(window, process.env.FOX_VERIFY_DIR, repositories, database, rendererErrors);
    app.quit();
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(start).catch(error => {
  console.error('FOX startup failed', error);
  if (!process.env.FOX_VERIFY_DIR) dialog.showErrorBox('FOX — Gabim', 'Aplikacioni nuk mund të niset. Të dhënat lokale nuk janë fshirë. Shikoni regjistrimin e gabimit.');
  database?.close();
  app.exit(1);
});
app.on('second-instance', () => {
  const window = mainWindow;
  if (window?.isMinimized()) window.restore();
  window?.focus();
});
app.on('before-quit', () => { printManager?.stop(); database?.close(); });
app.on('window-all-closed', () => app.quit());
