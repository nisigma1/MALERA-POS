import { useContext, useRef, useState } from 'react';
import type { CatalogProduct } from '../../domain/types';
import { LOSS_REASONS, type LossReason } from '../../domain/finance';
import { parseQuantity } from '../../domain/configuration';
import { formatMoney } from '../../domain/money';
import { Button, Field, SidePanel, useFieldErrorFocus } from '../common/Controls';
import { OperatorContext } from '../../app/operatorContext';
import {
  COFFEE_STOCK_ID,
  coffeePortions,
  coffeeStockLabel,
  isCoffee,
} from '../../domain/operators';
export function StockLossPanel({
  products,
  onClose,
  onSaved,
}: {
  products: CatalogProduct[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const duo = useContext(OperatorContext).required;
  const eligible = products.filter(
      (p) => p.trackInventory === true && (!duo || !isCoffee(p.id) || p.id === COFFEE_STOCK_ID),
    ),
    [productId, setProduct] = useState(''),
    [quantity, setQuantity] = useState(''),
    [reason, setReason] = useState<LossReason>('DAMAGED'),
    [note, setNote] = useState(''),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [requestId] = useState(() => crypto.randomUUID());
  const submitting = useRef(false),
    selected = eligible.find((p) => p.id === productId);
  const coffee = duo && selected?.id === COFFEE_STOCK_ID;
  useFieldErrorFocus(errors, busy, 'loss-form');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    let value: number;
    try {
      value = parseQuantity(quantity)!;
      if (value === null || value <= 0) throw Error();
      if (coffee) coffeePortions(value);
    } catch {
      setErrors({
        quantity: coffee
          ? 'Shkruaj kilogramët me deri në tri shifra pas presjes.'
          : 'Vendos një sasi më të madhe se zero.',
      });
      return;
    }
    if (!selected) {
      setErrors({ productId: 'Zgjidh produktin.' });
      return;
    }
    submitting.current = true;
    setBusy(true);
    setErrors({});
    try {
      const r = await window.fox.finance.recordLoss({
        requestId,
        productId,
        quantity: value,
        reason,
        note,
      });
      if (r.ok) onSaved();
      else setErrors(r.errors);
    } catch {
      setErrors({ form: 'Humbja nuk u konfirmua. Provo përsëri me të njëjtat të dhëna.' });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <SidePanel
      eyebrow=""
      title="Hiq mall si humbje"
      subtitle="Stoku do të ulet. Ky veprim nuk krijon shitje."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Anulo
          </Button>
          <Button
            variant="danger"
            type="submit"
            form="loss-form"
            disabled={busy || !eligible.length}
          >
            {busy ? 'Duke regjistruar…' : 'Ruaj humbjen'}
          </Button>
        </>
      }
    >
      <form id="loss-form" onSubmit={save} noValidate>
        {errors.form && (
          <p role="alert" className="form-error">
            {errors.form}
          </p>
        )}
        <fieldset disabled={busy}>
          <Field id="loss-product" label="Produkti" error={errors.productId}>
            <select
              id="loss-product"
              data-initial-focus
              value={productId}
              onChange={(e) => setProduct(e.target.value)}
              aria-invalid={!!errors.productId}
            >
              <option value="">Zgjidh produktin</option>
              {eligible.map((p) => (
                <option key={p.id} value={p.id}>
                  {duo && p.id === COFFEE_STOCK_ID ? 'Kafe (stok i përbashkët)' : p.name}
                </option>
              ))}
            </select>
          </Field>
          {selected && (
            <p className="notice">
              Stoku:{' '}
              {selected.stockQuantity === null
                ? 'Pa vendosur'
                : coffee
                  ? coffeeStockLabel(selected.stockQuantity)
                  : selected.stockQuantity}{' '}
              · Kosto/copë:{' '}
              {selected.purchaseCostCents === null
                ? 'Mungon'
                : formatMoney(selected.purchaseCostCents)}
            </p>
          )}
          <Field id="loss-quantity" label={coffee ? 'Sasia (kg)' : 'Sasia'} error={errors.quantity}>
            <input
              id="loss-quantity"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              aria-invalid={!!errors.quantity}
            />
          </Field>
          <Field id="loss-reason" label="Arsyeja">
            <select
              id="loss-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as LossReason)}
            >
              {Object.entries(LOSS_REASONS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="loss-note" label="Shënim (opsional)">
            <input
              id="loss-note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {selected?.purchaseCostCents === null && (
            <p className="notice warning-notice">
              Kostoja mungon. Humbja ruhet, por fitimi s’mund të llogaritet.
            </p>
          )}
          <p className="field-helper">Ky veprim nuk zhbëhet. Kontrollo produktin dhe sasinë.</p>
          {!eligible.length && (
            <p>Nuk ka produkte me ndjekje stoku. Konfiguro stokun te Edito produktin.</p>
          )}
        </fieldset>
      </form>
    </SidePanel>
  );
}
