import { Fragment, useCallback, useState } from 'react';
import type { ReportPeriod } from '../domain/types';
import { useData } from '../app/useData';
import { DataState } from '../components/DataState';
import { formatLocalDateTime, formatSaleNumber } from '../domain/display';
import { formatMoney } from '../domain/money';
import { EmptyState, PageHeader } from '../components/ui';
import { ReceiptActions } from '../components/ReceiptActions';

export function Reports() {
  const [period, setPeriod] = useState<ReportPeriod>('ALL');
  const [expandedSale, setExpandedSale] = useState<string>();
  const load = useCallback(() => window.fox.reports.getSalesReport(period), [period]);
  const { data: report, error, retry } = useData(load);
  const data = report?.summary;
  const header = <PageHeader title="Raportet" helper="Përmbledhje e shitjeve të përfunduara të FOX." actions={<label className="report-filter">Periudha<select aria-label="Periudha e raportit" value={period} onChange={e => setPeriod(e.target.value as ReportPeriod)}><option value="TODAY">Sot</option><option value="7_DAYS">7 ditët e fundit</option><option value="30_DAYS">30 ditët e fundit</option><option value="ALL">Të gjitha</option></select></label>}/>;
  if (!data) return <>{header}<DataState error={error} retry={retry}/></>;
  const metrics = [
    ['Shitjet totale', formatMoney(data.salesCents)], ['Kosto e mallit', data.costCents === null ? '—' : formatMoney(data.costCents)],
    ['Fitimi bruto', data.grossProfitCents === null ? '—' : formatMoney(data.grossProfitCents)], ['Shpenzimet', formatMoney(data.expensesCents)],
    ['Fitimi neto', data.netProfitCents === null ? '—' : formatMoney(data.netProfitCents)], ['Porosi të përfunduara', data.completedOrders],
    ['Produktet e shitura', data.productsSold], ['Mesatarja për porosi', data.averageOrderCents === null ? '—' : formatMoney(data.averageOrderCents)],
  ] as const;
  return <div data-page="reports">
    {header}<div className="report-period">{{TODAY:'Shitjet e sotme', '7_DAYS':'7 ditët e fundit', '30_DAYS':'30 ditët e fundit', ALL:'Të gjitha shitjet e përfunduara'}[period]}</div>
    <dl className="report-kpis">{metrics.slice(0,6).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {data.completedOrders === 0 && <div className="report-empty"><EmptyState title="Nuk ka ende shitje të përfunduara." helper="Raportet do të plotësohen automatikisht pasi të mbyllen porositë." icon="reports"/></div>}
    <dl className="report-secondary">{metrics.slice(6).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {data.costCents === null && <div className="notice" data-cost-coverage><strong>Kosto e paplotë: fitimi bruto dhe neto nuk mund të llogariten.</strong><p>{report!.costCoverage.missingCostUnits} njësi në {report!.costCoverage.missingCostLines} rreshta nuk kanë kosto historike. Shitjet për këta artikuj: {formatMoney(report!.costCoverage.salesWithoutCostCents)}. Kosto e njohur vetëm për artikujt e tjerë: {formatMoney(report!.costCoverage.knownCostCents)}.</p><p>Ndryshimi i kostos së produktit sot nuk plotëson koston e shitjeve të kaluara. Hap porosinë për të parë çfarë mungon.</p></div>}
    <dl className="report-secondary payment-breakdown"><div><dt>Para të gatshme</dt><dd data-cash-total>{formatMoney(report!.cashCents)}</dd></div></dl>
    {(report!.cardCents !== 0 || report!.unknownPaymentCents !== 0) && <p className="notice">Pagesa historike / pa metodë: {formatMoney(report!.cardCents + report!.unknownPaymentCents)}.{report!.cardCents !== 0 && <> Kartelë historike: {formatMoney(report!.cardCents)}.</>}{report!.unknownPaymentCents !== 0 && <> Pa metodë të regjistruar: {formatMoney(report!.unknownPaymentCents)}.</>}</p>}
    <section className="recent-sales"><h2>Shitjet e fundit</h2>{data.completedOrders>report!.recentSales.length&&<p>Shfaqen {report!.recentSales.length} shitjet e fundit nga {data.completedOrders}. Totalet sipër përfshijnë të gjitha shitjet e periudhës.</p>}<div className="sales-scroll"><table><thead><tr><th>Shitja</th><th>Data / ora</th><th>Tavolina</th><th>Pagesa</th><th>Totali</th><th>Porosia</th></tr></thead><tbody>{report!.recentSales.map(sale => <Fragment key={sale.id}><tr data-sale-id={sale.id}><td>{formatSaleNumber(sale.saleNumber)}</td><td>{formatLocalDateTime(sale.completedAt)}</td><td>{sale.tableCode}</td><td>{sale.paymentMethod === 'CASH' ? 'Para të gatshme' : sale.paymentMethod === 'CARD' ? 'Kartelë historike' : 'Pa metodë të regjistruar'}</td><td>{formatMoney(sale.totalCents)}</td><td><button className="button button-secondary" aria-expanded={expandedSale===sale.id} aria-controls={`sale-details-${sale.id}`} onClick={()=>setExpandedSale(expandedSale===sale.id?undefined:sale.id)}>{expandedSale===sale.id?'Mbyll':'Shiko porosinë'}</button></td></tr>{expandedSale===sale.id&&<tr className="sale-detail-row"><td colSpan={6}><div id={`sale-details-${sale.id}`}><h3>Porosia {formatSaleNumber(sale.saleNumber)} · {sale.tableCode}</h3><table className="sale-item-details"><thead><tr><th>Produkti</th><th>Sasia</th><th>Çmimi / njësi</th><th>Kosto / njësi</th><th>Shitja</th><th>Kosto</th><th>Fitimi bruto</th></tr></thead><tbody>{sale.items.map(item=><tr key={item.id} data-sale-item><td>{item.name}</td><td>{item.quantity}</td><td>{formatMoney(item.unitPriceCents)}</td><td>{item.unitCostCents===null?'Mungon':formatMoney(item.unitCostCents)}</td><td>{formatMoney(item.totalCents)}</td><td>{item.costCents===null?'Mungon':formatMoney(item.costCents)}</td><td>{item.profitCents===null?'—':formatMoney(item.profitCents)}</td></tr>)}</tbody></table><p className="sale-detail-total">Totali i porosisë: <strong>{formatMoney(sale.totalCents)}</strong></p><p>Emrat, çmimet dhe kostot janë ato të ruajtura në porosi.</p><ReceiptActions saleId={sale.id}/></div></td></tr>}</Fragment>)}</tbody></table></div></section>
    <div className="report-notes"><div><h3>Fitimi bruto</h3><p>Shitjet − Kosto historike e mallit të shitur</p></div><div><h3>Fitimi neto</h3><p>Fitimi bruto − Shpenzimet e regjistruara për periudhën. Shpenzimet e paregjistruara nuk përfshihen.</p></div></div>
  </div>;
}

