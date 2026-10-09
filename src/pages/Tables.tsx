import { useEffect, useRef, useState } from 'react';
import { useData } from '../app/useData';
import { DataState } from '../components/DataState';
import { CheckoutDialog } from '../components/CheckoutDialog';
import { RealFloorPlan } from '../components/RealFloorPlan';
import { AREA_LABELS, CATEGORIES, TABLE_STATUS_LABELS } from '../domain/definitions';
import { formatMoney } from '../domain/money';
import type { CategoryCode, OrderWorkspace, TableStatus, ActiveOrder } from '../domain/types';
import type { MutationResult } from '../domain/configuration';
import { Button, Icon, PageHeader, StatusBadge } from '../components/ui';
const load = () => window.fox.tables.list();
const loadProducts = () => window.fox.products.list();
const tone = (status: TableStatus) => status === 'FREE' ? 'success' : status === 'ACTIVE' ? 'info' : status === 'AWAITING_PAYMENT' ? 'warning' : 'neutral';

export function Tables() {
  const { data, error, retry, setData } = useData(load);
  const catalog = useData(loadProducts);
  const [checkout, setCheckout] = useState<{ code: string; order: ActiveOrder }>();
  const checkoutLock = useRef(false);
  const [selected, setSelected] = useState<string>();
  const [view, setView] = useState<OrderWorkspace>();
  const [category, setCategory] = useState<CategoryCode>('KAFE');
  const [message, setMessage] = useState('');
  const [readFailed, setReadFailed] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const current = useRef<string | undefined>(undefined);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const queue = useRef(Promise.resolve());
  const busy = useRef(new Set<string>());
  const uncertain = useRef(new Set<string>());
  const opener = useRef<HTMLElement | null>(null);
  const orderBody = useRef<HTMLDivElement | null>(null);
  const initialSelection = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function close() { if (checkoutLock.current) return; current.current = undefined; epoch.current++; setSelected(undefined); setView(undefined); setMessage(''); opener.current?.focus(); }
  useEffect(() => {
    if (!selected) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !checkoutLock.current) close(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [selected]);
  function select(tableId: string, source?: HTMLButtonElement) {
    if (checkoutLock.current) return;
    if (source) opener.current = source;
    if (current.current !== tableId) { setCategory('KAFE'); orderBody.current?.scrollTo({ top: 0 }); }
    current.current = tableId; setSelected(tableId); setView(undefined); setReadFailed(false); setMessage(''); setSuccess('');
    const version = ++epoch.current;
    window.fox.orders.getForTable(tableId).then(value => {
      if (!mounted.current || version !== epoch.current) return;
      uncertain.current.delete(tableId); setView(value);
      setData(tables => tables?.map(table => table.id === tableId ? value.table : table));
    }).catch(() => {
      if (!mounted.current || version !== epoch.current) return;
      setReadFailed(true); setMessage('Porosia nuk mund të lexohet. Provo përsëri.');
    });
  }
  useEffect(() => {
    if (!data || initialSelection.current) return;
    initialSelection.current = true;
    const initial = data.find(item => item.code === 'M5');
    if (initial) select(initial.id);
  }, [data]);
  function run(key: string, action: () => Promise<MutationResult<OrderWorkspace>>) {
    const tableId = current.current;
    if (checkoutLock.current || !tableId || busy.current.has(key) || uncertain.current.has(tableId)) return;
    busy.current.add(key); setPending([...busy.current]); setMessage('');
    // The queue survives navigation; committed DTOs alone update the visible order.
    queue.current = queue.current.then(async () => {
      if (uncertain.current.has(tableId)) return;
      try {
        const result = await action();
        if (!mounted.current) return;
        if (result.ok) {
          setData(tables => tables?.map(table => table.id === tableId ? result.data.table : table));
          if (current.current === tableId) { epoch.current++; setView(result.data); setReadFailed(false); setMessage(''); }
        } else if (current.current === tableId) setMessage(result.errors.form ?? result.message);
      } catch {
        uncertain.current.add(tableId);
        if (mounted.current && current.current === tableId) setMessage('Porosia nuk u konfirmua. Rifresko gjendjen përpara se të provosh përsëri.');
      }
    }).finally(() => { busy.current.delete(key); if (mounted.current) setPending([...busy.current]); });
  }
  function cancelCheckout() { checkoutLock.current = false; setCheckout(undefined); }
  async function confirmCheckout(): Promise<string | null> {
    if (!checkout) return 'Porosia nuk është e disponueshme.';
    const captured = checkout;
    try {
      const result = await window.fox.orders.completeOrder({ orderId: captured.order.id, expectedRevision: captured.order.revision });
      if (!result.ok) {
        if (['ORDER_CHANGED','ALREADY_COMPLETED','ORDER_NOT_OPEN'].includes(result.code)) {
          cancelCheckout(); select(captured.order.tableId); setMessage(result.message);
        }
        catalog.retry();
        return result.message;
      }
      epoch.current++; setView(result.data.workspace);
      setData(tables => tables?.map(t => t.id === result.data.workspace.table.id ? result.data.workspace.table : t));
      setMessage(''); cancelCheckout(); catalog.retry(); setSuccess(result.data.receiptWarning ? 'Shitja u regjistrua. Kuponi nuk mund të krijohej. Hap shitjen te Raportet për ta provuar përsëri.' : 'Shitja u regjistrua.');
      return null;
    } catch {
      // Outcome may have committed before a transport failure. Read authoritative state before another action.
      uncertain.current.add(captured.order.tableId); cancelCheckout();
      setMessage('Pagesa nuk u konfirmua. Rifresko gjendjen përpara se të provosh përsëri.');
      return null;
    }
  }
  const [success, setSuccess] = useState('');
  const legend = <div className="table-header-context"><span className="board-count">{data?.length ?? '—'} pozicione</span><div className="status-legend" aria-label="Gjendjet e porosive">{(['FREE','ACTIVE'] as const).map(status => <StatusBadge key={status} tone={tone(status)}>{TABLE_STATUS_LABELS[status]}</StatusBadge>)}</div></div>;
  const header = <PageHeader title="Tavolinat" helper="" actions={data ? legend : undefined}/>;
  if (!data) return <>{header}<DataState error={error} retry={retry}/></>;
  const table = view?.table ?? data.find(item => item.id === selected);
  const canOrder = Boolean(view && table?.enabled && ['FREE','ACTIVE'].includes(table.status) && (table.status === 'ACTIVE') === Boolean(view.order) && !uncertain.current.has(table.id));
  const canMutate = canOrder && !checkout;
  const tablePending = pending.some(key => key.startsWith(`${selected}:`));
  const visibleProducts = catalog.data?.filter(product => product.active && product.categoryId === category);
  const saveState = tablePending ? 'pending' : message ? 'error' : !view ? 'loading' : view.order ? 'saved' : 'empty';
  const saveMessage = { pending: 'Duke ruajtur…', error: 'Kontrollo gjendjen e porosisë.', loading: 'Duke lexuar porosinë…', saved: 'Porosia ruhet automatikisht.', empty: 'Porosia nis me produktin e parë.' }[saveState];
  return <div data-page="tables" className={selected ? 'pos-selected' : ''}>
    {header}
    <div className="pos-layout"><div className="board-scroll"><RealFloorPlan tables={data} selected={selected} onSelect={select}/></div>
    {table && <aside className="order-workspace" data-order-workspace aria-labelledby="order-heading">
      <header className="order-header"><div><h2 id="order-heading">Tavolina {table.code}</h2><div className="order-context"><span>{AREA_LABELS[table.area]}</span><StatusBadge tone={tone(table.status)}>{TABLE_STATUS_LABELS[table.status]}</StatusBadge></div></div><Button variant="ghost" className="icon-button" aria-label="Mbyll panelin e tavolinës" onClick={close}><Icon name="close"/></Button></header>
      <div className="order-body" ref={orderBody}>
        {message && <div role="alert" className="form-error">{message}{(readFailed || uncertain.current.has(table.id)) && <Button onClick={() => select(table.id)}>Rifresko gjendjen</Button>}</div>}
        {!view ? <p className="order-help">{readFailed ? 'Gjendja e porosisë nuk është e disponueshme.' : 'Duke lexuar porosinë…'}</p> : <>
          {!canOrder && !uncertain.current.has(table.id) && <p className="notice">{!table.enabled ? 'Ky pozicion shërbimi është joaktiv.' : 'Porositë nuk janë të disponueshme për këtë gjendje tavoline.'}</p>}
          <section className="product-browser" aria-label="Shto produkte në porosi">
          <div className="order-categories" role="group" aria-label="Kategoritë e produkteve">{CATEGORIES.map(item => <Button key={item.id} variant="ghost" aria-pressed={item.id === category} data-order-category={item.id} onClick={() => setCategory(item.id)}>{item.name}</Button>)}</div>
          {!catalog.data ? <DataState error={catalog.error} retry={catalog.retry}/> : !visibleProducts?.length ? <p className="order-category-empty">Nuk ka produkte aktive në këtë kategori.</p> : <div className="order-products">{visibleProducts.map(product => {
            const key = `${table.id}:product:${product.id}`;
            return <Button key={product.id} className={`order-product${product.sellingPriceCents === null ? ' unpriced-product' : ''}`} data-order-product={product.id} title={product.trackInventory === null ? 'Zgjidh Po ose Jo te Inventari.' : product.sellingPriceCents === null ? 'Pa çmim. Vendos çmimin te Inventari.' : undefined} disabled={!canMutate || product.trackInventory === null || (product.trackInventory === true && (product.stockQuantity === null || product.stockQuantity <= 0)) || product.sellingPriceCents === null || pending.includes(key)} onClick={() => run(key, () => window.fox.orders.addProduct({ tableId: table.id, productId: product.id }))}><span>{product.name}</span><small>{pending.includes(key) ? 'Duke shtuar…' : product.sellingPriceCents === null ? 'Pa çmim' : product.trackInventory === null ? 'Konfiguro stokun' : product.trackInventory === true && product.stockQuantity === null ? 'Stok pa vendosur' : product.trackInventory === true && product.stockQuantity! <= 0 ? 'Pa stok' : product.sellingPriceCents === null ? 'Pa çmim' : formatMoney(product.sellingPriceCents)}</small></Button>;
          })}</div>}
          </section>
          <section className="current-order" aria-label="Porosia aktuale"><h3>Porosia aktuale</h3>
            {!view.order ? <div className="order-empty"><p>Nuk ka porosi aktive.</p><small>Zgjidh një produkt për ta nisur porosinë.</small></div> : view.order.items.map(item => {
              const key = `${table.id}:item:${item.id}`;
              const disabled = !canMutate || pending.includes(key);
              const input = { tableId: table.id, itemId: item.id };
              return <div className="order-item" key={item.id} data-order-item={item.id}><div className="order-item-name"><strong>{item.name}</strong><small>{formatMoney(item.unitPriceCents)} / njësi</small></div><div className="order-item-controls"><div className="quantity-control"><Button className="icon-button" disabled={disabled || item.quantity === 1} aria-label={`Ul sasinë e ${item.name}`} onClick={() => run(key, () => window.fox.orders.decrementItem(input))}><Icon name="minus"/></Button><span data-order-quantity>{item.quantity}</span><Button className="icon-button" disabled={disabled} aria-label={`Rrit sasinë e ${item.name}`} onClick={() => run(key, () => window.fox.orders.incrementItem(input))}><Icon name="plus"/></Button></div><strong>{formatMoney(item.lineTotalCents)}</strong><Button variant="ghost" className="icon-button remove-item" disabled={disabled} aria-label={`Hiq ${item.name}`} onClick={() => run(key, () => window.fox.orders.removeItem(input))}><Icon name="trash"/></Button></div></div>;
            })}
          </section>
        </>}
      </div>
      <footer className="order-footer" data-order-state={saveState}><div><strong>{view && !view.order ? 'Pa porosi' : 'Totali'}</strong><strong data-order-total>{view?.order ? formatMoney(view.order.totalCents) : '—'}</strong></div><p role="status">{success || saveMessage}</p><Button variant="primary" className="checkout-open" data-open-checkout disabled={!canOrder || !view?.order?.items.length || tablePending || !!checkout} onClick={() => { if (!view?.order || busy.current.size || checkoutLock.current) return; checkoutLock.current = true; setSuccess(''); setCheckout({ code: table.code, order: view.order }); }}>Mbyll llogarinë</Button></footer>
    </aside>}
    </div>
    {checkout && <CheckoutDialog tableCode={checkout.code} items={checkout.order.items} totalCents={checkout.order.totalCents} onClose={cancelCheckout} onConfirm={confirmCheckout}/>}
  </div>;
}



