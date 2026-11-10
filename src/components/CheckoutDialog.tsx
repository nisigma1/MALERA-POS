import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../domain/money';
import type { ActiveOrderItem } from '../domain/types';
import { Button } from './ui';

export function CheckoutDialog({ tableCode, items, totalCents, onClose, onConfirm }: { tableCode: string; items: ActiveOrderItem[]; totalCents: number; onClose: () => void; onConfirm: () => Promise<string | null> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>('[data-cancel-payment]')?.focus();
    return () => { dialog.current?.close(); opener?.focus(); };
  }, []);
  async function confirm() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try { const message = await onConfirm(); if (message) setError(message); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="checkout-dialog" aria-labelledby="checkout-title" onKeyDown={e => {
    if (e.key === 'Escape') e.stopPropagation();
    if (e.key === 'Tab') {
      e.preventDefault();
      const targets = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')];
      const index = targets.indexOf(document.activeElement as HTMLElement);
      targets[(index + (e.shiftKey ? -1 : 1) + targets.length) % targets.length]?.focus();
    }
  }} onCancel={e => { e.preventDefault(); if (!submitting.current) onClose(); }}>
    <header><span className="eyebrow">Pagesa</span><h2 id="checkout-title">Mbyll llogarinë</h2><p>Tavolina {tableCode}</p></header>
    <section className="checkout-summary" aria-labelledby="checkout-summary-title">
      <h3 id="checkout-summary-title">Porosia</h3>
      <div className="checkout-items" role="region" aria-labelledby="checkout-summary-title" tabIndex={0}>
        <table><thead><tr><th scope="col">Produkti</th><th scope="col">Sasia</th><th scope="col">Totali</th></tr></thead>
          <tbody>{items.map(item => <tr key={item.id} data-checkout-item={item.id}><td><strong>{item.name}</strong><small>{formatMoney(item.unitPriceCents)} / njësi</small></td><td>{item.quantity}</td><td>{formatMoney(item.lineTotalCents)}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
    <div className="checkout-total"><span>Totali për pagesë</span><strong data-checkout-total>{formatMoney(totalCents)}</strong></div>
    <p className="checkout-method">Mënyra e pagesës: <strong>Para të gatshme</strong></p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer><Button data-cancel-payment disabled={busy} onClick={onClose}>Anulo</Button><Button variant="primary" data-confirm-payment disabled={busy} onClick={confirm}>{busy ? 'Duke regjistruar…' : 'Konfirmo pagesën'}</Button></footer>
  </dialog>;
}
