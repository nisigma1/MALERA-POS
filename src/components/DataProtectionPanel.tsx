import {useEffect,useRef,useState} from 'react';
import {Button} from './ui';
import {formatLocalDateTime} from '../domain/display';
import {productReadiness} from '../domain/readiness';
import type {DataDiagnostics,DataActionResult} from '../domain/protection';
export function DataProtectionPanel(){
  const [data,setData]=useState<DataDiagnostics>(),[readiness,setReadiness]=useState<ReturnType<typeof productReadiness>>(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const lock=useRef(false);
  const refresh=()=>Promise.all([window.fox.data.diagnostics(),window.fox.products.list()]).then(([diagnostics,products])=>{setData(diagnostics);setReadiness(productReadiness(products));}).catch(()=>setMessage('Gjendja nuk mund të lexohet. Provo përsëri.'));
  useEffect(()=>{void refresh();},[]);
  async function action(operation:()=>Promise<DataActionResult>,restarting=false){if(lock.current)return;lock.current=true;setBusy(true);setMessage('');try{const result=await operation();setMessage(result.message);if(!(restarting&&result.ok))await refresh();}catch{setMessage('Veprimi nuk u konfirmua. Kontrollo gjendjen te Cilësimet para se ta provosh përsëri.');}finally{lock.current=false;setBusy(false);}}
  return <><section className="settings-panel readiness-panel"><h2>Gati për shitje</h2>{readiness?<>
    <p role="status"><strong>{readiness.configured?'Gati për fillimin e punës':'Nuk është gati për fillimin e punës'}</strong></p>
    <p>{readiness.configured?'Çmimet dhe stoku janë gati.':'Plotëso këto të dhëna te Stoku për produktet aktive:'}</p>
    <dl className="readiness-counts"><div><dt>Produkte pa çmim</dt><dd>{readiness.missingPrices}</dd></div><div><dt>Stok pa konfiguruar</dt><dd>{readiness.missingStockConfiguration}</dd></div></dl>
    {readiness.outOfStock>0&&<p className="notice">Pa stok: {readiness.outOfStock} produkte. Furnizoji për t'i shitur.</p>}
    <p>Pa kosto: {readiness.missingCosts} · Pa prag stoku: {readiness.missingThresholds}</p><p className="field-helper">Kostoja ndihmon llogaritjen e fitimit; pragu është opsional. Asnjëra nuk bllokon shitjen.</p>
  </>:<p>Gjendja e konfigurimit nuk është ende e disponueshme.</p>}</section>
  <section className="settings-panel data-protection"><h2>Të dhënat</h2><p>Ruaj backup-in dhe skedarin shoqërues në një vend të sigurt, mundësisht në USB.</p><p>Backup i fundit: {data?.lastBackup?formatLocalDateTime(data.lastBackup.createdAt):'Nuk është krijuar'}</p><div className="receipt-settings-actions"><Button disabled={busy} onClick={()=>void action(window.fox.data.backup)}>Krijo backup</Button><Button variant="secondary" disabled={busy} onClick={()=>void action(window.fox.data.restore,true)}>Rikthe nga backup</Button></div>{busy&&<p role="status">Duke kryer veprimin…</p>}{message&&<p role="status">{message}</p>}{data&&<details className="diagnostics"><summary>Gjendja dhe diagnostika</summary><p>Të dhënat: Në rregull · FOX {data.version}</p><dl><dt>Versioni i të dhënave</dt><dd>{data.schemaVersion}</dd><dt>Pajisja</dt><dd>{data.platform} / {data.architecture}</dd><dt>Nënshkrimi i aplikacionit</dt><dd>{data.signing==='SIGNED'?'I nënshkruar':'Në pritje të nënshkrimit'}</dd><dt>Vendndodhja e të dhënave</dt><dd>Në këtë pajisje</dd></dl><Button disabled={busy} onClick={()=>void action(window.fox.data.copyDiagnostics)}>Kopjo diagnostikën</Button></details>}</section></>;
}
