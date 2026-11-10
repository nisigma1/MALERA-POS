import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openDatabase} from '../../electron/database/connection';
import {configure,sale,snapshot,digest,assertAll} from '../../tests/support/reliability';
const [directory,mode]=process.argv.slice(2);
const filename=path.join(directory!,'fox.sqlite'),expected=path.join(directory!,'expected.json');
if(mode==='prepare'){
 const db=openDatabase(filename);configure(db,100,50,300);sale(db);assertAll(db);
 fs.writeFileSync(expected,JSON.stringify({hash:digest(snapshot(db))}));
 // Deliberately leave the durable WAL/SHM as a killed last client would.
 process.exit(0);
}else if(mode==='unpatched'){
 assert.throws(()=>openDatabase(filename),{code:'SQLITE_IOERR_TRUNCATE'});
 console.log(JSON.stringify({expectedFailure:true,code:'SQLITE_IOERR_TRUNCATE'}));
}else{
 const db=openDatabase(filename);assert.equal(digest(snapshot(db)),JSON.parse(fs.readFileSync(expected,'utf8')).hash);assertAll(db);
 sale(db);const finance=assertAll(db);assert.equal(finance.revenue,200);
 db.close();const reopened=openDatabase(filename);assertAll(reopened);reopened.close();
 console.log(JSON.stringify({passed:true,exactState:true,continued:true,revenueCents:200}));
}
