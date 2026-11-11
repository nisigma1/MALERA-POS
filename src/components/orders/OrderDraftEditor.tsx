import { useState } from 'react';
import type { CatalogProduct, Category, CategoryCode } from '../../domain/types';
import type { OrderDraft } from '../../domain/orderDraft';
import { formatMoney } from '../../domain/money';
import { Button, Icon } from '../common/Controls';

function productUnavailable(product: CatalogProduct) {
  if (!product.active) return 'Joaktiv';
  if (product.sellingPriceCents === null) return 'Pa çmim';
  if (product.trackInventory === false) return;
  if (product.trackInventory === null) return 'Konfiguro stokun';
  if (product.stockQuantity === null) return 'Stok pa vendosur';
  if (product.stockQuantity <= 0) return 'Pa stok';
}

export function draftLineIssue(
  line: OrderDraft['items'][number],
  product: CatalogProduct | undefined,
  categories: readonly Category[],
) {
  if (!product) return 'Produkti mungon';
  if (!categories.some((item) => item.id === product.categoryId)) return 'Kategori joaktive';
  const { name, categoryId, unitPriceCents } = line.expectedProduct;
  if (
    product.name !== name ||
    product.categoryId !== categoryId ||
    product.sellingPriceCents !== unitPriceCents
  )
    return 'Produkti ka ndryshuar. Hiqe dhe zgjidhe përsëri.';
  return productUnavailable(product);
}

