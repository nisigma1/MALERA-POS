import { useEffect, useState } from 'react';
import { Button } from './ui';
import { PRINT_STATUS_LABELS, type Printer, type ReceiptSettings, type PrintJob } from '../domain/receipts';
export function ReceiptSettingsPanel() {
  const [config,setConfig]=useState<ReceiptSettings>();
  const [printers,setPrinters]=useState<Printer[]>([]);
  const [device,setDevice]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [test,setTest]=useState<PrintJob>();
  async function refresh(){
    try{const result=await window.fox.receipts.listPrinters();if(result.ok)setPrinters(result.data);else setMessage(result.message);}catch{setMessage('Printerët nuk mund të lexohen. Provo përsëri.');}
  }
  useEffect(()=>{let live=true;window.fox.receipts.getSettings().then(value=>{if(live){setConfig(value);setDevice(value.deviceName??'');}}).catch(()=>{if(live)setMessage('Cilësimet e printerit nuk mund të lexohen.');});void refresh();return()=>{live=false;};},[]);
  useEffect(()=>{if(!test||!['PENDING','SUBMITTING'].includes(test.status))return;let live=true;const timer=setInterval(()=>{window.fox.receipts.recentJobs().then(jobs=>{const job=jobs.find(j=>j.id===test.id);if(live&&job)setTest(job);}).catch(()=>{});},1000);return()=>{live=false;clearInterval(timer);};},[test]);
  async function save(autoPrint:boolean){
    if(busy)return;setBusy(true);setMessage('');
    try{const result=await window.fox.receipts.saveSettings({deviceName:device||null,autoPrint,paperWidth:80,copies:1});if(!result.ok)setMessage(result.message);else if(!result.data.saved)setMessage(result.data.message);else{setConfig(result.data.settings);setMessage('Cilësimet u ruajtën.');}}
    catch{setMessage('Cilësimet nuk u ruajtën.');}finally{setBusy(false);}
  }
  async function printTest(){
    if(busy)return;setBusy(true);setMessage('');
    try{const result=await window.fox.receipts.testPrint();if(result.ok)setTest(result.data);else setMessage(result.message);}catch{setMessage('Testi nuk u dërgua.');}finally{setBusy(false);}
  }
  const savedDevice=device===(config?.deviceName??'');
  const missing=config?.deviceName&&!printers.some(p=>p.deviceName===config.deviceName);
  return <section className="settings-panel receipt-settings"><h2>Kuponët</h2><p>Kupon jo-fiskal · 80 mm · 1 kopje</p><label>Printeri i kuponit<select aria-label="Printeri i kuponit" value={device} onChange={event=>{setDevice(event.target.value);setTest(undefined);setMessage('');}} disabled={busy}><option value="">Pa printer</option>{missing&&<option value={config.deviceName!}>{config.displayName} — nuk u gjet</option>}{printers.map(printer=><option key={printer.deviceName} value={printer.deviceName}>{printer.displayName}</option>)}</select></label><div className="receipt-settings-actions"><Button variant="secondary" onClick={()=>void refresh()} disabled={busy}>Rifresko printerët</Button><Button variant="secondary" onClick={()=>void save(false)} disabled={busy}>Ruaj printerin</Button><Button variant="secondary" onClick={()=>void printTest()} disabled={busy||!device||!savedDevice||Boolean(test&&['PENDING','SUBMITTING'].includes(test.status))}>Testo printerin</Button></div><label className="receipt-auto"><input type="checkbox" checked={config?.autoPrint??false} disabled={busy||!savedDevice||!device} onChange={event=>void save(event.target.checked)}/>Printim automatik pas pagesës</label><p>Zgjidh printerin, ruaje dhe testo printimin para aktivizimit automatik. Kontrollo kuponin në letër.</p>{missing&&<p className="notice">Printeri i zgjedhur nuk u gjet. Shitjet mund të vazhdojnë.</p>}{test&&<p role="status">Testi: {PRINT_STATUS_LABELS[test.status]}.{test.status==='SUBMITTED'&&' U dërgua në printer; kontrollo ë, ç dhe € në kupon.'}{test.status==='UNKNOWN'&&' Nuk mund të konfirmohet nëse Windows e mori kërkesën.'}</p>}{message&&<p role="status">{message}</p>}</section>;
}
