import {useEffect,useState} from 'react';
import {Button} from './ui';
import type {DataDiagnostics,DataActionResult} from '../domain/protection';
export function DataProtectionPanel(){
  const [data,setData]=useState<DataDiagnostics>(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const refresh=()=>window.fox.data.diagnostics().then(setData).catch(()=>setMessage('Diagnostika nuk mund të lexohet.'));
  useEffect(()=>{void refresh();},[]);
  async function action(operation:()=>Promise<DataActionResult>){if(busy)return;setBusy(true);setMessage('');try{const result=await operation();setMessage(result.message);await refresh();}catch{setMessage('Veprimi nuk u përfundua. Të dhënat ekzistuese janë ruajtur.');}finally{setBusy(false);}}
  return <section className="settings-panel data-protection"><h2>Të dhënat</h2><p>Ruaj backup-in dhe skedarin shoqërues në një vend të sigurt, mundësisht në USB.</p><p>Backup i fundit: {data?.lastBackup?new Date(data.lastBackup.createdAt).toLocaleString('sq-AL'):'Nuk është krijuar'}</p><div className="receipt-settings-actions"><Button disabled={busy} onClick={()=>void action(window.fox.data.backup)}>Krijo backup</Button><Button variant="secondary" disabled={busy} onClick={()=>void action(window.fox.data.restore)}>Rikthe nga backup</Button><Button variant="secondary" disabled={busy} onClick={()=>void action(window.fox.data.copyDiagnostics)}>Kopjo diagnostikën</Button></div>{busy&&<p role="status">Duke kryer veprimin…</p>}{message&&<p role="status">{message}</p>}{data&&<><p>Databaza: Në rregull · Versioni: {data.version} · Schema: {data.schemaVersion}</p><p>Produkte pa çmim: {data.missingPrices} · Pa konfigurim stoku: {data.missingStockConfiguration} · Pa kosto: {data.missingCosts}</p></>}</section>;
}
