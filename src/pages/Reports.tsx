import { localInputDisplay } from '../domain/operatorInput';
import { profitPresentation } from '../presentation/profit';
import { LocalDateInput } from '../components/common/LocalDateInput';
import { tableDisplayCode } from '../presentation/tableIdentity';
import { Fragment, useCallback, useContext, useState } from 'react';
import { localDate, type FinanceQuery } from '../domain/finance';
import { CashControl, ExpenseList, LossHistory } from '../components/finance/OwnerFinance';
import { useData } from '../app/useData';

import { DataState } from '../components/common/DataState';

import { formatLocalDateTime, formatSaleNumber } from '../domain/display';
import { formatMoney } from '../domain/money';

import { Button, EmptyState, Icon, PageHeader, SidePanel } from '../components/common/Controls';
import { ReceiptActions } from '../components/receipts/ReceiptActions';
import { OperatorContext } from '../app/operatorContext';
import { OPERATORS, type ShiftPeriod } from '../domain/operators';

const periods = [
  ['TODAY', 'Sot'],
  ['WEEK', 'Këtë javë'],
  ['MONTH', 'Këtë muaj'],
  ['CUSTOM', 'Periudhë tjetër'],
  ['ALL', 'Të gjitha'],
  ['AM', 'Shitjet Paradite'],
  ['PM', 'Shitjet Masdite'],
  ['DAY', 'Totali i Ditës'],
] as const;

function ShiftReport({ period }: { period: ShiftPeriod }) {
  const load = useCallback(() => window.fox.operators.report(period), [period]);
  const { data, error, retry } = useData(load);
  if (!data) return <DataState error={error} retry={retry} />;
  return (
    <section className="settings-panel">
      <h2>Shitjet e paguara</h2>
      <p>{data.date}</p>
      <dl>
        {data.rows.map((row) => (
          <div key={row.operator}>
            <dt>
              {row.operator === 'LEGACY' ? 'Pa përdorues të regjistruar' : OPERATORS[row.operator]}
            </dt>
            <dd>{formatMoney(row.totalCents)}</dd>
          </div>
        ))}
      </dl>
      <p>
        Totali: <strong>{formatMoney(data.totalCents)}</strong>
      </p>
    </section>
  );
}

