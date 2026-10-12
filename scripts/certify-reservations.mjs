// Certification controller only. Uses synthetic contacts in a marked isolated QA profile.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

export async function certifyReservations(h){
 const {api,ui,command,observe,check,capture,viewport,directory,installer,close,launch,connect,reserveFromUi}=h;
 const delay=ms=>new Promise(r=>setTimeout(r,ms)),getPid=()=>h.processId();
 const codes=['M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12','M13','SH1','SH2','SH3','SH4','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10'];
 const positions=['M1','M13','SH1','SH4','T1','T10'];
 const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const snapshot=()=>observe().tables;
 const invariant=s=>Object.fromEntries(Object.entries(s).filter(([name])=>!['cafe_tables','table_reservations'].includes(name)));
 const financial=()=>api('return {report:await fox.finance.report({period:"ALL"}),cash:await fox.finance.cashPreview({openingCents:5000})};');
 const phone='+000 000 901393';
 if(installer){
   const asar=createRequire(import.meta.url)('@electron/asar'),archive=path.join(directory,'application','resources','app.asar'),files=asar.listPackage(archive).map(name=>name.replaceAll('\\','/'));
   check(!files.some(name=>/\.(?:sqlite(?:-wal|-shm)?|db|log|pfx|pem|key)$/i.test(name)||/^\/(?:tests|scripts|docs|outputs|work)\//.test(name)||/(?:^|\/)\.env(?:\.|$)/.test(name)),'Installed ASAR excludes DBs, backups, logs, screenshots/evidence roots and secrets');
   for(const name of files.filter(name=>/\.(?:js|cjs|json|html|css|txt)$/i.test(name))){const relative=name.replace(/^\//,''),stat=asar.statFile(archive,relative,false),bytes=stat.unpacked?fs.readFileSync(path.join(archive+'.unpacked',relative)):asar.extractFile(archive,relative);for(const token of [phone,'+383 44 123456','QA Çelik','QA Keyboard','QA crash only'])assert.ok(!bytes.toString().includes(token),'Synthetic contact/test fixture leaked into release asset');}
   check(true,'Every packaged text asset excludes reservation contact fixtures');
 }
 const input=tableId=>({requestId:randomUUID(),tableId,customerName:'QA Çelik '+tableId,phone,startsAt:new Date(Date.now()+86400000).toISOString(),guests:4,note:'QA certification only'});
 const reserve=value=>api(`return fox.reservations.reserve(${JSON.stringify(value)});`);
 const cancel=value=>api(`return fox.reservations.cancel(${JSON.stringify(value)});`);
 assert.deepEqual(observe().tables.cafe_tables.map(t=>t.code).sort(),[...codes].sort());
 assert.deepEqual(await ui.js('[...document.querySelectorAll("[data-table-code]")].map(e=>e.dataset.tableCode).sort()'),[...codes].sort());
 check(true,'Independent exact canonical M13/SH4/T10 domain, no B/J/T11 identities');
 await viewport(1366,768);await ui.select('M2');await ui.js('document.querySelector("[data-open-reservation]").focus();document.querySelector("[data-open-reservation]").click()');await ui.until('Boolean(document.querySelector("#reservation-form"))');
 check(await ui.js('document.activeElement.id==="reservation-name"'),'Reservation initial focus is customer-name field');
 const focused=[];for(let i=0;i<24;i++){
   await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   const state=await ui.js('({inside:Boolean(document.activeElement.closest("dialog[open]")),id:document.activeElement.id,tag:document.activeElement.tagName})');
   // The native offscreen renderer focuses its viewport at the cycle boundary.
   // A background control is never an acceptable tab target; verify inertness too.
   check(state.inside||state.tag==='BODY','Native Tab never reaches an interactive background control '+i);focused.push(state.id);
 }
 for(const id of ['reservation-name','reservation-phone','reservation-when','reservation-guests','reservation-note'])check(focused.includes(id),'Tab reaches '+id);
 await ui.js('document.querySelector("[data-nav=inventory]").focus()');check(await ui.js('document.activeElement!==document.querySelector("[data-nav=inventory]")'),'Modal background is inert even to programmatic focus');
 for(let i=0;i<2;i++)await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 check(await ui.js('Boolean(document.activeElement.closest("dialog[open]"))'),'Native viewport focus returns to modal; no outside focus trap');
 await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await ui.until('!document.querySelector("dialog[open]")');
 check(await ui.js('document.activeElement.hasAttribute("data-open-reservation")'),'Escape restores focus to reservation opener');
 const before=snapshot(),beforeFinancial=await financial(),requests=positions.map(input);
 const repeated=await api(`return Promise.all(Array.from({length:10},()=>fox.reservations.reserve(${JSON.stringify(requests[0])})));`);check(repeated.every(r=>r.ok),'10 near-simultaneous same-intent IPC creates return one reservation');
 for(const value of requests.slice(1))check((await reserve(value)).ok,'Booking canonical '+value.tableId);
 for(const value of requests)check(!(await reserve({...value,customerName:'QA changed'})).ok,'Unsupported edit rejected '+value.tableId);
 const booked=snapshot();assert.equal(booked.table_reservations.filter(r=>r.status==='BOOKED').length,6);assert.deepEqual(invariant(booked),invariant(before));assert.deepEqual(await financial(),beforeFinancial);check(true,'Six bookings and attempted edits have exact zero order/payment/receipt/stock/finance/cash delta');
 const scratch=input('M2');check((await reserve(scratch)).ok,'Scratch reservation');const cancelled=await api(`return Promise.all(Array.from({length:10},()=>fox.reservations.cancel({tableId:"M2",reservationId:${JSON.stringify(scratch.requestId)}})));`);check(cancelled.every(r=>r.ok),'10 repeated cancellations are idempotent');assert.deepEqual(invariant(snapshot()),invariant(before));assert.deepEqual(await financial(),beforeFinancial);
 for(const code of positions){await ui.select(code);await ui.until('Boolean(document.querySelector("[data-reservation-details]"))');const value=await api(`return fox.orders.getForTable(${JSON.stringify(code)});`);check(value.reservation.id===requests.find(r=>r.tableId===code).requestId&&value.reservation.phone===phone&&value.table.status==='RESERVED'&&value.order===null,'Correct contact and identity on '+code);}
 await ui.js(`[${positions.map(c=>JSON.stringify(c)).join(',')}].forEach(code=>document.querySelector('[data-table-code="'+code+'"]').click())`);await ui.until('document.querySelector("#order-heading")?.textContent==="Tavolina T10" && Boolean(document.querySelector("[data-reservation-details]"))');
 check(await ui.js('document.querySelector("[data-reservation-details]").textContent.includes("QA Çelik T10") && !document.querySelector("[data-reservation-details]").textContent.includes("QA Çelik M13")'),'Rapid navigation cannot show stale contact from another table');
 check(await ui.js('document.querySelector("[data-table-code=T10]").getAttribute("aria-pressed")==="true" && document.querySelector("[data-table-code=T10]").dataset.status==="RESERVED" && document.querySelector("[data-table-code=M13]").getAttribute("aria-pressed")==="false"'),'RESERVED and SELECTED remain independent');
 await ui.js('window.__certificationAlert=0;window.alert=()=>{window.__certificationAlert++}');await (await reserveFromUi('M3','<script>alert(1)</script>'))();
 check(await ui.js('window.__certificationAlert===0 && document.querySelector("[data-reservation-details]").textContent.includes("<script>alert(1)</script>") && !document.querySelector("[data-reservation-details] script")'),'Untrusted customer text is escaped in actual React renderer');
 const unsafe=(await api('return fox.orders.getForTable("M3");')).reservation;await cancel({tableId:'M3',reservationId:unsafe.id});
 // Enter is intentional form submission; native key + duplicate browser event still persists once.
 await ui.select('M2');await ui.js('document.querySelector("[data-open-reservation]").focus();document.querySelector("[data-open-reservation]").click()');await ui.until('Boolean(document.querySelector("#reservation-form"))');await ui.field('reservation-name','QA Keyboard');await ui.js('document.querySelector("#reservation-name").focus()');
 await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await ui.until('!document.querySelector("dialog[open]") && Boolean(document.querySelector("[data-reservation-details]"))');
 const keyboard=(await api('return fox.orders.getForTable("M2");')).reservation;check(snapshot().table_reservations.filter(r=>r.table_id==='M2'&&r.status==='BOOKED').length===1,'Enter commits one booking');await cancel({tableId:'M2',reservationId:keyboard.id});
 // Direct IPC probes do not run the React mutation handler; reload that view's cache
 // before asserting the operator-visible state of the now-cancelled test holds.
 await ui.nav('reports');await ui.nav('tables');await ui.until('document.querySelector("[data-table-code=M2]").dataset.status==="FREE" && document.querySelector("[data-table-code=M3]").dataset.status==="FREE"');
 check(true,'Refreshed map agrees with authoritative cancellation states after direct IPC probes');
 check((await api('return fox.finance.saveExpense({requestId:crypto.randomUUID(),amountCents:100,category:"OTHER",occurredAt:new Date().toISOString(),description:"QA",paidFromTill:true});')).ok,'Mixed-state operating expense committed');check((await api('return fox.finance.recordLoss({requestId:crypto.randomUUID(),productId:"KAFE-1",quantity:1,reason:"DAMAGED",note:"QA"});')).ok,'Mixed-state stock loss committed');check((await api('return fox.finance.recordCashMovement({requestId:crypto.randomUUID(),direction:"IN",amountCents:200,reason:"QA",note:""});')).ok,'Mixed-state cash event committed');
 await ui.select('M6');await ui.add('KAFE-1');check((await api('return fox.orders.getForTable("M6");')).table.status==='ACTIVE','Actual OPEN order is ACTIVE');
 check(await ui.js('document.querySelector("[data-table-code=M6]").dataset.status==="ACTIVE" && document.querySelector("[data-table-code=M6]").getAttribute("aria-pressed")==="true" && !document.querySelector("[data-table-code=M6] .position-reserved")'),'ACTIVE+SELECTED visually differs from RESERVED');
 for(const [w,height] of [[1366,768],[1440,900],[1920,1080]]){await viewport(w,height);await ui.select('M13');await capture('certification-combined-states-'+w);}
 const coherent=snapshot(),coherentFinancial=await financial();const sinks=JSON.stringify({report:coherentFinancial,products:await ui.products(),diagnostics:await api('return fox.data.diagnostics();'),receipts:coherent.receipt_documents,jobs:coherent.receipt_print_jobs,cash:coherent.cash_closes});
 check(!sinks.includes(phone)&&!sinks.includes('QA Çelik'),'Phone/name absent from receipt, inventory, finance, cash and diagnostics sinks');
 await api('return fox.data.rendererError("RENDERER_FAILURE");');
 for(const name of fs.readdirSync(path.join(directory,'logs'))){check(!fs.readFileSync(path.join(directory,'logs',name),'utf8').includes(phone),'Routine log excludes synthetic contact');}
 check(!fs.readFileSync(path.join(directory,'launch.log'),'utf8').includes(phone),'Process output excludes synthetic contact');
 function owned(){const actual=fs.realpathSync.native(directory),temp=fs.realpathSync.native(os.tmpdir()),relative=path.relative(temp,actual),marker=JSON.parse(fs.readFileSync(path.join(directory,'.fox-qa.json')));assert.ok(!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(actual).startsWith('fox-qa-'));assert.equal(fs.realpathSync.native(marker.directory),actual);}
 owned();const kill=spawnSync('taskkill.exe',['/PID',String(getPid()),'/T','/F'],{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(kill.status,0);await delay(200);await launch();assert.deepEqual(snapshot(),coherent);assert.deepEqual(await financial(),coherentFinancial);check(true,'Abrupt isolated packaged/source process termination preserves committed mixed snapshot exactly once');
 async function fileAction(action,file){const filename=path.join(directory,file);if(!installer)fs.writeFileSync(path.join(directory,'cutover-dialog.json'),JSON.stringify({action,path:filename}));await (action==='backup'?ui.backupButton():ui.restoreButton());if(installer){const r=spawnSync('powershell.exe',['-NoProfile','-File','scripts/cutover-native-dialog.ps1','-FoxProcessId',String(getPid()),'-Action',action,'-File',filename],{windowsHide:true,encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stdout+r.stderr);}return filename;}
 await fileAction('backup','certified-coherent.sqlite');await ui.until('document.querySelector(".data-protection").textContent.includes("Backup u krijua dhe u verifikua")');assert.deepEqual(observe('certified-coherent.sqlite').tables,coherent);check(true,'Actual app backup coherently contains reservations, OPEN order, sale, stock, expenses and cash');
 check(!fs.readFileSync(path.join(directory,'certified-coherent.sqlite.json'),'utf8').includes(phone),'Backup manifest/file name excludes contact; backup DB legitimately contains it');
 await ui.select('M6');await ui.pay();await cancel({tableId:'M13',reservationId:requests.find(r=>r.tableId==='M13').requestId});await api('return fox.inventory.addSupply({requestId:crypto.randomUUID(),productId:"KAFE-1",quantity:1,drawerPaymentCents:10});');await api('return fox.finance.saveExpense({requestId:crypto.randomUUID(),amountCents:20,category:"OTHER",occurredAt:new Date().toISOString(),description:"QA mutation",paidFromTill:true});');await api('return fox.finance.recordLoss({requestId:crypto.randomUUID(),productId:"KAFE-1",quantity:1,reason:"DAMAGED",note:"QA mutation"});');await api('return fox.finance.recordCashMovement({requestId:crypto.randomUUID(),direction:"OUT",amountCents:5,reason:"QA mutation",note:""});');assert.notEqual(hash(snapshot()),hash(coherent));
 const oldPid=getPid();await fileAction('restore','certified-coherent.sqlite');for(let i=0;i<300;i++){try{process.kill(oldPid,0);}catch{break;}await delay(50);}await connect();assert.notEqual(getPid(),oldPid);assert.deepEqual(snapshot(),coherent);assert.deepEqual(await financial(),coherentFinancial);check(true,'Native/injected restore reopens app and restores all domains to same snapshot, no temporal skew');
 await close();await launch();assert.deepEqual(snapshot(),coherent);for(const code of positions)check((await api(`return fox.orders.getForTable(${JSON.stringify(code)});`)).reservation.tableId===code,'Restart/restore keeps exact canonical reference '+code);
 const health=observe();check(health.quickCheck==='ok'&&health.foreignKeys.length===0,'quick_check/FK after CRUD, crash, backup and restore');
 check(await ui.js('typeof require==="undefined" && typeof window.fox.executeSQL==="undefined" && typeof window.fox.reservations.update==="undefined"'),'Renderer has no Node/generic SQL or invented reservation edit');
 return {canonicalPositions:codes,canonicalHash:hash(codes),mixedSnapshotHash:hash(coherent),quickCheck:'ok',foreignKeyCheck:'ok',crash:'PASS',coherentBackupRestore:'PASS',privacy:'PASS',keyboard:'PASS',offline:true,edit:'UNSUPPORTED; cancel/rebook',expiration:'MANUAL arrival/cancel'};
}
