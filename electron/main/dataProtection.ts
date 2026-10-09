import {app, clipboard, dialog, type BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {backupName, createBackup, validateBackup, assertDestination, durableWrite} from '../database/backups';
import {inspectDatabase} from '../database/health';
import {replaceDatabase} from '../database/restore';
import {logError} from './logging';
import type {DataActionResult, DataDiagnostics} from '../../src/domain/protection';

export function createDataProtection(window:BrowserWindow, db:Database.Database, stop:()=>void) {
  const directory=path.dirname(db.name), history=path.join(directory,'fox-last-backup.json');
  let busy=false, maintenance=false;
  function lastBackup():DataDiagnostics['lastBackup'] {try { const record=JSON.parse(fs.readFileSync(history,'utf8')) as {createdAt:string;path:string}; if(typeof record.path==='string'&&Number.isFinite(Date.parse(record.createdAt)))return record; }catch{} return null; }
  function remember(filename:string,createdAt:string) {const stage=history+'.next';if(fs.existsSync(stage))fs.unlinkSync(stage);durableWrite(stage,JSON.stringify({createdAt,path:filename}));fs.renameSync(stage,history);}
  function diagnostics():DataDiagnostics {
    const readiness=db.prepare(`SELECT SUM(CASE WHEN active=1 AND selling_price_cents IS NULL THEN 1 ELSE 0 END) AS prices,
      SUM(CASE WHEN active=1 AND purchase_cost_cents IS NULL THEN 1 ELSE 0 END) AS costs,
      SUM(CASE WHEN active=1 AND (track_inventory IS NULL OR (track_inventory=1 AND b.quantity IS NULL)) THEN 1 ELSE 0 END) AS stock
      FROM products p LEFT JOIN inventory_balances b ON p.id=b.product_id`).get() as {prices:number;costs:number;stock:number};
    let signing:'SIGNED'|'UNSIGNED'='UNSIGNED';
    try {const metadata=JSON.parse(fs.readFileSync(path.join(process.resourcesPath,'fox-release.json'),'utf8')) as {signing?:string};if(metadata.signing==='SIGNED')signing='SIGNED';}catch{}
    return {version:app.getVersion(),schemaVersion:inspectDatabase(db),databaseStatus:'OK',databasePath:db.name,userDataPath:directory,architecture:process.arch,platform:process.platform,signing,lastBackup:lastBackup(),missingPrices:readiness.prices,missingCosts:readiness.costs,missingStockConfiguration:readiness.stock};
  }
  async function run(action:()=>Promise<DataActionResult>):Promise<DataActionResult>{
    if(busy)return {ok:false,message:'Një veprim me të dhënat është duke u kryer.'};busy=true;
    try{return await action();}catch(error){logError('DATA_PROTECTION',error);return {ok:false,message:'Veprimi nuk u përfundua. Të dhënat ekzistuese janë ruajtur. Kontrollo diagnostikën.'};}
    finally{busy=false;}
  }
  return {
    isBusy:()=>busy,
    whenIdle:async()=>{const deadline=Date.now()+30000;while(busy){if(Date.now()>deadline)throw Error('FOX_BACKUP_SHUTDOWN_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,50));}},
    isMaintenance:()=>maintenance,
    diagnostics,
    copyDiagnostics:()=>{clipboard.writeText(JSON.stringify(diagnostics(),null,2));return {ok:true,message:'Diagnostika u kopjua.'};},
    rendererError:(input:unknown)=>{if(input!=='RENDERER_FAILURE')throw Error('FOX_DIAGNOSTIC_INPUT');logError('RENDERER_FAILURE');return {ok:true,message:''};},
    backup:()=>run(async()=>{
      const selected=await dialog.showSaveDialog(window,{title:'Krijo backup',defaultPath:path.join(app.getPath('documents'),backupName('Backup')),filters:[{name:'FOX backup',extensions:['sqlite']}],properties:['showOverwriteConfirmation']});
      if(selected.canceled||!selected.filePath)return {ok:false,cancelled:true,message:''};
      const installRoot=app.isPackaged?path.dirname(app.getPath('exe')):app.getAppPath();
      assertDestination(selected.filePath,db.name,installRoot);
      const result=await createBackup(db,selected.filePath,app.getVersion());remember(selected.filePath,result.createdAt);
      return {ok:true,message:'Backup u krijua dhe u verifikua.'};
    }),
    restore:()=>run(async()=>{
      const selected=await dialog.showOpenDialog(window,{title:'Zgjidh backup për rikthim',filters:[{name:'FOX backup',extensions:['sqlite']}],properties:['openFile']});
      if(selected.canceled||!selected.filePaths[0])return {ok:false,cancelled:true,message:''};
      const file=selected.filePaths[0],manifest=await validateBackup(file);
      if((db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='OPEN'").get() as {n:number}).n)return {ok:false,message:'Përfundo porositë e hapura para rikthimit.'};
      const confirmation=await dialog.showMessageBox(window,{type:'warning',title:'Rikthe nga backup',message:'Rikthimi do ta zëvendësojë gjendjen aktuale.',detail:`Backup: ${new Date(manifest.createdAt).toLocaleString('sq-AL')}\nFOX do të krijojë një backup sigurie para rikthimit. Aplikacioni do të riniset.`,buttons:['Anulo','Rikthe backup-in'],defaultId:0,cancelId:0,noLink:true});
      if(confirmation.response!==1)return {ok:false,cancelled:true,message:''};
      maintenance=true;
      try {await replaceDatabase(db,file,directory,app.getVersion(),stop);app.relaunch();setImmediate(()=>app.exit(0));return {ok:true,message:'Backup-i u rikthye dhe u verifikua. FOX po riniset.'};}
      catch(error){if(!db.open){app.relaunch();setImmediate(()=>app.exit(1));}else maintenance=false;throw error;}
    }),
  };
}
export type DataProtectionService=ReturnType<typeof createDataProtection>;
