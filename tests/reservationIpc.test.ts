import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {BrowserWindow,IpcMainInvokeEvent} from 'electron';
const handlers=vi.hoisted(()=>new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>());
vi.mock('electron',()=>({ipcMain:{handle:(channel:string,handler:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(channel,handler)}}));
import {registerIpc} from '../electron/ipc/register';import {RESERVATION_IPC} from '../src/types/api';
import type {createReservationService} from '../electron/database/reservations';
const contents={mainFrame:{}},reservations={reserve:vi.fn(),arrive:vi.fn(),cancel:vi.fn()},maintenance={isMaintenance:vi.fn(()=>false)};
const event=()=>({sender:contents,senderFrame:contents.mainFrame}) as unknown as IpcMainInvokeEvent;
beforeEach(()=>{handlers.clear();vi.clearAllMocks();maintenance.isMaintenance.mockReturnValue(false);registerIpc({webContents:contents} as unknown as BrowserWindow,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,maintenance as never,undefined,reservations as unknown as ReturnType<typeof createReservationService>);});
describe('reservation IPC authority',()=>{
 it.each(Object.values(RESERVATION_IPC))('protects %s against foreign windows, frames and wrong arity',channel=>{const handler=handlers.get(channel)!;expect(()=>handler({...event(),sender:{}} as IpcMainInvokeEvent,{})).toThrow('Unauthorized');expect(()=>handler({...event(),senderFrame:{}} as IpcMainInvokeEvent,{})).toThrow('Unauthorized');expect(()=>handler(event())).toThrow('Unauthorized');expect(()=>handler(event(),{},{})).toThrow('Unauthorized');expect(Object.values(reservations).every(f=>f.mock.calls.length===0)).toBe(true);});
 it('blocks all reservation writes during restore maintenance',()=>{maintenance.isMaintenance.mockReturnValue(true);for(const channel of Object.values(RESERVATION_IPC))expect(()=>handlers.get(channel)!(event(),{})).toThrow('MAINTENANCE');});
 it('routes booking through the validated service only',()=>{const input={tableId:'M5'};handlers.get(RESERVATION_IPC.reserve)!(event(),input);expect(reservations.reserve).toHaveBeenCalledWith(input);expect(reservations.reserve).toHaveBeenCalledOnce();});
});
