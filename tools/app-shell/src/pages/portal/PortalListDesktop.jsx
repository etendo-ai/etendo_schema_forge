import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { useUI } from '@/i18n';
import { cn } from '@/lib/utils';
import { TableRow } from '@/components/ui/table';
import { listRowClassName } from '@/components/contract-ui/rowVisuals.js';
import {
  PortalDate, PortalDocumentStatus, PortalDueDate, PortalInvoiceTypeBadge, PortalMoney,
  PortalPaymentStatus, PORTAL_FIGMA_SHADOW, PORTAL_ROW_FOCUS, portalRowActivation,
  PortalConvertedAmount, portalShowsConverted, usePortalTabLabel,
} from './PortalBits.jsx';
import { PortalDateSelect, PortalTypeSelect } from './PortalListFilters.jsx';
import {
  PORTAL_KIND_META, documentLabelKey, quotationValidity,
} from './portalPresentation.js';

/*
 * The desktop list of one document kind as the designer's Figma "PC Presupuestos" draws it
 * (2026-11-17): the view toolbar and the table. Hex values, sizes and type are the Figma's; the
 * badges use the main screen's Figma palette, with the app's status names. Quotations are the
 * reference; orders, shipments and invoices take the same styling with their own tabs (the
 * customer-facing status groups they already had) and columns. The mobile list is not here.
 */

/** A 40px bordered white icon button of the toolbar (refresh). */
const TOOL = `inline-flex h-10 items-center justify-center rounded-lg border border-[#C7CBD3] bg-white text-[#81848F] transition-colors hover:bg-[#F3F5F9] ${PORTAL_FIGMA_SHADOW}`;

/** The Figma's tab button: 32px, padding 8px 12px, r8, label 14/24 (padding 0 4px). */
function Tab({ selected, onClick, testId, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-3 py-2',
        selected
          ? 'bg-white shadow-[0_1px_3px_rgba(27,26,31,0.1),0_1px_2px_rgba(27,26,31,0.06)]'
          : 'hover:bg-white/60',
      )}
      data-testid={testId}
    >
      <span className={cn('px-1 text-sm leading-6', selected ? 'font-medium text-[#1B1A1F]' : 'font-normal text-[#40465C]')}>
        {children}
      </span>
    </button>
  );
}

/**
 * The view toolbar (padding 8px): the kind's status tabs, then the app list toolbar's quick
 * filters (ETP-6209, `PortalListFilters.jsx`: the document type of a kind that mixes types, the
 * date range — same buttons, popovers and active border as `ListFilterBar`); refresh on the right.
 * No status selector: the tabs are the status filter, as in the app's windows that hide their
 * status dropdown behind tabs (`hideStatusFilter`). "Descargar seleccionados" and the row
 * checkboxes are out (PO answer: bulk download is a performance risk), and so is the advanced
 * filter (the portal API takes no NEO criteria). `dateActive`: the range is not the tab's default.
 */
export function PortalListToolbar({
  kind, tabs, group, onGroup, range, onRange, onRefresh, subtype = null, onSubtype, dateActive = false,
}) {
  const ui = useUI();
  const tabLabel = usePortalTabLabel();
  return (
    <div className="hidden items-start justify-between gap-2.5 p-2 md:flex" data-kind={kind} data-testid="portal-list-toolbar">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={ui('portalColStatus')}
          className="flex items-center gap-1 overflow-x-auto rounded-xl bg-[#F3F5F9] p-1"
          style={{ scrollbarWidth: 'none' }}
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.code ?? 'all'}
              selected={(group ?? null) === tab.code}
              onClick={() => onGroup(tab.code)}
              testId={`portal-status-tab-${(tab.code ?? 'all').toLowerCase()}`}
              data-testid="Tab__b71e0c">
              {tabLabel(tab)}
            </Tab>
          ))}
        </div>
        <PortalTypeSelect kind={kind} subtype={subtype} onSubtype={onSubtype} data-testid="PortalTypeSelect__b71e0c" />
        <PortalDateSelect value={range} onChange={onRange} active={dateActive} data-testid="PortalDateSelect__b71e0c" />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" aria-label={ui('portalRefresh')} title={ui('portalRefresh')} onClick={onRefresh} className={cn(TOOL, 'w-10 p-2')} data-testid="portal-refresh">
          <ArrowsClockwiseIcon size={20} aria-hidden="true" data-testid="ArrowsClockwise__b71e0c" />
        </button>
      </div>
    </div>
  );
}

