// Test the actual installed executable using Electron's opt-in local debugging switch.
// No server, test fixture or debugging switch is shipped in normal startup.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createQaDirectory} from './qa-directory.mjs';
const [installerA,installerB]=process.argv.slice(2);
if(!installerA||!installerB) throw Error('Usage: verify-installed.mjs <installer A> <installer B>');
const directory=createQaDirectory('installed');
const install=path.join(directory,'application');
const exe=path.join(install,'FOX Kafeteri.exe');
const evidence={directory,install,checks:[],versions:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function installVersion(file) {
  const result=spawnSync(path.resolve(file),['/S',`/D=${install}`],{windowsHide:true,timeout:120000});
  assert.equal(result.status,0,`Installer exit ${result.status}: ${result.stderr}`);
  assert.ok(fs.existsSync(exe),'Installed executable missing');
}
let running,ws;
async function launch() {
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('FOX_VERIFY_')||['ELECTRON_RUN_AS_NODE','FOX_DEV_URL'].includes(key))delete env[key];
  Object.assign(env,{FOX_VERIFY_DIR:directory,FOX_VERIFY_MANUAL:'1'});
  running=spawn(exe,[`--remote-debugging-port=${port}`,'--force-device-scale-factor=1'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';running.stderr.on('data',b=>{log+=b;});
  let page;
  for(let i=0;i<200;i++) {try {page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page');if(page)break;}catch{} if(running.exitCode!==null)throw Error(`Installed launch exited: ${log}`);await pause(100);}
  assert.ok(page,'Installed renderer not found');
  assert.ok(page.url.startsWith('file:'),'Production file assets required');
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let sequence=0;const pending=new Map();ws.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id){const cb=pending.get(msg.id);pending.delete(msg.id);if(msg.error)cb.reject(Error(JSON.stringify(msg.error)));else cb.resolve(msg.result);}};
  const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const value=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
  for(let i=0;i<100;i++){if(await evaluate('Boolean(window.fox && document.querySelectorAll("[data-table-code]").length===27)'))break;await pause(100);}
  assert.equal(await evaluate('document.querySelectorAll("[data-table-code]").length'),27);
  await command('Network.enable');await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  return {evaluate,command,env,pid:running.pid};
}
async function close(force=false) {
  ws?.close();
  // Only the exact isolated QA process tree is terminated; never the operational app.
  if(running&&running.exitCode===null) {
    const args=['/PID',String(running.pid),'/T'];if(force)args.push('/F');
    spawnSync('taskkill',args,{windowsHide:true});
    for(let i=0;i<100&&running.exitCode===null;i++)await pause(50);
    if(running.exitCode===null)throw Error('QA process did not close');
  }
}
function snapshot() {
  const script=path.join(directory,'read-snapshot.cjs');
  fs.writeFileSync(script,`const DB=require(${JSON.stringify(path.join(install,'resources/app.asar/node_modules/better-sqlite3'))});const db=new DB(${JSON.stringify(path.join(directory,'fox.sqlite'))},{readonly:true});const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();const result={integrity:db.pragma('integrity_check',{simple:true}),tables:Object.fromEntries(names.map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]))};db.close();console.log(JSON.stringify(result));`);
  const result=spawnSync(exe,[script],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);assert.equal(data.integrity,'ok');return data;
}
const okay=(value,message)=>{assert.ok(value,message);evidence.checks.push(message);};
try {
  installVersion(installerA);let session=await launch();let {evaluate,command}=session;
  const fresh=snapshot();fs.writeFileSync(path.join(directory,'fresh.json'),JSON.stringify(fresh,null,2));
  okay(fresh.tables.cafe_tables.length===27&&fresh.tables.products.length===21,'fresh canonical references');
  okay(fresh.tables.orders.length===0&&fresh.tables.inventory_movements.length===0,'fresh zero transactions');
  okay(fresh.tables.products.every(p=>p.selling_price_cents===null&&p.purchase_cost_cents===null&&p.track_inventory===null)&&fresh.tables.inventory_balances.every(p=>p.quantity===null),'fresh no invented configuration');
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
  const beforeUpgrade=snapshot();fs.writeFileSync(path.join(directory,'before-upgrade.json'),JSON.stringify(beforeUpgrade,null,2));await close();
  installVersion(installerB);session=await launch();evaluate=session.evaluate;command=session.command;
  assert.deepEqual(snapshot(),beforeUpgrade);assert.deepEqual(await api(`return fox.reports.getSalesReport('ALL');`),report);evidence.checks.push('real installer A to B preserves all database rows and reports');
  await close();const uninstaller=fs.readdirSync(install).find(n=>/^Uninstall.*\.exe$/i.test(n));assert.ok(uninstaller);
  const uninstalled=spawnSync(path.join(install,uninstaller),['/S'],{windowsHide:true,timeout:120000});assert.equal(uninstalled.status,0);
  okay(fs.existsSync(path.join(directory,'fox.sqlite')),'uninstall preserves userData');
  installVersion(installerB);session=await launch();assert.deepEqual(snapshot(),beforeUpgrade);evidence.checks.push('actual reinstall preserves all business rows');await close();
  // Remove QA installation and its shortcuts/registration, retaining test evidence.
  const cleanup=spawnSync(path.join(install,uninstaller),['/S'],{windowsHide:true,timeout:120000});assert.equal(cleanup.status,0);
  evidence.passed=true;
} catch(error) {evidence.passed=false;evidence.error=error.stack;await close(true).catch(()=>{});throw error;}
finally {fs.writeFileSync(path.join(directory,'installed-result.json'),JSON.stringify(evidence,null,2));console.log(`Installed verification evidence: ${directory}`);}
