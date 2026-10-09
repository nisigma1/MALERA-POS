import { BrowserWindow } from 'electron';
import type { PrinterAdapter } from './manager';
import { PrintError } from './manager';
import { RECEIPT_PROFILE } from '../../src/domain/receipts';

export class WindowsPrinterAdapter implements PrinterAdapter {
  constructor(private readonly discoveryWindow: BrowserWindow) {}
  async list() {
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return(await Promise.race([this.discoveryWindow.webContents.getPrintersAsync(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new PrintError('PRINTER_DISCOVERY_FAILED')),10000);})])).map(p=>({deviceName:p.name,displayName:p.displayName||p.name,description:p.description}));}
    catch{throw new PrintError('PRINTER_DISCOVERY_FAILED');}
    finally{if(timer)clearTimeout(timer);}
  }
  async submit(html: string, deviceName: string, signal: AbortSignal): Promise<void> {
    if(!deviceName.trim())throw new PrintError('INVALID_PRINTER');
    if(signal.aborted)throw new PrintError('PRINT_CANCELLED');
    const window=new BrowserWindow({show:false,useContentSize:true,width:Math.ceil(RECEIPT_PROFILE.paperWidthMm*96/25.4),height:600,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'fox-receipt-renderer',backgroundThrottling:false}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.webContents.on('will-attach-webview',event=>event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    window.webContents.session.setPermissionCheckHandler(()=>false);
    window.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('data:text/html;charset=utf-8,')}));
    let invoked=false;
    const abort=()=>{if(!window.isDestroyed())window.destroy();};signal.addEventListener('abort',abort,{once:true});
    try{
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      if(signal.aborted)throw new PrintError('PRINT_TIMEOUT');
      const height=await window.webContents.executeJavaScript("document.fonts.ready.then(()=>Math.ceil(document.querySelector('main').getBoundingClientRect().height+2*parseFloat(getComputedStyle(document.body).paddingTop)))") as number;
      if(!Number.isFinite(height)||height<1||height>100000)throw new PrintError('RENDER_FAILED');
      if(signal.aborted)throw new PrintError('PRINT_TIMEOUT');
      await new Promise<void>((resolve,reject)=>{
        const interrupted=()=>reject(new PrintError('PRINT_TIMEOUT',invoked));
        signal.addEventListener('abort',interrupted,{once:true});
        const done=(error?:PrintError)=>{signal.removeEventListener('abort',interrupted);error?reject(error):resolve();};
        try{
          invoked=true;
          window.webContents.print({silent:true,deviceName,color:false,printBackground:false,copies:1,margins:{marginType:'none'},header:'',footer:'',pageSize:{width:RECEIPT_PROFILE.paperWidthMm*1000,height:Math.max(50000,Math.ceil(height*25400/96)+3000)}},(success)=>done(success?undefined:new PrintError('SPOOLER_REJECTED')));
        }catch{done(new PrintError('PRINT_CALL_FAILED',invoked));}
      });
    }catch(error){if(error instanceof PrintError)throw error;throw new PrintError(invoked?'PRINT_CALL_FAILED':'WINDOW_LOAD_FAILED',invoked);}
    finally{signal.removeEventListener('abort',abort);if(!window.isDestroyed())window.destroy();}
  }
}
