import { useCallback, useState } from 'react';
import type { ReportPeriod } from '../domain/types';
import { useData } from '../app/useData';
import { DataState } from '../components/DataState';
import { formatLocalDateTime, formatSaleNumber } from '../domain/display';
import { formatMoney } from '../domain/money';
import { EmptyState, PageHeader } from '../components/ui';

export function Reports() {
  const [period, setPeriod] = useState<ReportPeriod>('ALL');
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
    {data.costCents === null && <p className="notice">Kosto e paplotë: disa produkte të shitura nuk kanë kosto historike. Fitimi bruto dhe neto nuk mund të llogariten.</p>}
    <dl className="report-secondary payment-breakdown"><div><dt>Para të gatshme</dt><dd data-cash-total>{formatMoney(report!.cashCents)}</dd></div></dl>
    {(report!.cardCents !== 0 || report!.unknownPaymentCents !== 0) && <p className="notice">Pagesa historike / pa metodë: {formatMoney(report!.cardCents + report!.unknownPaymentCents)}.{report!.cardCents !== 0 && <> Kartelë historike: {formatMoney(report!.cardCents)}.</>}{report!.unknownPaymentCents !== 0 && <> Pa metodë të regjistruar: {formatMoney(report!.unknownPaymentCents)}.</>}</p>}
    <section className="recent-sales"><h2>Shitjet e fundit</h2><div className="sales-scroll"><table><thead><tr><th>Shitja</th><th>Data / ora</th><th>Tavolina</th><th>Pagesa</th><th>Totali</th></tr></thead><tbody>{report!.recentSales.map(sale => <tr key={sale.id} data-sale-id={sale.id}><td>{formatSaleNumber(sale.saleNumber)}</td><td>{formatLocalDateTime(sale.completedAt)}</td><td>{sale.tableCode}</td><td>{sale.paymentMethod === 'CASH' ? 'Para të gatshme' : sale.paymentMethod === 'CARD' ? 'Kartelë historike' : 'Pa metodë të regjistruar'}</td><td>{formatMoney(sale.totalCents)}</td></tr>)}</tbody></table></div></section>
    <div className="report-notes"><div><h3>Fitimi bruto</h3><p>Shitjet − Kosto e mallit të shitur</p></div><div><h3>Fitimi neto</h3><p>Fitimi bruto − Shpenzimet</p></div></div>
  </div>;
}
