// Background-only integration verification; no production database or visible window.
import { ipcMain, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { assertQaDirectory } from '../database/safety';
import { IPC } from '../../src/types/api';
import type { createRepositories } from '../database/repositories';
import type Database from 'better-sqlite3';
import { verifyActiveOrders } from './verify-orders';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function verifyRuntime(window: BrowserWindow, directory: string, repositories: ReturnType<typeof createRepositories>, db: Database.Database, errors: string[]): Promise<void> {
  assertQaDirectory(directory); if(path.resolve(db.name)!==path.join(directory,'fox.sqlite'))throw new Error('Runtime QA database mismatch');
  const waitFor = async (selector: string) => {
    for (let i = 0; i < 100; i++) {
      if (await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
      await delay(50);
    }
    throw new Error(`Renderer did not load ${selector}`);
  };
  const snapshot = async (filename: string) => {
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await delay(100);
    fs.writeFileSync(path.join(directory, filename), (await window.webContents.capturePage()).toPNG());
  };
  const measurements: unknown[] = [];
  const inspectQuality = async (screen: string, width: number) => {
    const metrics = await window.webContents.executeJavaScript(`(() => {
      const rgba = value => (value.match(/[\\d.]+/g) || []).map(Number);
      const blend = (a,b) => a.slice(0,3).map((v,i) => v*(a[3]??1)+b[i]*(1-(a[3]??1)));
      const background = element => {
        const chain=[]; for(let e=element;e;e=e.parentElement) chain.unshift(e);
        return chain.reduce((color,e)=>blend(rgba(getComputedStyle(e).backgroundColor),color),[255,255,255]);
      };
      const luminance = color => color.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
      let minContrast=100; const contrastFailures=[];
      const scope=document.querySelector('dialog[open]')||document;
      for(const e of scope.querySelectorAll('*')) {
        if(!(e instanceof HTMLElement)||e.closest('.sr-only')||!e.getBoundingClientRect().height)continue;
        if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&!e.matches('input,select'))continue;
        const style=getComputedStyle(e),bg=background(e),fg=blend(rgba(style.color),bg);
        const a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        minContrast=Math.min(minContrast,ratio);
        if(ratio<4.5)contrastFailures.push({text:e.textContent.trim().slice(0,60),ratio});
      }
      const bounds = selector => [...document.querySelectorAll(selector)].map(e=>{
        const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {height:b.height,left:b.left,right:b.right,font:s.fontSize,alignment:s.textAlign};
      });
      return {minContrast,contrastFailures,bodyScroll:document.body.scrollHeight>innerHeight,
        headings:bounds('h1'),tiles:bounds('.position'),inputs:bounds('dialog input,dialog select'),
        numeric:bounds('.catalog .numeric'),rows:bounds('.catalog tbody tr'),badges:bounds('.badge'),
        summary:bounds('.summary-strip'),toolbar:bounds('.inventory-toolbar'),panel:bounds('dialog[open]')};
    })()`) as { contrastFailures: unknown[]; bodyScroll: boolean };
    if (metrics.contrastFailures.length || metrics.bodyScroll) throw new Error(`Quality measurements failed ${screen}/${width}: ${JSON.stringify(metrics)}`);
    measurements.push({ screen, width, ...metrics });
  };
  const escapePanel = async () => {
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    for (let i=0;i<100;i++) {
      if (!await window.webContents.executeJavaScript(`Boolean(document.querySelector('dialog[open]'))`)) return;
      await delay(20);
    }
    throw new Error('Escape did not close the panel');
  };
  await waitFor('[data-table-code="T10"]');
  const api = await window.webContents.executeJavaScript(`(async () => ({
    tables: await window.fox.tables.list(), products: await window.fox.products.list(),
    settings: await window.fox.settings.get(), reports: await window.fox.reports.getSummary(),
    nodeAccessible: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
    keys: Object.keys(window.fox)
  }))()`) as { tables: unknown[]; products: unknown[]; settings: { businessName: string }; reports: { salesCents: number; completedOrders: number }; nodeAccessible: boolean; keys: string[] };
  if (api.tables.length !== 27 || api.products.length !== 21 || api.settings.businessName !== 'FOX' || api.reports.salesCents !== 0 || api.reports.completedOrders !== 0 || api.nodeAccessible || api.keys.sort().join(',') !== 'data,inventory,orders,products,receipts,reports,settings,tables') {
    throw new Error('Preload/runtime data verification failed');
  }
  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]] as const) {
    window.setContentSize(width, height);
    for (const page of ['tables', 'inventory', 'reports', 'settings']) {
      await window.webContents.executeJavaScript(`document.querySelector('[data-nav="${page}"]').click()`);
      await waitFor(`[data-page="${page}"]`);
      await delay(50);
      const layout = await window.webContents.executeJavaScript(`(() => {
        const main = document.querySelector('main').getBoundingClientRect();
        const aside = document.querySelector('aside').getBoundingClientRect();
        const controls = [...document.querySelectorAll('nav button')];
        const boxes = [...document.querySelectorAll('.position')].map(e => e.getBoundingClientRect());
        const overlaps = boxes.some((a,i) => boxes.slice(i+1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          hidden: main.left < aside.right || controls.some(e => e.getBoundingClientRect().bottom > innerHeight), overlaps,
          clipped: [...document.querySelectorAll('th,td,.position strong,.state,nav button')].some(e => e.scrollWidth > e.clientWidth) };
      })()`) as { overflow: boolean; hidden: boolean; overlaps: boolean; clipped: boolean };
      if (Object.values(layout).some(Boolean)) throw new Error(`Layout failure ${page} ${width}x${height}: ${JSON.stringify(layout)}`);
      await inspectQuality(page, width);
      await snapshot(`${page}-${width}.png`);
    }
  }
  // Existing statuses are inspected with isolated fixtures, including the longest labels.
  for (const [code,status] of [['M1','ACTIVE'],['SH1','AWAITING_PAYMENT'],['T1','ACTIVE'],['T2','AWAITING_PAYMENT'],['T3','RESERVED']]) db.prepare('UPDATE cafe_tables SET status=? WHERE code=?').run(status,code);
  for (const [width,height] of [[1366,768],[1440,900],[1920,1080]] as const) {
    window.setContentSize(width,height);
    await window.webContents.executeJavaScript(`document.querySelector('[data-nav="tables"]').click()`);
    await waitFor('[data-table-code="T10"]');
    if (await window.webContents.executeJavaScript(`[...document.querySelectorAll('.position .badge')].some(e => e.scrollWidth > e.clientWidth || e.getBoundingClientRect().right > e.closest('.position').getBoundingClientRect().right)`)) throw new Error('Table status label is clipped');
    await snapshot(`tables-states-${width}.png`);
  }
  db.prepare("UPDATE cafe_tables SET status='FREE'").run();
  // Inspect editor and supply panels at every target size before entering test values.
  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]] as const) {
    window.setContentSize(width, height);
    await window.webContents.executeJavaScript(`document.querySelector('[data-nav="inventory"]').click()`);
    await waitFor('[data-page="inventory"]');
    await window.webContents.executeJavaScript(`(() => { const opener=document.querySelector('[aria-label="Edito Ujë natyral"]'); opener.focus(); opener.click(); })()`);
    await waitFor('dialog[open]');
    const panel = await window.webContents.executeJavaScript(`(() => {
      const footer = document.querySelector('.panel-footer').getBoundingClientRect();
      return { width: document.querySelector('dialog').getBoundingClientRect().width,
        footerVisible: footer.bottom <= innerHeight && footer.top > 0,
        focus: document.activeElement.id, overflow: document.querySelector('.panel-body').scrollWidth > document.querySelector('.panel-body').clientWidth };
    })()`) as { width: number; footerVisible: boolean; focus: string; overflow: boolean };
    if (panel.width < 380 || panel.width > 440 || !panel.footerVisible || panel.overflow || panel.focus !== 'name') throw new Error(`Editor layout/focus failed: ${JSON.stringify(panel)}`);
    await snapshot(`editor-${width}.png`);
    await inspectQuality('editor', width);
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await delay(50);
    if (await window.webContents.executeJavaScript(`document.activeElement.id`) !== 'categoryId') throw new Error('Editor Tab order failed');
    await escapePanel();
    if (await window.webContents.executeJavaScript(`document.activeElement.getAttribute('aria-label')`) !== 'Edito Ujë natyral') throw new Error('Editor focus return failed');
    await window.webContents.executeJavaScript(`document.querySelector('.page-actions button').focus(); document.querySelector('.page-actions button').click()`);
    await waitFor('dialog[open]');
    await snapshot(`supply-empty-${width}.png`);
    await inspectQuality('supply-empty', width);
    await escapePanel();
    if (!await window.webContents.executeJavaScript(`document.activeElement.matches('.page-actions button')`)) throw new Error('Supply focus return failed');
  }
  // Exercise the real React forms, preload writes and database persistence in this isolated DB.
  const setInput = async (id: string, value: string, select = false) => {
    await window.webContents.executeJavaScript(`(() => {
      const element = document.getElementById(${JSON.stringify(id)});
      Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(element,${JSON.stringify(value)});
      element.dispatchEvent(new Event(${select ? "'change'" : "'input'"}, { bubbles: true }));
    })()`);
  };
  window.setContentSize(1366, 768);
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Edito Ujë natyral"]').click()`);
  await waitFor('#product-form');
  await setInput('name','');
  await setInput('sellingPriceCents', '-1');
  await window.webContents.executeJavaScript(`document.querySelector('#product-form').requestSubmit()`);
  await waitFor('#name-error');
  await setInput('name','Ujë natyral');
  await delay(50);
  if (await window.webContents.executeJavaScript(`document.activeElement.id`) !== 'name') throw new Error('Correcting a field moved focus away while typing');
  await window.webContents.executeJavaScript(`document.querySelector('#product-form').requestSubmit()`);
  await waitFor('#sellingPriceCents-error');
  await delay(50);
  if (await window.webContents.executeJavaScript(`document.activeElement.id`) !== 'sellingPriceCents') throw new Error('Validation focus failed');
  await snapshot('price-validation-1366.png');
  await setInput('sellingPriceCents', '1.20');
  if (await window.webContents.executeJavaScript(`Boolean(document.querySelector('#sellingPriceCents-error'))`)) throw new Error('Corrected price kept a stale error');
  await setInput('purchaseCostCents', '0.50');
  await setInput('trackInventory', 'yes', true);
  await setInput('lowStockThreshold', '2');
  if (await window.webContents.executeJavaScript(`document.querySelector('.calculated-value output').textContent`) !== '€0.70') throw new Error('Calculated editor profit failed');
  await window.webContents.executeJavaScript(`document.querySelector('#product-form').requestSubmit()`);
  await waitFor('.feedback .icon');
  if (await window.webContents.executeJavaScript(`Boolean(document.querySelector('dialog[open]'))`)) throw new Error('Product editor did not close after save');
  const saved = repositories.listProducts().find(p => p.id === 'UJE-1');
  if (saved?.sellingPriceCents !== 120 || saved.purchaseCostCents !== 50 || saved.trackInventory !== true) throw new Error('Product form did not persist');
  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]] as const) {
    window.setContentSize(width, height);
    await window.webContents.executeJavaScript(`document.querySelector('.page-actions button').click()`);
    await waitFor('#supply-form');
    await setInput('productId', 'UJE-1', true);
    await setInput('quantity', '5');
    const visible = await window.webContents.executeJavaScript(`(() => { const b=document.querySelector('.panel-footer button[type="submit"]').getBoundingClientRect(); return b.bottom<=innerHeight && b.right<=innerWidth && b.top>0; })()`);
    if (!visible) throw new Error('Supply primary action is clipped');
    await snapshot(`supply-${width}.png`);
    await inspectQuality('supply', width);
    if (await window.webContents.executeJavaScript(`document.querySelector('.supply-result dd').textContent`) !== '5') throw new Error('Initial supply summary failed');
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Mbyll panelin"]').click()`);
  }
  window.setContentSize(1366,768);
  await window.webContents.executeJavaScript(`document.querySelector('.page-actions button').click()`);
  await waitFor('#supply-form');
  await setInput('productId', 'UJE-1', true);
  await setInput('quantity', '5');
  await window.webContents.executeJavaScript(`const form=document.querySelector('#supply-form'); form.requestSubmit(); form.requestSubmit();`);
  for (let i = 0; i < 100 && await window.webContents.executeJavaScript(`Boolean(document.querySelector('dialog[open]'))`); i++) await delay(50);
  if (repositories.listProducts().find(p => p.id === 'UJE-1')?.stockQuantity !== 5) throw new Error('Supply form did not persist exactly once');
  await window.webContents.executeJavaScript(`document.querySelector('.page-actions button').click()`);
  await waitFor('#supply-form');
  await setInput('productId','UJE-1',true);
  await setInput('quantity','0');
  await window.webContents.executeJavaScript(`document.querySelector('#supply-form').requestSubmit()`);
  await waitFor('#quantity-error');
  if (await window.webContents.executeJavaScript(`document.activeElement.id`) !== 'quantity') throw new Error('Supply validation focus failed');
  await setInput('quantity','3');
  if (await window.webContents.executeJavaScript(`Boolean(document.querySelector('#quantity-error'))`)) throw new Error('Corrected supply quantity kept a stale error');
  if (await window.webContents.executeJavaScript(`document.querySelector('.supply-result dd').textContent`) !== '8') throw new Error('Known stock supply summary failed');
  await snapshot('supply-addition-1366.png');
  await escapePanel();
  // Regression: a disabled threshold cannot block saving or overwrite the stored threshold.
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Edito Ujë natyral"]').click()`);
  await waitFor('#product-form');
  await setInput('lowStockThreshold', '-1');
  await window.webContents.executeJavaScript(`document.querySelector('#product-form').requestSubmit()`);
  await waitFor('#lowStockThreshold-error');
  await setInput('trackInventory', 'no', true);
  if (await window.webContents.executeJavaScript(`document.querySelector('.current-stock .badge').textContent`) !== 'Nuk ndiqet') throw new Error('Tracking-off preview failed');
  await snapshot('tracking-off-1366.png');
  await window.webContents.executeJavaScript(`document.querySelector('#product-form').requestSubmit()`);
  for (let i=0;i<100 && await window.webContents.executeJavaScript(`Boolean(document.querySelector('dialog[open]'))`);i++) await delay(20);
  const disabled = repositories.listProducts().find(p=>p.id==='UJE-1');
  if (disabled?.trackInventory !== false || disabled.lowStockThreshold !== 2 || disabled.stockQuantity !== 5) throw new Error('Disabled threshold regression failed');
  await window.webContents.executeJavaScript(`document.querySelector('.page-actions button').click()`);
  await waitFor('.empty-state');
  if (await window.webContents.executeJavaScript(`Boolean(document.querySelector('#supply-form'))`)) throw new Error('Tracking-off product remained eligible for supply');
  await escapePanel();
  await window.webContents.executeJavaScript(`document.querySelector('.category-filters button:last-child').click()`);
  if (await window.webContents.executeJavaScript(`document.querySelectorAll('.catalog tbody tr').length`) !== 4) throw new Error('Category filter failed');
  await setInput('product-search', 'Peja');
  if (await window.webContents.executeJavaScript(`document.querySelectorAll('.catalog tbody tr').length`) !== 1) throw new Error('Product search failed');
  await setInput('product-search', 'NukEkziston');
  await waitFor('.empty-state');
  await snapshot('search-empty-1366.png');
  // Verify a real renderer error state and its retry path.
  ipcMain.removeHandler(IPC.tables);
  ipcMain.handle(IPC.tables, () => { throw new Error('Intentional verification failure'); });
  await window.webContents.executeJavaScript(`document.querySelector('[data-nav="tables"]').click()`);
  await waitFor('[role="alert"]');
  await snapshot('load-error-1366.png');
  ipcMain.removeHandler(IPC.tables);
  ipcMain.handle(IPC.tables, () => repositories.listTables());
  await window.webContents.executeJavaScript(`document.querySelector('[role="alert"] button').click()`);
  await waitFor('[data-table-code="T10"]');
  // Known zero prices and stock must stay visibly different from unknown and tracking-off.
  db.prepare("UPDATE products SET selling_price_cents=0,purchase_cost_cents=0,track_inventory=1,low_stock_threshold=1 WHERE id='KAFE-1'").run();
  db.prepare("UPDATE inventory_balances SET quantity=0 WHERE product_id='KAFE-1'").run();
  for (const [width,height] of [[1366,768],[1440,900],[1920,1080]] as const) {
    window.setContentSize(width,height);
    await window.webContents.executeJavaScript(`document.querySelector('[data-nav="inventory"]').click()`);
    await waitFor('[data-page="inventory"]');
    const zero = await window.webContents.executeJavaScript(`(() => { const row=document.querySelector('.catalog tbody tr'); return {stock:row.querySelector('.stock-cell strong').textContent,state:row.querySelector('.stock-cell .badge').textContent,prices:[...row.querySelectorAll('.numeric')].slice(1).map(e=>e.textContent)}; })()`);
    if (zero.stock!=='0'||zero.state!=='Pa stok'||zero.prices.slice(0,3).some((s:string)=>s!=='€0.00')) throw new Error('Known zero UI regression failed');
    await snapshot(`inventory-states-${width}.png`);
    await inspectQuality('inventory-states',width);
    await window.webContents.executeJavaScript(`document.querySelector('[data-nav="tables"]').click()`);
    await waitFor('[data-table-code="T10"]');
  }
  await verifyActiveOrders(window,directory,db);
  for (const [width,height] of [[1366,768],[1440,900],[1920,1080]] as const) {
    window.setContentSize(width,height);
    await inspectQuality('active-orders',width);
  }
  const unexpectedErrors = errors.filter(message => !message.includes('Intentional verification failure'));
  if (unexpectedErrors.length) throw new Error(`Renderer errors: ${unexpectedErrors.join('; ')}`);
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ api, measurements, layouts: '4 sections and panels at 3 desktop sizes', errorRetry: true, productSave: true, supply: true, filters: true, keyboardEscapeTabFocusReturn: true, validationFocus: true, disabledThresholdPreserved: true, calculatedProfit: true, supplySummary: true }, null, 2));
  console.log('FOX runtime verified: isolated SQLite IPC, renderer isolation, 4 sections and panels, 3 desktop sizes, product save, supply, filters and error retry.');
}

