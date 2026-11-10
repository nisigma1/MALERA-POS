// Isolated visual acceptance of the actual FOX runtime. Never opens owner data.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import electron from 'electron';
import { build } from 'esbuild';
import { createQaDirectory } from '../lib/qa-directory.mjs';
const phase = process.argv[2] ?? 'before',
  installer = process.argv[3],
  directory = createQaDirectory('visual-' + phase);
assert.ok(['before', 'after'].includes(phase));
const output = path.resolve(
  process.env.FOX_VISUAL_OUTPUT ?? '../../outputs/fox-phase9-regression-screenshots',
);
fs.mkdirSync(output, { recursive: true });
await build({
  entryPoints: ['electron/verification/cutover-ui.ts'],
  outfile: 'work/visual-ui.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const { cutoverUi } = createRequire(import.meta.url)('../../work/visual-ui.cjs');
let executable = electron;
if (installer) {
  const target = path.join(directory, 'application');
  const r = spawnSync(path.resolve(installer), ['/S', `/D=${target}`], {
    windowsHide: true,
    timeout: 120000,
  });
  assert.equal(r.status, 0);
  executable = path.join(target, 'FOX Kafeteri.exe');
}
const port = await new Promise((r) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => r(p));
  });
});
const env = { ...process.env };
for (const k of Object.keys(env))
  if (
    k.startsWith('FOX_VERIFY_') ||
    ['FOX_DEV_URL', 'ELECTRON_RUN_AS_NODE', 'NODE_ENV'].includes(k)
  )
    delete env[k];
