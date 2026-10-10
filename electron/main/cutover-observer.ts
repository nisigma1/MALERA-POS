// Read-only developer evidence; cannot open interactive userData or modify any DB.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {assertQaDirectory} from '../database/safety';
import {inspectDatabase} from '../database/health';
import {createRepositories} from '../database/repositories';
import {productReadiness} from '../../src/domain/readiness';
import {validateBackup} from '../database/backups';
async function run(){
 const [directory,relative='fox.sqlite',version]=process.argv.slice(2);assertQaDirectory(directory!);
 const filename=path.resolve(directory!,relative),rel=path.relative(fs.realpathSync.native(directory!),fs.realpathSync.native(filename));
 if(rel.startsWith('..')||path.isAbsolute(rel)||path.extname(filename)!=='.sqlite')throw Error('Observer target outside isolated directory');
 const manifest=relative==='fox.sqlite'?null:await validateBackup(filename);
 const db=new Database(filename,{readonly:true,fileMustExist:true});
 try{
  const schemaVersion=inspectDatabase(db,true),repositories=createRepositories(db),products=repositories.listProducts(),active=products.filter(p=>p.active),ready=productReadiness(products);
  const tables=Object.fromEntries((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));
  let lastBackup=null;try{lastBackup=JSON.parse(fs.readFileSync(path.join(directory!,'fox-last-backup.json'),'utf8')).createdAt;}catch{}
  const summary={version,schemaVersion,activeProductCount:active.length,pricedProductCount:active.filter(p=>p.sellingPriceCents!==null).length,missingPrices:ready.missingPrices,trackedProductCount:active.filter(p=>p.trackInventory===true).length,untrackedProductCount:active.filter(p=>p.trackInventory===false).length,unconfiguredInventoryCount:active.filter(p=>p.trackInventory===null).length,trackedStockConfiguredCount:active.filter(p=>p.trackInventory===true&&p.stockQuantity!==null).length,missingCosts:ready.missingCosts,blockerCount:ready.missingPrices+ready.missingStockConfiguration,warningCount:ready.missingCosts+ready.missingThresholds+ready.outOfStock,readiness:ready.configured?'READY FOR GO-LIVE':'NOT READY',databaseHealth:'PASS',lastSuccessfulBackup:lastBackup};
  console.log(JSON.stringify({tables,products,report:repositories.getSalesReport('ALL'),summary,manifest,quickCheck:db.pragma('quick_check',{simple:true}),foreignKeys:db.pragma('foreign_key_check')}));
 }finally{db.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
