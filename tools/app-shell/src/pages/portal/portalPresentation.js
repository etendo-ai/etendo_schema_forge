// Relative imports, not the `@/` alias: keeps this module loadable by plain `node --test`.
import { resolveInvoicePaymentBadge } from '../../windows/custom/shared/invoicePaymentBadge.js';
import { getCalendarDateRelation, todayCalendarISO } from '../../lib/dateOnly.js';
import { isCompletedStatus, isNotApprovedStatus } from '../../lib/docStatus.js';

/**
 * Presentation rules of the customer portal (ETP-6209 Part B) — pure, no React.
 *
 * Statuses and payment states are the app's own: document status through `statusLabel` /
 * `DocumentStatusPill` (`lib/statusBadge.js`), invoice payment through
 * `resolveInvoicePaymentBadge` (`windows/custom/shared/invoicePaymentBadge.js`), the due-date dot
 * through `getDueDateState` (`lib/invoiceDueDate.js`). Nothing here invents a status of its own.
 */

/** Per kind: the i18n keys a view names it with, and the list's date column. */
export const PORTAL_KIND_META = Object.freeze({
  QUOTATION: {
    singularKey: 'portalKindQuotation',
    pluralKey: 'portalKindQuotationPlural',
    dateColumnKey: 'portalColQuotationDate',
  },
  ORDER: {
    singularKey: 'portalKindOrder',
    pluralKey: 'portalKindOrderPlural',
    dateColumnKey: 'portalColOrderDate',
  },
  SHIPMENT: {
    singularKey: 'portalKindShipment',
    pluralKey: 'portalKindShipmentPlural',
    dateColumnKey: 'portalColShipmentDate',
  },
  INVOICE: {
    singularKey: 'portalKindInvoice',
    pluralKey: 'portalKindInvoicePlural',
    dateColumnKey: 'portalColInvoiceDate',
  },
});

/**
 * The list tabs per kind (design Listado: "Todos / Por responder / Aceptados / Rechazados"): the
 * customer-facing status groups the backend defines (`PortalDocumentQuery.GROUPS`), each with its
 * label. "All" is the implicit first tab. The mapping is recorded in the plan (§B.4). Labels are
 * the app's own status keys (PO answer: the same status names as the app), the ones its badges
 * use; only "delivered" keeps a portal key, as the app has no status of that name.
 *
 * `statusCode` (QA 24/11 CP-16): a group that stands for one document status is named exactly as
 * the app names that status (the AD list translation through `statusLabel`, e.g. UE "Bajo
 * evaluación", VO "Anulada"), so the tab and the badges of its rows read the same. `labelKey` is
 * the fallback.
 */
export const PORTAL_KIND_GROUPS = Object.freeze({
  QUOTATION: [
    { code: 'awaiting', statusCode: 'UE', labelKey: 'docStatusUe' },
    { code: 'accepted', statusCode: 'ETGO_AC', labelKey: 'statusAccepted' },
    { code: 'rejected', statusCode: 'CJ', labelKey: 'statusRejected' },
  ],
  ORDER: [
    { code: 'inProgress', labelKey: 'statusInProcess' },
    { code: 'completed', statusCode: 'CO', labelKey: 'statusComplete' },
    { code: 'voided', statusCode: 'VO', labelKey: 'statusVoid' },
  ],
  SHIPMENT: [
    { code: 'delivered', labelKey: 'portalGroupDelivered' },
    { code: 'voided', statusCode: 'VO', labelKey: 'statusVoid' },
  ],
  INVOICE: [
    { code: 'pending', labelKey: 'statusPending' },
    { code: 'overdue', labelKey: 'statusOverdue' },
    { code: 'paid', labelKey: 'statusPaid' },
  ],
});

/**
 * The document types inside a kind that mixes them (QA 24/11 CP-16: "tipo" is one of the app's
 * quick filters): invoices and credit notes share the invoice list. The labels are the row badge's
 * (`PortalInvoiceTypeBadge`), so the filter names a type exactly as the rows show it. The code is
 * sent as the list's `subtype` query parameter.
 */
