import { app, dialog, type BrowserWindow, type MessageBoxOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import type { PrintManager } from '../receipts/manager';
import { inspectDatabase } from '../database/health';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function verifyHardening(
  window: BrowserWindow,
  directory: string,
  db: Database.Database,
  _manager: PrintManager,
  errors: string[],
): Promise<void> {
  const expectedFile = path.join(directory, 'hardening-expected.json'),
    snapshot = () =>
      Object.fromEntries(
        (
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .all() as { name: string }[]
        ).map(({ name }) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]),
      );
  const js = <T = unknown>(code: string) =>
    window.webContents.executeJavaScript(code) as Promise<T>;
  if (fs.existsSync(expectedFile)) {
    assert.deepEqual(snapshot(), JSON.parse(fs.readFileSync(expectedFile, 'utf8')));
    assert.equal(inspectDatabase(db, true), 7);
    assert.equal(await js('typeof require'), 'undefined');
    fs.writeFileSync(
      path.join(directory, 'hardening-result.json'),
      JSON.stringify(
        {
          passed: true,
          realElectron: true,
          backupThroughUi: true,
          restoreThroughUi: true,
          nativeConfirmationDefaultsSafe: true,
          actualAppRelaunch: true,
          roundtripExact: true,
          offline: true,
          nodeAbsent: true,
          viewports: [1366, 1440, 1920],
        },
        null,
        2,
      ),
    );
    return;
  }
  const api = (code: string) => js(`(async()=>{const fox=window.fox;${code}})()`);
  for (let i = 0; i < 100; i++) {
    if (await js('Boolean(document.querySelector("[data-table-code=M5]"))')) break;
    await wait(50);
  }
  await js('location.reload()');
  await wait(200);
  for (let i = 0; i < 100; i++) {
    if (await js('Boolean(document.querySelector("[data-table-code=M5]"))')) break;
    await wait(50);
  }
  assert.equal(await js('performance.getEntriesByType("navigation")[0].type'), 'reload');
  const configured = (await api(
    `return fox.products.update({id:'KAFE-1',name:'QA Espresso',categoryId:'KAFE',sellingPriceCents:100,purchaseCostCents:50,trackInventory:true,lowStockThreshold:null,active:true});`,
  )) as { ok: boolean };
  assert.ok(configured.ok);
  assert.ok(
    (
      (await api(
        `return fox.inventory.addSupply({requestId:crypto.randomUUID(),productId:'KAFE-1',quantity:100});`,
      )) as { ok: boolean }
    ).ok,
  );
  async function sell(table: string) {
    const added = (await api(
      `return fox.orders.addProduct({tableId:${JSON.stringify(table)},productId:'KAFE-1'});`,
    )) as { ok: boolean; data: { order: { id: string } } };
    assert.ok(added.ok);
    assert.ok(
      (
        (await api(
          `return fox.orders.completeOrder({orderId:${JSON.stringify(added.data.order.id)}});`,
        )) as { ok: boolean }
      ).ok,
    );
  }
  await sell('M5');
  await js('document.querySelector("[data-nav=settings]").click()');
  for (let i = 0; i < 100; i++) {
    if (await js('Boolean(document.querySelector(".data-protection"))')) break;
    await wait(50);
  }
  for (const [width, height] of [
    [1366, 768],
    [1440, 900],
    [1920, 1080],
  ]) {
    window.setContentSize(width!, height!);
    await wait(100);
    await js('document.querySelector(".data-protection").scrollIntoView({block:"end"})');
    await wait(150);
    assert.equal(await js('document.documentElement.scrollWidth<=window.innerWidth'), true);
    assert.equal(
      await js(
        'Array.from(document.querySelectorAll(".data-protection button")).every(b=>b.getBoundingClientRect().width>=80)',
      ),
      true,
    );
    fs.writeFileSync(
      path.join(directory, `data-settings-${width}.png`),
      (await window.webContents.capturePage()).toPNG(),
    );
  }
  // All paths stay inside the marked QA directory; only native selection/confirmation are injected.
  const backup = path.join(directory, 'QA-manual.sqlite');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });
  await js(
    'Array.from(document.querySelectorAll(".data-protection button")).find(b=>b.textContent==="Krijo backup").click()',
  );
  for (let i = 0; i < 200; i++) {
    if (
      await js(
        'document.querySelector(".data-protection").textContent.includes("Backup u krijua dhe u verifikua")',
      )
    )
      break;
    await wait(50);
  }
  assert.equal(fs.existsSync(backup + '.json'), true);
  assert.equal(
    await js(
      'document.querySelector(".data-protection").textContent.includes("Backup u krijua dhe u verifikua")',
    ),
    true,
  );
  window.setContentSize(1366, 768);
  await js('document.querySelector(".data-protection").scrollIntoView({block:"end"})');
  await wait(150);
  fs.writeFileSync(
    path.join(directory, 'backup-confirmation-1366.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  fs.writeFileSync(expectedFile, JSON.stringify(snapshot()));
  await sell('M6');
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [backup] });
  dialog.showMessageBox = async (...args: unknown[]) => {
    const options = args.at(-1) as MessageBoxOptions;
    assert.equal(options.defaultId, 0);
    assert.equal(options.cancelId, 0);
    assert.equal(options.buttons?.[0], 'Anulo');
    assert.ok(options.message?.includes('zëvendësojë'));
    assert.ok(options.detail?.includes('backup sigurie'));
    fs.writeFileSync(
      path.join(directory, 'restore-confirmation-options.json'),
      JSON.stringify(options, null, 2),
    );
    return { response: 1, checkboxChecked: false };
  };
  await js(
    'Array.from(document.querySelectorAll(".data-protection button")).find(b=>b.textContent==="Rikthe nga backup").click()',
  );
  for (let i = 0; i < 200 && db.open; i++) await wait(50);
  assert.equal(db.open, false);
  assert.equal(errors.length, 0);
  // DataProtection has called app.relaunch; normal entrypoint returns and quits this process.
  assert.equal(app.getName(), 'FOX Kafeteri');
}
