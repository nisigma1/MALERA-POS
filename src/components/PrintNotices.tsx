import { useEffect, useRef, useState } from 'react';
import { formatSaleNumber } from '../domain/display';
import type { PrintJob } from '../domain/receipts';
import { Button } from './ui';
export function PrintNotices(){
  const [jobs,setJobs]=useState<PrintJob[]>([]),[dismissed,setDismissed]=useState<string[]>([]),[message,setMessage]=useState('');
  const lock=useRef(false);
  useEffect(()=>{let live=true;const read=()=>window.fox.receipts.recentJobs().then(value=>{if(live)setJobs(value);}).catch(()=>{if(live)setMessage('Statusi i kuponëve nuk mund të lexohet. Shitjet mbeten të ruajtura.');});void read();const timer=setInterval(()=>void read(),1500);return()=>{live=false;clearInterval(timer);};},[]);
  const job=jobs.find(j=>j.saleId&&['FAILED','UNKNOWN'].includes(j.status)&&!dismissed.includes(j.id+':'+j.attemptCount));
  async function recover(){if(!job||lock.current)return;lock.current=true;setMessage('');try{const result=job.status==='FAILED'&&['ORIGINAL_AUTO','ORIGINAL_RETRY'].includes(job.kind)?await window.fox.receipts.retry(job.id):await window.fox.receipts.printCopy({saleId:job.saleId!,requestId:crypto.randomUUID()});setMessage(result.ok?'Kërkesa për kuponin u ruajt.':result.message);if(result.ok)setDismissed(value=>[...value,job.id+':'+job.attemptCount]);}catch{setMessage('Kërkesa nuk u krye. Kontrollo statusin te Raportet.');}finally{lock.current=false;}}
  if(!job&&!message)return null;
  return <aside className="print-notice" aria-label="Njoftim për kuponin"><p role="status">{job&&<>Shitja {formatSaleNumber(job.saleNumber!)} u përfundua. {job.status==='UNKNOWN'?'Statusi i printimit nuk mund të konfirmohet.':'Kuponi nuk u dërgua në printer.'}</>}{message&&<> {message}</>}</p>{job&&<><Button variant="secondary" onClick={()=>void recover()}>{job.status==='FAILED'&&['ORIGINAL_AUTO','ORIGINAL_RETRY'].includes(job.kind)?'Riprovo kuponin':'Printo kopje'}</Button><Button variant="ghost" onClick={()=>{setDismissed(value=>[...value,job.id+':'+job.attemptCount]);setMessage('');}}>Mbyll</Button></>}</aside>;
}
