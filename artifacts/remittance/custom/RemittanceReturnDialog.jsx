import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { WarningIcon, MagnifyingGlassIcon, CheckSquareIcon } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useLocaleSwitch, useUI } from '@/i18n';
import { useApiFetch } from '@/auth/useApiFetch.js';
import ActionChoiceModal from '@/components/contract-ui/ActionChoiceModal.jsx';
import { InfoBanner } from '@/components/InfoBanner';
import { Checkbox } from '@/components/ui/checkbox';
import { DateField } from '@/components/ui/date-field';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatCurrency.js';
import { formatCalendarDate, todayCalendarISO } from '@/lib/dateOnly.js';
import {
  fetchRemittanceLines,
  fetchReturnState,
  fileActionErrorMessage,
  returnProblemsFromError,
  returnRemittanceLines,
} from './remittanceFileApi.js';

const REASON_KEYS = {
  NOT_PROCESSED: 'remittanceReturnReasonNotProcessed',
  NOT_SETTLED: 'remittanceReturnReasonNotSettled',
  NOT_A_COLLECTION: 'remittanceReturnReasonNotCollection',
  POSTED: 'remittanceReturnReasonPosted',
  RECONCILED: 'remittanceReturnReasonReconciled',
};

/** The invoice / partner / amount of a line, as the dialog lists it. */
export function returnLineSummary(line) {
  return {
    id: line.id,
    documentNo: line.invoiceDocumentNo ?? '—',
    partner: line['businessPartner$_identifier'] ?? line.businessPartnerName ?? '',
    amount: Number(line.amount ?? 0),
    currency: line.currency ?? null,
  };
}

/**
 * Ticking a line ticks every line that shares its payment (a return takes them all); ticking it again clears the group.
 * Takes one line id or several (a bank-instruction row hands all of its lines).
 */
