import { amountError } from '../../domain/operatorInput';
import { useContext, useRef, useState } from 'react';
import type { CatalogProduct } from '../../domain/types';
import { parseEuro } from '../../domain/money';
import { parseQuantity, type FieldErrors } from '../../domain/configuration';
import { Button, EmptyState, Field, SidePanel, useFieldErrorFocus } from '../common/Controls';
import { OperatorContext } from '../../app/operatorContext';
import {
  COFFEE_STOCK_ID,
  coffeePortions,
  coffeeStockLabel,
  isCoffee,
} from '../../domain/operators';
export function SupplyPanel({
  products,
  onClose,
  onSaved,
}: {
  products: CatalogProduct[];
  onClose: () => void;
  onSaved: (product: CatalogProduct) => void;
}) {
  const duo = useContext(OperatorContext).required;
  const eligible = products.filter(
    (p) =>
      p.active &&
      p.trackInventory === true &&
      (!duo || !isCoffee(p.id) || p.id === COFFEE_STOCK_ID),
  );
  const [productId, setProductId] = useState('');
  const [drawer, setDrawer] = useState(false),
    [paid, setPaid] = useState('');
  const [quantity, setQuantity] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const clearError = (key: string) =>
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  const selected = eligible.find((p) => p.id === productId);
  const coffee = duo && selected?.id === COFFEE_STOCK_ID;
  useFieldErrorFocus(errors, busy, 'supply-form');
  let amountPreview: number | null = null;
  try {
    const value = parseQuantity(quantity);
    if (value !== null && value > 0) amountPreview = coffee ? coffeePortions(value) : value;
  } catch {
    /* Show no result for invalid input. */
  }
  const nextStock =
    selected && amountPreview !== null ? (selected.stockQuantity ?? 0) + amountPreview : null;
  const validPreview =
    nextStock !== null &&
    Number.isFinite(nextStock) &&
    nextStock <= Number.MAX_SAFE_INTEGER &&
    nextStock > (selected?.stockQuantity ?? 0);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const nextErrors: FieldErrors = {};
    let amount: number | null = null;
    try {
      amount = parseQuantity(quantity);
      if (coffee && amount !== null) coffeePortions(amount);
      if (amount === null || amount <= 0)
        nextErrors.quantity = 'Sasia duhet të jetë më e madhe se zero.';
    } catch {
      nextErrors.quantity = coffee
        ? 'Shkruaj kilogramët me deri në tri shifra pas presjes.'
        : 'Vendos një sasi të vlefshme, më të madhe se zero.';
    }
    if (!selected) nextErrors.productId = 'Zgjidh produktin.';
    let drawerPaymentCents: number | undefined;
    if (drawer) {
      const issue = amountError(paid);
      if (issue) nextErrors.drawerPaymentCents = issue;
      else drawerPaymentCents = parseEuro(paid)!;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || amount === null) return;
    submitting.current = true;
    setBusy(true);
    try {
      const result = await window.fox.inventory.addSupply({
        requestId,
        productId,
        quantity: amount,
        ...(drawer ? { drawerPaymentCents } : {}),
      });
      if (result.ok) onSaved(result.data);
      else setErrors(result.errors);
    } catch (error) {
      console.error('FOX supply failed', error);
      setErrors({ form: 'Furnizimi nuk u konfirmua. Provo përsëri me të njëjtat të dhëna.' });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <SidePanel
      title="Shto stok"
      subtitle="Regjistro sasinë në stokun e produktit."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Anulo
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="supply-form"
            disabled={busy || !eligible.length}
          >
            {busy ? 'Duke regjistruar…' : 'Shto stok'}
          </Button>
        </>
      }
    >
      {!eligible.length ? (
        <EmptyState
          title="Nuk ka produkte me stok aktiv"
          helper="Te Edito produktin, zgjidh një produkt aktiv dhe vendos Mbaj stok?: Po."
        />
      ) : (
        <form id="supply-form" onSubmit={save} noValidate>
          {errors.form && (
            <p role="alert" className="form-error">
              {errors.form}
            </p>
          )}
          <fieldset disabled={busy}>
            <Field id="productId" label="Produkti" error={errors.productId}>
              <select
                id="productId"
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  clearError('productId');
                }}
                data-initial-focus
                aria-invalid={Boolean(errors.productId)}
                aria-describedby={errors.productId ? 'productId-error' : undefined}
              >
                <option value="">Zgjidh produktin</option>
                {eligible.map((p) => (
                  <option value={p.id} key={p.id}>
                    {duo && p.id === COFFEE_STOCK_ID ? 'Kafe (stok i përbashkët)' : p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="quantity" label={coffee ? 'Sasia (kg)' : 'Sasia'} error={errors.quantity}>
              <input
                id="quantity"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  clearError('quantity');
                }}
                aria-invalid={Boolean(errors.quantity)}
                aria-describedby={errors.quantity ? 'quantity-error' : undefined}
              />
            </Field>
            <label className="finance-check">
              <input
                type="checkbox"
                checked={drawer}
                onChange={(e) => setDrawer(e.target.checked)}
              />
              Paguar nga arka
            </label>
            {drawer && (
              <Field id="supply-paid" label="Shuma e paguar (€)" error={errors.drawerPaymentCents}>
                <input
                  id="supply-paid"
                  inputMode="decimal"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                />
              </Field>
            )}
            <p className="field-helper">
              Nëse paguan nga arka, shëno shumën që nxore. Blerja e stokut nuk regjistrohet dy herë
              si shpenzim.
            </p>
            <section className="supply-summary" aria-labelledby="supply-summary-title">
              <h3 id="supply-summary-title">Përmbledhja</h3>
              <dl>
                <div>
                  <dt>Produkti</dt>
                  <dd>{selected?.name ?? '—'}</dd>
                </div>
                <div>
                  <dt>Stoku tani</dt>
                  <dd>
                    {selected
                      ? selected.stockQuantity === null
                        ? 'Pa vendosur'
                        : coffee
                          ? coffeeStockLabel(selected.stockQuantity)
                          : selected.stockQuantity
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Sasia që shtohet</dt>
                  <dd>
                    {amountPreview === null
                      ? '—'
                      : coffee
                        ? coffeeStockLabel(amountPreview)
                        : amountPreview}
                  </dd>
                </div>
                <div className="supply-result">
                  <dt>Stoku pas shtimit</dt>
                  <dd aria-live="polite">
                    {validPreview ? (coffee ? coffeeStockLabel(nextStock!) : nextStock) : '—'}
                  </dd>
                </div>
              </dl>
            </section>
            {selected?.stockQuantity === null && (
              <p className="notice warning-notice">
                Kjo është vendosja fillestare e stokut. Sasia e regjistruar do të bëhet stoku
                aktual; verifiko sasinë përpara konfirmimit.
              </p>
            )}
            <p className="field-helper">Çdo furnizim ruhet në historikun e lëvizjeve të stokut.</p>
          </fieldset>
        </form>
      )}
    </SidePanel>
  );
}
