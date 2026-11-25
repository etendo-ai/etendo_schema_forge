import { useCallback, useState } from 'react';
import {
  CalendarBlankIcon, CalendarCheckIcon, CalendarXIcon, CheckIcon, DotsThreeVerticalIcon, FileTextIcon,
  FunnelIcon,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useUI } from '@/i18n';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DateRangePopoverContent } from '@/components/ui/date-range-popover';
import {
  PORTAL_ERROR, fetchPortalDocument, fetchPortalDocumentPdf,
} from '@/lib/portal/portalApi.js';
import { portalPdfFileName } from '@/lib/portal/portalInvoices.js';
import { saveBlobAsFile } from '@/lib/portal/portalDownload.js';
import {
  PortalDate, PortalDocumentStatus, PortalInvoiceTypeBadge, PortalMoney, PortalRowBadge,
  PORTAL_ROW_FOCUS, usePortalTabLabel,
} from './PortalBits.jsx';
import {
  PORTAL_ACCEPT_ENABLED, PORTAL_KIND_SUBTYPES, canOfferDecision, quotationValidity,
} from './portalPresentation.js';
import PortalDecisionActions from './PortalDecisionActions.jsx';
import { isCompletedStatus } from '../../lib/docStatus.js';

/*
 * The mobile list of one document kind, as the designer's redesign draws it (2026-11-25): the card
 * with its options menu, and the funnel's quick filters. Figma hex values; the status names are the
 * app's (PO decision), through the same badges and tab labels as desktop.
 */

/** One option row of the filter sheet, with the check of the committed value. */
function FilterOption({ selected, onSelect, testId, children }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm leading-5',
        selected ? 'bg-[#F3F5F9] font-medium text-[#1B1A1F]' : 'text-[#40465C]',
      )}
      data-testid={testId}
    >
      <CheckIcon size={16} className={selected ? 'opacity-100' : 'opacity-0'} aria-hidden="true" data-testid="Check__f2a7c1" />
      {children}
    </button>
  );
}

/**
 * The mobile funnel (QA CP-37, redesign 2026-11-25): the same quick filters as desktop — the
 * document type of a kind that mixes types, the status (the list's tabs) and the date range (the
 * app's own range picker) — in one sheet under the button.
 */