export function Reports() {
  const session = useContext(OperatorContext);
  const [shift, setShift] = useState<ShiftPeriod | null>(null);
  const [choosingPeriod, setChoosingPeriod] = useState(false);
  const [query, setQuery] = useState<FinanceQuery>({ period: 'ALL' });
  const [tab, setTab] = useState<'overview' | 'expenses' | 'cash'>('overview');
  const [startDate, setStartDate] = useState(localDate()),
    [endDate, setEndDate] = useState(localDate());
  const [expandedSale, setExpandedSale] = useState<string>();
  const load = useCallback(() => window.fox.finance.report(query), [query]);
  const { data: finance, error, retry, setData } = useData(load);
  const refreshFinance = () => {
    void load()
      .then(setData)
      .catch(() => retry());
  };
  const report = finance?.sales;
  const data = report?.summary;

  const header = (
    <>
      <PageHeader
        title="Raportet"
        helper="Shitjet, shpenzimet dhe arka."
        actions={
          <div className="report-filter">
            <span>Periudha</span>
            <Button aria-haspopup="dialog" onClick={() => setChoosingPeriod(true)}>
              <Icon name="calendar" />
              {periods.find(([value]) => value === (shift ?? query.period))?.[1]}
            </Button>
          </div>
        }
      />
      {choosingPeriod && (
        <SidePanel
          title="Periudha e raportit"
          subtitle=""
          busy={false}
          onClose={() => setChoosingPeriod(false)}
          footer={null}
        >
          <div className="report-period-options">
            {periods.slice(0, session.required ? periods.length : 5).map(([value, label]) => (
              <Button
                key={value}
                variant={value === (shift ?? query.period) ? 'primary' : 'secondary'}
                aria-pressed={value === (shift ?? query.period)}
                onClick={() => {
                  setChoosingPeriod(false);
                  if (value === 'AM' || value === 'PM' || value === 'DAY') setShift(value);
                  else {
                    setShift(null);
                    setQuery(
                      value === 'CUSTOM'
                        ? { period: value, startDate, endDate }
                        : { period: value },
                    );
                  }
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </SidePanel>
      )}
      {!shift && query.period === 'CUSTOM' && (
        <form
          className="finance-period"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery({ period: 'CUSTOM', startDate, endDate });
          }}
        >
          <label>
            Nga
            <LocalDateInput withTime={false} value={startDate} onChange={setStartDate} />
          </label>
          <label>
            Deri më
            <LocalDateInput withTime={false} value={endDate} onChange={setEndDate} />
          </label>
          <button className="button button-secondary" type="submit">
            Shfaq periudhën
          </button>
        </form>
      )}
      {!shift && (
        <div className="finance-tabs" role="group" aria-label="Kontrolli financiar">
          {(
            [
              ['overview', 'Përmbledhje'],
              ['expenses', 'Shpenzime'],
              ['cash', 'Mbyll arkën'],
            ] as const
          ).map(([id, label]) => (
            <button
              className="button button-secondary"
              key={id}
              aria-pressed={tab === id}
              data-finance-tab={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  );
  if (shift)
    return (
      <>
        {header}
        <ShiftReport key={shift} period={shift} />
      </>
    );
  if (!data)
    return (
      <>
        {header}
        <DataState error={error} retry={retry} />
      </>
    );

  const profit = profitPresentation(
    finance!.operatingResultCents,
    report!.costCoverage.missingCostUnits,
    finance!.missingLossCosts,
  );
  const metrics = [
    ['Shitjet', formatMoney(data.salesCents)],
    ['Shpenzimet', formatMoney(data.expensesCents)],
    [
      'Humbjet',
      finance!.stockLossCents === null ? 'Nuk llogariten' : formatMoney(finance!.stockLossCents),
    ],
    ['Fitimi', profit.value],
  ] as const;
  const secondary = [
    ['Porosi', data.completedOrders],
    ['Copë të shitura', data.productsSold],
    [
      'Mesatarja për porosi',
      data.averageOrderCents === null ? '—' : formatMoney(data.averageOrderCents),
    ],
  ] as const;
  const missingCostNote = profit.reason;
  const historicalPayments = report!.cardCents + report!.unknownPaymentCents;

  return (
    <div data-page="reports">
      {header}
      {query.period !== 'ALL' && (
        <div className="report-period">
          {localInputDisplay(finance!.startDate)} — {localInputDisplay(finance!.endDate)}
        </div>
      )}
      {tab === 'expenses' ? (
        <ExpenseList report={finance!} onRefresh={refreshFinance} />
      ) : tab === 'cash' ? (
        <CashControl report={finance!} onRefresh={refreshFinance} />
      ) : (
        <>
          <dl className="report-kpis">
            {metrics.map(([label, value]) => (
              <div key={label} className={label === 'Fitimi' ? 'finance-result' : ''}>
                <dt>{label}</dt>
                <dd
                  className={
                    label === 'Fitimi' &&
                    finance!.operatingResultCents !== null &&
                    finance!.operatingResultCents < 0
                      ? 'finance-negative'
                      : ''
                  }
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {data.completedOrders === 0 && (
            <div className="report-empty">
              <EmptyState
                title="Nuk ka ende shitje të përfunduara."
                helper="Raportet do të plotësohen automatikisht pasi të mbyllen porositë."
                icon="reports"
              />
            </div>
          )}

          <dl className="report-secondary">
            {secondary.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
            <div>
              <dt>Cash</dt>
              <dd data-cash-total>{formatMoney(report!.cashCents)}</dd>
            </div>
          </dl>
          {missingCostNote && (
            <p className="report-caution" data-cost-coverage>
              {missingCostNote}
            </p>
          )}

          <details className="report-details">
            <summary>Shiko detajet</summary>
            <dl className="report-secondary">
              <div>
                <dt>Kostoja e produkteve</dt>
                <dd>{data.costCents === null ? 'Nuk llogaritet' : formatMoney(data.costCents)}</dd>
              </div>
              <div>
                <dt>Fitimi nga shitjet</dt>
                <dd>
                  {data.grossProfitCents === null
                    ? 'Nuk llogaritet'
                    : formatMoney(data.grossProfitCents)}
                </dd>
              </div>
              {historicalPayments > 0 && (
                <div>
                  <dt>Pagesa historike jashtë cash-it / pa metodë</dt>
                  <dd data-historical-payments>{formatMoney(historicalPayments)}</dd>
                </div>
              )}
            </dl>
          </details>
          <section className="recent-sales">
            <h2>Shitjet e fundit</h2>
            {data.completedOrders > report!.recentSales.length && (
              <p>
                Shfaqen {report!.recentSales.length} shitjet e fundit nga {data.completedOrders}.
                Totalet sipër përfshijnë të gjitha shitjet e periudhës.
              </p>
            )}
            <div className="sales-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Shitja</th>
                    <th>Data / ora</th>
                    <th>Tavolina</th>
                    <th>Pagesa</th>
                    <th>Totali</th>
                    <th>Porosia</th>
                  </tr>
                </thead>
                <tbody>
                  {report!.recentSales.map((sale) => (
                    <Fragment key={sale.id}>
                      <tr data-sale-id={sale.id}>
                        <td>{formatSaleNumber(sale.saleNumber)}</td>
                        <td>{formatLocalDateTime(sale.completedAt)}</td>
                        <td>{tableDisplayCode(sale.tableCode)}</td>
                        <td>
                          {sale.paymentMethod === 'CASH'
                            ? 'Cash'
                            : sale.paymentMethod === 'CARD'
                              ? 'Kartelë historike'
                              : 'Pa metodë të regjistruar'}
                        </td>
                        <td>{formatMoney(sale.totalCents)}</td>
                        <td>
                          <button
                            className="button button-secondary"
                            aria-expanded={expandedSale === sale.id}
                            aria-controls={`sale-details-${sale.id}`}
                            onClick={() =>
                              setExpandedSale(expandedSale === sale.id ? undefined : sale.id)
                            }
                          >
                            {expandedSale === sale.id ? 'Mbyll' : 'Shiko porosinë'}
                          </button>
                        </td>
                      </tr>
                      {expandedSale === sale.id && (
                        <tr className="sale-detail-row">
                          <td colSpan={6}>
                            <div id={`sale-details-${sale.id}`}>
                              <h3>
                                Porosia {formatSaleNumber(sale.saleNumber)} ·{' '}
                                {tableDisplayCode(sale.tableCode)}
                              </h3>
                              <table className="sale-item-details">
                                <thead>
                                  <tr>
                                    <th>Produkti</th>
                                    <th>Sasia</th>
                                    <th>Çmimi / njësi</th>
                                    <th>Kosto / njësi</th>
                                    <th>Shitja</th>
                                    <th>Kosto</th>
                                    <th>Fitimi nga shitjet</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sale.items.map((item) => (
                                    <tr key={item.id} data-sale-item>
                                      <td>{item.name}</td>
                                      <td>{item.quantity}</td>
                                      <td>{formatMoney(item.unitPriceCents)}</td>
                                      <td>
                                        {item.unitCostCents === null
                                          ? 'Mungon'
                                          : formatMoney(item.unitCostCents)}
                                      </td>
                                      <td>{formatMoney(item.totalCents)}</td>
                                      <td>
                                        {item.costCents === null
                                          ? 'Mungon'
                                          : formatMoney(item.costCents)}
                                      </td>
                                      <td>
                                        {item.profitCents === null
                                          ? '—'
                                          : formatMoney(item.profitCents)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <p className="sale-detail-total">
                                Totali i porosisë: <strong>{formatMoney(sale.totalCents)}</strong>
                              </p>
                              <p>Emrat, çmimet dhe kostot janë ato të ruajtura në porosi.</p>
                              <ReceiptActions saleId={sale.id} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <LossHistory report={finance!} />
        </>
      )}
    </div>
  );
}