export function toggleReturnSelection(selected, state, lineIdOrIds) {
  const ids = Array.isArray(lineIdOrIds) ? lineIdOrIds : [lineIdOrIds];
  const group = [...new Set(ids.flatMap((id) => state.lines[id]?.paymentLineIds ?? [id]))];
  const next = new Set(selected);
  const removing = group.every((id) => next.has(id));
  for (const id of group) {
    if (removing) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** Selects every given returnable line, plus the siblings of their payments. */
export function selectAllReturnable(state, lineIds) {
  let next = new Set();
  for (const id of lineIds) {
    if (state.lines[id]?.returnable) for (const sibling of state.lines[id].paymentLineIds) next.add(sibling);
  }
  return next;
}

/**
 * ETP-6247 — the dialog's rows are BANK INSTRUCTIONS, not lines: with a grouping (GGP / GGPD) several lines (invoices)
 * share one payment, which is one instruction to the bank, and a return always takes the whole payment. Groups the
 * lines by `state.lines[id].paymentId`, in the order their first line arrives; a line without a payment (or unknown to
 * the state) is its own group.
 *
 * Each group: `key`, `lineIds`, `lines`, `infos` (their returnState entries), `returnable` (every line is) and `info`,
 * the entry that speaks for the row — the first line that cannot be returned, else the first one — so the note reads
 * as it did per line (returned on, not collected yet, reconciled…).
 */
export function groupReturnLines(lines, state) {
  const groups = new Map();
  for (const line of lines) {
    const info = state?.lines?.[line.id];
    const key = info?.paymentId ? `payment:${info.paymentId}` : `line:${line.id}`;
    if (!groups.has(key)) groups.set(key, { key, lineIds: [], lines: [], infos: [] });
    const group = groups.get(key);
    group.lineIds.push(line.id);
    group.lines.push(line);
    group.infos.push(info);
  }
  return [...groups.values()].map((group) => {
    const returnable = group.infos.every((info) => info?.returnable === true);
    const info = group.infos.find((i) => i?.returnable !== true) ?? group.infos[0];
    return { ...group, returnable, info };
  });
}

/**
 * What a bank-instruction row shows, from `returnLineSummary` of each line: the invoices, the partner (null when they
 * differ — the row then says «Varios clientes»), the total and the currency.
 */
export function returnGroupSummary(group) {
  const items = group.lines.map(returnLineSummary);
  const partners = [...new Set(items.map((i) => i.partner).filter(Boolean))];
  return {
    documentNos: items.map((i) => i.documentNo),
    partner: partners.length <= 1 ? (partners[0] ?? '') : null,
    amount: items.reduce((sum, i) => sum + i.amount, 0),
    currency: items.find((i) => i.currency)?.currency ?? null,
    single: items.length === 1,
  };
}

// The sibling pickers' (DocumentPickerModal) search box, icon and row look.
const CONTROL = 'border-[hsl(var(--sf-border-input))] shadow-[var(--sf-shadow-xs)]';
const ICON = 'text-[hsl(var(--sf-icon-outline-secondary))]';

function InstructionRow({ group, checked, onToggle, ui, locale }) {
  const item = returnGroupSummary(group);
  const { info } = group;
  const returnable = group.returnable;
  const returned = info?.state === 'RETURNED';
  let note = null;
  if (returned) {
    note = info.returnDate ? ui('remittanceReturnReturnedOn', { date: formatCalendarDate(info.returnDate, locale) }) : ui('remittanceReturnReturned');
  } else if (!returnable) {
    note = ui(REASON_KEYS[info?.reasonCode] ?? 'remittanceReturnReasonNotSettled');
  }
  // committed-selection-ok: multi-select checklist, aria-selected comes from each line's own checked state
  return (
    <li
      role="option"
      aria-selected={checked}
      aria-disabled={!returnable}
      onClick={returnable ? onToggle : undefined}
      className={cn(
        'flex min-h-12 items-center gap-3 border-b border-[hsl(var(--border-subtle))] px-3 py-2 text-sm',
        returnable ? 'cursor-pointer hover:bg-muted/60' : 'cursor-not-allowed opacity-60',
        checked && 'bg-muted/40',
      )}
      data-testid="remittance-return-line"
      data-lines={group.lineIds.length}
      data-state={info?.state}
      data-code={info?.reasonCode ?? undefined}>
      <Checkbox
        checked={checked}
        disabled={!returnable}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        aria-label={ui('selectRow')}
        data-testid="remittance-return-check" />
      {item.single ? (
        <span className="min-w-0 flex-1 truncate">{item.documentNos[0]}{item.partner ? ` · ${item.partner}` : ''}</span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col" data-testid="remittance-return-group">
          <span className="truncate">
            {item.partner ?? ui('remittanceReturnSeveralPartners')}
            {' · '}
            {ui('remittanceReturnInvoiceCount', { count: item.documentNos.length })}
          </span>
          <span className="truncate text-xs text-muted-foreground" title={item.documentNos.join(', ')} data-testid="remittance-return-group-invoices">
            {item.documentNos.join(', ')}
          </span>
        </span>
      )}
      {note && <span className="shrink-0 text-xs text-muted-foreground" data-testid="remittance-return-note">{note}</span>}
      <span className="w-28 shrink-0 text-right tabular-nums">{formatCurrency(item.currency, item.amount)}</span>
    </li>
  );
}

/**
 * ETP-6247 returns — «Devolver» (the `returnLines` header process, `confirmModal`, routed by
 * RemittanceProcessConfirmModal): the bank did not collect some receipts of a processed remittance.
 * Built on ActionChoiceModal like «Confirmar remesa». It reads `returnState` and the lines and lists
 * one row per BANK INSTRUCTION (payment, `groupReturnLines`): with a grouping several invoices share
 * one payment and a return takes it whole. A row that cannot be returned stays visible, disabled,
 * with its reason. Search box (any invoice or partner of the row), select all and a scrollable list;
 * the POST still sends the ids of every line of the selected payments.
 * The return date is the shared DateField (locale order), defaults to today and cannot be in the future. Only a collection remittance can
 * be returned. Success toasts, refreshes the record and closes; a refusal keeps it open and lists
 * the lines the backend blocked.
 */
export default function RemittanceReturnDialog({ record, apiBaseUrl, onRefresh, onClose }) {
  const ui = useUI();
  const { locale } = useLocaleSwitch();
  const apiFetch = useApiFetch(apiBaseUrl);
  const remittanceId = record?.id;
  const today = useMemo(() => todayCalendarISO(), []);
  const [state, setState] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [returnDate, setReturnDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [returnState, remittanceLines] = await Promise.all([fetchReturnState(apiFetch, remittanceId), fetchRemittanceLines(apiFetch, remittanceId)]);
      setState(returnState);
      setLines(remittanceLines);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, remittanceId]);
  useEffect(() => { load(); }, [load]);

  const needle = query.trim().toLowerCase();
  // One row per bank instruction (payment); the search matches the invoice or partner of ANY of its lines.
  const groups = useMemo(() => (state ? groupReturnLines(lines, state) : []), [lines, state]);
  const visible = useMemo(() => groups.filter((g) => {
    if (!needle) return true;
    return g.lines.some((l) => {
      const item = returnLineSummary(l);
      return `${item.documentNo} ${item.partner}`.toLowerCase().includes(needle);
    });
  }), [groups, needle]);
  const selectedLines = useMemo(() => lines.filter((l) => selected.has(l.id)), [lines, selected]);
  const selectedInstructions = groups.filter((g) => g.lineIds.some((id) => selected.has(id))).length;
  const currency = selectedLines.find((l) => l.currency)?.currency ?? lines.find((l) => l.currency)?.currency ?? null;
  const total = selectedLines.reduce((sum, l) => sum + returnLineSummary(l).amount, 0);
  const returnableVisible = visible.filter((g) => g.returnable);
  const allSelected = returnableVisible.length > 0 && returnableVisible.every((g) => g.lineIds.every((id) => selected.has(id)));
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(returnDate) && returnDate <= today; // DateField has no max, so a later day is refused here
  const notCollection = state && !state.collection;
  const canReturn = !loading && !busy && !loadFailed && !notCollection && selectedLines.length > 0 && dateValid;

  const handleReturn = async () => {
    if (!canReturn) return;
    setBusy(true);
    try {
      await returnRemittanceLines(apiFetch, remittanceId, selectedLines.map((l) => l.id), returnDate);
      toast.success(ui(selectedInstructions === 1 ? 'remittanceReturnSuccessOne' : 'remittanceReturnSuccess', { count: selectedInstructions }));
      onRefresh?.();
      onClose?.();
    } catch (err) {
      setProblems(returnProblemsFromError(err));
      toast.error(fileActionErrorMessage(err, ui, 'remittanceReturnError'));
      setBusy(false);
    }
  };

  const content = (
    <ActionChoiceModal
      title={ui('remittanceReturnTitle')}
      summaryColumns={[
        { key: 'count', label: ui('remittanceReturnInstructions'), testId: 'remittance-return-count' },
        { key: 'total', label: ui('remittanceConfirmTotal'), testId: 'remittance-return-total' },
        { key: 'date', label: ui('remittanceReturnDate'), testId: 'remittance-return-date-label' },
      ]}
      summaryData={{ count: selectedInstructions, total: formatCurrency(currency, total), date: formatCalendarDate(returnDate, locale) }}
      options={[]}
      onCancel={() => { if (!busy) onClose?.(); }}
      onContinue={handleReturn}
      loading={busy}
      primaryLabel={ui('remittanceReturnAction')}
      loadingLabel={ui('remittanceReturnAction')}
      primaryDisabled={!canReturn}
      testId="remittance-return-dialog"
      data-testid="ActionChoiceModal__remittance-return">
      <div className="flex flex-col gap-3" data-testid="remittance-return-body">
        {loading && <p className="m-0 text-sm text-[hsl(var(--muted-foreground))]" data-testid="remittance-return-loading">{ui('loading')}</p>}
        {!loading && loadFailed && <p className="m-0 text-sm text-[hsl(var(--muted-foreground))]" data-testid="remittance-return-load-error">{ui('remittanceReturnLoadError')}</p>}
        {!loading && notCollection && <p className="m-0 text-sm text-[hsl(var(--muted-foreground))]" data-testid="remittance-return-not-collection">{ui('remittanceReturnReasonNotCollection')}</p>}
        {!loading && state?.collection && (
          <div className="flex flex-col gap-2">
            <div className="flex h-10 items-center gap-3">
              <label className="relative flex h-10 min-w-0 flex-1 items-center">
                <MagnifyingGlassIcon size={20} aria-hidden="true" className={cn('pointer-events-none absolute left-2', ICON)} data-testid="Search__remittance-return" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={ui('remittanceReturnSearch')}
                  aria-label={ui('remittanceReturnSearch')}
                  disabled={busy}
                  className={cn('h-10 w-full rounded-lg border bg-card py-2 pl-9 pr-2 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-focus-ring', CONTROL)}
                  data-testid="remittance-return-search" />
              </label>
              <button
                type="button"
                onClick={() => setSelected(allSelected ? new Set() : selectAllReturnable(state, returnableVisible.flatMap((g) => g.lineIds)))}
                disabled={busy || returnableVisible.length === 0}
                aria-pressed={allSelected}
                className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium leading-6 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="remittance-return-select-all">
                <CheckSquareIcon size={20} aria-hidden="true" className={ICON} data-testid="SquareCheck__remittance-return" />
                {ui(allSelected ? 'deselectAll' : 'selectAll')}
              </button>
            </div>
            <ul role="listbox" aria-multiselectable="true" aria-label={ui('remittanceReturnTitle')} className="m-0 max-h-56 list-none overflow-y-auto rounded-lg border border-[hsl(var(--border-subtle))] p-0" data-testid="remittance-return-lines">
              {visible.map((group) => (
                <InstructionRow
                  key={group.key}
                  group={group}
                  checked={group.lineIds.every((id) => selected.has(id))}
                  onToggle={() => setSelected((prev) => toggleReturnSelection(prev, state, group.lineIds))}
                  ui={ui}
                  locale={locale}
                  data-testid="InstructionRow__return" />
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="remittance-return-date">{ui('remittanceReturnDate')}</Label>
          <DateField
            id="remittance-return-date"
            value={returnDate}
            onChange={setReturnDate}
            disabled={busy}
            data-testid="remittance-return-date" />
          {!dateValid && <span className="text-xs text-destructive" role="alert" data-testid="remittance-return-date-error">{ui('remittanceReturnDateFuture')}</span>}
        </div>
        <InfoBanner tone="danger" icon={WarningIcon} dismissible={false} role="alert" data-testid="remittance-return-warning">
          {ui('remittanceReturnWarning')}
        </InfoBanner>
        {problems.length > 0 && (
          <ul className="m-0 list-disc space-y-0.5 pl-5 text-sm text-foreground" role="alert" data-testid="remittance-return-problems">
            {problems.map((p, i) => <li key={`${p.lineId ?? ''}-${i}`} data-code={p.reasonCode ?? undefined}>{p.message ?? p.documentNo ?? p.reasonCode}</li>)}
          </ul>
        )}
      </div>
    </ActionChoiceModal>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
