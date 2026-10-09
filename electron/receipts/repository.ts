import type Database from 'better-sqlite3';
import {logError} from '../main/logging';
import { createHash, randomUUID } from 'node:crypto';
import { NON_FISCAL_NOTICE, type ReceiptPayload, type ReceiptSettings, type PrintJob, type ReceiptState, type PrintKind } from '../../src/domain/receipts';

export const receiptHash = (json: string) => createHash('sha256').update(json, 'utf8').digest('hex');
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
export function validateReceiptAction(input: unknown): { saleId: string; requestId: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid receipt action');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['saleId','requestId'].includes(key)) || !validId(value.saleId) || typeof value.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)) throw Error('Invalid receipt action');
  return { saleId: value.saleId, requestId: value.requestId };
}
export function validatePayload(payload: ReceiptPayload): void {
  if (payload.schemaVersion !== 1 || payload.currency !== 'EUR' || !['SALE','TEST'].includes(payload.kind) || typeof payload.businessDisplayName !== 'string' || !payload.businessDisplayName.trim() || !Number.isFinite(Date.parse(payload.completedAt)) || payload.nonFiscalNotice !== NON_FISCAL_NOTICE || !Array.isArray(payload.items)) throw Error('Invalid receipt payload');
  if (payload.kind === 'SALE' && (!Number.isSafeInteger(payload.saleNumber) || payload.saleNumber! < 1 || !validId(payload.tableCode) || ![null,'CASH','CARD'].includes(payload.paymentMethod))) throw Error('Invalid receipt sale identity');
  let sum = 0n;
  for (const item of payload.items) {
    if (typeof item.name !== 'string' || !item.name.trim() || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0 || !Number.isSafeInteger(item.lineTotalCents) || BigInt(item.quantity)*BigInt(item.unitPriceCents) !== BigInt(item.lineTotalCents)) throw Error('Invalid receipt line');
    sum += BigInt(item.lineTotalCents);
  }
  if (!Number.isSafeInteger(payload.totalCents) || payload.totalCents < 0 || sum !== BigInt(payload.totalCents)) throw Error('Receipt total mismatch');
}
export function createReceiptRepository(db: Database.Database) {
  const jobs = (where: string, args: unknown[] = []) => db.prepare(`SELECT j.id,j.sale_id AS saleId,o.sale_number AS saleNumber,j.job_kind AS kind,j.status,j.last_error_code AS errorCode,j.created_at AS createdAt,j.attempt_count AS attemptCount FROM receipt_print_jobs j LEFT JOIN orders o ON o.id=j.sale_id ${where}`).all(...args) as PrintJob[];
  function settings(): ReceiptSettings {
    const device = JSON.parse((db.prepare("SELECT value FROM settings WHERE key='receipt_printer'").get() as {value:string}).value) as {deviceName:string;displayName:string}|null;
    const autoPrint = (db.prepare("SELECT value FROM settings WHERE key='receipt_auto_print'").get() as {value:string}).value === 'true';
    return { deviceName: device?.deviceName ?? null, displayName: device?.displayName ?? null, autoPrint, paperWidth:80, copies:1 };
  }
  function document(saleId: string, legacy = true) {
    if (!validId(saleId)) throw Error('Invalid sale');
    const stored = db.prepare('SELECT id,payload_json AS json,payload_hash AS hash FROM receipt_documents WHERE sale_id=?').get(saleId) as {id:string;json:string;hash:string}|undefined;
    if (stored) {
      if (receiptHash(stored.json) !== stored.hash) throw Error('Receipt hash mismatch');
      const payload = JSON.parse(stored.json) as ReceiptPayload; validatePayload(payload); return { ...stored, payload };
    }
    const sale = db.prepare(`SELECT o.sale_number AS saleNumber,o.closed_at AS completedAt,t.code AS tableCode,p.payment_method AS paymentMethod FROM orders o JOIN cafe_tables t ON t.id=o.table_id LEFT JOIN order_payments p ON p.order_id=o.id WHERE o.id=? AND o.status='CLOSED'`).get(saleId) as {saleNumber:number;completedAt:string;tableCode:string;paymentMethod:'CASH'|'CARD'|null}|undefined;
    if (!sale) throw Error('Receipt requires completed sale');
    const lines = db.prepare('SELECT product_name_snapshot AS name,quantity,unit_price_cents AS unitPriceCents FROM order_items WHERE order_id=? ORDER BY rowid').all(saleId) as {name:string;quantity:number;unitPriceCents:number}[];
    if (!lines.length) throw Error('Empty receipt');
    const items = lines.map(item => ({ ...item, lineTotalCents: Number(BigInt(item.quantity)*BigInt(item.unitPriceCents)) }));
    const total = db.prepare('SELECT SUM(quantity*unit_price_cents) AS total FROM order_items WHERE order_id=?').get(saleId) as {total:number};
    const business = (db.prepare("SELECT value FROM settings WHERE key='business_name'").get() as {value:string}).value;
    const payload: ReceiptPayload = { schemaVersion:1,kind:'SALE',...sale,businessDisplayName:business,items,totalCents:total.total,currency:'EUR',nonFiscalNotice:NON_FISCAL_NOTICE };
    validatePayload(payload);
    const json=JSON.stringify(payload),hash=receiptHash(json),id=randomUUID();
    db.prepare("INSERT INTO receipt_documents VALUES (?,?,1,'NON_FISCAL',?,?,?,?)").run(id,saleId,json,hash,Number(legacy),new Date().toISOString());
    return {id,json,hash,payload};
  }
  function enqueue(saleId: string | null, kind: PrintKind, requestId: string, testPayload?: ReceiptPayload): PrintJob {
    const config=settings(); if (!config.deviceName) throw Error('NO_PRINTER_CONFIGURED');
    const duplicate=jobs('WHERE j.id=?',[requestId])[0];
    if (duplicate) {if (duplicate.saleId!==saleId || duplicate.kind!==kind) throw Error('Duplicate request conflict');return duplicate;}
    const active=jobs(saleId ? "WHERE j.sale_id=? AND j.status IN ('PENDING','SUBMITTING')" : "WHERE j.job_kind='TEST' AND j.status IN ('PENDING','SUBMITTING')",saleId ? [saleId] : [])[0];
    if (active) return active;
    const doc=saleId ? document(saleId) : undefined;
    if (testPayload) validatePayload(testPayload);
    const now=new Date().toISOString();
    db.prepare(`INSERT INTO receipt_print_jobs (id,receipt_document_id,sale_id,job_kind,reason,printer_device_name,printer_display_name,status,test_payload_json,created_at,queued_at) VALUES (?,?,?,?,?,?,?,'PENDING',?,?,?)`).run(requestId,doc?.id??null,saleId,kind,kind==='ORIGINAL_AUTO'?'CHECKOUT':kind==='ORIGINAL_RETRY'?'OPERATOR_RETRY':kind==='COPY'?'OPERATOR_COPY':'PRINTER_SETUP',config.deviceName,config.displayName??config.deviceName,testPayload ? JSON.stringify(testPayload):null,now,now);
    return jobs('WHERE j.id=?',[requestId])[0]!;
  }
  return {
    settings, document,
    saveSettings(config: ReceiptSettings): void {
      db.transaction(()=>{
        db.prepare("UPDATE settings SET value=? WHERE key='receipt_printer'").run(JSON.stringify(config.deviceName ? {deviceName:config.deviceName,displayName:config.displayName}:null));
        db.prepare("UPDATE settings SET value=? WHERE key='receipt_auto_print'").run(String(config.autoPrint));
      }).immediate();
    },
    tested(deviceName: string): boolean { return !!db.prepare("SELECT 1 FROM receipt_print_jobs WHERE job_kind='TEST' AND printer_device_name=? AND status='SUBMITTED' LIMIT 1").get(deviceName); },
    onSaleCompleted(saleId: string): boolean {
      try { db.transaction(()=>{document(saleId,false);const config=settings();if(config.autoPrint&&config.deviceName)enqueue(saleId,'ORIGINAL_AUTO',randomUUID());})(); return true; }
      catch(error){ logError('RECEIPT_GENERATION',error);db.prepare("INSERT OR IGNORE INTO receipt_generation_errors VALUES (?,'RECEIPT_INTEGRITY_ERROR',?)").run(saleId,new Date().toISOString()); return false; }
    },
    enqueueCopy(input: unknown): PrintJob {const value=validateReceiptAction(input);return db.transaction(()=>enqueue(value.saleId,'COPY',value.requestId)).immediate();},
    retry(input: unknown): PrintJob {
      if (!validId(input)) throw Error('Invalid print job');
      return db.transaction(()=>{
        const old=jobs('WHERE j.id=?',[input])[0];if(!old||old.status!=='FAILED'||!['ORIGINAL_AUTO','ORIGINAL_RETRY'].includes(old.kind)||!old.saleId)throw Error('Only a known failed original can be retried');
        const row=db.prepare('SELECT printer_device_name FROM receipt_print_jobs WHERE id=?').get(input) as {printer_device_name:string};
        const config=settings();if(config.deviceName!==row.printer_device_name)throw Error('Use a copy for a different printer');
        // Retry the same durable intent. Active-job index prevents overlapping copies.
        db.prepare("UPDATE receipt_print_jobs SET status='PENDING',queued_at=?,job_kind='ORIGINAL_RETRY',reason='OPERATOR_RETRY',last_error_code=NULL,finished_at=NULL WHERE id=? AND status='FAILED'").run(new Date().toISOString(),input);
        return jobs('WHERE j.id=?',[input])[0]!;
      }).immediate();
    },
    enqueueTest(): PrintJob {
      return db.transaction(()=>enqueue(null,'TEST',randomUUID(),{schemaVersion:1,kind:'TEST',saleNumber:null,completedAt:new Date().toISOString(),tableCode:null,paymentMethod:null,businessDisplayName:'FOX KAFETERI',items:[],totalCents:0,currency:'EUR',nonFiscalNotice:NON_FISCAL_NOTICE})).immediate();
    },
    state(input: unknown): ReceiptState {
      if (!validId(input)||!db.prepare("SELECT 1 FROM orders WHERE id=? AND status='CLOSED'").get(input))throw Error('Invalid completed sale');
      return {saleId:input,jobs:jobs('WHERE j.sale_id=? ORDER BY j.rowid DESC',[input]),generationError:!!db.prepare('SELECT 1 FROM receipt_generation_errors WHERE sale_id=? AND NOT EXISTS (SELECT 1 FROM receipt_documents WHERE sale_id=?)').get(input,input)};
    },
    recentJobs:()=>jobs(`WHERE j.rowid IN (SELECT rowid FROM receipt_print_jobs ORDER BY rowid DESC LIMIT 30)
      OR (j.status IN ('FAILED','UNKNOWN','PENDING','SUBMITTING') AND j.sale_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM receipt_print_jobs newer WHERE newer.sale_id=j.sale_id AND newer.rowid>j.rowid))
      ORDER BY j.rowid DESC`),
    recover(): void {
      db.transaction(()=>{
        const now=new Date().toISOString();
        db.prepare("UPDATE receipt_print_attempts SET outcome='UNKNOWN',finished_at=?,error_code='UNKNOWN_AFTER_CRASH' WHERE outcome='SUBMITTING'").run(now);
        db.prepare("UPDATE receipt_print_jobs SET status='UNKNOWN',finished_at=?,last_error_code='UNKNOWN_AFTER_CRASH' WHERE status='SUBMITTING'").run(now);
      }).immediate();
    },
    claim() {
      return db.transaction(()=>{
        const job=jobs("WHERE j.status='PENDING' ORDER BY j.queued_at,j.rowid LIMIT 1")[0];if(!job)return null;
        const target=db.prepare('SELECT printer_device_name AS deviceName,test_payload_json AS testJson FROM receipt_print_jobs WHERE id=?').get(job.id) as {deviceName:string;testJson:string|null};
        const now=new Date().toISOString(),attemptId=randomUUID();
        db.prepare("UPDATE receipt_print_jobs SET status='SUBMITTING',started_at=?,attempt_count=attempt_count+1 WHERE id=? AND status='PENDING'").run(now,job.id);
        db.prepare("INSERT INTO receipt_print_attempts VALUES (?,?,?,?,NULL,'SUBMITTING',NULL)").run(attemptId,job.id,job.attemptCount+1,now);
        return {...job,...target,attemptId};
      }).immediate();
    },
    payload(job: {saleId:string|null;testJson:string|null}): ReceiptPayload {
      const payload=job.saleId ? document(job.saleId).payload : JSON.parse(job.testJson!) as ReceiptPayload;validatePayload(payload);return payload;
    },
    finish(job: {id:string;attemptId:string}, status: 'SUBMITTED'|'FAILED'|'UNKNOWN', code: string|null): void {
      db.transaction(()=>{
        const now=new Date().toISOString();
        db.prepare("UPDATE receipt_print_attempts SET outcome=?,finished_at=?,error_code=? WHERE id=? AND outcome='SUBMITTING'").run(status,now,code,job.attemptId);
        db.prepare("UPDATE receipt_print_jobs SET status=?,finished_at=?,submitted_at=CASE WHEN ?='SUBMITTED' THEN ? ELSE submitted_at END,last_error_code=? WHERE id=? AND status='SUBMITTING'").run(status,now,status,now,code,job.id);
      }).immediate();
    },
  };
}
export type ReceiptRepository = ReturnType<typeof createReceiptRepository>;
