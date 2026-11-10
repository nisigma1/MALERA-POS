import { app, BrowserWindow, dialog, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { openDatabase } from '../database/connection';
import { isDuoCatalogTerminal } from '../database/duoCatalog';
import { createOperatorSession, requiresOperatorLogin } from './operatorSession';
import { readShiftSales } from '../database/duoReports';
import { createRepositories } from '../database/repositories';
import { createConfigurationService } from '../database/configuration';
import { createCheckoutService } from '../database/checkout';
import { createOrderService } from '../database/orders';
import { createReservationService } from '../database/reservations';
import { createFinanceService } from '../database/finance';
import { registerIpc } from '../ipc/register';
import { verificationDirectory } from '../database/safety';
import { createReceiptRepository } from '../receipts/repository';
import { PrintManager, createReceiptService } from '../receipts/manager';
import { WindowsPrinterAdapter } from '../receipts/windowsAdapter';
import { initializeLogging, logError } from './logging';
import { createDataProtection, type DataProtectionService } from './dataProtection';
import { recoverInterruptedRestore, restoreUnreadableDatabase } from '../database/restore';
import { durableWrite, validateBackup } from '../database/backups';
import { allowedResource } from './security';
declare const FOX_RELEASE: boolean;

app.setName('FOX Kafeteri');
const qaDirectory = verificationDirectory(app.getPath('userData'), process.env);
if (qaDirectory) app.setPath('userData', qaDirectory);
let database: Database.Database | undefined;
let printManager: PrintManager | undefined;
let mainWindow: BrowserWindow | undefined;
let protection: DataProtectionService | undefined;
let waitingToQuit = false;
async function start() {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  initializeLogging(userData);
  recoverInterruptedRestore(userData);
  const identityFile = path.join(userData, 'fox-data-identity.json');
  if (fs.existsSync(identityFile) && !fs.existsSync(path.join(userData, 'fox.sqlite')))
    throw Error('FOX_DB_MISSING_EXISTING');
  database = openDatabase(
    path.join(userData, 'fox.sqlite'),
    app.getVersion(),
    app.isPackaged && !qaDirectory && isDuoCatalogTerminal(),
  );
  if (!fs.existsSync(identityFile))
    durableWrite(
      identityFile,
      JSON.stringify({ format: 1, product: 'FOX Kafeteri', createdAt: new Date().toISOString() }),
    );
  Menu.setApplicationMenu(null);
  const devUrl =
    !app.isPackaged && /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.FOX_DEV_URL ?? '')
      ? process.env.FOX_DEV_URL
      : undefined;
  const window = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 900,
    minHeight: 460,
    title: 'MALERA POS',
    show: !process.env.FOX_VERIFY_DIR,
    backgroundColor: '#f4f3ef',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
      offscreen: Boolean(process.env.FOX_VERIFY_DIR),
      backgroundThrottling: !process.env.FOX_VERIFY_DIR,
    },
  });
  mainWindow = window;
  if (!FOX_RELEASE && qaDirectory && process.env.FOX_VERIFY_CUTOVER_DIALOGS)
    (await import('../verification/cutover-dialogs')).cutoverDialogs(qaDirectory);
  window.on('closed', () => app.quit());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !allowedResource(details.url, path.resolve(__dirname, '../dist'), devUrl) });
  });
  const duo = app.isPackaged && !qaDirectory && requiresOperatorLogin(userData);
  const setupPending = app.isPackaged && !qaDirectory && isDuoCatalogTerminal() && !duo;
  const access = createOperatorSession(userData, duo, Date.now, setupPending);
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) access.logout();
  });
  window.webContents.on('render-process-gone', () => access.logout());
  const repositories = createRepositories(database, duo);
  const orders = createOrderService(
    database,
    repositories,
    duo ? { operator: access.current } : undefined,
  );
  const receiptRepository = createReceiptRepository(database),
    printerAdapter = new WindowsPrinterAdapter(window);
  printManager = new PrintManager(receiptRepository, printerAdapter);
  protection = createDataProtection(window, database, () => printManager?.stop());
  registerIpc(
    window,
    repositories,
    createConfigurationService(database, repositories, duo),
    orders,
    createCheckoutService(database, orders, duo),
    createReceiptService(receiptRepository, printerAdapter, printManager),
    printManager,
    protection,
    createFinanceService(database, undefined, duo),
    createReservationService(database, orders),
    access,
    duo ? (input) => readShiftSales(database!, input) : undefined,
  );
  printManager.start();
  const rendererErrors: string[] = [];
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      if (rendererErrors.length < 50) rendererErrors.push(details.message);
      logError('RENDERER_CONSOLE_ERROR');
      if (process.env.FOX_VERIFY_DIR) console.error('FOX verification renderer:', details.message);
    }
  });
  window.webContents.on('preload-error', (_event, _preloadPath, error) => {
    rendererErrors.push(error.message);
    logError('PRELOAD_ERROR', error);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererErrors.push(`Renderer stopped: ${details.reason}`);
    logError('RENDERER_GONE');
    if (!process.env.FOX_VERIFY_DIR)
      dialog.showErrorBox('FOX', 'Ekrani u ndërpre. Të dhënat e ruajtura janë ruajtur. Rihap FOX.');
  });
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(path.join(__dirname, '../dist/index.html'));
  if (!process.env.FOX_VERIFY_DIR) window.maximize();
  // Interactive QA keeps the same isolated, hidden window open for native input.
  if (!FOX_RELEASE && process.env.FOX_VERIFY_DIR && !process.env.FOX_VERIFY_MANUAL) {
    if (process.env.FOX_VERIFY_HARDENING)
      await (
        await import('../verification/verify-hardening')
      ).verifyHardening(window, process.env.FOX_VERIFY_DIR, database, printManager, rendererErrors);
    else if (process.env.FOX_VERIFY_RECEIPTS)
      await (
        await import('../verification/verify-receipts')
      ).verifyReceipts(window, process.env.FOX_VERIFY_DIR, database, printManager, rendererErrors);
    else if (process.env.FOX_VERIFY_CHECKOUT)
      await (
        await import('../verification/verify-checkout')
      ).verifyCheckout(
        window,
        process.env.FOX_VERIFY_DIR,
        database,
        rendererErrors,
        Boolean(process.env.FOX_VERIFY_CHECKOUT_RESTART),
      );
    else if (process.env.FOX_VERIFY_ORDER_RESTART)
      await (
        await import('../verification/verify-orders')
      ).verifyOrderRestart(window, process.env.FOX_VERIFY_DIR, database, rendererErrors);
    else
      await (
        await import('../verification/verify')
      ).verifyRuntime(window, process.env.FOX_VERIFY_DIR, repositories, database, rendererErrors);
    app.quit();
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else
  app
    .whenReady()
    .then(start)
    .catch(async (error) => {
      if (process.env.FOX_VERIFY_DIR)
        console.error('FOX isolated startup verification failed', error);
      logError('STARTUP_FAILED', error);
      if (database?.open) database.close();
      if (!process.env.FOX_VERIFY_DIR) {
        const choice = await dialog.showMessageBox({
          type: 'error',
          title: 'FOX — Të dhënat',
          message: 'FOX nuk mund ta hapë databazën ekzistuese. Të dhënat nuk janë fshirë.',
          detail:
            'Mund të rikthesh një backup të verifikuar ose ta mbyllësh aplikacionin. Diagnostika është ruajtur lokalisht.',
          buttons: ['Mbyll', 'Zgjidh backup për rikthim'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (choice.response === 1)
          try {
            const selected = await dialog.showOpenDialog({
              title: 'Zgjidh backup',
              filters: [{ name: 'FOX backup', extensions: ['sqlite'] }],
              properties: ['openFile'],
            });
            const file = selected.filePaths[0];
            if (file) {
              await validateBackup(file);
              const confirmation = await dialog.showMessageBox({
                type: 'warning',
                message: 'Rikthe backup-in? Gjendja e palexueshme do të ruhet veçmas.',
                buttons: ['Anulo', 'Rikthe'],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
              });
              if (confirmation.response === 1) {
                await restoreUnreadableDatabase(file, app.getPath('userData'), app.getVersion());
                app.relaunch();
              }
            }
          } catch (recoveryError) {
            logError('RECOVERY_FAILED', recoveryError);
            dialog.showErrorBox(
              'FOX',
              'Backup-i nuk u rikthye. Të dhënat ekzistuese janë ruajtur.',
            );
          }
      }
      // Let Electron's ready callback finish before terminating a failed early startup.
      // Immediate native exit here produced a Windows access violation in acceptance.
      setImmediate(() => app.exit(1));
    });
app.on('second-instance', () => {
  const window = mainWindow;
  if (window?.isMinimized()) window.restore();
  window?.focus();
});
app.on('before-quit', (event) => {
  printManager?.stop();
  if (protection?.isBusy()) {
    event.preventDefault();
    if (waitingToQuit) return;
    waitingToQuit = true;
    void protection
      .whenIdle()
      .then(() => {
        waitingToQuit = false;
        app.quit();
      })
      .catch((error) => {
        logError('CONTROLLED_SHUTDOWN_TIMEOUT', error);
        app.exit(1);
      });
    return;
  }
  if (database?.open) database.close();
});
app.on('window-all-closed', () => app.quit());
process.on('uncaughtException', (error) => {
  logError('MAIN_FATAL_EXCEPTION', error);
  printManager?.stop();
  if (database?.open) database.close();
  app.exit(1);
});
process.on('unhandledRejection', (error) => {
  logError('MAIN_FATAL_REJECTION', error);
  printManager?.stop();
  if (database?.open) database.close();
  app.exit(1);
});