export function PortalMobileFilters({
  kind, tabs, group, onGroup, subtype = null, onSubtype, range, onRange,
}) {
  const ui = useUI();
  const tabLabel = usePortalTabLabel();
  const [open, setOpen] = useState(false);
  const subtypes = PORTAL_KIND_SUBTYPES[kind] ?? null;
  const section = 'px-2 pb-1 pt-2 text-xs font-semibold leading-4 text-[#6B7280]';
  return (
    <Popover open={open} onOpenChange={setOpen} data-testid="Popover__f2a7c1">
      <PopoverTrigger asChild data-testid="PopoverTrigger__f2a7c1">
        <button
          type="button"
          aria-label={ui('filters')}
          title={ui('filters')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8.9px] border border-[#C7CBD3] bg-white text-[#81848F]"
          data-testid="portal-list-filters-mobile"
        >
          <FunnelIcon size={20} aria-hidden="true" data-testid="Funnel__f2a7c1" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[70vh] w-[calc(100vw-32px)] max-w-sm overflow-y-auto p-2"
        data-testid="portal-list-filters-mobile-panel"
      >
        {subtypes ? (
          <div role="group" aria-label={ui('documentType')}>
            <p className={section}>{ui('documentType')}</p>
            {[{ code: null, labelKey: 'portalStatusAll' }, ...subtypes].map((option) => (
              <FilterOption
                key={option.code ?? 'all'}
                selected={(subtype ?? null) === option.code}
                onSelect={() => onSubtype?.(option.code)}
                testId={`portal-list-subtype-${(option.code ?? 'all').toLowerCase()}-mobile`}
                data-testid="FilterOption__f2a7c1">
                {ui(option.labelKey)}
              </FilterOption>
            ))}
          </div>
        ) : null}
        <div role="group" aria-label={ui('portalColStatus')}>
          <p className={section}>{ui('portalColStatus')}</p>
          {tabs.map((tab) => (
            <FilterOption
              key={tab.code ?? 'all'}
              selected={(group ?? null) === tab.code}
              onSelect={() => onGroup(tab.code)}
              testId={`portal-list-filter-${(tab.code ?? 'all').toLowerCase()}-mobile`}
              data-testid="FilterOption__f2a7c1">
              {tabLabel(tab)}
            </FilterOption>
          ))}
        </div>
        <div role="group" aria-label={ui('portalDateRange')} data-testid="portal-list-filters-mobile-range">
          <p className={section}>{ui('portalDateRange')}</p>
          <DateRangePopoverContent
            value={range}
            onChange={onRange}
            onClose={() => setOpen(false)}
            data-testid="DateRangePopoverContent__f2a7c1" />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A labelled value of the card: a 14px icon and a 12/16 label over a 14/20 value. */
function CardValue({ Icon, label, children, danger = false, testId }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5" data-testid={testId}>
      <span className={cn('inline-flex items-center gap-1 text-xs leading-4', danger ? 'text-[#AF0932]' : 'text-[#6B7280]')}>
        <Icon size={14} aria-hidden="true" data-testid="Icon__f2a7c1" />
        {label}
      </span>
      <span className={cn('truncate text-sm leading-5 tabular-nums', danger ? 'text-[#AF0932]' : 'text-[#1B1A1F]')}>{children}</span>
    </span>
  );
}

/** The card's second value: validity (or the generated order) on a quotation, the due date on an invoice. */
function SecondValue({ document }) {
  const ui = useUI();
  if (document.kind === 'QUOTATION') {
    if (document.orderNo) {
      return (
        <CardValue Icon={FileTextIcon} label={ui('portalRelatedOrderLabel')} testId="portal-card-order" data-testid="CardValue__f2a7c1">
          {document.orderNo}
        </CardValue>
      );
    }
    if (!document.validUntil) return null;
    const expired = quotationValidity(document)?.state === 'expired';
    return (
      <CardValue
        Icon={expired ? CalendarXIcon : CalendarCheckIcon}
        label={ui('portalColValidUntil')}
        danger={expired}
        testId="portal-card-valid-until"
        data-testid="CardValue__f2a7c1">
        <PortalDate value={document.validUntil} data-testid="PortalDate__f2a7c1" />
      </CardValue>
    );
  }
  if (document.kind === 'INVOICE' && document.dueDate) {
    return (
      <CardValue Icon={CalendarCheckIcon} label={ui('portalColDueDate')} testId="portal-card-due-date" data-testid="CardValue__f2a7c1">
        <PortalDate value={document.dueDate} data-testid="PortalDate__f2a7c1" />
      </CardValue>
    );
  }
  return null;
}

/**
 * The card's options (⋮): "Ver detalle", "Descargar PDF" and — only on a quotation the customer
 * can answer now ({@link canOfferDecision}: the row's `canDecide`, pending, not expired) — Aceptar /
 * Rechazar, which open the very popups of the detail (recipients, `not_recipient` refusal).
 */
function CardMenu({ document, onOpen, onDownload, onDecide }) {
  const ui = useUI();
  const decidable = canOfferDecision(document);
  return (
    <DropdownMenu data-testid="DropdownMenu__f2a7c1">
      <DropdownMenuTrigger asChild data-testid="DropdownMenuTrigger__f2a7c1">
        <button
          type="button"
          aria-label={ui('portalDocumentOptions')}
          title={ui('portalDocumentOptions')}
          onClick={(event) => event.stopPropagation()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F3F5F9] text-[#81848F]"
          data-testid="portal-card-menu"
        >
          <DotsThreeVerticalIcon size={20} weight="bold" aria-hidden="true" data-testid="DotsThreeVertical__f2a7c1" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="DropdownMenuContent__f2a7c1">
        <DropdownMenuItem onSelect={() => onOpen(document)} data-testid="portal-card-menu-open">
          {ui('portalViewDetail')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDownload(document)} data-testid="portal-card-menu-pdf">
          {ui('portalDownloadPdf')}
        </DropdownMenuItem>
        {decidable && PORTAL_ACCEPT_ENABLED ? (
          <DropdownMenuItem onSelect={() => onDecide(document, 'accept')} data-testid="portal-card-menu-accept">
            {ui('portalDecisionAccept')}
          </DropdownMenuItem>
        ) : null}
        {decidable ? (
          <DropdownMenuItem onSelect={() => onDecide(document, 'reject')} data-testid="portal-card-menu-reject">
            {ui('portalDecisionReject')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One mobile card (redesign 2026-11-25): the number (20/28 600) with the status badge; the
 * reference as a chip when there is one; "Fecha" and the kind's second value; "Importe total" and
 * the options menu. An invoice also shows its document type and, in the footer, what is pending.
 */
export function PortalMobileCard({ document, kind, onOpen, onDownload, onDecide }) {
  const ui = useUI();
  const isInvoice = kind === 'INVOICE';
  const hasAmounts = kind !== 'SHIPMENT';
  return (
    <div className="flex w-full flex-col rounded-xl border border-[#E3E7EC] bg-white" data-testid="portal-document-card">
      <button
        type="button"
        onClick={() => onOpen(document)}
        className={`flex w-full flex-col gap-3 p-4 text-left ${PORTAL_ROW_FOCUS}`}
        data-testid="portal-document-card-open"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xl font-semibold leading-7 text-[#1B1A1F]">{document.documentNo}</span>
            {isInvoice ? <PortalInvoiceTypeBadge document={document} data-testid="PortalInvoiceTypeBadge__f2a7c1" /> : null}
          </span>
          {/* An invoice shows its payment state; its document status too when it is not the plain
              "completed" every listed invoice shares (closed, voided), like the table. */}
          <span className="flex flex-wrap items-center justify-end gap-1">
            {isInvoice && !isCompletedStatus(document.documentStatus) ? (
              <PortalDocumentStatus
                status={document.documentStatus}
                palette="figma"
                className="rounded-full text-sm font-normal leading-5"
                data-testid="PortalDocumentStatus__f2a7c1" />
            ) : null}
            <PortalRowBadge
              document={document}
              palette="figma"
              className="rounded-full text-sm font-normal leading-5"
              data-testid="PortalRowBadge__f2a7c1" />
          </span>
        </span>
        {document.reference ? (
          <span className="max-w-full self-start truncate rounded-lg bg-[#F3F5F9] px-2 py-0.5 text-xs leading-4 text-[#40465C]" data-testid="portal-card-reference">
            {document.reference}
          </span>
        ) : null}
        <span className="grid grid-cols-2 gap-3">
          <CardValue Icon={CalendarBlankIcon} label={ui('date')} testId="portal-card-date" data-testid="CardValue__f2a7c1">
            <PortalDate value={document.date} data-testid="PortalDate__f2a7c1" />
          </CardValue>
          <SecondValue document={document} data-testid="SecondValue__f2a7c1" />
        </span>
      </button>
      <div className="flex items-center justify-between gap-3 border-t border-[#E3E7EC] px-4 py-3">
        <span className="flex min-w-0 flex-col">
          {hasAmounts ? (
            <>
              <span className="text-xs leading-4 text-[#6B7280]">{ui('portalSummaryTotal')}</span>
              <PortalMoney
                currency={document.currency}
                value={document.grandTotal}
                className="truncate text-base font-semibold leading-6 tabular-nums text-[#1B1A1F]"
                data-testid="PortalMoney__f2a7c1" />
            </>
          ) : null}
          {isInvoice ? (
            <span className="text-xs leading-4 text-[#6B7280]" data-testid="portal-card-outstanding">
              {ui('portalColOutstanding')}{' '}
              <PortalMoney currency={document.currency} value={document.outstandingAmount} className="tabular-nums" data-testid="PortalMoney__f2a7c1" />
            </span>
          ) : null}
        </span>
        <CardMenu
          document={document}
          onOpen={onOpen}
          onDownload={onDownload}
          onDecide={onDecide}
          data-testid="CardMenu__f2a7c1" />
      </div>
    </div>
  );
}

/**
 * What the card menu does: download the printable, and accept / reject through the detail's own
 * popups. The list rows carry no `decision` block (recipients, `acceptAvailable`), so the detail is
 * read first; the popups then behave exactly as on the detail page. Refusals end on a toast.
 */
export function usePortalCardActions({ apiFetch, token, tenantName, onInvalid }) {
  const ui = useUI();
  const [decisionTarget, setDecisionTarget] = useState(null);

  const download = useCallback((document) => {
    fetchPortalDocumentPdf(apiFetch, token, document.kind, document.id).then((blob) => {
      saveBlobAsFile(new Blob([blob], { type: 'application/pdf' }), portalPdfFileName(document));
    }).catch((error) => {
      if (error?.code === PORTAL_ERROR.invalidLink) {
        onInvalid();
        return;
      }
      toast.error(ui(error?.status === 404 ? 'portalPdfUnavailable' : 'portalDownloadFailed'));
    });
  }, [apiFetch, token, onInvalid, ui]);

  const decide = useCallback((document, step) => {
    fetchPortalDocument(apiFetch, token, document.kind, document.id).then((detail) => {
      setDecisionTarget({ document: detail, step });
    }).catch((error) => {
      if (error?.code === PORTAL_ERROR.invalidLink) onInvalid();
      else toast.error(ui('portalDecisionError'));
    });
  }, [apiFetch, token, onInvalid, ui]);

  const done = useCallback((messageKey) => {
    setDecisionTarget(null);
    if (messageKey) toast.error(ui(messageKey, { tenantName: tenantName ?? '' }));
  }, [ui, tenantName]);

  const popups = decisionTarget ? (
    <PortalDecisionActions
      key={`${decisionTarget.document.id}:${decisionTarget.step}`}
      apiFetch={apiFetch}
      token={token}
      document={decisionTarget.document}
      tenantName={tenantName}
      onInvalid={onInvalid}
      variant="headless"
      initialStep={decisionTarget.step}
      onDone={done}
      data-testid="PortalDecisionActions__f2a7c1" />
  ) : null;

  return { download, decide, popups };
}
