// Owned hidden Electron profile only. Inspector is opt-in at QA launch and is
// used solely for resource observations; all mutations use the existing API/UI.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import electron from 'electron';
import { createQaDirectory } from '../lib/qa-directory.mjs';
const installer = process.argv[2],
  directory = createQaDirectory('phase10-lifecycle');
let exe = electron;
if (installer) {
  const target = path.join(directory, 'application'),
    r = spawnSync(path.resolve(installer), ['/S', `/D=${target}`], {
      windowsHide: true,
      timeout: 120000,
    });
  assert.equal(r.status, 0, r.error?.message);
  exe = path.join(target, 'FOX Kafeteri.exe');
  const mapped = spawnSync(
    process.execPath,
    [
      'scripts/qa/verify-windows-shm.mjs',
      '--module=' + path.join(target, 'resources/app.asar/node_modules/better-sqlite3'),
    ],
    { windowsHide: true, encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(mapped.status, 0, mapped.stderr);
}
await build({
  entryPoints: ['electron/verification/cutover-ui.ts'],
  outfile: 'work/phase10-ui.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const { cutoverUi } = createRequire(import.meta.url)('../../work/phase10-ui.cjs');
const env = { ...process.env };
for (const k of Object.keys(env))
  if (
    k.startsWith('FOX_VERIFY_') ||
    ['FOX_DEV_URL', 'ELECTRON_RUN_AS_NODE', 'NODE_ENV', 'VITEST'].includes(k)
  )
    delete env[k];
Object.assign(env, { FOX_VERIFY_DIR: directory, FOX_VERIFY_MANUAL: '1' });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const port = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
async function connect(p) {
  let page;
  for (let i = 0; i < 400; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${p}/json/list`)).json()).find(
        (v) => v.type === 'page' || v.type === 'node',
      );
      if (page) break;
    } catch {}
    await delay(50);
  }
  assert.ok(page, 'Owned QA endpoint not ready');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data),
      callback = waiting.get(m.id);
    if (callback) {
      waiting.delete(m.id);
      m.error ? callback.reject(Error(JSON.stringify(m.error))) : callback.resolve(m.result);
    }
  };
  return {
    ws,
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const number = ++id;
        const deadline = setTimeout(() => {
          waiting.delete(number);
          reject(Error('QA command deadline ' + method));
        }, 20000);
        waiting.set(number, {
          resolve: (r) => {
            clearTimeout(deadline);
            resolve(r);
          },
          reject: (e) => {
            clearTimeout(deadline);
            reject(e);
          },
        });
        ws.send(JSON.stringify({ id: number, method, params }));
      }),
  };
}
const cycles = [],
  soak = [],
  launches = [];
let child, renderer, main, ui;
async function launch() {
  const rp = await port();
  let mp = await port();
  while (mp === rp) mp = await port();
  const launchRecord = {
    cycle: cycles.length + 1,
    rendererPort: rp,
    mainPort: mp,
    startedAt: new Date().toISOString(),
  };
  launches.push(launchRecord);
  child = spawn(
    exe,
    [...(installer ? [] : ['.']), `--remote-debugging-port=${rp}`, `--inspect=127.0.0.1:${mp}`],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  launchRecord.pid = child.pid;
  child.on('exit', (code, signal) => Object.assign(launchRecord, { exitCode: code, signal }));
  child.on('error', (error) => (launchRecord.spawnError = error.message));
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (b) => fs.appendFileSync(path.join(directory, 'technical-launch.log'), b));
  launchRecord.endpoint = 'renderer';
  renderer = await connect(rp);
  launchRecord.endpoint = 'main';
  main = await connect(mp);
  launchRecord.endpoint = 'connected';
  ui = cutoverUi(async (expression) => {
    const r = await renderer.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
    return r.result.value;
  });
  await ui.until(
    'Boolean(window.fox && document.querySelectorAll("[data-table-code]").length===27)',
  );
  await renderer.send('Network.enable');
  await renderer.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
}
async function measure() {
  const r = await main.send('Runtime.evaluate', {
    expression: `(()=>{const e=process.mainModule.require('electron');return {pid:process.pid,memory:process.memoryUsage(),cpu:process.cpuUsage(),activeHandles:process._getActiveHandles().length,windows:e.BrowserWindow.getAllWindows().length,ipcHandlers:e.ipcMain._invokeHandlers.size,ipcEvents:e.ipcMain.eventNames().map(n=>[String(n),e.ipcMain.listenerCount(n)]),metrics:e.app.getAppMetrics().map(p=>({type:p.type,memory:p.memory,cpu:p.cpu}))};})()`,
    returnByValue: true,
  });
  assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
  const state = r.result.value;
  assert.ok(Number.isSafeInteger(state.pid) && state.pid > 0);
  const root = await main.send('Runtime.evaluate', {
    expression:
      "process.mainModule.require('electron').ipcMain._invokeHandlers.get('fox:tables:list')",
    objectGroup: 'fox-cert-resources',
  });
  const visited = new Set();
  async function findDatabase(id, depth = 0) {
    if (!id || visited.has(id) || depth > 8) return;
    visited.add(id);
    const check = await main.send('Runtime.callFunctionOn', {
      objectId: id,
      functionDeclaration:
        "function(){return typeof this.prepare==='function'&&typeof this.pragma==='function'&&typeof this.open==='boolean';}",
      returnByValue: true,
    });
    if (check.result?.value) return id;
    const properties = await main.send('Runtime.getProperties', {
      objectId: id,
      ownProperties: true,
    });
    for (const p of properties.result ?? [])
      if (
        ['listener', 'handler', 'repositories', 'repo', 'listTables', 'db', 'database'].includes(
          p.name,
        ) &&
        p.value?.objectId
      ) {
        const found = await findDatabase(p.value.objectId, depth + 1);
        if (found) return found;
      }
    const scopes = properties.internalProperties?.find((p) => p.name === '[[Scopes]]')?.value
      ?.objectId;
    if (scopes) {
      const list = await main.send('Runtime.getProperties', {
        objectId: scopes,
        ownProperties: true,
      });
      for (const entry of list.result ?? [])
        if (/^\d+$/.test(entry.name) && entry.value?.objectId) {
          const found = await findDatabase(entry.value.objectId, depth + 1);
          if (found) return found;
        }
    }
  }
  const database = await findDatabase(root.result.objectId);
  assert.ok(database, 'Operational SQLite closure must be observable');
  const prototype = await main.send('Runtime.callFunctionOn', {
    objectId: database,
    functionDeclaration: 'function(){return Object.getPrototypeOf(this);}',
    objectGroup: 'fox-cert-resources',
  });
  const objects = await main.send('Runtime.queryObjects', {
    prototypeObjectId: prototype.result.objectId,
    objectGroup: 'fox-cert-resources',
  });
  const count = await main.send('Runtime.callFunctionOn', {
    objectId: objects.objects.objectId,
    functionDeclaration:
      'function(){return {known:this.length,open:this.filter(d=>d.open).length};}',
    returnByValue: true,
  });
  assert.ok(!count.exceptionDetails);
  state.sqlite = count.result.value;
  assert.equal(state.sqlite.open, 1);
  await main.send('Runtime.releaseObjectGroup', { objectGroup: 'fox-cert-resources' });
  const os = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-Process -Id ${state.pid} | Select-Object HandleCount,CPU,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`,
    ],
    { windowsHide: true, encoding: 'utf8', timeout: 20000 },
  );
  assert.equal(os.status, 0, os.stderr);
  state.os = JSON.parse(os.stdout);
  return state;
}
async function close(force) {
  const r = await main.send('Runtime.evaluate', { expression: 'process.pid', returnByValue: true }),
    pid = r.result.value;
  if (force) {
    main.ws.close();
    renderer.ws.close();
    const killed = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    assert.equal(killed.status, 0, killed.stderr);
  } else {
    await main.send('Runtime.evaluate', {
      expression: "setImmediate(()=>process.mainModule.require('electron').app.quit()); true",
      returnByValue: true,
    });
    main.ws.close();
    renderer.ws.close();
  }
  for (let i = 0; i < 400; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await delay(25);
  }
  throw Error('Owned app did not terminate');
}
try {
  for (let i = 0; i < 100; i++) {
    const started = Date.now();
    await launch();
    const report = await ui.js('window.fox.finance.report({period:"ALL"})');
    assert.equal(report.sales.summary.completedOrders, i);
    assert.equal(report.sales.summary.salesCents, i * 100);
    if (i === 0) {
      await ui.edit('KAFE-1', {
        sellingPriceCents: '1.00',
        purchaseCostCents: '0.50',
        trackInventory: 'yes',
      });
      await ui.supply('KAFE-1', '300');
      for (let batch = 0; batch < 10; batch++) {
        for (let j = 0; j < 10; j++) {
          for (const page of ['tables', 'inventory', 'reports', 'settings']) await ui.nav(page);
          await ui.openEditor('KAFE-1');
          await ui.js(
            'document.querySelector("dialog[open]").dispatchEvent(new Event("cancel",{cancelable:true}))',
          );
          await ui.until('!document.querySelector("dialog[open]")');
        }
        soak.push({ batch, ...(await measure()) });
      }
      assert.ok(soak.every((s) => s.windows === 1));
      assert.equal(new Set(soak.map((s) => s.ipcHandlers)).size, 1);
      assert.equal(new Set(soak.map((s) => JSON.stringify(s.ipcEvents))).size, 1);
      assert.ok(
        Math.max(...soak.map((s) => s.activeHandles)) -
          Math.min(...soak.map((s) => s.activeHandles)) <=
          3,
        'Active handle growth',
      );
      assert.ok(soak.every((s) => s.sqlite.open === 1));
      assert.ok(
        soak.at(-1).os.HandleCount - soak[0].os.HandleCount < 30,
        'Pathological OS handle growth',
      );
      fs.mkdirSync('outputs', { recursive: true });
      fs.writeFileSync(
        'outputs/fox-phase10-ui-soak.json',
        JSON.stringify(
          {
            passed: true,
            packaged: !!installer,
            navigationCycles: 400,
            editorModalCycles: 100,
            soak,
          },
          null,
          2,
        ),
      );
    }
    await ui.select('M5');
    await ui.add('KAFE-1');
    await ui.pay();
    if (i % 10 === 0) {
      const input = {
        requestId: randomUUID(),
        tableId: 'M13',
        customerName: 'QA',
        phone: '',
        startsAt: '2099-01-01T10:00:00.000Z',
        guests: 2,
        note: '',
      };
      const booked = await ui.js(`window.fox.reservations.reserve(${JSON.stringify(input)})`);
      assert.ok(booked.ok);
      const cmd = { tableId: 'M13', reservationId: booked.data.reservation.id };
      assert.ok((await ui.js(`window.fox.reservations.cancel(${JSON.stringify(cmd)})`)).ok);
    }
    const state = await ui.js('window.fox.data.diagnostics()');
    assert.equal(state.schemaVersion, 6);
    const resources = await measure();
    assert.equal(resources.windows, 1);
    cycles.push({
      cycle: i + 1,
      forced: i % 2 === 1,
      elapsedMs: Date.now() - started,
      ipcHandlers: resources.ipcHandlers,
      windows: resources.windows,
    });
    await close(i % 2 === 1);
    fs.mkdirSync('outputs', { recursive: true });
    fs.writeFileSync(
      'outputs/fox-phase10-ui-progress.json',
      JSON.stringify({ completed: cycles.length, packaged: !!installer }, null, 2),
    );
  }
  await launch();
  const final = await ui.js('window.fox.finance.report({period:"ALL"})');
  assert.equal(final.sales.summary.completedOrders, 100);
  assert.equal(final.sales.summary.salesCents, 10000);
  assert.equal(final.sales.summary.costCents, 5000);
  await close(false);
  const evidence = {
    passed: true,
    packaged: !!installer,
    lifecycleCycles: 100,
    forced: 50,
    clean: 50,
    navigationCycles: 400,
    editorModalCycles: 100,
    offline: true,
    cycles,
    soak,
    financial: { revenue: 10000, cogs: 5000 },
    measurement:
      'Main-process inspector read-only resource observations in owned QA launch; no production instrumentation',
  };
  fs.writeFileSync('outputs/fox-phase10-ui-lifecycle.json', JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({ passed: true, packaged: !!installer, lifecycleCycles: 100, offline: true }),
  );
} catch (error) {
  fs.mkdirSync('outputs', { recursive: true });
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(-64000) : '');
  fs.writeFileSync(
    'outputs/fox-phase10-ui-failure.json',
    JSON.stringify(
      {
        passed: false,
        packaged: !!installer,
        completed: cycles.length,
        error: error.stack,
        launches,
        technicalLog: read(path.join(directory, 'technical-launch.log')),
        applicationLog: read(path.join(directory, 'logs', 'fox.log')),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (child?.exitCode === null) {
    try {
      await close(true);
    } catch {
      child.kill();
    }
  }
}
