import {tableDisplayArea, tableDisplayCode} from '../presentation/tableIdentity';
import { useContext, useEffect, useRef, useState } from 'react';
import { useData } from '../app/useData';
import { DataState } from '../components/DataState';
import { CheckoutDialog } from '../components/CheckoutDialog';
import { ReservationDialog } from '../components/ReservationDialog';
import { formatReservationTime, type ReserveTableInput } from '../domain/reservations';
import { RealFloorPlan } from '../components/RealFloorPlan';
import { CATEGORIES, TABLE_STATUS_LABELS } from '../domain/definitions';
import { formatMoney } from '../domain/money';
import type { Area, OrderWorkspace, TableStatus, ActiveOrder, ActiveOrderItem } from '../domain/types';
import type { MutationResult } from '../domain/configuration';
import type { OrderDraft, TableDraft } from '../domain/orderDraft';
import { Button, Icon, PageHeader, StatusBadge } from '../components/ui';
import { OrderDraftContext } from '../app/orderDraftContext';
import { draftLineIssue, OrderDraftEditor } from '../components/OrderDraftEditor';
const load = () => window.fox.tables.list();
const loadProducts = () => window.fox.products.list();
const tone = (status: TableStatus) => status === 'FREE' ? 'neutral' : status === 'ACTIVE' ? 'info' : ['AWAITING_PAYMENT','RESERVED'].includes(status) ? 'warning' : 'neutral';
const emptyDraft: TableDraft = { items: [] };
type Checkout = { code: string } & (
  { order: ActiveOrder } |
  { workspace: OrderWorkspace; draft: TableDraft; items: ActiveOrderItem[]; totalCents: number }
);

