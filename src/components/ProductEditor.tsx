import { useRef, useState } from 'react';
import type { CatalogProduct, CategoryCode } from '../domain/types';
import { CATEGORIES } from '../domain/definitions';
import { parseEuro, moneyInput, formatMoney } from '../domain/money';
import { parseQuantity, stockState, unitProfit, validateProductUpdate, type FieldErrors, type ProductUpdate } from '../domain/configuration';
import { Button, Field, SidePanel, StockBadge, useFieldErrorFocus } from './ui';
export function ProductEditor({ product, onClose, onSaved }: { product: CatalogProduct; onClose: () => void; onSaved: (product: CatalogProduct) => void }) {
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState(product.categoryId);
  const [cost, setCost] = useState(moneyInput(product.purchaseCostCents));
  const [price, setPrice] = useState(moneyInput(product.sellingPriceCents));
  const [tracking, setTracking] = useState(product.trackInventory === null ? '' : product.trackInventory ? 'yes' : 'no');
  const [threshold, setThreshold] = useState(product.lowStockThreshold === null ? '' : String(product.lowStockThreshold));
  const [active, setActive] = useState(product.active);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const clearError = (key: string) => setErrors(current => { if (!current[key]) return current; const next = { ...current }; delete next[key]; return next; });
  useFieldErrorFocus(errors, busy, 'product-form');
  let currentThreshold: number | null = null;
  try { currentThreshold = parseQuantity(threshold, true); } catch { /* Invalid thresholds do not predict a warning. */ }
  const currentStock = stockState({ ...product, trackInventory: tracking === '' ? null : tracking === 'yes', lowStockThreshold: currentThreshold });
  let profit: number | null = null;
  try { profit = unitProfit({ purchaseCostCents: parseEuro(cost), sellingPriceCents: parseEuro(price) }); } catch { /* Invalid input has no calculated value. */ }
  // A display-only typo review cue, not a FOX business limit or save validation.
  const needsReview = (text: string) => { try { return (parseEuro(text) ?? 0) >= 10_000; } catch { return false; } };
  const warnings: Record<string, boolean> = { purchaseCostCents: needsReview(cost), sellingPriceCents: needsReview(price) };
  const invalid = (key: string) => ({ 'aria-invalid': Boolean(errors[key]), 'aria-describedby': [errors[key] ? `${key}-error` : '', warnings[key] ? `${key}-review` : ''].filter(Boolean).join(' ') || undefined });
  const review = (key: string) => warnings[key] && <p id={`${key}-review`} className="price-review">Kontrollo vlerën para ruajtjes — çmimi duket i pazakontë.</p>;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const nextErrors: FieldErrors = {};
    const parse = (key: string, value: string, kind: 'money' | 'quantity') => {
      try { return kind === 'money' ? parseEuro(value) : parseQuantity(value, true); }
      catch (error) { nextErrors[key] = error instanceof Error ? error.message : 'Vlera nuk është e vlefshme.'; return null; }
    };
    const input: ProductUpdate = { id: product.id, name, categoryId: category, purchaseCostCents: parse('purchaseCostCents', cost, 'money'),
      sellingPriceCents: parse('sellingPriceCents', price, 'money'), trackInventory: tracking === '' ? null : tracking === 'yes',
      lowStockThreshold: tracking === 'yes' ? parse('lowStockThreshold', threshold, 'quantity') : product.lowStockThreshold, active };
    Object.assign(nextErrors, validateProductUpdate(input));
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    submitting.current = true; setBusy(true);
    try {
      const result = await window.fox.products.update(input);
      if (result.ok) onSaved(result.data);
      else setErrors(result.errors);
    } catch (error) { console.error('FOX product save failed', error); setErrors({ form: 'Produkti nuk u ruajt. Provo përsëri.' }); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <SidePanel title="Edito produktin" subtitle={`${product.name} · ${product.categoryName} · ${product.active ? 'Aktiv' : 'Joaktiv'}`} busy={busy} onClose={onClose} footer={<>
    <Button onClick={onClose} disabled={busy}>Anulo</Button><Button variant="primary" type="submit" form="product-form" disabled={busy}>{busy ? 'Duke ruajtur…' : 'Ruaj ndryshimet'}</Button>
  </>}>
    <form id="product-form" onSubmit={save} noValidate>
      {errors.form && <p role="alert" className="form-error">{errors.form}</p>}
      <fieldset disabled={busy}>
        <section className="form-section" aria-labelledby="product-section"><h3 id="product-section">Produkti</h3>
        <Field id="name" label="Emri" error={errors.name}><input id="name" value={name} onChange={e => { setName(e.target.value); clearError('name'); }} maxLength={200} data-initial-focus {...invalid('name')}/></Field>
        <div className="form-columns">
        <Field id="categoryId" label="Kategoria" error={errors.categoryId}><select id="categoryId" value={category} onChange={e => { setCategory(e.target.value as CategoryCode); clearError('categoryId'); }} {...invalid('categoryId')}>{CATEGORIES.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></Field>
        <Field id="active" label="Statusi" error={errors.active}><select id="active" value={active ? 'yes' : 'no'} onChange={e => { setActive(e.target.value === 'yes'); clearError('active'); }} {...invalid('active')}><option value="yes">Aktiv</option><option value="no">Joaktiv</option></select></Field>
        </div></section>
        <section className="form-section" aria-labelledby="price-section"><h3 id="price-section">Çmimet</h3>
        <div className="form-columns">
          <Field id="purchaseCostCents" label="Çmimi i blerjes (€)" error={errors.purchaseCostCents}><input id="purchaseCostCents" inputMode="decimal" value={cost} onChange={e => { setCost(e.target.value); clearError('purchaseCostCents'); }} placeholder="Pa vendosur" {...invalid('purchaseCostCents')}/>{review('purchaseCostCents')}</Field>
          <Field id="sellingPriceCents" label="Çmimi i shitjes (€)" error={errors.sellingPriceCents}><input id="sellingPriceCents" inputMode="decimal" value={price} onChange={e => { setPrice(e.target.value); clearError('sellingPriceCents'); }} placeholder="Pa vendosur" {...invalid('sellingPriceCents')}/>{review('sellingPriceCents')}</Field>
        </div>
        <p className="field-helper price-helper">Lëri bosh çmimet që nuk janë vendosur.</p>
        <div className="calculated-value"><span>Fitimi/copë <small>I llogaritur</small></span><output aria-live="polite" aria-label="Fitimi për copë">{profit === null ? '—' : formatMoney(profit)}</output></div>
        </section>
        <section className="form-section" aria-labelledby="stock-section"><h3 id="stock-section">Stoku</h3>
          <div className="form-columns"><Field id="trackInventory" label="Ndjek stokun" error={errors.trackInventory}><select id="trackInventory" value={tracking} onChange={e => { setTracking(e.target.value); clearError('trackInventory'); if (e.target.value !== 'yes') { setThreshold(product.lowStockThreshold === null ? '' : String(product.lowStockThreshold)); clearError('lowStockThreshold'); } }} {...invalid('trackInventory')}><option value="" disabled>Pa konfiguruar</option><option value="yes">Po</option><option value="no">Jo</option></select></Field>
          <Field id="lowStockThreshold" label="Pragu i stokut" error={tracking === 'yes' ? errors.lowStockThreshold : undefined}><input id="lowStockThreshold" inputMode="decimal" value={threshold} onChange={e => { setThreshold(e.target.value); clearError('lowStockThreshold'); }} placeholder="Pa vendosur" disabled={tracking !== 'yes'} {...(tracking === 'yes' ? invalid('lowStockThreshold') : {})}/></Field></div>
          <p className="field-helper">{tracking === '' ? 'Zgjidh Po ose Jo për të konfiguruar stokun.' : tracking === 'no' ? 'Pragu ruhet, por nuk zbatohet kur stoku nuk ndiqet.' : 'Pragu paralajmëron vetëm për stokun e njohur.'}</p>
          <div className="current-stock"><span>Stoku aktual</span><div>{tracking === 'yes' && product.stockQuantity !== null && <strong>{product.stockQuantity}</strong>}<StockBadge state={currentStock}/></div></div>
        </section>
      </fieldset>
    </form>
  </SidePanel>;
}
