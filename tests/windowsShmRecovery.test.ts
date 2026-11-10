import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
it('Windows recovery tolerates a lingering external SHM mapping without losing committed history',()=>{
 const result=spawnSync(process.execPath,['scripts/qa/verify-windows-shm.mjs'],{encoding:'utf8',windowsHide:true,timeout:25000});
 expect(result.status,result.stderr).toBe(0);
 expect(JSON.parse(result.stdout.trim())).toMatchObject({passed:true,exactState:true,continued:true,revenueCents:200});
 // This native integration creates two Electron processes and a real Windows
 // mapping helper. Its own bounded barriers remain 10s/15s, not test retries.
},30000);