Object.assign(env, { FOX_VERIFY_DIR: directory, FOX_VERIFY_MANUAL: '1' });
if (!installer) env.FOX_VERIFY_CUTOVER_DIALOGS = '1';
const child = spawn(
  executable,
  [...(installer ? [] : ['.']), `--remote-debugging-port=${port}`, '--force-device-scale-factor=1'],
  { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let log = '',
  ws;
child.stderr.on('data', (b) => (log += b));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const result = {
  phase,
  packaged: Boolean(installer),
  directory,
  version: JSON.parse(fs.readFileSync('package.json')).version,
  views: [],
  checks: [],
  issues: [],
};
try {
  let page;
  for (let i = 0; i < 400; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
        (p) => p.type === 'page',
      );
      if (page) break;
    } catch {}
    if (child.exitCode !== null) throw Error(log);
    await delay(50);
  }
  assert.ok(page, 'Visual runtime not started');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data),
      p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  };
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expression) => {
    const r = await command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const ui = cutoverUi(js),
    click = async (selector) => {
      await ui.until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      await js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.click();})()`,
      );
    },
    api = (code) => js(`(async()=>{const fox=window.fox;${code}})()`);
  await ui.until('document.querySelectorAll("[data-table-code]").length===27');
  result.version = (await api('return fox.data.diagnostics();')).version;
  await command('Network.enable');
  await command('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  const viewport = async (width, height, scale = 1) => {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: scale,
      mobile: false,
    });
    await js('document.querySelector("main").scrollTo(0,0)');
    await delay(120);
  };
  const capture = async (name) => {
    await delay(100);
    const file = `${phase}-${installer ? 'packaged-' : ''}${name}.png`;
    fs.writeFileSync(
      path.join(output, file),
      Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    );
    return file;
  };
  const metrics = () =>
    js(
      `(()=>{const bounds=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom};};const clipping=selector=>[...document.querySelectorAll(selector)].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>({text:e.textContent,...bounds(e),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}));const tables=[...document.querySelectorAll('[data-table-code]')];return {viewport:[innerWidth,innerHeight,devicePixelRatio],pageOverflow:document.documentElement.scrollWidth>innerWidth+1,mainOverflow:document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1,amountClipping:clipping('.position-total,[data-order-total],[data-checkout-total],.report-kpis dd,.summary-strip dd'),tableCodes:tables.map(e=>e.dataset.tableCode),tableBounds:tables.map(e=>({code:e.dataset.tableCode,...bounds(e)})),tableOverlaps:tables.flatMap((e,i)=>tables.slice(i+1).filter(f=>{const b=e.getBoundingClientRect(),c=f.getBoundingClientRect();return b.left<c.right&&b.right>c.left&&b.top<c.bottom&&b.bottom>c.top}).map(f=>[e.dataset.tableCode,f.dataset.tableCode])),actions:[...document.querySelectorAll('[data-open-checkout],dialog[open] .panel-footer button,.checkout-dialog footer button')].map(e=>({text:e.textContent,...bounds(e)})),settingsWidths:[...document.querySelectorAll('.settings-panel')].map(bounds),scrollAreas:[...document.querySelectorAll('main,.order-body,.current-order,.sales-scroll,.catalog-scroll,.checkout-items')].filter(e=>e.scrollHeight>e.clientHeight+1).map(e=>({class:e.className,height:e.clientHeight,scrollHeight:e.scrollHeight})),date:document.querySelector('.topbar time').textContent};})()`,
    );
  const record = async (name) => {
    const file = await capture(name),
      m = await metrics();
    result.views.push({ file, ...m });
    if (m.pageOverflow || m.mainOverflow)
      result.issues.push({ file, issue: 'Horizontal page/main overflow' });
    if (m.amountClipping.length)
      result.issues.push({ file, issue: 'Critical amount clipping', details: m.amountClipping });
    if (m.tableOverlaps.length)
      result.issues.push({ file, issue: 'Overlapping service targets', details: m.tableOverlaps });
    for (const b of m.actions)
      if (b.bottom > m.viewport[1] + 1 || b.x < 0 || b.right > m.viewport[0] + 1)
        result.issues.push({ file, issue: 'Operational action outside viewport', details: b });
  };
  const escape = async () => {
    await command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
  };
  await viewport(1366, 768);
  await ui.nav('settings');
  await record('readiness-blockers-1366');
  await ui.nav('reports');
  await record('reports-empty-1366');
  // All artificial values are created through existing validated services in this marked QA directory.
  const names = [
    'Kafe speciale e lokalit',
    'Makiato e madhe me qumësht të ngrohtë',
    'Pije freskuese e përgatitur me shije limoni dhe mente',
  ];
  await api(
    `for(const [i,p] of (await fox.products.list()).entries()){const r=await fox.products.update({...p,name:names[i]??p.name,sellingPriceCents:100,purchaseCostCents:50,trackInventory:false,lowStockThreshold:null,active:true});if(!r.ok)throw Error(JSON.stringify(r));}`.replace(
      'names[i]',
      JSON.stringify(names) + '[i]',
    ),
  );
  for (const [w, h] of [
    [1366, 768],
    [1440, 900],
    [1920, 1080],
  ]) {
    await viewport(w, h);
    await ui.nav('settings');
    await record('settings-ready-' + w);
    await js('document.querySelector(".data-protection").scrollIntoView({block:"end"})');
    await record('settings-data-' + w);
  }
  await viewport(1366, 768);
  if (installer) {
    const info = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
    const browser = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((r) => (browser.onopen = r));
    const processInfo = await new Promise((r) => {
      browser.onmessage = (e) => r(JSON.parse(e.data).result);
      browser.send(JSON.stringify({ id: 1, method: 'SystemInfo.getProcessInfo' }));
    });
    browser.close();
    const pid = processInfo.processInfo.find((p) => p.type === 'browser').id;
    const nativeOutput = path.join(output, phase + '-native');
    fs.mkdirSync(nativeOutput, { recursive: true });
    const backupFile = path.join(directory, 'VISUAL-BASELINE.sqlite');
    await ui.backupButton();
    const saved = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-File',
        'scripts/windows/cutover-native-dialog.ps1',
        '-FoxProcessId',
        String(pid),
        '-Action',
        'backup',
        '-File',
        backupFile,
        '-CaptureDirectory',
        nativeOutput,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 60000 },
    );
    assert.equal(saved.status, 0, saved.stdout + saved.stderr);
    await ui.until(
      'document.querySelector(".data-protection").textContent.includes("Backup u krijua dhe u verifikua")',
    );
    await record('backup-confirmation-1366');
    await ui.restoreButton();
    const restored = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-File',
        'scripts/windows/cutover-native-dialog.ps1',
        '-FoxProcessId',
        String(pid),
        '-Action',
        'restore',
        '-File',
        backupFile,
        '-CaptureDirectory',
        nativeOutput,
        '-CancelRestore',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 60000 },
    );
    assert.equal(restored.status, 0, restored.stdout + restored.stderr);
    result.nativeDialogs = { passed: true, restoreCancelled: true, directory: nativeOutput };
  }
  if (!installer) {
    fs.writeFileSync(
      path.join(directory, 'cutover-dialog.json'),
      JSON.stringify({ path: path.join(directory, 'VISUAL-BASELINE.sqlite'), action: 'backup' }),
    );
    await ui.backupButton();
    await ui.until(
      'document.querySelector(".data-protection").textContent.includes("Backup u krijua dhe u verifikua")',
    );
    await record('backup-confirmation-1366');
  }
  // Six exact amounts, long orders, large quantities, and many report rows.
  const amounts = [999, 9999, 99999, 227000, 999999, 9999999],
    codes = ['M1', 'M2', 'M3', 'M4', 'M6', 'M7'];
  await api(
    `const products=await fox.products.list();for(let i=0;i<6;i++){const p=products[i],r=await fox.products.update({...p,sellingPriceCents:${JSON.stringify(amounts)}[i]});if(!r.ok)throw Error(JSON.stringify(r));}for(let i=0;i<30;i++){const r=await fox.orders.addProduct({tableId:'T1',productId:products[i%6].id});if(!r.ok)throw Error(JSON.stringify(r));const paid=await fox.orders.completeOrder({orderId:r.data.order.id});if(!paid.ok)throw Error(JSON.stringify(paid));}for(let i=0;i<6;i++){const r=await fox.orders.addProduct({tableId:${JSON.stringify(codes)}[i],productId:products[i].id});if(!r.ok)throw Error(JSON.stringify(r));}for(let i=0;i<4;i++){const r=await fox.orders.addProduct({tableId:"SH"+(i+1),productId:products[[0,1,4,5][i]].id});if(!r.ok)throw Error(JSON.stringify(r));}for(const p of products.slice(0,20)){const r=await fox.orders.addProduct({tableId:'M5',productId:p.id});if(!r.ok)throw Error(JSON.stringify(r));}`,
  );
  await api(
    `const p=(await fox.products.list()).at(-1);const r=await fox.products.update({...p,sellingPriceCents:999,purchaseCostCents:9999999,trackInventory:true,lowStockThreshold:5});if(!r.ok)throw Error(JSON.stringify(r));const supply=await fox.inventory.addSupply({requestId:crypto.randomUUID(),productId:p.id,quantity:1});if(!supply.ok)throw Error(JSON.stringify(supply));`,
  );
  {
    const previousOrigin = await js('performance.timeOrigin');
    await js('location.reload()');
    await ui.until(
      `performance.timeOrigin!==${previousOrigin} && Boolean(document.querySelector('main')) && document.querySelectorAll('[data-table-code]').length===27`,
    );
  }
  result.version = (await api('return fox.data.diagnostics();')).version;
  for (const [w, h, s] of [
    [1366, 768, 1],
    [1440, 900, 1],
    [1920, 1080, 1],
    [1093, 614, 1.25],
    [910, 512, 1.5],
    [910, 428, 1.5],
    [884, 422, 1.5],
  ]) {
    const key = `${w}-${s}${h === 428 ? '-taskbar' : h === 422 ? '-minimum' : ''}`;
    await viewport(w, h, s);
    await ui.select('M5');
    await record('tavolinat-large-order-' + key);
    await js(
      'document.querySelector(".order-body").scrollTo(0,document.querySelector(".order-body").scrollHeight);document.querySelector(".current-order").scrollTo(0,document.querySelector(".current-order").scrollHeight)',
    );
    await record('order-bottom-' + key);
    await click('[data-open-checkout]');
    await ui.until('Boolean(document.querySelector(".checkout-dialog[open]"))');
    await record('checkout-20-items-' + key);
    await escape();
    await ui.until('!document.querySelector("dialog[open]")');
    await ui.select('M7');
    await record('tavolinat-active-' + key);
    await click('[data-open-checkout]');
    await ui.until('Boolean(document.querySelector(".checkout-dialog[open]"))');
    await record('checkout-one-item-' + key);
    await escape();
    await ui.until('!document.querySelector("dialog[open]")');
    await ui.select('M13');
    await record('tavolinat-free-' + key);
    await click('button[aria-label="Mbyll panelin e tavolinës"]');
    await record('tavolinat-unselected-' + key);
    await ui.nav('inventory');
    await record('inventory-' + key);
    await js(
      'document.querySelector(".inventory-surface").scrollIntoView({block:"end"});document.querySelector(".catalog-scroll").scrollTop=0',
    );
    await record('inventory-list-' + key);
    if (phase === 'after')
      assert.equal(
        await js(
          '(()=>{const row=document.querySelector(".catalog tbody tr"),r=row.getBoundingClientRect(),c=document.querySelector(".catalog-scroll").getBoundingClientRect();return r.bottom>c.top&&r.top<c.bottom&&Math.min(r.bottom,c.bottom,innerHeight)-Math.max(r.top,c.top)>20;})()',
        ),
        true,
        'Inventory must expose a usable product row at ' + key,
      );
    if (s > 1) {
      await js(
        'document.querySelector(".catalog-scroll").scrollLeft=document.querySelector(".catalog-scroll").scrollWidth',
      );
      await record('inventory-actions-' + key);
      if (phase === 'after')
        assert.equal(
          await js(
            '(()=>{const r=document.querySelector(".catalog tbody tr button").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()',
          ),
          true,
          'Inventory edit must be visible after contained horizontal scrolling at ' + key,
        );
    }
    await ui.openEditor('KAFE-1');
    await record('product-edit-' + key);
    await escape();
    await ui.until('!document.querySelector("dialog[open]")');
    await ui.nav('reports');
    await record('reports-' + key);
    await js('document.querySelector("[data-sale-id] button").click()');
    await js('document.querySelector(".sale-detail-row").scrollIntoView({block:"center"})');
    await record('sale-detail-' + key);
    await ui.nav('settings');
    await record('settings-' + key);
    await js('document.querySelector(".data-protection").scrollIntoView({block:"end"})');
    await record('settings-bottom-' + key);
  }
  await viewport(1366, 768);
  await api(
    `const r=await fox.orders.addProduct({tableId:'M8',productId:'KAFE-7'});if(!r.ok)throw Error(JSON.stringify(r));`,
  );
  for (const quantity of [1, 9, 10, 99, 999]) {
    await api(
      `let w=await fox.orders.getForTable('M8');for(let i=w.order.items[0].quantity;i<${quantity};i++){const a=await fox.orders.incrementItem({tableId:'M8',itemId:w.order.items[0].id});if(!a.ok)throw Error(JSON.stringify(a));}`,
    );
    await ui.select('M8');
    await record('quantity-' + quantity + '-1366');
  }
  await ui.select('M8');
  await record('quantity-999-1366');
  const beforeOperator = await api('return fox.reports.getSalesReport("ALL");');
  await ui.select('M5');
  await ui.add('KAFE-1');
  await ui.quantity(true);
  await ui.quantity(false);
  const open = await api('return fox.orders.getForTable("M5");');
  await ui.select('M6');
  await ui.select('M5');
  assert.deepEqual(
    (await api('return fox.orders.getForTable("M5");')).order.items,
    open.order.items,
  );
  await click('[data-open-checkout]');
  await ui.until('Boolean(document.querySelector("dialog[open]"))');
  assert.equal(await js('document.activeElement.hasAttribute("data-cancel-payment")'), true);
  await command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  assert.equal(await js('document.activeElement.hasAttribute("data-confirm-payment")'), true);
  await escape();
  await ui.until('!document.querySelector("dialog[open]")');
  assert.equal(await js('document.activeElement.hasAttribute("data-open-checkout")'), true);
  await ui.pay();
  const paid = await api('return fox.reports.getSalesReport("ALL");');
  assert.equal(paid.summary.completedOrders, beforeOperator.summary.completedOrders + 1);
  assert.equal(paid.summary.salesCents, beforeOperator.summary.salesCents + open.order.totalCents);
  assert.equal(paid.cashCents, beforeOperator.cashCents + open.order.totalCents);
  await ui.nav('inventory');
  await ui.field('product-search', 'Kafe speciale');
  await ui.until('document.querySelectorAll(".catalog tbody tr").length===1');
  await record('operator-inventory-search-1366');
  await ui.field('product-search', 'zz-no-match');
  await ui.until('Boolean(document.querySelector(".empty-state"))');
  await record('inventory-empty-filter-1366');
  await ui.nav('reports');
  await js('document.querySelector("[data-sale-id] button").click()');
  await record('operator-sale-detail-1366');
  await ui.nav('settings');
  await record('operator-settings-1366');
  await api(
    `const products=await fox.products.list();for(const p of products.slice(0,10)){const r=await fox.orders.addProduct({tableId:'M13',productId:p.id});if(!r.ok)throw Error(JSON.stringify(r));}`,
  );
  await ui.select('M13');
  await record('order-10-items-1366');
  await api(
    `const products=await fox.products.list(),p=products.at(-1);const r=await fox.orders.addProduct({tableId:'M13',productId:p.id});if(!r.ok)throw Error(JSON.stringify(r));const paid=await fox.orders.completeOrder({orderId:r.data.order.id});if(!paid.ok)throw Error(JSON.stringify(paid));for(const [id,changes] of [['CAJ-1',{trackInventory:true}],['CAJ-2',{sellingPriceCents:null}],['KAFE-7',{sellingPriceCents:0}]]){const p=products.find(p=>p.id===id);if(!p)throw Error('Missing fixture '+id);const update=await fox.products.update({...p,...changes});if(!update.ok)throw Error(JSON.stringify(update));}`,
  );
  {
    const previousOrigin = await js('performance.timeOrigin');
    await js('location.reload()');
    await ui.until(
      `performance.timeOrigin!==${previousOrigin} && Boolean(document.querySelector('main')) && document.querySelectorAll('[data-table-code]').length===27`,
    );
  }
  for (const [w, h, s] of [
    [1366, 768, 1],
    [884, 422, 1.5],
  ]) {
    await viewport(w, h, s);
    await ui.select('M5');
    for (const category of ['KAFE', 'CAJ', 'ALKOOL']) {
      await click('[data-order-category=' + category + ']');
      await record('catalog-data-states-' + category + '-' + w);
    }
    await ui.nav('inventory');
    await record('inventory-zero-unknown-' + w);
    await ui.nav('settings');
    await record('readiness-data-blockers-' + w);
  }
  result.dataStates = {
    tenLineOrder: true,
    unknownStock: true,
    zeroStock: true,
    missingPrice: true,
    zeroPrice: true,
  };
  await api(
    `for(const t of await fox.tables.list()){if(t.activeOrderTotalCents===null){const r=await fox.orders.addProduct({tableId:t.id,productId:'KAFE-6'});if(!r.ok)throw Error(JSON.stringify(r));}}`,
  );
  for (const [w, h, s] of [
    [1366, 768, 1],
    [1440, 900, 1],
    [1920, 1080, 1],
    [1093, 614, 1.25],
    [910, 512, 1.5],
    [910, 428, 1.5],
    [884, 422, 1.5],
  ]) {
    await viewport(w, h, s);
    await ui.select('M5');
    await record(`all-active-${w}-${s}-${h}`);
  }
  result.operator = {
    passed: true,
    table: 'M5',
    quantityControls: true,
    tableSwitch: true,
    cashCheckout: true,
    search: true,
    saleDetail: true,
    settings: true,
    escapeAndFocus: true,
  };
  result.fixture = {
    amountsCents: amounts,
    nameLengths: names.map((n) => n.length),
    orderLines: 20,
    completedSales: 30,
  };
  result.passed = result.issues.length === 0;
  fs.writeFileSync(
    path.join(output, `${phase}-${installer ? 'packaged-' : ''}visual-result.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      phase,
      packaged: result.packaged,
      directory,
      views: result.views.length,
      issues: result.issues.length,
      output,
    }),
  );
  if (phase === 'after') assert.equal(result.issues.length, 0, 'Visual geometry blockers remain');
} finally {
  ws?.close();
  if (child.exitCode === null) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  }
}
