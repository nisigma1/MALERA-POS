import fs from 'node:fs';
import path from 'node:path';
let directory: string | undefined;
export function initializeLogging(userData: string): void { directory = path.join(userData, 'logs'); fs.mkdirSync(directory, {recursive:true}); }
export function logError(event: string, error?: unknown): void {
  if (!directory) return;
  try {
    const filename = path.join(directory, 'fox.log');
    if (fs.existsSync(filename) && fs.statSync(filename).size >= 256 * 1024) {
      const oldest = path.join(directory, 'fox.4.log'); if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
      for (let i=3;i>=1;i--) { const source=path.join(directory, `fox.${i}.log`); if(fs.existsSync(source))fs.renameSync(source,path.join(directory,`fox.${i+1}.log`)); }
      fs.renameSync(filename,path.join(directory,'fox.1.log'));
    }
    const candidate = error instanceof Error ? error.message : '';
    // Only application-owned diagnostic codes: never arbitrary messages, arguments, SQL or secrets.
    const code = /^FOX_[A-Z0-9_]{1,80}$/.test(candidate) ? candidate : 'UNEXPECTED_ERROR';
    fs.appendFileSync(filename, JSON.stringify({time:new Date().toISOString(),severity:'ERROR',event:event.replace(/[^A-Z0-9_]/g,'').slice(0,80),code,errorType:error instanceof Error?error.name:'Unknown'})+'\n');
  } catch { /* A logging disk failure cannot initiate destructive recovery or mask the original failure. */ }
}