export function Tables() {
  const { drafts, setDrafts } = useContext(OrderDraftContext);
  const { data, error, retry, setData } = useData(load);
  const catalog = useData(loadProducts);
  const [checkout, setCheckout] = useState<Checkout>();
  const checkoutLock = useRef(false);
  const [reservationDialog, setReservationDialog] = useState<{id:string;code:string}>();
  const [selected, setSelected] = useState<string>();
  const [view, setView] = useState<OrderWorkspace>();
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
  function close() { if (checkoutLock.current || busy.current.has(`${current.current}:draft`)) return; current.current = undefined; epoch.current++; setSelected(undefined); setView(undefined); setMessage(''); opener.current?.focus(); }
  useEffect(() => {
    if (!selected) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !checkoutLock.current && !document.querySelector('dialog[open]')) close(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [selected]);
  function select(tableId: string, source?: HTMLButtonElement) {
    if (checkoutLock.current || busy.current.has(`${current.current}:draft`)) return;
    if (source) opener.current = source;
    orderBody.current?.scrollTo({ top: 0 });
    current.current = tableId; setSelected(tableId); setView(undefined); setReadFailed(false); setMessage(''); setSuccess('');
    const version = ++epoch.current;
    window.fox.orders.getForTable(tableId).then(value => {
      if (!mounted.current || version !== epoch.current) return;
      uncertain.current.delete(tableId); setView(value);
      setData(tables => tables?.map(table => table.id === tableId ? value.table : table));
    }).catch(() => {
      if (!mounted.current || version !== epoch.current) return;
      setReadFailed(true);
      setMessage('Porosia nuk mund të lexohet. Provo përsëri.');
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
    // The preview is read-only. Confirming first saves the draft using its
    // existing idempotent submission, then pays the returned order revision.
    const order = 'order' in captured ? captured.order : (await submitDraft(captured.workspace, captured.draft, true))?.order;
    if (!order) { cancelCheckout(); return null; }
    if ('draft' in captured) setCheckout({ code: captured.code, order });
    try {
      const result = await window.fox.orders.completeOrder({ orderId: order.id, expectedRevision: order.revision });
      if (!result.ok) {
        if (['ORDER_CHANGED','ALREADY_COMPLETED','ORDER_NOT_OPEN'].includes(result.code)) {
          cancelCheckout(); select(order.tableId); setMessage(result.message);
        }
        catalog.retry();
        return result.message;
      }
      epoch.current++; setView(result.data.workspace);
      setData(tables => tables?.map(t => t.id === result.data.workspace.table.id ? result.data.workspace.table : t));
      orderBody.current?.scrollTo({ top: 0 });
      setMessage(''); cancelCheckout(); catalog.retry(); setSuccess(result.data.receiptWarning ? 'Shitja u regjistrua. Kuponi nuk mund të krijohej. Hap shitjen te Raportet për ta provuar përsëri.' : 'Shitja u regjistrua.');
      return null;
    } catch {
      // Outcome may have committed before a transport failure. Read authoritative state before another action.
      uncertain.current.add(order.tableId); cancelCheckout();
      setMessage('Pagesa nuk u konfirmua. Rifresko gjendjen përpara se të provosh përsëri.');
      return null;
    }
  }
  async function saveReservation(input: ReserveTableInput): Promise<string | null> {
    try {
      const result = await window.fox.reservations.reserve(input);
      if (!mounted.current) return null;
      if (!result.ok) return result.message;
      uncertain.current.delete(input.tableId);
      setData(tables => tables?.map(item => item.id === input.tableId ? result.data.table : item));
      if (current.current === input.tableId) { epoch.current++; setView(result.data); setMessage(''); setSuccess('Rezervimi u ruajt.'); }
      return null;
    } catch {
      uncertain.current.add(input.tableId);
      if (mounted.current) setMessage('Rezervimi nuk u konfirmua. Rifresko gjendjen për ta kontrolluar.');
      throw new Error('Reservation outcome unknown');
    }
  }
  const [success, setSuccess] = useState('');
  function applyWorkspace(value: OrderWorkspace, feedback: string) {
    if(!mounted.current)return;
    const tableId=value.table.id;
    setData(tables=>tables?.map(table=>table.id===tableId?value.table:table));
    if(current.current===tableId) {
      epoch.current++;setView(value);setReadFailed(false);setMessage('');setSuccess(feedback);
    }
  }
  function changeDraft(tableId: string, update: (draft: OrderDraft) => OrderDraft) {
    if (current.current !== tableId || busy.current.size || checkoutLock.current) return;
    setDrafts(previous => {
      const draft = previous.get(tableId) ?? emptyDraft;
      if (draft.retry) return previous;
      return new Map(previous).set(tableId, update(draft));
    });
    setSuccess('');
  }
  function settleDraft(tableId: string, requestId: string, committed: boolean) {
    setDrafts(previous => {
      const draft = previous.get(tableId);
      if (!draft || draft.retry?.request.requestId !== requestId) return previous;
      const next = new Map(previous);
      if (committed) next.delete(tableId);
      else next.set(tableId, {items: draft.items});
      return next;
    });
  }
  async function submitDraft(workspace: OrderWorkspace, draft: TableDraft, forCheckout = false) {
    const tableId = workspace.table.id;
    if (!draft.items.length || draft.retry?.pending || current.current !== tableId || busy.current.size || (checkoutLock.current && !forCheckout)) return;
    const key = `${tableId}:draft`;
    // A transport failure can happen after commit. Retry the exact same request.
    const input = draft.retry?.request ?? {
      requestId: crypto.randomUUID(), tableId, orderId: workspace.order?.id ?? null,
      expectedRevision: workspace.order?.revision ?? null, items: draft.items,
    };
    setDrafts(previous => new Map(previous).set(tableId, { ...draft, retry: {request: input, pending: true} }));
    busy.current.add(key);
    setPending([...busy.current]);
    setMessage('');
    setSuccess('');
    try {
      const result = await window.fox.orders.submitDraft(input);
      if (!result.ok) {
        if (result.notCommitted) settleDraft(tableId, input.requestId, false);
        if (mounted.current) {
          catalog.refresh();
          setMessage(result.message);
        }
        return;
      }
      settleDraft(tableId, input.requestId, true);
      const saved = result.data;
      applyWorkspace(saved, 'Porosia u ruajt.');
      return saved;
    } catch {
      if (mounted.current) setMessage('Përgjigjja mungon. Provo të njëjtën porosi.');
    } finally {
      setDrafts(previous => {
        const saved = previous.get(tableId);
        if (saved?.retry?.request.requestId !== input.requestId) return previous;
        return new Map(previous).set(tableId, {...saved, retry: {...saved.retry, pending: false}});
      });
      busy.current.delete(key);
      if (mounted.current) setPending([...busy.current]);
    }
  }
  const legend = <div className="table-header-context"><span className="board-count">{data?.length ?? '—'} pozicione</span><div className="status-legend" aria-label="Gjendjet e porosive">{(['FREE','ACTIVE','RESERVED'] as const).map(status => <StatusBadge key={status} dot={false} tone={tone(status)}>{TABLE_STATUS_LABELS[status]}</StatusBadge>)}</div></div>;
  const header = <PageHeader title="Tavolinat" helper="Pamje e lokalit dhe menaxhimi i porosive." actions={data ? legend : undefined}/>;
  if (!data) return <>{header}<DataState error={error} retry={retry}/></>;
  const table = view?.table ?? data.find(item => item.id === selected);
  const canOrder = Boolean(view && table?.enabled && ['FREE','ACTIVE'].includes(table.status) && (table.status === 'ACTIVE') === Boolean(view.order) && !uncertain.current.has(table.id));
  const canMutate = canOrder && !checkout && !reservationDialog;
  const draft = (table && drafts.get(table.id)) ?? emptyDraft;
  const tablePending = !!draft.retry?.pending || pending.some(key => key.startsWith(`${selected}:`));
  const hasDraft = draft.items.length > 0;
  const subtotal = draft.items.reduce<number | null>((total, item) => {
    if (total === null) return null;
    const next = total + item.expectedProduct.unitPriceCents * item.quantity;
    return Number.isSafeInteger(next) ? next : null;
  }, 0);
  const confirmedTotal = view?.order?.totalCents ?? 0;
  const draftTotal = subtotal !== null && Number.isSafeInteger(subtotal + confirmedTotal) ? subtotal + confirmedTotal : null;
  const validDraft = draftTotal !== null && draft.items.every(item =>
    !draftLineIssue(item, catalog.data?.find(product => product.id === item.productId), CATEGORIES));
  const canCheckout = canMutate && !tablePending && !draft.retry &&
    (hasDraft ? validDraft : Boolean(view?.order?.items.length));
  function openCheckout() {
    if (!view || !canCheckout || busy.current.size || checkoutLock.current) return;
    const code = tableDisplayCode(view.table.code);
    if (hasDraft && draftTotal !== null) {
      const additions = draft.items.map(({productId, quantity, expectedProduct}) => ({
        id: `draft:${productId}`, productId, quantity, name: expectedProduct.name,
        unitPriceCents: expectedProduct.unitPriceCents, lineTotalCents: expectedProduct.unitPriceCents * quantity,
      }));
      checkoutLock.current = true;
      setCheckout({code, workspace: view, draft, items: [...(view.order?.items ?? []), ...additions], totalCents: draftTotal});
    } else if (view.order) {
      checkoutLock.current = true;
      setCheckout({code, order: view.order});
    }
    setSuccess('');
  }
  const orderTotal = view && !view.reservation && !draft.retry ? draftTotal : null;
  const checkoutSummary = checkout && ('order' in checkout ? checkout.order : checkout);
  const saveState = tablePending ? 'pending' : message ? 'error' : !view ? 'loading' : view.order ? 'saved' : 'empty';
  const saveMessage = { pending: 'Duke ruajtur…', error: 'Kontrollo gjendjen e porosisë.', loading: 'Duke lexuar porosinë…', saved: '', empty: '' }[saveState];
  return <div data-page="tables" className={selected ? 'pos-selected' : ''}>
    {header}
    <div className="pos-layout"><div className="board-scroll"><RealFloorPlan tables={data} selected={selected} onSelect={select}/></div>
    {table && <aside className="order-workspace" data-order-workspace data-order-draft aria-labelledby="order-heading">
      <header className="order-header"><span className="order-heading-icon"><Icon name="seat"/></span><div className="order-heading-content"><h2 id="order-heading">Tavolina {tableDisplayCode(table.code)}</h2><div className="order-context"><span>{tableDisplayArea(table.code,table.area as Area)}</span><StatusBadge dot tone={table.status==='FREE'?'success':tone(table.status)}>{TABLE_STATUS_LABELS[table.status]}</StatusBadge></div></div><Button variant="ghost" className="icon-button" aria-label="Mbyll panelin e tavolinës" onClick={close}><Icon name="close"/></Button></header>
      {canOrder && !view?.order && <div className="reservation-toolbar"><Button data-open-reservation disabled={tablePending || hasDraft || !!reservationDialog} onClick={()=>setReservationDialog({id:table.id,code:tableDisplayCode(table.code)})}><Icon name="calendar"/>Rezervo tavolinën</Button></div>}
      <div className="order-body" ref={orderBody}>
        {message && <div role="alert" className="form-error">{message}{(readFailed || uncertain.current.has(table.id) || hasDraft) && <Button onClick={() => select(table.id)}>Rifresko gjendjen</Button>}</div>}
        {!view ? <p className="order-help">{readFailed ? 'Gjendja e porosisë nuk është e disponueshme.' : 'Duke lexuar porosinë…'}</p> : <>
          {view.reservation ? <section className="reservation-details" aria-label="Rezervimi i tavolinës" data-reservation-details>
            <span className="eyebrow">Rezervimi</span><h3>{view.reservation.customerName}</h3>
            <dl><div><dt>Data / ora</dt><dd>{formatReservationTime(view.reservation.startsAt)}</dd></div>
              <div><dt>Persona</dt><dd>{view.reservation.guests}</dd></div>
              {view.reservation.phone && <div><dt>Telefoni</dt><dd>{view.reservation.phone}</dd></div>}
              {view.reservation.note && <div><dt>Shënim</dt><dd>{view.reservation.note}</dd></div>}</dl>
            <p className="order-help">Kur klienti të vijë, shëno mbërritjen dhe shto produktet në porosi.</p>
            <div className="reservation-actions"><Button variant="primary" data-reservation-arrive disabled={tablePending || uncertain.current.has(table.id)} onClick={()=>run(`${table.id}:reservation`,()=>window.fox.reservations.arrive({tableId:table.id,reservationId:view.reservation!.id}))}>Klienti mbërriti</Button>
              <Button data-reservation-cancel disabled={tablePending || uncertain.current.has(table.id)} onClick={()=>run(`${table.id}:reservation`,()=>window.fox.reservations.cancel({tableId:table.id,reservationId:view.reservation!.id}))}>Anulo rezervimin</Button></div>
          </section> : <>
          {!canOrder && !uncertain.current.has(table.id) && <p className="notice">{!table.enabled ? 'Ky pozicion shërbimi është joaktiv.' : 'Porositë nuk janë të disponueshme për këtë gjendje tavoline.'}</p>}
          {catalog.data
            ? <OrderDraftEditor key={`draft:${table.id}`} products={catalog.data} categories={CATEGORIES}
                draft={draft} onChange={update => changeDraft(table.id, update)} subtotal={subtotal}
                disabled={!canMutate || tablePending || !!draft.retry}/>
            : <DataState error={catalog.error} retry={catalog.retry}/>}
          {view.order && <section className="current-order" aria-label="Porosia e ruajtur"><h3><Icon name="cart"/>Porosia e ruajtur</h3>
            {view.order.items.map(item => {
              const key = `${table.id}:item:${item.id}`;
              const disabled = !canMutate || hasDraft || tablePending;
              const input = { tableId: table.id, itemId: item.id };
              return <div className="order-item" key={item.id} data-order-item={item.id}><div className="order-item-name"><strong>{item.name}</strong><small>{formatMoney(item.unitPriceCents)} / njësi</small></div><div className="order-item-controls"><div className="quantity-control"><Button className="icon-button" disabled={disabled || item.quantity === 1} aria-label={`Ul sasinë e ${item.name}`} onClick={() => run(key, () => window.fox.orders.decrementItem(input))}><Icon name="minus"/></Button><span data-order-quantity>{item.quantity}</span><Button className="icon-button" disabled={disabled} aria-label={`Rrit sasinë e ${item.name}`} onClick={() => run(key, () => window.fox.orders.incrementItem(input))}><Icon name="plus"/></Button></div><strong>{formatMoney(item.lineTotalCents)}</strong><Button variant="ghost" className="icon-button remove-item" disabled={disabled} aria-label={`Hiq ${item.name}`} onClick={() => run(key, () => window.fox.orders.removeItem(input))}><Icon name="trash"/></Button></div></div>;
            })}
          </section>}
          </>}
        </>}
      </div>
      <footer className="order-footer" data-order-state={saveState}>
        <div><strong>{view?.reservation ? 'Rezervim' : 'Totali'}</strong>
          <strong data-order-total aria-live="polite">{orderTotal === null ? '—' : formatMoney(orderTotal)}</strong></div>
        <p role="status">{draft.retry && !tablePending ? 'Ruajtja nuk u konfirmua. Provo të njëjtën porosi.' :
          view?.reservation ? 'Tavolina mbahet për klientin e rezervuar.' :
          hasDraft && !message && !tablePending ? (!validDraft ? 'Kontrollo produktet e shënuara në draft.' : 'Zgjidh POROSIT ose Mbyll llogarinë.') :
          success || saveMessage}</p>
        {(!view?.reservation || draft.retry) && <Button variant="primary" data-ops-save-order className="checkout-open"
          disabled={!hasDraft || tablePending || (draft.retry ? !view : !canMutate || !validDraft)}
          onClick={() => { if (view) void submitDraft(view, draft); }}>
          <Icon name="cart"/>{tablePending ? 'Duke ruajtur…' : draft.retry ? 'Provo të njëjtën porosi' : 'POROSIT'}
        </Button>}
        {!view?.reservation && <Button className="checkout-open" data-open-checkout disabled={!canCheckout}
          onClick={openCheckout}><Icon name="receipt"/>Mbyll llogarinë</Button>}
      </footer>
    </aside>}
    </div>
    {reservationDialog && <ReservationDialog tableId={reservationDialog.id} tableCode={reservationDialog.code} onClose={()=>setReservationDialog(undefined)} onSave={saveReservation}/> }
    {checkout && checkoutSummary && <CheckoutDialog tableCode={checkout.code} items={checkoutSummary.items} totalCents={checkoutSummary.totalCents}
      onClose={cancelCheckout} onConfirm={confirmCheckout}/>}

  </div>;
}
