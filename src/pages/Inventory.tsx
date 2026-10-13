import { useData } from '../app/useData';
import { useEffect, useState } from 'react';
import { DataState } from '../components/DataState';
import { formatMoney } from '../domain/money';
import { CATEGORIES } from '../domain/definitions';
import { inventorySummary, stockState, unitProfit } from '../domain/configuration';
import type { CatalogProduct, CategoryCode } from '../domain/types';
import { Button, EmptyState, Icon, PageHeader, StockBadge } from '../components/ui';
import { ProductEditor } from '../components/ProductEditor';
import { SupplyPanel } from '../components/SupplyPanel';
import {StockLossPanel} from '../components/StockLossPanel';
const load = () => window.fox.products.list();
export function Inventory() {
  const { data, error, retry, setData } = useData(load);
  const [category, setCategory] = useState<CategoryCode | ''>('');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<CatalogProduct>();
  const [supply, setSupply] = useState(false);
  const [loss,setLoss]=useState(false);
  const [feedback, setFeedback] = useState('');
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(''), 5000); return () => clearTimeout(timer); }, [feedback]);
  const onSaved = (product: CatalogProduct, message: string) => {
    setData(current => current?.map(p => p.id === product.id ? product : p));
    setEditor(undefined); setSupply(false); setFeedback(message);
  };
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('sq-AL');
  const filtered = data?.filter(p => (!category || p.categoryId === category) && normalize(p.name).includes(normalize(search.trim()))) ?? [];
  const summary = data ? inventorySummary(data) : null;
  const header = <PageHeader title="Stoku" helper="Produktet, çmimet dhe stoku." actions={<><Button variant="primary" onClick={() => setSupply(true)} disabled={!data}><Icon name="plus"/>Shto stok</Button><Button data-stock-loss onClick={()=>setLoss(true)} disabled={!data}>Hiq si humbje</Button></>}/>;
  if (!data || !summary) return <>{header}<DataState error={error} retry={retry}/></>;
  return <div data-page="inventory">
    {header}
    <dl className="summary-strip">
      <div><dt>Produkte</dt><dd>{summary.total}</dd><small title="Blerja dhe çmimi i shitjes janë të dy të vendosur.">Çmime të plota (blerje + shitje): {summary.fullyPriced}</small></div>
      <div><dt>Aktive</dt><dd>{summary.active}</dd></div>
      <div><dt>Stok i ulët</dt><dd>{summary.low}</dd></div>
      <div><dt>Vlera e mallit</dt><dd className={summary.inventoryValueCents === null ? 'incomplete-value' : ''}>{summary.inventoryValueCents === null ? 'Pa të dhëna të plota' : formatMoney(summary.inventoryValueCents)}</dd><small>Sipas çmimit të blerjes</small></div>
    </dl>
    <div className="inventory-surface">
      <div className="inventory-toolbar"><div className="category-filters" role="group" aria-label="Filtro sipas kategorisë">
        <Button variant="ghost" onClick={() => setCategory('')} aria-pressed={category === ''}>Të gjitha</Button>{CATEGORIES.map(c => <Button variant="ghost" key={c.id} onClick={() => setCategory(c.id)} aria-pressed={category === c.id}>{c.name}</Button>)}
      </div><div className="search-control"><Icon name="search"/><label className="sr-only" htmlFor="product-search">Kërko produkt</label><input id="product-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Kërko produkt..." type="search"/></div></div>
      <div className="table-caption"><span>{filtered.length} produkte{category || search ? ` nga ${data.length}` : ''}</span><span className="feedback" role="status">{feedback && <><Icon name="check"/>{feedback}</>}</span><span>«—» = Pa vendosur</span></div>
    {filtered.length ? <div className="catalog-scroll"><table className="catalog"><thead><tr>
      <th>Produkti</th><th>Kategoria</th><th className="numeric">Stoku</th>
      <th className="numeric">Blerja</th><th className="numeric">Shitja</th><th className="numeric">Fitimi për copë</th><th className="product-status">Statusi</th><th className="actions-heading">Veprime</th>
    </tr></thead><tbody>{filtered.map(product => {
      const state = stockState(product);
      return <tr key={product.id} className={product.active ? '' : 'inactive-row'} onClick={() => setEditor(product)}>
      <td className="product-name">{product.name}</td><td>{product.categoryName}</td><td className="stock-cell numeric">{product.trackInventory === true && product.stockQuantity !== null && <strong>{product.stockQuantity}</strong>}{state !== 'KNOWN' && <StockBadge state={state}/>}</td>
      <td className="numeric">{product.purchaseCostCents === null ? '—' : formatMoney(product.purchaseCostCents)}</td>
      <td className="numeric">{product.sellingPriceCents === null ? 'Pa çmim' : formatMoney(product.sellingPriceCents)}</td>
      <td className="numeric">{unitProfit(product) === null ? '—' : formatMoney(unitProfit(product))}</td>
      <td className="product-status">{product.active ? 'Aktiv' : 'Joaktiv'}</td>
      <td className="row-actions"><Button variant="ghost" aria-label={`Edito ${product.name}`} onClick={e => { e.stopPropagation(); setEditor(product); }}><Icon name="edit"/>Edito</Button></td>
    </tr>; })}</tbody></table></div> : <EmptyState title="Nuk u gjet asnjë produkt" helper="Provo një emër tjetër ose ndrysho filtrin e kategorisë." icon="search"/>}
    </div>
    {editor && <ProductEditor product={editor} onClose={() => setEditor(undefined)} onSaved={product => onSaved(product, 'Produkti u ruajt.')}/>}
    {supply && <SupplyPanel products={data} onClose={() => setSupply(false)} onSaved={product => onSaved(product, 'Furnizimi u regjistrua.')}/>}
    {loss&&<StockLossPanel products={data} onClose={()=>setLoss(false)} onSaved={()=>{setLoss(false);setFeedback('Humbja u regjistrua dhe stoku u përditësua.');retry();}}/>}
  </div>;
}
