import { Fragment, useCallback, useState } from 'react';
import {localDate,type FinanceQuery} from '../domain/finance';
import {CashControl,ExpenseList,LossHistory} from '../components/OwnerFinance';
import { useData } from '../app/useData';

import { DataState } from '../components/DataState';

import { formatLocalDateTime, formatSaleNumber } from '../domain/display';
import { formatMoney } from '../domain/money';

import { EmptyState, PageHeader } from '../components/ui';
import { ReceiptActions } from '../components/ReceiptActions';



export function Reports() {

  const [query,setQuery]=useState<FinanceQuery>({period:'ALL'});
  const [tab,setTab]=useState<'overview'|'expenses'|'cash'>('overview');
  const [startDate,setStartDate]=useState(localDate()),[endDate,setEndDate]=useState(localDate());
  const [expandedSale, setExpandedSale] = useState<string>();
  const load = useCallback(() => window.fox.finance.report(query), [query]);
  const { data: finance, error, retry, setData } = useData(load);
  const refreshFinance=()=>{void load().then(setData).catch(()=>retry());};
  const report=finance?.sales;
  const data = report?.summary;

  const header = <><PageHeader title="Raportet" helper="Kontrolli i biznesit · për pronarin." actions={<label className="report-filter">Periudha<select aria-label="Periudha e raportit" value={query.period} onChange={e => setQuery(e.target.value==='CUSTOM'?{period:'CUSTOM',startDate,endDate}:{period:e.target.value as FinanceQuery['period']})}><option value="TODAY">Sot</option><option value="WEEK">Këtë javë</option><option value="MONTH">Këtë muaj</option><option value="CUSTOM">Periudhë tjetër</option><option value="ALL">Të gjitha</option></select></label>}/>{query.period==='CUSTOM'&&<form className="finance-period" onSubmit={e=>{e.preventDefault();setQuery({period:'CUSTOM',startDate,endDate});}}><label>Nga<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label><label>Deri më<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label><button className="button button-secondary" type="submit">Shfaq periudhën</button></form>}<div className="finance-tabs" role="group" aria-label="Kontrolli financiar">{([['overview','Përmbledhja'],['expenses','Shpenzimet'],['cash','Mbyllja e arkës']] as const).map(([id,label])=><button className="button button-secondary" key={id} aria-pressed={tab===id} data-finance-tab={id} onClick={()=>setTab(id)}>{label}</button>)}</div></>;
  if (!data) return <>{header}<DataState error={error} retry={retry}/></>;

  const metrics = [

    ['Shitjet totale', formatMoney(data.salesCents)], ['Kosto e mallit', data.costCents === null ? '—' : formatMoney(data.costCents)],

    ['Fitimi bruto', data.grossProfitCents === null ? '—' : formatMoney(data.grossProfitCents)], ['Shpenzime të regjistruara', formatMoney(data.expensesCents)],
    ['Humbja e mallit', finance!.stockLossCents===null?'—':formatMoney(finance!.stockLossCents)], ['Rezultati operativ', finance!.operatingResultCents===null?'—':formatMoney(finance!.operatingResultCents)],
    ['Porosi të përfunduara', data.completedOrders], ['Produktet e shitura', data.productsSold], ['Mesatarja për porosi', data.averageOrderCents === null ? '—' : formatMoney(data.averageOrderCents)],
  ] as const;

  return <div data-page="reports">

    {header}<div className="report-period">{query.period==='ALL'?'Të gjitha regjistrimet':`${finance!.startDate} — ${finance!.endDate}`}</div>
    {tab==='expenses'?<ExpenseList report={finance!} onRefresh={refreshFinance}/>:tab==='cash'?<CashControl report={finance!} onRefresh={refreshFinance}/>:<>
    <dl className="report-kpis">{metrics.slice(0,6).map(([label, value]) => <div key={label} className={label==='Rezultati operativ'?'finance-result':''}><dt>{label}</dt><dd className={label==='Rezultati operativ'&&finance!.operatingResultCents!==null&&finance!.operatingResultCents<0?'finance-negative':''}>{value}</dd>{label==='Rezultati operativ'&&<small>{finance!.operatingResultCents===null?'Kosto të paplota':finance!.operatingResultCents<0?'Humbje':finance!.operatingResultCents>0?'Rezultat pozitiv':'Në baraspeshë'}</small>}</div>)}</dl>
    <p className="field-helper">Rezultati përfshin vetëm shpenzimet dhe humbjet e regjistruara. Regjistro të gjitha që të marrësh pasqyrën e biznesit; ky nuk është fitimi neto tatimor.</p>
    {finance!.missingLossCosts>0&&<p className="notice warning-notice">{finance!.missingLossCosts} humbje kanë kosto të panjohur. Rezultati operativ nuk mund të llogaritet plotësisht.</p>}
    {data.completedOrders === 0 && <div className="report-empty"><EmptyState title="Nuk ka ende shitje të përfunduara." helper="Raportet do të plotësohen automatikisht pasi të mbyllen porositë." icon="reports"/></div>}

    <dl className="report-secondary">{metrics.slice(6).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>

    {data.costCents === null && <div className="notice" data-cost-coverage><strong>Kosto e paplotë: fitimi bruto dhe rezultati operativ nuk mund të llogariten.</strong><p>{report!.costCoverage.missingCostUnits} njësi në {report!.costCoverage.missingCostLines} rreshta nuk kanë kosto historike. Shitjet për këta artikuj: {formatMoney(report!.costCoverage.salesWithoutCostCents)}. Kosto e njohur vetëm për artikujt e tjerë: {formatMoney(report!.costCoverage.knownCostCents)}.</p><p>Ndryshimi i kostos së produktit sot nuk plotëson koston e shitjeve të kaluara. Hap porosinë për të parë çfarë mungon.</p></div>}
    <dl className="report-secondary payment-breakdown"><div><dt>Para të gatshme</dt><dd data-cash-total>{formatMoney(report!.cashCents)}</dd></div></dl>
    {(report!.cardCents !== 0 || report!.unknownPaymentCents !== 0) && <p className="notice">Pagesa historike / pa metodë: {formatMoney(report!.cardCents + report!.unknownPaymentCents)}.{report!.cardCents !== 0 && <> Kartelë historike: {formatMoney(report!.cardCents)}.</>}{report!.unknownPaymentCents !== 0 && <> Pa metodë të regjistruar: {formatMoney(report!.unknownPaymentCents)}.</>}</p>}

    <section className="recent-sales"><h2>Shitjet e fundit</h2>{data.completedOrders>report!.recentSales.length&&<p>Shfaqen {report!.recentSales.length} shitjet e fundit nga {data.completedOrders}. Totalet sipër përfshijnë të gjitha shitjet e periudhës.</p>}<div className="sales-scroll"><table><thead><tr><th>Shitja</th><th>Data / ora</th><th>Tavolina</th><th>Pagesa</th><th>Totali</th><th>Porosia</th></tr></thead><tbody>{report!.recentSales.map(sale => <Fragment key={sale.id}><tr data-sale-id={sale.id}><td>{formatSaleNumber(sale.saleNumber)}</td><td>{formatLocalDateTime(sale.completedAt)}</td><td>{sale.tableCode}</td><td>{sale.paymentMethod === 'CASH' ? 'Para të gatshme' : sale.paymentMethod === 'CARD' ? 'Kartelë historike' : 'Pa metodë të regjistruar'}</td><td>{formatMoney(sale.totalCents)}</td><td><button className="button button-secondary" aria-expanded={expandedSale===sale.id} aria-controls={`sale-details-${sale.id}`} onClick={()=>setExpandedSale(expandedSale===sale.id?undefined:sale.id)}>{expandedSale===sale.id?'Mbyll':'Shiko porosinë'}</button></td></tr>{expandedSale===sale.id&&<tr className="sale-detail-row"><td colSpan={6}><div id={`sale-details-${sale.id}`}><h3>Porosia {formatSaleNumber(sale.saleNumber)} · {sale.tableCode}</h3><table className="sale-item-details"><thead><tr><th>Produkti</th><th>Sasia</th><th>Çmimi / njësi</th><th>Kosto / njësi</th><th>Shitja</th><th>Kosto</th><th>Fitimi bruto</th></tr></thead><tbody>{sale.items.map(item=><tr key={item.id} data-sale-item><td>{item.name}</td><td>{item.quantity}</td><td>{formatMoney(item.unitPriceCents)}</td><td>{item.unitCostCents===null?'Mungon':formatMoney(item.unitCostCents)}</td><td>{formatMoney(item.totalCents)}</td><td>{item.costCents===null?'Mungon':formatMoney(item.costCents)}</td><td>{item.profitCents===null?'—':formatMoney(item.profitCents)}</td></tr>)}</tbody></table><p className="sale-detail-total">Totali i porosisë: <strong>{formatMoney(sale.totalCents)}</strong></p><p>Emrat, çmimet dhe kostot janë ato të ruajtura në porosi.</p><ReceiptActions saleId={sale.id}/></div></td></tr>}</Fragment>)}</tbody></table></div></section>
    <LossHistory report={finance!}/><div className="report-notes"><div><h3>Fitimi bruto</h3><p>Shitjet − Kosto historike e mallit të shitur</p></div><div><h3>Rezultati operativ</h3><p>Fitimi bruto − Shpenzimet − Humbja e mallit. Diferenca e kasës nuk ndryshon rezultatin.</p></div></div></>}
  </div>;

}
