import { useMemo, useState } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { InlineSearchCombo } from '@/components/contract-ui/InlineSearchCombo.jsx';
import ProductSearchDrawer from '@/components/contract-ui/ProductSearchDrawer.jsx';
import { buildLineSelectorContext } from '@/lib/selectorContext.js';
import { deriveSelectorUrl } from '@/components/copilot/ocr/ocrQuery.js';

/**
 * The selectors the panel searches (plan 9.1): the purchase-invoice vendor and line product
 * selectors (what the single-invoice OCR flow uses, `ocrDocTypes.js`), the product spec's
 * category and unit selectors, and the contacts' country selector. A search is always a selector
 * `q` (never a raw `_neoWhere`, which the production WAF blocks).
 */
const PURCHASE_INVOICE = 'purchase-invoice';
export const PICKER_SELECTORS = Object.freeze({
  vendor: { spec: PURCHASE_INVOICE, entity: 'header', column: 'C_BPartner_ID', params: { isSOTrx: 'N', isVendor: 'Y' } },
  product: { spec: PURCHASE_INVOICE, entity: 'lines', column: 'M_Product_ID', params: {} },
  category: { spec: 'product', entity: 'product', column: 'M_Product_Category_ID', params: {} },
  uom: { spec: 'product', entity: 'product', column: 'C_UOM_ID', params: {} },
  country: { spec: 'contacts', entity: 'locationAddress', column: 'C_Country_ID', params: {} },
  // The SAME selector the purchase-invoice lines use for their tax (the `tax` field, inputMode selector).
  tax: { spec: PURCHASE_INVOICE, entity: 'lines', column: 'C_Tax_ID', params: {} },
});

const NO_OPTIONS = Object.freeze([]);

/**
 * ETP-6050 S2 — a search-and-pick over a NEO selector, built on the shared `InlineSearchCombo`, so
 * it opens on the committed value: marked with a check and `aria-selected`, centred, arrows
 * starting from it (`selectorSelection.js`, `useLocateCommittedValue`). `value` is the committed
 * id and `label` its name; leaving either out would make the picker open at the top without
 * telling anyone. The combo never clears the value on typing (`clearOnType={false}`): a typed
 * search is not a choice, and nothing is written until the user picks a row.
 *
 * @param {{kind: keyof typeof PICKER_SELECTORS, apiBaseUrl: string, value?: string|null,
 *   label?: string, placeholder?: string, fieldKey: string, params?: object, onPick: (pick: {id: string,
 *   name: string, option: object}) => void}} props
 */
export function EntityPicker({ kind, apiBaseUrl, value = null, label = '', placeholder = '', fieldKey, onPick, params = null }) {
  const spec = PICKER_SELECTORS[kind];
  const selectorUrl = useMemo(
    () => deriveSelectorUrl(apiBaseUrl, spec.spec, spec.entity, spec.column),
    [apiBaseUrl, spec],
  );
  // Extra selector context (the tax selector reads the document date and the supplier's address); keyed
  // by content so a new object each render does not refetch.
  const paramsKey = JSON.stringify(params ?? {});
  const selectorContext = useMemo(() => ({ ...spec.params, ...JSON.parse(paramsKey) }), [spec, paramsKey]);
  const field = useMemo(() => ({ key: fieldKey, id: fieldKey, required: true }), [fieldKey]);
  return (
    <InlineSearchCombo
      field={field}
      value={value ?? ''}
      displayLabel={label}
      options={NO_OPTIONS}
      selectorUrl={selectorUrl}
      selectorContext={selectorContext}
      placeholder={placeholder}
      clearOnType={false}
      onChange={(id, name, option) => { if (id) onPick({ id, name, option: option ?? {} }); }}
      data-testid={`EntityPicker__${fieldKey}`} />
  );
}

/**
 * ETP-6051 — the product picker of a MANUAL line: the shared `ProductSearchDrawer` over the very selector
 * the purchase-invoice lines use, with that window's context (price list, document date, purchase side,
 * `currency`, `priceCurrency` = the organization's, the rate), so it lists only the products of the price
 * list and shows each one's list price and, underneath, the converted one. It opens on the committed value
 * (`value` / `valueLabel`). Picking sends the same `selectProduct` the OCR lines use; the server prices the
 * line. `pricing` is `manualPricingOf(review, header)`.
 *
 * @param {{apiBaseUrl: string, pricing: object, value?: string|null, label?: string, placeholder?: string,
 *   fieldKey: string, onPick: (pick: {id: string, name: string, option: object}) => void}} props
 */
export function ManualProductPicker({ apiBaseUrl, pricing, value = null, label = '', placeholder = '', fieldKey, onPick }) {
  const [open, setOpen] = useState(false);
  const { priceListId, orgIso, docIso, rate, invoiceDate } = pricing;
  const selectorUrl = useMemo(
    () => deriveSelectorUrl(apiBaseUrl, PURCHASE_INVOICE, 'lines', 'M_Product_ID'),
    [apiBaseUrl],
  );
  const selectorContext = useMemo(() => ({
    ...buildLineSelectorContext({
      windowCategory: 'purchases',
      headerRecord: { invoiceDate, priceList: priceListId, eTGOCurrencyRate: rate },
    }),
    ...(docIso ? { currency: docIso } : {}),
    ...(orgIso ? { priceCurrency: orgIso } : {}),
  }), [invoiceDate, priceListId, rate, docIso, orgIso]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-2.5 text-left text-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
        data-testid={`ManualProductPicker__${fieldKey}`}>
        <MagnifyingGlassIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" data-testid={`Search__${fieldKey}`} />
        {label
          ? <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
          : <span className="min-w-0 flex-1 truncate text-muted-foreground">{placeholder}</span>}
      </button>
      <ProductSearchDrawer
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(item) => {
          setOpen(false);
          const id = item?.id ?? '';
          if (id) onPick({ id, name: item.label || item.name || item._identifier || '', option: item });
        }}
        selectorUrl={selectorUrl}
        selectorContext={selectorContext}
        value={value}
        valueLabel={label}
        title={placeholder}
        data-testid={`ProductSearchDrawer__${fieldKey}`} />
    </>
  );
}