export function OrderDraftEditor({
  products,
  categories,
  draft,
  onChange,
  disabled,
  subtotal,
  showStock = false,
}: {
  products: CatalogProduct[];
  categories: readonly Category[];
  draft: OrderDraft;
  onChange(update: (draft: OrderDraft) => OrderDraft): void;
  disabled: boolean;
  subtotal: number | null;
  showStock?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryCode | '' | undefined>(
    showStock ? '' : undefined,
  );
  const activeCategories = categories;
  const categoryIds = new Set(activeCategories.map((item) => item.id));
  const catalog = products.filter((product) => categoryIds.has(product.categoryId));
  const activeProducts = catalog.filter((product) => product.active);
  const needsSetup = activeProducts.length === 0;
  const menu = activeProducts;
  const selectedCategory =
    category === '' || (category && categoryIds.has(category))
      ? category
      : (activeCategories.find((item) =>
          activeProducts.some((product) => product.categoryId === item.id),
        )?.id ?? '');
  const search = query.trim().toLowerCase();
  const visible = menu.filter((product) =>
    search
      ? product.name.toLowerCase().includes(search)
      : !selectedCategory || product.categoryId === selectedCategory,
  );
  const lines = new Map(draft.items.map((item) => [item.productId, item]));

  function changeQuantity(productId: string, delta: number) {
    onChange((previous) => {
      const line = previous.items.find((item) => item.productId === productId);
      const quantity = (line?.quantity ?? 0) + delta;
      if (quantity < 0 || quantity > 999 || (!line && previous.items.length >= 100))
        return previous;
      if (line)
        return {
          ...previous,
          items: previous.items
            .map((item) => (item === line ? { ...line, quantity } : item))
            .filter((item) => item.quantity > 0),
        };
      const product = products.find((item) => item.id === productId);
      if (!product || product.sellingPriceCents === null || productUnavailable(product))
        return previous;
      const expectedProduct = {
        name: product.name,
        categoryId: product.categoryId,
        unitPriceCents: product.sellingPriceCents,
      };
      return { ...previous, items: [...previous.items, { productId, quantity, expectedProduct }] };
    });
  }

  return (
    <section className="order-draft" aria-label="Shto produkte në porosi">
      <div
        className="order-categories draft-categories"
        role="group"
        aria-label="Kategoritë e produkteve"
      >
        <Button
          variant="ghost"
          data-order-all-products
          aria-pressed={!search && !selectedCategory}
          onClick={() => {
            setQuery('');
            setCategory('');
          }}
        >
          Të gjitha
        </Button>
        {activeCategories.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            data-order-category={item.id}
            aria-pressed={!search && item.id === selectedCategory}
            onClick={() => {
              setQuery('');
              setCategory(item.id);
            }}
          >
            {item.name}
          </Button>
        ))}
      </div>
      <input
        className="draft-search"
        type="search"
        aria-label="Kërko produkt"
        placeholder="Kërko produkt"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {needsSetup && catalog.length > 0 && (
        <p className="order-help">
          Për porosi, vendos çmimet e shitjes dhe aktivizo produktet te Stoku.
        </p>
      )}
      <div className="ops-products">
        {visible.map((product) => {
          const line = lines.get(product.id);
          const quantity = line?.quantity ?? 0;
          const issue = line
            ? draftLineIssue(line, product, categories)
            : productUnavailable(product);
          return (
            <div className="ops-product" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <p>
                  {product.sellingPriceCents === null
                    ? 'Pa çmim'
                    : formatMoney(product.sellingPriceCents)}
                  {issue && issue !== 'Pa çmim' && (
                    <span className="draft-product-issue">{issue}</span>
                  )}
                </p>
                {showStock && (
                  <p className="order-stock">
                    {product.trackInventory && product.stockQuantity !== null
                      ? `Stoku: ${product.stockQuantity}`
                      : 'Stok pa numëruar'}
                  </p>
                )}
              </div>
              <div className="quantity-control">
                <Button
                  className="icon-button"
                  data-ops-remove={product.id}
                  disabled={disabled || quantity === 0}
                  aria-label={`Hiq një ${product.name}`}
                  onClick={() => changeQuantity(product.id, -1)}
                >
                  <Icon name="minus" />
                </Button>
                <span data-ops-quantity={product.id}>{quantity}</span>
                <Button
                  className="icon-button"
                  data-order-product={product.id}
                  disabled={
                    disabled ||
                    !!issue ||
                    quantity >= 999 ||
                    (quantity === 0 && draft.items.length >= 100)
                  }
                  aria-label={`Shto një ${product.name}`}
                  onClick={() => changeQuantity(product.id, 1)}
                >
                  <Icon name="plus" />
                </Button>
              </div>
            </div>
          );
        })}
        {!visible.length && (
          <div className="order-category-empty">
            <p>
              {search
                ? 'Nuk u gjet asnjë produkt.'
                : selectedCategory
                  ? 'Kjo kategori është bosh.'
                  : 'Përgatit produktet te Stoku.'}
            </p>
            {!search && selectedCategory && menu.length > 0 && (
              <Button onClick={() => setCategory('')}>Shiko të gjitha</Button>
            )}
          </div>
        )}
      </div>
      {draft.items.length > 0 && (
        <section className="draft-summary" aria-label="Drafti i porosisë">
          <h3>Drafti · i paporositur</h3>
          {draft.items.map((line) => {
            const {
              productId,
              quantity,
              expectedProduct: { name, unitPriceCents },
            } = line;
            const issue = draftLineIssue(
              line,
              products.find((product) => product.id === productId),
              categories,
            );
            const total = quantity * unitPriceCents;
            return (
              <div className="draft-line" key={productId} data-draft-line={productId}>
                <div className="draft-line-label">
                  <strong>{name}</strong>
                  <small>{formatMoney(unitPriceCents)} / njësi</small>
                  {issue && <small>{issue}</small>}
                </div>
                <strong data-draft-line-total>
                  {Number.isSafeInteger(total) ? formatMoney(total) : '—'}
                </strong>
                <div className="quantity-control">
                  <Button
                    className="icon-button"
                    disabled={disabled}
                    aria-label={`Ul sasinë e ${name} në draft`}
                    onClick={() => changeQuantity(productId, -1)}
                  >
                    <Icon name="minus" />
                  </Button>
                  <span data-draft-quantity>{quantity}</span>
                  <Button
                    className="icon-button"
                    disabled={disabled || !!issue || quantity >= 999}
                    aria-label={`Rrit sasinë e ${name} në draft`}
                    onClick={() => changeQuantity(productId, 1)}
                  >
                    <Icon name="plus" />
                  </Button>
                  <Button
                    className="icon-button"
                    variant="ghost"
                    data-draft-remove
                    disabled={disabled}
                    aria-label={`Hiq ${name} nga drafti`}
                    onClick={() => changeQuantity(productId, -quantity)}
                  >
                    <Icon name="trash" />
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="draft-summary-total">
            <span>Totali i draftit</span>
            <strong data-draft-total>{subtotal === null ? '—' : formatMoney(subtotal)}</strong>
          </div>
        </section>
      )}
    </section>
  );
}