export const PORTAL_KIND_SUBTYPES = Object.freeze({
  INVOICE: Object.freeze([
    { code: 'invoice', labelKey: 'invoicesTab' },
    { code: 'creditNote', labelKey: 'rectificativeInvoicesTab' },
  ]),
});

/** Whether `subtype` is one of `kind`'s document types. */
export function isPortalSubtype(kind, subtype) {
  return Boolean(subtype) && (PORTAL_KIND_SUBTYPES[kind] ?? []).some((s) => s.code === subtype);
}

/** Whether `group` is one of `kind`'s tabs. */
export function isPortalGroup(kind, group) {
  return Boolean(group) && (PORTAL_KIND_GROUPS[kind] ?? []).some((g) => g.code === group);
}

/**
 * The "Requiere tu atención" tiles: the figure each kind calls out (the backend's `highlight`),
 * its badge, and the list tab a click opens — the same set, so the tile and the tab agree.
 */
export const PORTAL_HIGHLIGHTS = Object.freeze({
  awaitingAnswer: { labelKey: 'portalHighlightAwaitingAnswer', tone: 'info', group: 'awaiting' },
  overdue: { labelKey: 'portalHighlightOverdue', tone: 'destructive', group: 'overdue' },
  inProgress: { labelKey: 'portalHighlightInProgress', tone: 'warning', group: 'inProgress' },
  thisMonth: { labelKey: 'portalHighlightThisMonth', tone: 'neutral', group: null },
});

/**
 * A quotation's "Válido hasta" as the design draws it: a dot while the customer can still answer
 * (`UE`/`CO`) — the foreground colour, or the destructive one once the date is past — and plain
 * muted text once answered. `null` when the quotation has no validity date.
 *
 * @returns {{ state: 'open'|'expired'|'answered' }|null}
 */
export function quotationValidity(document) {
  if (document?.kind !== 'QUOTATION' || !document.validUntil) return null;
  const open = isNotApprovedStatus(document.documentStatus) || isCompletedStatus(document.documentStatus);
  if (!open) return { state: 'answered' };
  return { state: getCalendarDateRelation(document.validUntil) === 'past' ? 'expired' : 'open' };
}

/**
 * Whether the portal offers Aceptar / Rechazar on a quotation (ETP-6209 Part C; QA 24/11 CP-49).
 *
 * The backend decides (the row's `canDecide`, and `decision.canDecide` on a detail: pending, not expired, AND
 * emailed to the address this link was sent to); the browser only refuses on top of it, never
 * grants: a quotation already answered or whose validity date is past shows no buttons even if an
 * answer said otherwise. A missing flag is `false`.
 */
export function canOfferDecision(document) {
  if (document?.kind !== 'QUOTATION') return false;
  // A list row carries only its own `canDecide`; a detail also carries the `decision` block, and
  // then both must agree.
  if (document.canDecide !== true) return false;
  if (document.decision != null && document.decision.canDecide !== true) return false;
  if (!(isNotApprovedStatus(document.documentStatus) || isCompletedStatus(document.documentStatus))) {
    return false;
  }
  return quotationValidity(document)?.state !== 'expired';
}

/**
 * Whether the portal offers "Aceptar" (ETP-6209 Part C, PO answer to Q1: a confirmed accept moves
 * the quotation to `ETGO_AC` "Aceptado", still convertible in the app). Kept as a switch with the
 * backend's `PortalDecisionService.ACCEPT_AVAILABLE` (reported as `decision.acceptAvailable`);
 * the button shows only when both are on.
 */
export const PORTAL_ACCEPT_ENABLED = true;

/**
 * Addresses as one phrase: "a", "a y b", "a, b y c" (`conjunction` is the locale's "y" / "and").
 * The confirmation goes to every To recipient of the original send, never the CC (QA CP-45).
 */
