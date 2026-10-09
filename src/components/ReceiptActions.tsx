import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';
import { PRINT_STATUS_LABELS, type ReceiptState } from '../domain/receipts';
export function ReceiptActions({saleId}:{saleId:string}) {
  const [state,setState]=useState<ReceiptState>();
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  useEffect(()=>{let live=true;const read=()=>window.fox.receipts.getState(saleId).then(result=>{if(live){if(result.ok)setState(result.data);else setMessage(result.message);}}).catch(()=>{if(live)setMessage('Statusi i kuponit nuk mund të lexohet.');});void read();const timer=setInterval(()=>void read(),1500);return()=>{live=false;clearInterval(timer);};},[saleId]);
  async function action(retryId?:string){
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
    try{const result=retryId?await window.fox.receipts.retry(retryId):await window.fox.receipts.printCopy({saleId,requestId:crypto.randomUUID()});setMessage(result.ok?'Kërkesa u ruajt.':result.message);if(result.ok){const updated=await window.fox.receipts.getState(saleId);if(updated.ok)setState(updated.data);}}
    catch{setMessage('Kërkesa nuk u krye. Kontrollo statusin para se të provosh përsëri.');}finally{lock.current=false;setBusy(false);}
  }
  const latest=state?.jobs[0],pending=state?.jobs.some(job=>['PENDING','SUBMITTING'].includes(job.status));
  return <div className="receipt-actions"><span>Kuponi: {latest?PRINT_STATUS_LABELS[latest.status]:'Nuk u kërkua'}{state?.generationError&&' · Dokumenti nuk mund të krijohej'}</span>{latest?.status==='FAILED'&&['ORIGINAL_AUTO','ORIGINAL_RETRY'].includes(latest.kind)&&<Button variant="secondary" disabled={busy||pending} onClick={()=>void action(latest.id)}>Riprovo kuponin</Button>}<Button variant="secondary" disabled={busy||pending} onClick={()=>void action()}>Printo kopje</Button>{latest?.status==='UNKNOWN'&&<p>Nuk mund të konfirmohet statusi i printimit. Një kërkesë e re do të shënohet KOPJE.</p>}{message&&<p role="status">{message}</p>}</div>;
}
