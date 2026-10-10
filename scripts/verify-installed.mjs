// Test the actual installed executable using Electron's opt-in local debugging switch.
// No server, test fixture or debugging switch is shipped in normal startup.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createQaDirectory} from './qa-directory.mjs';
const [installerA,installerB,receiptTargetFile]=process.argv.slice(2);
if(!installerA||!installerB) throw Error('Usage: verify-installed.mjs <installer A> <installer B>');
const directory=createQaDirectory('installed');
const install=path.join(directory,'application');
const exe=path.join(install,'FOX Kafeteri.exe');
const evidence={directory,install,checks:[],installers:[path.resolve(installerA),path.resolve(installerB)]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const sessionSales=Number(process.env.FOX_QA_SESSION_SALES??150);
assert.ok([25,150].includes(sessionSales),'Only the established soak or cutover session size is allowed');
function installVersion(file) {
  const result=spawnSync(path.resolve(file),['/S',`/D=${install}`],{windowsHide:true,timeout:120000});
  assert.equal(result.status,0,`Installer exit ${result.status}: ${result.error?.message||result.stderr}`);
  assert.ok(fs.existsSync(exe),'Installed executable missing');
  if(process.env.FOX_REQUIRE_SIGNED==='1'&&path.resolve(file)===path.resolve(installerB)) {
    const verified=spawnSync('powershell.exe',['-NoProfile','-File','scripts/verify-signatures.ps1','-Root',install,'-RequireSigned'],{windowsHide:true,encoding:'utf8',timeout:120000});
    assert.equal(verified.status,0,'Installed executable/helper/uninstaller signatures failed: '+verified.stderr);
  }
}
let running,ws,canonicalExecutable;
async function launch() {
  const launchStarted=Date.now();
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('FOX_VERIFY_')||['ELECTRON_RUN_AS_NODE','FOX_DEV_URL'].includes(key))delete env[key];
  const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')??'Path';
  const windows=process.env.SystemRoot??'C:\\Windows';
  env[pathKey]=[windows,path.join(windows,'System32'),path.join(windows,'System32','WindowsPowerShell','v1.0')].join(';');
  evidence.noDeveloperToolsOnApplicationPath=true;
  Object.assign(env,{FOX_VERIFY_DIR:directory,FOX_VERIFY_MANUAL:'1'});
  running=spawn(exe,[`--remote-debugging-port=${port}`,'--force-device-scale-factor=1'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';running.stderr.on('data',b=>{log+=b;});
  let page;
  for(let i=0;i<200;i++) {try {page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page');if(page)break;}catch{} if(running.exitCode!==null)throw Error(`Installed launch exited: ${log}`);await pause(100);}
  assert.ok(page,'Installed renderer not found');
  assert.ok(page.url.startsWith('file:'),'Production file assets required');
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let sequence=0;const pending=new Map();ws.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id){const cb=pending.get(msg.id);pending.delete(msg.id);if(!cb)return;if(msg.error)cb.reject(Error(JSON.stringify(msg.error)));else cb.resolve(msg.result);}};
  const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const value=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
  for(let i=0;i<100;i++){if(await evaluate('Boolean(window.fox && document.querySelectorAll("[data-table-code]").length===27)'))break;await pause(100);}
  assert.equal(await evaluate('document.querySelectorAll("[data-table-code]").length'),27);
  await command('Network.enable');await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  (evidence.startupMs??=[]).push(Date.now()-launchStarted);
  return {evaluate,command,env,pid:running.pid};
}
async function close(force=false) {
  if(!force && ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify({id:999999,method:'Page.close'}));
  // Only the exact isolated QA process tree is terminated; never the operational app.
  if(force&&running&&running.exitCode===null&&running.signalCode===null) {
    const args=['/PID',String(running.pid),'/T'];if(force)args.push('/F');
    spawnSync('taskkill',args,{windowsHide:true});
  }
  for(let i=0;i<200&&running&&running.exitCode===null&&running.signalCode===null;i++)await pause(50);
  ws?.close();
  if(running&&running.exitCode===null&&running.signalCode===null)throw Error('QA process did not close');
}
function snapshot(databaseFile=path.join(directory,'fox.sqlite')) {
  const script=path.join(directory,'read-snapshot.cjs');
  fs.writeFileSync(script,`const DB=require(${JSON.stringify(path.join(install,'resources/app.asar/node_modules/better-sqlite3'))});const db=new DB(${JSON.stringify(databaseFile)},{readonly:true,fileMustExist:true});const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();const result={integrity:db.pragma('integrity_check',{simple:true}),tables:Object.fromEntries(names.map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]))};db.close();console.log(JSON.stringify(result));`);
  const result=spawnSync(exe,[script],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);assert.equal(data.integrity,'ok');return data;
}
const okay=(value,message)=>{assert.ok(value,message);evidence.checks.push(message);};
function resourceSample(){
  // Observe only this isolated application tree; never collect command lines or owner data.
  const script=`$qaRootPid=${running.pid};$qaProcesses=Get-CimInstance Win32_Process;$qaIds=@($qaRootPid);do{$qaNew=@($qaProcesses|Where-Object {$_.ParentProcessId -in $qaIds -and $_.ProcessId -notin $qaIds}|Select-Object -ExpandProperty ProcessId);$qaIds+= $qaNew}while($qaNew.Count -gt 0);$qaStats=@(Get-Process -Id $qaIds -ErrorAction Stop);@{processes=$qaStats.Count;workingSetBytes=($qaStats|Measure-Object WorkingSet64 -Sum).Sum;cpuSeconds=($qaStats|Measure-Object CPU -Sum).Sum;handles=($qaStats|Measure-Object HandleCount -Sum).Sum;visibleWindows=@($qaStats|Where-Object {$_.MainWindowHandle -ne 0}).Count}|ConvertTo-Json -Compress`;
  const r=spawnSync('powershell.exe',['-NoProfile','-Command',script],{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);return {rootPid:running.pid,elapsedMs:Date.now(),...JSON.parse(r.stdout)};
}
function shortcuts(expected) {
  const script=path.join(directory,'inspect-shortcuts.ps1');
  fs.writeFileSync(script,`$ErrorActionPreference='Stop';$desktop=[Environment]::GetFolderPath('DesktopDirectory');$menu=Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs';$shell=New-Object -ComObject WScript.Shell;$links=@(Get-ChildItem -LiteralPath $desktop,$menu -Recurse -Filter '*FOX*.lnk' -ErrorAction SilentlyContinue | ForEach-Object { @{path=$_.FullName;target=$shell.CreateShortcut($_.FullName).TargetPath} });ConvertTo-Json -InputObject $links -Compress`);
  const result=spawnSync('powershell.exe',['-NoProfile','-File',script],{windowsHide:true,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);const links=JSON.parse(result.stdout.trim());
  if(fs.existsSync(exe))canonicalExecutable=fs.realpathSync.native(exe).toLowerCase();
  const own=links.filter(l=>(fs.existsSync(l.target)?fs.realpathSync.native(l.target):l.target).toLowerCase()===canonicalExecutable);
  evidence.shortcuts=links;
  if(expected)okay(own.length>=2,'actual Desktop and Start Menu shortcuts target installed executable');
  else okay(own.length===0,'uninstall removes QA shortcuts');
  return own;
}
try {
  installVersion(installerA);const links=shortcuts(true);let session=await launch();let {evaluate,command}=session;
  const fresh=snapshot();fs.writeFileSync(path.join(directory,'fresh.json'),JSON.stringify(fresh,null,2));
  okay(fresh.tables.cafe_tables.length===27&&fresh.tables.products.length===21,'fresh canonical references');
  okay(fresh.tables.orders.length===0&&fresh.tables.inventory_movements.length===0,'fresh zero transactions');
  if(fresh.tables.receipt_documents){okay(fresh.tables.receipt_documents.length===0&&fresh.tables.receipt_print_jobs.length===0,'fresh zero receipts/print jobs');okay(fresh.tables.settings.find(s=>s.key==='receipt_auto_print').value==='false'&&fresh.tables.settings.find(s=>s.key==='receipt_printer').value==='null','fresh no printer and auto-print OFF');}
  okay(fresh.tables.products.every(p=>p.selling_price_cents===null&&p.purchase_cost_cents===null&&p.track_inventory===null)&&fresh.tables.inventory_balances.every(p=>p.quantity===null),'fresh no invented configuration');
  for(const code of fresh.tables.cafe_tables.map(t=>t.code)) {
    await evaluate(`document.querySelector('[data-table-code="${code}"]').click()`);
    for(let i=0;i<100;i++){if(await evaluate(`document.querySelector('#order-heading')?.textContent==='Tavolina ${code}'`))break;await pause(20);}
    okay(await evaluate(`document.querySelector('#order-heading')?.textContent==='Tavolina ${code}'`),`clickable installed ${code}`);
  }
  okay(snapshot().tables.orders.length===0,'free table selection creates no order');
  const floor=await command('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(directory,'installed-floor.png'),Buffer.from(floor.data,'base64'));
  const api=code=>evaluate(`(async()=>{${code}})()`);
  const mutation=await api(`const p=(await fox.products.list()).find(p=>p.id==='KAFE-1');return fox.products.update({...p,sellingPriceCents:100,purchaseCostCents:50,trackInventory:true,lowStockThreshold:2,active:true});`);
  okay(mutation.ok,'installed product configuration');
  okay((await api(`return fox.inventory.addSupply({requestId:crypto.randomUUID(),productId:'KAFE-1',quantity:20});`)).ok,'installed supply');
  const tableCodes=await api(`return (await fox.tables.list()).map(t=>t.code);`);okay(new Set(tableCodes).size===27,'installed 27 unique tables');
  let workspace=await api(`const t=(await fox.tables.list()).find(t=>t.code==='M5');return fox.orders.addProduct({tableId:t.id,productId:'KAFE-1'});`);okay(workspace.ok,'installed add product');
  workspace=await api(`const t=(await fox.tables.list()).find(t=>t.code==='M5');const w=await fox.orders.getForTable(t.id);return fox.orders.incrementItem({tableId:t.id,itemId:w.order.items[0].id});`);okay(workspace.ok&&workspace.data.order.totalCents===200,'installed increment total');
  const beforeCrash=snapshot();await close(true);session=await launch();evaluate=session.evaluate;command=session.command;
  assert.deepEqual(snapshot(),beforeCrash);evidence.checks.push('forced-close active order persistence');
  const sale=await api(`const t=(await fox.tables.list()).find(t=>t.code==='M5');const w=await fox.orders.getForTable(t.id);return fox.orders.completeOrder({orderId:w.order.id,expectedRevision:w.order.revision});`);
  okay(sale.ok,'installed atomic CASH checkout');
  const report=await api(`return fox.reports.getSalesReport('ALL');`);
  okay(report.summary.salesCents===200&&report.summary.costCents===100&&report.cashCents===200&&report.summary.completedOrders===1,'installed CASH report and cost');
  okay((await api(`return (await fox.products.list()).find(p=>p.id==='KAFE-1').stockQuantity;`))===18,'installed inventory deduction');
  okay((await api(`return (await fox.tables.list()).find(t=>t.code==='M5').status;`))==='FREE','installed paid table free');
  okay((await api(`const t=(await fox.tables.list()).find(t=>t.code==='M6');return fox.orders.addProduct({tableId:t.id,productId:'KAFE-1'});`)).ok,'active order prepared for upgrade');
  await evaluate(`document.querySelector('[data-nav="reports"]').click()`);await pause(300);
  okay(await evaluate('document.querySelectorAll("[data-sale-id]").length===1'),'installed reports screen');
  const image=await command('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(directory,'installed-reports.png'),Buffer.from(image.data,'base64'));
  const second=spawn(exe,[],{env:session.env,windowsHide:true,stdio:'ignore'});
  const secondExit=await Promise.race([new Promise(r=>second.on('exit',r)),pause(10000).then(()=>undefined)]);
  okay(secondExit===0&&running.exitCode===null,'installed second launch exits; original stays');
  const linked=spawnSync('powershell.exe',['-NoProfile','-Command',`$p=Start-Process -FilePath '${links[0].path.replaceAll("'","''")}' -PassThru -Wait -WindowStyle Hidden;exit $p.ExitCode`],{env:session.env,windowsHide:true,encoding:'utf8',timeout:15000});
  okay(linked.status===0&&running.exitCode===null,'actual shortcut second launch leaves one operational instance');
  const beforeUpgrade=snapshot();fs.writeFileSync(path.join(directory,'before-upgrade.json'),JSON.stringify(beforeUpgrade,null,2));await close();
  installVersion(installerB);session=await launch();evaluate=session.evaluate;command=session.command;
  const upgraded=snapshot();
  for(const [table,rows] of Object.entries(beforeUpgrade.tables)) {
    if(table==='schema_migrations') {for(const row of rows)assert.ok(upgraded.tables[table].some(r=>JSON.stringify(r)===JSON.stringify(row)));}
    else if(table==='settings') {for(const row of rows)assert.deepEqual(upgraded.tables[table].find(r=>r.key===row.key),row);}
    else assert.deepEqual(upgraded.tables[table],rows,`Upgrade preserves ${table}`);
  }
  const upgradedReport=await api(`return fox.reports.getSalesReport('ALL');`);
  for(const key of ['summary','cashCents','cardCents','unknownPaymentCents','period'])assert.deepEqual(upgradedReport[key],report[key]);
  for(const oldSale of report.recentSales){const newSale=upgradedReport.recentSales.find(s=>s.id===oldSale.id);for(const [key,value] of Object.entries(oldSale))assert.deepEqual(newSale[key],value);}
  evidence.checks.push('real installer A to B preserves every old business row and report value; additive receipt migration permitted');
  if(Math.max(...upgraded.tables.schema_migrations.map(row=>row.version))>Math.max(...beforeUpgrade.tables.schema_migrations.map(row=>row.version))){
    const backups=path.join(directory,'backups');assert.ok(fs.existsSync(backups),'Required pre-migration backup directory');
    const automatic=fs.readdirSync(backups).filter(name=>/^FOX-before-v\d+-.*\.sqlite$/.test(name));assert.ok(automatic.length);
    assert.deepEqual(snapshot(path.join(backups,automatic.at(-1))).tables,beforeUpgrade.tables);
    okay(true,'installed pre-migration backup exactly preserves old state');
  }
  if(receiptTargetFile){
    const target=JSON.parse(fs.readFileSync(receiptTargetFile,'utf8'));assert.ok(target.Printer.startsWith('FOX QA Receipt '));
    okay((await api('return fox.receipts.getSettings();')).autoPrint===false,'upgraded receipt auto-print safely OFF');
    okay(upgraded.tables.receipt_documents.length===0&&upgraded.tables.receipt_print_jobs.length===0,'upgrade has no invented historical receipts/jobs');
    const printers=await api('return fox.receipts.listPrinters();');okay(printers.ok&&printers.data.some(p=>p.deviceName===target.Printer),'installed Windows printer discovery');
    okay((await api(`return fox.receipts.saveSettings({deviceName:${JSON.stringify(target.Printer)},autoPrint:false,paperWidth:80,copies:1});`)).data.saved,'installed printer setting saved');
    const test=await api('return fox.receipts.testPrint();');okay(test.ok,'installed test print request');
    async function submitted(jobId){for(let i=0;i<600;i++){const jobs=await api('return fox.receipts.recentJobs();');const job=jobs.find(j=>j.id===jobId);if(job?.status==='SUBMITTED')return;assert.ok(!['FAILED','UNKNOWN'].includes(job?.status),JSON.stringify(job));await pause(50);}throw Error('Installed receipt submit timed out');}
    async function keepOutput(name){for(let i=0;i<400;i++){if(fs.existsSync(target.Port)&&fs.statSync(target.Port).size>0){try{fs.renameSync(target.Port,path.join(directory,name+'.pdf'));return;}catch(error){if(!['EBUSY','EPERM'].includes(error.code))throw error;}}await pause(50);}throw Error('Installed Windows PDF output missing');}
    await submitted(test.data.id);await keepOutput('installed-test-receipt');okay(true,'installed real webContents.print accepted and Windows spooler produced test PDF');
    assert.deepEqual(snapshot().tables.orders,beforeUpgrade.tables.orders);assert.deepEqual(snapshot().tables.inventory_balances,beforeUpgrade.tables.inventory_balances);
    okay((await api(`return fox.receipts.saveSettings({deviceName:${JSON.stringify(target.Printer)},autoPrint:true,paperWidth:80,copies:1});`)).data.saved,'installed auto-print enabled after test');
    const openOrder=await api(`return fox.orders.getForTable('M6');`);okay(openOrder.order&&openOrder.order.totalCents===100,'pre-upgrade OPEN order survives receipt migration');
    const completed=await api(`return fox.orders.completeOrder({orderId:${JSON.stringify(openOrder.order.id)},expectedRevision:${JSON.stringify(openOrder.order.revision)}});`);okay(completed.ok,'post-upgrade existing order CASH checkout');
    const receiptState=await api(`return fox.receipts.getState(${JSON.stringify(openOrder.order.id)});`);assert.ok(receiptState.ok&&receiptState.data.jobs.length===1);await submitted(receiptState.data.jobs[0].id);await keepOutput('installed-auto-receipt');
    okay((await api(`return (await fox.products.list()).find(p=>p.id==='KAFE-1').stockQuantity;`))===17,'installed auto-print inventory deducted exactly once');
    const beforeCopy=snapshot(),reportCopy=await api("return fox.reports.getSalesReport('ALL');");
    const copy=await api(`const input={saleId:${JSON.stringify(sale.data.orderId)},requestId:crypto.randomUUID()};return Promise.all([fox.receipts.printCopy(input),fox.receipts.printCopy(input)]);`);
    okay(copy.every(r=>r.ok)&&copy[0].data.id===copy[1].data.id,'installed duplicate copy request idempotent');await submitted(copy[0].data.id);await keepOutput('installed-legacy-copy');
    const afterCopy=snapshot();for(const table of ['orders','order_items','order_payments','inventory_balances','inventory_movements','cafe_tables','products','expenses'])assert.deepEqual(afterCopy.tables[table],beforeCopy.tables[table]);assert.deepEqual(await api("return fox.reports.getSalesReport('ALL');"),reportCopy);okay(true,'installed legacy copy preserves finances and stock');
    const printerControl=path.join(directory,'qa-printer-control.ps1');
    fs.writeFileSync(printerControl,`param([string]$Name,[string]$Port,[string]$Action)\n$ErrorActionPreference='Stop'\nif ($Name -notmatch '^FOX QA Receipt [a-f0-9]{32}$' -or $Port -notlike '*fox-qa-print-spool-*') { throw 'Not an owned QA printer' }\nif ($Action -eq 'Remove') { $p=Get-Printer -Name $Name;if ($p.PortName -ne $Port -or $p.DriverName -ne 'Microsoft Print To PDF') { throw 'QA printer mismatch' };Remove-Printer -Name $Name } elseif ($Action -eq 'Add') { Add-Printer -Name $Name -DriverName 'Microsoft Print To PDF' -PortName $Port } else { throw 'Invalid action' }`);
    function controlPrinter(action){const r=spawnSync('powershell.exe',['-NoProfile','-File',printerControl,'-Name',target.Printer,'-Port',target.Port,'-Action',action],{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);}
    controlPrinter('Remove');let printerRemoved=true;
    try{
      for(let i=0;i<100;i++){const discovered=await api('return fox.receipts.listPrinters();');assert.ok(discovered.ok);if(!discovered.data.some(p=>p.deviceName===target.Printer))break;await pause(50);}
      const disconnectedOrder=await api(`return fox.orders.addProduct({tableId:'M7',productId:'KAFE-1'});`);assert.ok(disconnectedOrder.ok);
      const disconnectedSale=await api(`return fox.orders.completeOrder({orderId:${JSON.stringify(disconnectedOrder.data.order.id)}});`);okay(disconnectedSale.ok,'installed sale succeeds with removed selected printer');
      let failedJob;for(let i=0;i<400;i++){failedJob=(await api(`return fox.receipts.getState(${JSON.stringify(disconnectedSale.data.orderId)});`)).data.jobs[0];if(['FAILED','UNKNOWN'].includes(failedJob?.status))break;await pause(50);}
      okay(failedJob.status==='FAILED'&&failedJob.errorCode==='PRINTER_NOT_FOUND','installed removed printer detected without default fallback');
      const failedSnapshot=snapshot(),failedReport=await api("return fox.reports.getSalesReport('ALL');");
      okay(failedSnapshot.tables.cafe_tables.find(t=>t.code==='M7').status==='FREE'&&failedSnapshot.tables.inventory_balances.find(b=>b.product_id==='KAFE-1').quantity===16,'installed failed receipt still frees table and deducts sale stock once');
      for(let i=0;i<100;i++){if(await evaluate('Boolean(document.querySelector(".print-notice"))'))break;await pause(50);}okay(await evaluate('document.querySelector(".print-notice")?.textContent.includes("Shitja #000003 u përfundua")'),'installed failure UI distinguishes completed sale');
      controlPrinter('Add');printerRemoved=false;
      const retry=await api(`return fox.receipts.retry(${JSON.stringify(failedJob.id)});`);assert.ok(retry.ok);await submitted(retry.data.id);await keepOutput('installed-retried-receipt');
      const retried=snapshot();for(const table of ['orders','order_items','order_payments','inventory_balances','inventory_movements','cafe_tables','products','expenses'])assert.deepEqual(retried.tables[table],failedSnapshot.tables[table]);assert.deepEqual(await api("return fox.reports.getSalesReport('ALL');"),failedReport);okay(true,'installed intentional retry after reconnection preserves financial state');
    }finally{
      if(printerRemoved)controlPrinter('Add');
    }
    await evaluate("document.querySelector('[data-nav=settings]').click()");await pause(300);okay(await evaluate(`Boolean(document.querySelector('[aria-label="Printeri i kuponit"]'))`),'installed receipt settings screen');
    for(let i=0;i<100;i++){if(await evaluate(`document.querySelector('[aria-label="Printeri i kuponit"]').value===${JSON.stringify(target.Printer)}`))break;await pause(50);}
    okay(await evaluate(`document.querySelector('[aria-label="Printeri i kuponit"]').value===${JSON.stringify(target.Printer)}`),'installed Settings shows exact persisted device');
    await evaluate(`document.querySelector('.receipt-auto input').click()`);
    for(let i=0;i<100&&(await api('return fox.receipts.getSettings();')).autoPrint;i++)await pause(50);
    okay((await api('return fox.receipts.getSettings();')).autoPrint===false,'installed UI turns auto-print OFF');
    await pause(150);await evaluate(`document.querySelector('.receipt-auto input').click()`);
    for(let i=0;i<100&&!(await api('return fox.receipts.getSettings();')).autoPrint;i++)await pause(50);
    okay((await api('return fox.receipts.getSettings();')).autoPrint===true,'installed UI turns tested auto-print ON');
    await pause(150);const existingJobs=await api('return fox.receipts.recentJobs();');
    await evaluate(`Array.from(document.querySelectorAll('.receipt-settings button')).find(b=>b.textContent==='Testo printerin').click()`);
    let uiTest;for(let i=0;i<100;i++){uiTest=(await api('return fox.receipts.recentJobs();')).find(j=>j.kind==='TEST'&&!existingJobs.some(old=>old.id===j.id));if(uiTest)break;await pause(50);}
    assert.ok(uiTest);await submitted(uiTest.id);await keepOutput('installed-ui-test-receipt');okay(true,'installed Testo printerin button executes real Windows pipeline');
    fs.writeFileSync(path.join(directory,'installed-receipt-settings.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
    const beforeRestart=snapshot();await close();session=await launch();evaluate=session.evaluate;command=session.command;assert.deepEqual(snapshot(),beforeRestart);okay((await api('return fox.receipts.getSettings();')).autoPrint===true,'installed printer config and receipt history persist through restart');
    evidence.receiptPipeline={windowsSpooler:true,physicalThermalPrinter:false,offlineRenderer:true};
  }
  const beforeReload=snapshot(),trustedUrl=await evaluate('location.href');
  await evaluate('location.reload()');await pause(300);
  for(let i=0;i<100;i++){if(await evaluate('Boolean(window.fox && document.querySelectorAll("[data-table-code]").length===27)'))break;await pause(50);}
  okay(await evaluate('performance.getEntriesByType("navigation")[0].type')==='reload','installed own-page retry reload works');
  await evaluate(`location.href='https://example.invalid/'`);await pause(200);
  assert.equal(await evaluate('location.href'),trustedUrl);assert.deepEqual(snapshot(),beforeReload);
  okay(true,'installed external navigation blocked and reload preserves all data');
  // Exercise the final installed executable repeatedly, offline and without dev tools on PATH.
  okay((await api(`return fox.inventory.addSupply({requestId:crypto.randomUUID(),productId:'KAFE-1',quantity:200});`)).ok,'installed soak supply');
  const soakInitial=await api(`return fox.reports.getSalesReport('ALL');`);
  const soakStock=await api(`return (await fox.products.list()).find(p=>p.id==='KAFE-1').stockQuantity;`);
  await command('HeapProfiler.collectGarbage');const soakBefore=await command('Memory.getDOMCounters'),soakStart=Date.now();
  const resources=[resourceSample()];let soakRestarts=0;
  for(let cycle=0;cycle<sessionSales;cycle++){
    await evaluate(`document.querySelector('[data-nav=tables]').click()`);await pause(20);
    await evaluate(`document.querySelector('[data-table-code=M5]').click()`);
    const added=await api(`return fox.orders.addProduct({tableId:'M5',productId:'KAFE-1'});`);assert.ok(added.ok);
    const itemId=added.data.order.items[0].id;
    assert.ok((await api(`return fox.orders.incrementItem({tableId:'M5',itemId:${JSON.stringify(itemId)}});`)).ok);
    assert.ok((await api(`return fox.orders.decrementItem({tableId:'M5',itemId:${JSON.stringify(itemId)}});`)).ok);
    assert.ok((await api(`return fox.orders.completeOrder({orderId:${JSON.stringify(added.data.order.id)}});`)).ok);
    await evaluate(`document.querySelector('[data-nav=${cycle%3===0?'settings':cycle%3===1?'reports':'tables'}]').click()`);
    const current=await api(`return fox.reports.getSalesReport('ALL');`);
    assert.equal(current.summary.salesCents,soakInitial.summary.salesCents+(cycle+1)*100);
    assert.equal(current.summary.completedOrders,soakInitial.summary.completedOrders+cycle+1);
    assert.equal((await api(`return fox.data.diagnostics();`)).databaseStatus,'OK');
    await pause(500);
    if(cycle===Math.floor(sessionSales/3)-1||cycle===Math.floor(sessionSales*2/3)-1){const before= snapshot();await close();session=await launch();evaluate=session.evaluate;command=session.command;assert.deepEqual(snapshot(),before);soakRestarts++;}
    if(cycle===Math.floor(sessionSales/2)-1||cycle===sessionSales-1)resources.push(resourceSample());
  }
  assert.equal((await api(`return (await fox.products.list()).find(p=>p.id==='KAFE-1').stockQuantity;`)),soakStock-sessionSales);
  await command('HeapProfiler.collectGarbage');const soakAfter=await command('Memory.getDOMCounters');
  assert.equal(soakAfter.documents,soakBefore.documents);assert.ok(soakAfter.nodes<soakBefore.nodes+3000);assert.ok(soakAfter.jsEventListeners<soakBefore.jsEventListeners+500);
  evidence.soak={passed:true,cycles:sessionSales,durationMs:Date.now()-soakStart,before:soakBefore,after:soakAfter,offline:true,financialTotalsCorrect:true,stockCorrect:true};
  evidence.soak.resources=resources;evidence.soak.actualElectronRestarts=soakRestarts;
  const beforeReinstall=snapshot();
  await close();const uninstaller=fs.readdirSync(install).find(n=>/^Uninstall.*\.exe$/i.test(n));assert.ok(uninstaller);
  const uninstalled=spawnSync(path.join(install,uninstaller),['/S'],{windowsHide:true,timeout:120000});assert.equal(uninstalled.status,0);
  okay(fs.existsSync(path.join(directory,'fox.sqlite')),'uninstall preserves userData');
  for(let i=0;i<100&&fs.existsSync(exe);i++)await pause(100);
  okay(!fs.existsSync(exe),'uninstall removes application executable');shortcuts(false);
  installVersion(installerB);session=await launch();assert.deepEqual(snapshot(),beforeReinstall);evidence.checks.push('actual reinstall preserves all business rows and receipt history');await close();
  // Remove QA installation and its shortcuts/registration, retaining test evidence.
  const cleanup=spawnSync(path.join(install,uninstaller),['/S'],{windowsHide:true,timeout:120000});assert.equal(cleanup.status,0);
  evidence.passed=true;
} catch(error) {evidence.passed=false;evidence.error=error.stack;await close(true).catch(()=>{});throw error;}
finally {fs.writeFileSync(path.join(directory,'installed-result.json'),JSON.stringify(evidence,null,2));console.log(`Installed verification evidence: ${directory}`);}