export function joinRecipients(recipients, conjunction) {
  const list = (recipients ?? []).filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} ${conjunction} ${list[list.length - 1]}`;
}

/** The fixed reject reasons (PO spec), with the API codes; "Otros" requires a text. */
export const PORTAL_REJECT_REASONS = Object.freeze([
  { code: 'PRICE', labelKey: 'portalRejectReasonPrice' },
  { code: 'DELIVERY', labelKey: 'portalRejectReasonDelivery' },
  { code: 'PAYMENT_TERMS', labelKey: 'portalRejectReasonPaymentTerms' },
  { code: 'OTHER_SUPPLIER', labelKey: 'portalRejectReasonOtherSupplier' },
  { code: 'NOT_NEEDED', labelKey: 'portalRejectReasonNotNeeded' },
  { code: 'OTHER', labelKey: 'portalRejectReasonOther' },
]);

/** The reject reason that requires a text. */
export const PORTAL_REJECT_REASON_OTHER = 'OTHER';

/** The singular label key of one document, telling a credit note from an invoice. */
export function documentLabelKey(document) {
  if (document?.kind === 'INVOICE' && document?.isCreditNote) return 'portalKindCreditNote';
  return PORTAL_KIND_META[document?.kind]?.singularKey ?? 'portalKindInvoice';
}

/**
 * The payment state of an invoice as the app shows it.
 *
 * Source of truth, since no shared helper maps a payment badge to a tag (each window renders its
 * own): the states come from `resolveInvoicePaymentBadge` (`windows/custom/shared/
 * invoicePaymentBadge.js`), and the labels are the ones the sales invoice topbar uses for them
 * (`artifacts/sales-invoice/custom/InvoiceTopbarExtra.jsx`: `statusPaid`, `statusPartial`,
 * `statusPending`, `statusOverdue`, `cpFavorBadge`, `cpCreditFullyApplied`), with the app's
 * `StatusTag` tones.
 *
 * **Overdue is decided like the app, in the browser's calendar day** (ETP-6209 review N-b):
 * - with the instalments (the document detail), like the topbar — overdue when any instalment
 *   still owing money is past due (`getCalendarDateRelation`, local-day parsing);
 * - without them (lists, home), from the row's server `overdue` flag (an instalment past due with
 *   money still owed — the same schedule query the detail reads). QA 24/11 CP-18: the list said
 *   "Pendiente" for an overdue invoice, even inside the "Vencido" tab, while the detail and the
 *   app said "Vencido"; list, home and detail must agree.
 *
 * @param {object} document a portal document
 * @param {Array<{dueDate: string, outstandingAmount: number}>} [installments] the detail's
 *   instalments, when known
 * @returns {{ id: string, labelKey: string, tone: string }|null} null when not an invoice
 */
export function invoicePaymentState(document, installments = null, { useServerOverdue = true } = {}) {
  if (document?.kind !== 'INVOICE') return null;
  const badge = resolveInvoicePaymentBadge({
    grandTotalAmount: document.grandTotal,
    outstandingAmount: document.outstandingAmount,
    documentStatus: document.documentStatus,
  });
  if (badge.kind === 'draft') return null;
  // The row's server `overdue` flag (an instalment past due with money owed) counts everywhere by
  // default (CP-18); `useServerOverdue: false` is left for a caller that must judge by the
  // instalments alone.
  const overdue = (useServerOverdue && document.overdue === true)
    || (Array.isArray(installments) && installments.some((installment) => (
      (installment.outstandingAmount ?? 0) > 0
        && getCalendarDateRelation(installment.dueDate) === 'past')));
  if (!badge.isCredit && overdue && (badge.kind === 'pending' || badge.kind === 'partial')) {
    return { id: 'overdue', labelKey: 'statusOverdue', tone: 'destructive' };
  }
  switch (badge.kind) {
    case 'paid':
      return { id: 'paid', labelKey: 'statusPaid', tone: 'success' };
    case 'partial':
      return { id: 'partial', labelKey: 'statusPartial', tone: 'warning' };
    case 'credit-available':
      return { id: 'credit-available', labelKey: 'cpFavorBadge', tone: 'info' };
    case 'credit-applied':
      return { id: 'credit-applied', labelKey: 'cpCreditFullyApplied', tone: 'success' };
    default:
      return { id: 'pending', labelKey: 'statusPending', tone: 'neutral' };
  }
}

/**
 * The default list range (decision D-2, the ticket's "el listado por defecto muestra el último
 * mes"): the rolling last month, today − 1 month … today, as the `{ from, to }` value
 * `DateRangePopover` takes. The day is clamped to the target month's length (31 Mar → 28/29 Feb),
 * like `presetBounds`' last3m/last6m.
 */
export function defaultPortalRange(reference = new Date()) {
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const lastDayOfTarget = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  const from = new Date(today.getFullYear(), today.getMonth() - 1,
    Math.min(today.getDate(), lastDayOfTarget));
  return { from, to: today };
}

/**
 * The range a list opens with: the rolling last month (D-2), unless the link that opened it names
 * a status group. A group link — a home tile ("Por responder", "Vencidas", "En curso") or "Ver
 * facturas pendientes" — asks for everything in that state, which may be older than a month, so it
 * opens on all time (`null`). Either way the customer can pick any other range.
 */
export function initialPortalRange(group, reference = new Date()) {
  return group ? null : defaultPortalRange(reference);
}

/**
 * The status tabs that mean "everything in this state now", not "what happened in a period"
 * (QA pass 2, CP-18b): an overdue invoice is by definition older than its due date, so the rolling
 * last month hid every overdue invoice while Inicio said "1 Vencida". Selecting one of these tabs
 * switches the list to all time (`null`), exactly as arriving from an Inicio tile does; the
 * customer can still pick a narrower range afterwards.
 */
export const PORTAL_ALL_TIME_GROUPS = Object.freeze(['awaiting', 'pending', 'overdue', 'inProgress']);

/** Whether selecting the `group` tab shows the whole history ({@link PORTAL_ALL_TIME_GROUPS}). */
export function isAllTimeGroup(group) {
  return PORTAL_ALL_TIME_GROUPS.includes(group);
}

/** A local `Date` as the `yyyy-MM-dd` calendar day the API expects. */
export function toCalendarParam(date) {
  return date instanceof Date ? todayCalendarISO(date) : null;
}

/**
 * The portal's view, read from and written to the URL search string. The token is in the path
 * (`/portal/:token`) and never here.
 *
 * - `{ view: 'home' }`
 * - `{ view: 'list', kind, group? }` — `group` one of the kind's tabs ({@link PORTAL_KIND_GROUPS})
 * - `{ view: 'doc', kind, id, group? }` — `group`: the list tab the document was opened from
 */
export function readPortalView(searchParams) {
  const view = searchParams.get('view');
  // Case-insensitive, so a hand-written `?view=list&kind=quotation` works like the `QUOTATION`
  // this page writes.
  const kind = searchParams.get('kind')?.toUpperCase() ?? null;
  const id = searchParams.get('id');
  const group = searchParams.get('group');
  if (view === 'list' && PORTAL_KIND_META[kind]) {
    return isPortalGroup(kind, group) ? { view: 'list', kind, group } : { view: 'list', kind };
  }
  // A document keeps the list tab it was opened from (the list stays underneath it on desktop).
  if (view === 'doc' && PORTAL_KIND_META[kind] && id) {
    return isPortalGroup(kind, group) ? { view: 'doc', kind, id, group } : { view: 'doc', kind, id };
  }
  if (view === 'home') return { view: 'home' };
  return null;
}

/** The search string of a view (see {@link readPortalView}): view, kind, id and group only. */
export function writePortalView(target) {
  const params = new URLSearchParams();
  params.set('view', target.view);
  if (target.kind) params.set('kind', target.kind);
  if (target.id) params.set('id', target.id);
  if (target.group) params.set('group', target.group);
  return params;
}