/** A 6px dot in a 24px box before "Válido hasta" (Figma: #FFC233 while it can be answered). */
function ValidityCell({ document }) {
  const validity = quotationValidity(document);
  if (!validity) return <span className="text-[#6B7280]">—</span>;
  let dot = null;
  if (validity.state === 'open') dot = 'bg-[#FFC233]';
  if (validity.state === 'expired') dot = 'bg-[#D50B3E]';
  return (
    <span className="inline-flex items-center" data-testid="portal-valid-until" data-state={validity.state}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
        {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', dot)} /> : null}
      </span>
      <span className={validity.state === 'answered' ? 'text-[#6B7280]' : ''}>
        <PortalDate value={document.validUntil} data-testid="PortalDate__b71e0c" />
      </span>
    </span>
  );
}

/** A document row: the app list row of `rowVisuals.js` (clickable, default lift). */
const PORTAL_ROW = listRowClassName({ clickable: true });

/** The 24px status badge of the table (r360, no border, 12/16, Figma palette). */
const TABLE_BADGE = 'h-6 rounded-full border-transparent px-2 py-1 font-normal tracking-[-0.005em]';

/**
 * Sums of the rows shown, one per currency (never two currencies in one figure). A shipment list
 * has no amounts and no totals. Only the fallback for a backend that sends no `totals`.
 */
function totalsByCurrency(documents) {
  const totals = new Map();
  for (const document of documents) {
    const currency = document.currency ?? '';
    const entry = totals.get(currency) ?? { currency: document.currency, taxBase: 0, grandTotal: 0 };
    entry.taxBase += document.taxBase ?? 0;
    entry.grandTotal += document.grandTotal ?? 0;
    totals.set(currency, entry);
  }
  return [...totals.values()];
}

/**
 * The totals row(s) of the table (QA 24/11 CP-47 and f):
 * - several currencies and the backend's converted figure → ONE row, "≈ 1.234,56 €" in the company
 *   currency (the app's list footer), no tax base (it is not converted);
 * - otherwise the backend's per-currency totals of the WHOLE filtered set (the "Y" of "Mostrando X
 *   de Y"), so the total does not change with "Cargar más";
 * - an older backend without totals → the sum of the rows loaded, as before.
 *
 * @returns {{ converted: object|null, rows: Array<{currency, taxBase, grandTotal}> }}
 */
function tableTotals(documents, totals, convertedTotal) {
  const perCurrency = Array.isArray(totals) && totals.length ? totals : totalsByCurrency(documents);
  if (portalShowsConverted(perCurrency, convertedTotal)) return { converted: convertedTotal, rows: [] };
  return { converted: null, rows: perCurrency };
}

/**
 * The table (Figma "Tabla"): the kind's columns at the Figma's widths (no checkbox column: bulk
 * download is out), 40px rows split by #E3E7EC rules, and a "Total" row per currency of the rows shown.
 * Quotations: date (semibold), number, reference, "Válido hasta" with its dot, status, tax base,
 * total. Invoices keep the story's columns (document type, due date, payment state, outstanding);
 * shipments carry no amounts. A row opens its document.
 */
export function PortalListTable({
  kind, documents, totals = null, convertedTotal = null, onOpen,
}) {
  const ui = useUI();
  const summary = tableTotals(documents, totals, convertedTotal);
  const isInvoice = kind === 'INVOICE';
  const isQuotation = kind === 'QUOTATION';
  const hasAmounts = kind !== 'SHIPMENT';
  const th = 'h-10 whitespace-nowrap px-3 text-left text-xs font-semibold leading-4 tracking-[-0.005em] text-[#1B1A1F]';
  const td = 'h-10 whitespace-nowrap px-3 text-sm leading-5 text-[#1B1A1F]';
  // Invoices carry three more columns than the quotation list: up to a 1280px screen the tax base
  // gives way (shown from 2xl), so "Imp. total" and "Pendiente" always fit.
  const taxBase = isInvoice ? 'hidden 2xl:table-cell' : '';
  const leadingColumns = 4 + (isQuotation || isInvoice ? 1 : 0) + (isInvoice ? 2 : 0);
  return (
    // Room for the last row's lift shadow, as DataTable keeps it (ETP-5388 / ETP-5600): the scroll
    // box (`overflow-x-auto` also clips vertically) gets 24px of click-through padding below the
    // table, and the outer box takes it back with a negative margin, so no gap shows and what
    // follows starts right under the last row (or the totals row). The `!` beats a parent's
    // `space-y-*` margin reset.
    <div className="hidden overflow-x-auto !-mb-6 md:block" data-testid="portal-document-table-scroll">
      <div className="pointer-events-none pb-6 [&>table]:pointer-events-auto">
      <table className="w-full border-collapse" data-testid="portal-document-table">
        <thead>
          <tr className="border-b border-[#E3E7EC]">
            <th className={cn(th, 'w-[178px]')}>{ui(PORTAL_KIND_META[kind].dateColumnKey)}</th>
            {isInvoice ? <th className={th}>{ui('documentType')}</th> : null}
            <th className={cn(th, 'w-[140px]')}>{ui('portalColDocumentNo')}</th>
            <th className={cn(th, 'w-[240px]')}>{ui('portalColReference')}</th>
            {isQuotation ? <th className={cn(th, 'w-[136px]')}>{ui('portalColValidUntil')}</th> : null}
            {isInvoice ? <th className={th}>{ui('portalColDueDate')}</th> : null}
            <th className={cn(th, 'w-[148px]')}>{ui('portalColStatus')}</th>
            {isInvoice ? <th className={th}>{ui('portalColPaymentStatus')}</th> : null}
            {hasAmounts ? <th className={cn(th, taxBase, 'text-right')}>{ui('portalColTaxBase')}</th> : null}
            {hasAmounts ? <th className={cn(th, 'text-right')}>{ui('portalColTotal')}</th> : null}
            {isInvoice ? <th className={cn(th, 'text-right')}>{ui('portalColOutstanding')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <TableRow
              key={document.id}
              // The app lists' row (ETP-6209): the same hover lift, borders and cursor as every
              // DataTable list, from the one shared helper; only the focus ring is the portal's.
              className={cn(PORTAL_ROW, PORTAL_ROW_FOCUS)}
              {...portalRowActivation(() => onOpen(document), `${ui(documentLabelKey(document))} ${document.documentNo ?? ''}`.trim())}
              data-testid="portal-document-row"
            >
              <td className={cn(td, 'font-semibold tabular-nums')}><PortalDate value={document.date} data-testid="PortalDate__b71e0c" /></td>
              {isInvoice ? <td className={td}><PortalInvoiceTypeBadge document={document} data-testid="PortalInvoiceTypeBadge__b71e0c" /></td> : null}
              <td className={td}>
                {/* The number stays its own button (keyboard and screen readers); the row opens the
                    same document. Hover is the row's only (Figma): no colour change on the number. */}
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); onOpen(document); }}
                  className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="portal-document-open"
                >
                  {document.documentNo}
                </button>
              </td>
              <td className={cn(td, 'max-w-[240px] truncate')} title={document.reference || undefined}>{document.reference || '—'}</td>
              {isQuotation ? <td className={cn(td, 'pl-1 tabular-nums')}><ValidityCell document={document} data-testid="ValidityCell__b71e0c" /></td> : null}
              {isInvoice ? <td className={cn(td, 'tabular-nums')}><PortalDueDate document={document} data-testid="PortalDueDate__b71e0c" /></td> : null}
              <td className={td}>
                <PortalDocumentStatus status={document.documentStatus} palette="figma" className={TABLE_BADGE} data-testid="PortalDocumentStatus__b71e0c" />
              </td>
              {isInvoice ? (
                <td className={td}>
                  <PortalPaymentStatus document={document} palette="figma" className={TABLE_BADGE} data-testid="PortalPaymentStatus__b71e0c" />
                </td>
              ) : null}
              {hasAmounts ? (
                <td className={cn(td, taxBase, 'text-right tabular-nums')}>
                  <PortalMoney currency={document.currency} value={document.taxBase} data-testid="PortalMoney__b71e0c" />
                </td>
              ) : null}
              {hasAmounts ? (
                <td className={cn(td, 'text-right tabular-nums')}>
                  <PortalMoney currency={document.currency} value={document.grandTotal} data-testid="PortalMoney__b71e0c" />
                </td>
              ) : null}
              {isInvoice ? (
                <td className={cn(td, 'text-right tabular-nums')}>
                  <PortalMoney currency={document.currency} value={document.outstandingAmount} data-testid="PortalMoney__b71e0c" />
                </td>
              ) : null}
            </TableRow>
          ))}
          {hasAmounts && summary.converted ? (
            <tr className="font-semibold" data-testid="portal-document-totals">
              <td colSpan={leadingColumns} className="h-10 px-3 text-sm leading-5 text-[#1B1A1F]">{ui('portalTotal')}</td>
              <td className={cn('h-10 px-3', taxBase)} />
              <td className="h-10 px-3 text-right text-sm leading-5 tabular-nums text-[#1B1A1F]">
                <PortalConvertedAmount
                  converted={summary.converted}
                  testId="portal-document-totals-converted"
                  data-testid="PortalConvertedAmount__b71e0c" />
              </td>
              {isInvoice ? <td /> : null}
            </tr>
          ) : null}
          {hasAmounts ? summary.rows.map((total) => (
            <tr key={total.currency ?? 'none'} className="font-semibold" data-testid="portal-document-totals">
              <td colSpan={leadingColumns} className="h-10 px-3 text-sm leading-5 text-[#1B1A1F]">{ui('portalTotal')}</td>
              <td className={cn('h-10 px-3 text-right text-sm leading-5 tabular-nums text-[#1B1A1F]', taxBase)}>
                <PortalMoney currency={total.currency} value={total.taxBase} data-testid="PortalMoney__b71e0c" />
              </td>
              <td className="h-10 px-3 text-right text-sm leading-5 tabular-nums text-[#1B1A1F]">
                <PortalMoney currency={total.currency} value={total.grandTotal} data-testid="PortalMoney__b71e0c" />
              </td>
              {isInvoice ? <td /> : null}
            </tr>
          )) : null}
        </tbody>
      </table>
      </div>
    </div>
  );
}
