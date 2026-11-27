import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { SparkleIcon } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useUI } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/formatCurrency.js';
import { translateBackendError, translateBackendErrorBody } from '@/lib/backendErrors.js';
import { useApplySuggestions } from '@/hooks/useReconciliation';
import { useAutoMatchSelection } from '@/hooks/useAutoMatchReview.js';
import { cn } from '@/lib/utils';
import { formatCalendarDate } from '@/lib/dateOnly';
import { StatusBadge, automatchBadgeKind } from './reconciliationBadges.jsx';
import { Checkbox } from '@/components/ui/checkbox';
import { AutoMatchBounceSection } from './AutoMatchBounceSection.jsx';
import { isAiStaleError } from './bounceAi.js';
import { AutoMatchCard, AutoMatchCardHeader } from './AutoMatchCard.jsx';
import { AutoMatchCloseConfirmDialog } from './AutoMatchCloseConfirmDialog.jsx';
import { AutoMatchPairRow, AutoMatchPairSide } from './AutoMatchPairRow.jsx';
import {
  BOUNCE_PAIR_KIND, bouncePairPayload, defaultGroupChecked, isLineNotPendingResult,
  isSelectableGroup, splitAutoMatchGroups, shownOutflow, summarizeApplyResults, withBounceDecisions,
} from './bouncePairs.js';
import {
  trackBounceSuggestionsDismissed, trackBounceSuggestionsViewed,
} from '@/lib/bounceSuggestionsTelemetry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLineDate(isoDate) {
  if (!isoDate) return '';
  return formatCalendarDate(isoDate, 'es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function RuleTypeBadge({ label, tone = 'default' }) {
  const cls = {
    default: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
    new: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
  }[tone] ?? 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]';
  return (
    <span className={cn('inline-flex items-center rounded-lg px-2 py-1 text-xs font-normal leading-4', cls)}>
      {label}
    </span>
  );
}

function formatSignedAmount(amount, currency) {
  if (amount === 0) return '—';
  const sign = amount < 0 ? '-' : '+';
  return `${sign}${formatCurrency(currency, Math.abs(amount))}`;
}

/* The checkboxes are the shared `Checkbox` (`@/components/ui/checkbox`), the one DataTable and every
   list use for row selection, so the modal gets the same look and the same indeterminate state. */

// ---------------------------------------------------------------------------
// Row content
// ---------------------------------------------------------------------------

/**
 * The statement-line side of a transaction group: description and amount, the date with its calendar
 * icon, then the type badge (suggested / difference / by rule) and the bank reference.
 */
function StatementSide({ group, currency }) {
  const ui = useUI();
  const line = group.statementLine ?? {};
  const isRule = group.origin === 'rule';
  // Every group states its type, using the same pill the left panel shows for the same line. Only
  // rule groups used to be labelled, so an exact match and a within-tolerance one looked identical
  // even though the second one posts an accounting entry (ETP-4965 QA round).
  const badgeKind = automatchBadgeKind(group);
  // The rule badge keeps its own key because it appends the rule name; the other two are the plain
  // shared labels ("Con sugerencia" / "Con diferencia").
  const badgeLabel = isRule && group.ruleName
    ? `${ui('financeReconcileAutomatchBadgeByRule')} ${group.ruleName}`
    : undefined;
  return (
    <AutoMatchPairSide
      description={line.description || line.referenceNo}
      amount={Number(line.amount ?? 0)}
      currency={currency}
      strong
      dateText={line.date ? formatLineDate(line.date) : ''}
      badge={(
        <span className="inline-flex" data-testid={`automatch-group-kind-${badgeKind}`}>
          <StatusBadge
            kind={badgeKind}
            label={badgeLabel}
            icon={badgeKind === 'suggested'
              ? <SparkleIcon
              className="size-3.5 text-[var(--status-info-fg)]"
              weight="fill"
              data-testid="SparkleIcon__a89979" />
              : null}
            data-testid="StatusBadge__a89979" />
        </span>
      )}
      reason={line.referenceNo ? (
        <span className="text-xs leading-4 text-[hsl(var(--muted-foreground))]">{line.referenceNo}</span>
      ) : null}
      testId={`automatch-group-statement-${group.groupKey}`}
      data-testid="AutoMatchPairSide__a89979" />
  );
}

/**
 * What the operation cell calls this row. A difference row names the accounting account the leftover
 * will be posted to; it is always known, because the engine only proposes an amount deviation when
 * the financial account has one configured.
 */
function displayName(op) {
  if (op.isNew) return op.name || op.glItemId || '—';
  return op.partnerName || op.documentNo || '—';
}

function OperationRow({ op, currency }) {
  const ui = useUI();
  const amount = Number(op.amount ?? 0);
  const isNew = op.isNew;

  return (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-10">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium leading-5 text-[hsl(var(--foreground))]">
            {displayName(op)}
          </span>
          <RuleTypeBadge
            label={isNew ? ui('financeReconcileAutomatchBadgeNew') : (op.documentNo || op.typeLabel || '')}
            tone={isNew ? 'new' : 'default'}
            data-testid="RuleTypeBadge__a89979" />
        </div>
        {isNew && (
          <span className="text-xs leading-4 text-[hsl(var(--muted-foreground))]">
            {ui(op.isDifference ? 'financeReconcileAutomatchOpDifference' : 'financeReconcileAutomatchOpNew')}
          </span>
        )}
        {/* The movement's own description — what the Movimientos list shows. A payment number on
            its own identifies nothing to whoever approves the batch. */}
        {!isNew && op.description && (
          <span
            className="truncate text-xs leading-4 text-[hsl(var(--muted-foreground))]"
            data-testid="automatch-op-description">
            {op.description}
          </span>
        )}
      </div>
      <div className="w-40 flex-none text-right">
        <div className={cn(
          'text-sm font-semibold leading-5',
          amount < 0 ? 'text-[hsl(var(--destructive))]' : 'text-[var(--status-success-fg)]',
        )}>
          {formatSignedAmount(amount, currency)}
        </div>
        {op.date && (
          <div className="text-xs leading-4 text-[hsl(var(--muted-foreground))]">{formatLineDate(op.date)}</div>
        )}
      </div>
    </div>
  );
}

function GroupRow({ group, checked, onToggle, currency, glItemDifference }) {
  const ui = useUI();
  const statementLine = group.statementLine ?? {};
  const realOps = group.operations ?? [];
  // Rule-origin groups have no existing transaction — the system will create a payment.
  // For now this is purely visual: show one proposed "New / Create payment" operation with the
  // rule name and the statement-line amount. The actual creation is wired in a later step.
  const baseOps = group.origin === 'rule'
    ? [{
        id: 'new',
        isNew: true,
        name: group.ruleName,
        amount: Number(group.statementLine?.amount ?? 0),
      }]
    : realOps;

  // A near match links its operation AND posts the leftover to the account's accounting account.
  // That second movement was invisible until now: the modal showed only the linked operation, so
  // the user could not tell a within-tolerance match from an exact one, nor where the difference
  // would land. Same shape a rule group already uses for its proposed movement.
  const difference = Number(group.difference ?? 0);
  const ops = group.nearMatch && Math.abs(difference) > 0
    ? [...baseOps, {
        id: 'difference',
        isNew: true,
        isDifference: true,
        name: glItemDifference?.name || '',
        amount: difference,
      }]
    : baseOps;

  return (
    <AutoMatchPairRow
      checked={checked}
      onToggle={() => onToggle(group)}
      checkLabel={ui('financeReconcileAutomatchGroupCheck', {
        line: statementLine.description || statementLine.referenceNo || '—',
      })}
      checkTestId={`automatch-group-check-${group.groupKey}`}
      testId={`automatch-group-row-${group.groupKey}`}
      left={<StatementSide group={group} currency={currency} data-testid="StatementContent__a89979" />}
      right={ops.length === 0 ? (
        <div className="text-sm text-[hsl(var(--muted-foreground))]">—</div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {ops.map((op, i) => (
            <OperationRow
              key={op.id ?? i}
              op={op}
              currency={currency}
              data-testid="OperationRow__a89979" />
          ))}
        </div>
      )}
      data-testid="AutoMatchPairRow__a89979" />
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

/**
 * The toast of an apply of transaction groups.
 *
 * applySuggestions answers 201 even when every group is rejected — the reason travels inside
 * results[]. Reducing that to two counters is what produced a bare "Error al aplicar la
 * conciliación" for problems the backend had already explained.
 */
function notifyApplyResults(results, ui) {
  const failures = results.filter((r) => r?.error);
  const failedCount = failures.length;
  const successCount = results.length - failedCount;
  if (failedCount === 0) {
    toast.success(ui('financeReconcileAutomatchToastSuccess', { count: successCount }));
  } else if (successCount > 0) {
    toast.warning(ui('financeReconcileAutomatchToastPartial', { success: successCount, failed: failedCount }));
  } else {
    // ETP-5121: the backend explains itself in English (e.g. the draft-statement guard);
    // translateBackendError maps the known sentences to a locale key and passes anything
    // else through untouched, so an unmapped message still reaches the user.
    toast.error(translateBackendError(failures[0]?.error?.message, ui)
      || ui('financeReconcileAutomatchToastError'));
  }
}

/**
 * The toast of "Excluir de la conciliación" (ETP-6359): how many rejections were excluded and, when
 * some were refused, the first refusal translated — a bounce refusal is coded
 * (`error.messageKeys`), so it goes through `translateBackendErrorBody`.
 */
function notifyExcludeResults(excluded, failures, ui) {
  const reason = failures.length > 0
    ? translateBackendErrorBody(failures[0], ui, null) || ui('financeReconcileAutomatchToastError')
    : null;
  if (reason == null) {
    toast.success(ui('financeReconcileAutomatchBounceToastExcluded', { count: excluded }));
  } else if (excluded > 0) {
    toast.warning(
      `${ui('financeReconcileAutomatchBounceToastExcluded', { count: excluded })} ${ui('financeReconcileAutomatchBounceToastSomeFailed', { count: failures.length })}`,
      { description: reason },
    );
  } else {
    toast.error(reason);
  }
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

/**
 * Automatch suggestion modal — the Figma "Conciliación automática P1" (ETP-6359): a KPI strip and
 * two cards, each with its own footer and its own action, and no global "Confirmar".
 *
 * - **Posibles rechazos bancarios** (yellow, on top; bounce pairs — ETP-5581, flag
 *   `bank-bounce-suggestions`, `kind: "bouncePair"` in `groups`): "Excluir de la conciliación (N)"
 *   is immediate and independent. It sends an `applySuggestions` with ONLY the checked pairs, drops
 *   those rows locally (no automatch refetch), updates the KPI and the count and calls `onChanged`
 *   so the host refreshes the reconciliation panel.
 * - **Líneas del extracto bancario** (green): "Conciliar seleccionadas (N)" sends ONLY the checked
 *   transaction groups, plus the `bounceDecisions` of the pairs still on screen.
 *
 * Closing without applying (X, Esc, backdrop, "Ir a conciliación manual") while rows are selected
 * asks "¿Deseas cerrar la ventana?" first. The default preselection counts as selected rows.
 *
 * With the backend flag off nothing in `groups` has the bounce kind and the yellow card is absent.
 *
 * @param {{ accountId, accountName?, groups, kpis, currency?, open, onClose, onSuccess?, onChanged?,
 *   glItemDifference?, selection?, dismissedPairKeys?, onReviewPair? }} props `glItemDifference`
 *   is the account's `{ id, name }` for differences — the same object `ReconciliationTab` composes
 *   for the panel — used to name the movement a near-match group will create. It is always set
 *   when such a group is present: the engine does not propose an amount deviation for an account
 *   with nowhere to post it.
 *   `onSuccess` runs after "Conciliar seleccionadas" (the host reloads everything and the modal
 *   closes); `onChanged` after an "Excluir" that excluded at least one pair (the host refreshes the
 *   panel but keeps these suggestions, and so the checks of the rest). When a pair was refused with
 *   409 `LINE_NOT_PENDING` (its line is no longer pending: the suggestions are stale) it is called
 *   with `{ reloadSuggestions: true }`, also when nothing was excluded, and the host reloads them.
 *   `selection` (ETP-5581) lifts the checks out of the modal ({@link useAutoMatchSelection}) so the
 *   host decides how long they live (the financial-account detail keeps them across a close while
 *   the suggestions do not reload); without it the modal keeps its own. `dismissedPairKeys`
 *   are pairs the user said are not a bounce, hidden here. `onReviewPair(group)` is "Revisar en el
 *   panel"; without it the button is not offered.
 *   `sentToPanelKeys` (ETP-5581) are the pairs sent to the panel during this modal session
 *   (`useAutoMatchReview().sentToPanelKeys`): "Conciliar seleccionadas" reports them as
 *   `sent_to_panel` in its `bounceDecisions`, every other pair still shown as `unchecked`.
 *   `bounceAiAssessments` (ETP-6359) is the autoMatch answer's AI layer. It decides which outflow an
 *   ambiguous pair shows and excludes (the recommended one, else the most probable) and whether
 *   that pair can be ticked at all (not without AI data, until its outflow is picked in the panel),
 *   and it shows the percentage. It never preselects a pair. Two checked rows never share an
 *   outflow: see `resolvePairOutflows` (bouncePairs.js), through the selection's `pairOutflow`.
 *   `autoOpened` says the modal opened by itself rather than from the Automatch button, for the
 *   `bounce_suggestions_*` events: `viewed` once per opening with at least one pair, `dismissed`
 *   when that opening is closed without applying (X, Esc, backdrop, "Ir a conciliación manual" —
 *   never "Revisar en el panel", which the host closes, nor an apply).
 */
export function AutoMatchSuggestionModal({
  accountId,
  accountName = '',
  groups = [],
  kpis = {},
  currency = 'EUR',
  open,
  onClose,
  onSuccess,
  onChanged,
  glItemDifference = null,
  selection = null,
  dismissedPairKeys = null,
  onReviewPair = null,
  sentToPanelKeys = null,
  autoOpened = false,
  bounceAiAssessments = null,
}) {
  const ui = useUI();
  const { apply, loading } = useApplySuggestions();

  // The checks default to every transaction group (and every high-confidence pair) whenever the
  // suggestions (re)load. The host may own them (`selection`); otherwise the modal does.
  const ownSelection = useAutoMatchSelection(groups, bounceAiAssessments, { dismissedKeys: dismissedPairKeys });
  const { isChecked, toggle, setMany } = selection ?? ownSelection;
  // The AI assessments minus the rejections refused as stale, and the outflow each pair shows (a
  // host selection without them falls back to the raw answer and to each pair on its own).
  const {
    assessments = bounceAiAssessments, invalidateAi = null, isCheckable = isSelectableGroup,
    pairOutflow = null,
  } = selection ?? ownSelection;

  // Pairs excluded from this modal's suggestions by "Excluir": hidden locally, by groupKey, so the
  // automatch is not asked again. A reload of the suggestions forgets them (the server no longer
  // offers them) — and so does the host's own state, which is why it lives here.
  const [excludedKeys, setExcludedKeys] = useState(() => new Set());
  useEffect(() => {
    setExcludedKeys((prev) => (prev.size === 0 ? prev : new Set()));
  }, [groups]);

  const { transactionGroups, bouncePairs: allPairs } = useMemo(
    () => splitAutoMatchGroups(groups), [groups]);
  const pairs = useMemo(
    () => (dismissedPairKeys?.size || excludedKeys.size
      ? allPairs.filter((p) => !dismissedPairKeys?.has(p.groupKey) && !excludedKeys.has(p.groupKey))
      : allPairs),
    [allPairs, dismissedPairKeys, excludedKeys],
  );

  const checkedGroups = useMemo(
    () => transactionGroups.filter(isChecked), [transactionGroups, isChecked]);
  const checkedPairs = useMemo(() => pairs.filter(isChecked), [pairs, isChecked]);

  const allChecked = checkedGroups.length === transactionGroups.length && transactionGroups.length > 0;

  const toggleAll = useCallback(() => {
    setMany(transactionGroups, !allChecked);
  }, [allChecked, setMany, transactionGroups]);

  const toggleAllPairs = useCallback((on) => setMany(pairs, on), [pairs, setMany]);

  // ETP-5581 — `bounce_suggestions_viewed`, once per opening that shows at least one pair (the
  // pairs may land after the modal opened). The flag resets when the modal closes.
  const viewedRef = useRef(false);
  const pairsPreselected = useMemo(() => pairs.filter(defaultGroupChecked).length, [pairs]);
  useEffect(() => {
    if (!open) {
      viewedRef.current = false;
      return;
    }
    if (viewedRef.current || pairs.length === 0) return;
    viewedRef.current = true;
    trackBounceSuggestionsViewed({ pairsShown: pairs.length, pairsPreselected, autoOpened });
  }, [open, pairs.length, pairsPreselected, autoOpened]);

  // The close confirmation (ETP-6359). Never left open behind a closed modal.
  const [confirmingClose, setConfirmingClose] = useState(false);
  useEffect(() => {
    if (!open) setConfirmingClose(false);
  }, [open]);

  // Every close that is not an apply and not "Revisar en el panel" (which the host performs).
  const handleDismiss = useCallback(() => {
    setConfirmingClose(false);
    if (pairs.length > 0) {
      trackBounceSuggestionsDismissed({
        pairsShown: pairs.length, pairsCheckedAtClose: checkedPairs.length, autoOpened,
      });
    }
    onClose();
  }, [pairs.length, checkedPairs.length, autoOpened, onClose]);

  // Closing with rows selected asks first: the selection is lost on close. Nothing selected closes
  // straight away.
  const selectedCount = checkedGroups.length + checkedPairs.length;
  const requestClose = useCallback(() => {
    if (selectedCount > 0) setConfirmingClose(true);
    else handleDismiss();
  }, [selectedCount, handleDismiss]);

  // "Conciliar seleccionadas (N)" — the transaction groups only. The pairs are not applied here:
  // `bounceDecisions` reports every pair still on screen (unchecked / sent_to_panel) for the
  // backend's KPI events, whether or not it is checked, because none of them is excluded by this call.
  const handleApply = async () => {
    if (checkedGroups.length === 0 || loading) return;
    try {
      const payload = withBounceDecisions({
        financialAccountId: accountId,
        groups: checkedGroups.map((g) => ({
          statementLineId: g.statementLine?.id,
          operationIds: (g.operations ?? []).filter((o) => !o.isNew).map((o) => o.id),
          ...(g.createPayment ? { createPayment: g.createPayment } : {}),
        })),
      }, pairs, () => false, sentToPanelKeys);
      const response = await apply(payload);
      notifyApplyResults(response?.results ?? [], ui);
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(translateBackendError(err?.message, ui) || ui('financeReconcileAutomatchToastError'));
    }
  };

  // "Excluir de la conciliación (N)" — immediate and independent of the reconciliation: ONLY the
  // checked pairs travel, with no `bounceDecisions` (the pairs that stay are reported later, by
  // "Conciliar seleccionadas"). The pairs the backend discarded leave the screen; the ones it
  // refused stay. The pair results come back in the order they were sent.
  const handleExclude = async () => {
    if (checkedPairs.length === 0 || loading) return;
    const sent = checkedPairs;
    try {
      const response = await apply({
        financialAccountId: accountId,
        // Each pair travels with the outflow its row SHOWS (two checked rows never share one, see
        // resolvePairOutflows) and its `choiceSource` (pairChoiceSource): 'ai' when that is the
        // AI-recommended one (the backend refuses the group as stale if the recommendation no
        // longer holds), 'user' when the AI rated the pair but the shown outflow is another or
        // the user picked it in the panel, nothing otherwise.
        groups: sent.map((g) => {
          const { line, source } = pairOutflow?.(g) ?? shownOutflow(g, assessments);
          return bouncePairPayload(g, line, source);
        }),
      });
      const results = (response?.results ?? []).filter((r) => r?.kind === BOUNCE_PAIR_KIND);
      const { pairsOk, failures } = summarizeApplyResults(results);
      const done = sent.filter((_, i) => results[i] && !results[i].error).map((p) => p.groupKey);
      // A group refused as stale (its AI recommendation no longer holds) stays on screen, unchecked,
      // and loses its AI data: no mark, and an ambiguous pair can no longer be ticked here until its
      // outflow is picked in the panel (`needsPanel`, see resolvePairOutflows).
      sent.forEach((g, i) => {
        const r = results[i];
        if (r?.error && isAiStaleError({ code: r.code ?? r.error?.code, body: r })) invalidateAi?.(g);
      });
      // A line that is no longer pending means these suggestions are stale: the host reloads them
      // (which also drops the refused row), instead of leaving a row that fails on every retry.
      const stale = results.some(isLineNotPendingResult);
      if (done.length > 0) setExcludedKeys((prev) => new Set([...prev, ...done]));
      if (stale) onChanged?.({ reloadSuggestions: true });
      else if (done.length > 0) onChanged?.();
      notifyExcludeResults(pairsOk, failures, ui);
    } catch (err) {
      toast.error(translateBackendError(err?.message, ui) || ui('financeReconcileAutomatchToastError'));
    }
  };

  // The transaction-group card (its column header + rows, or the empty state) stays as it always
  // was, and only steps aside when the run found bounce pairs and nothing else.
  const showGroupBlock = transactionGroups.length > 0 || pairs.length === 0;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => { if (!v) requestClose(); }}
        data-testid="Dialog__a89979">
        <DialogContent
          className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0"
          style={{
            width: '1248px',
            maxWidth: '96vw',
            background: 'hsl(var(--card))',
            boxShadow: '0px 0px 0px 1px hsl(var(--foreground) / 0.1), 0px 24px 48px hsl(var(--foreground) / 0.03), 0px 10px 18px hsl(var(--foreground) / 0.03), 0px 5px 8px hsl(var(--foreground) / 0.04)',
            borderRadius: '8px',
          }}
          data-testid="automatch-suggestion-modal"
        >
          {/* ── Header ────────────────────────────────────────────────────── */}
          <div className="flex flex-none items-center gap-4 py-3 pl-7 pr-10">
            <DialogTitle
              className="m-0 text-xl font-semibold leading-7 text-[hsl(var(--foreground))]"
              data-testid="DialogTitle__a89979">
              {ui('financeReconcileAutomatchModalTitle')}
            </DialogTitle>
            <Button
              type="button"
              variant="link"
              onClick={requestClose}
              data-testid="automatch-modal-open-reconciliation"
              className="h-auto p-0 text-sm font-medium text-[hsl(var(--foreground))] underline">
              {ui('financeReconcileAutomatchActionGoManual')}
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-5 px-7 pb-5">
            {/* ── KPI strip ───────────────────────────────────────────────── */}
            <div className="flex flex-none items-center gap-5 rounded-lg border border-[hsl(var(--border-subtle))] px-3 py-2">
              {[
                { label: ui('financeReconcileAutomatchKpiAccount'), value: accountName },
                { label: ui('financeReconcileAutomatchKpiPending'), value: kpis.pendingLines ?? 0 },
                { label: ui('financeReconcileAutomatchKpiGroups'), value: kpis.groupsFound ?? 0 },
                { label: ui('financeReconcileAutomatchKpiOps'), value: kpis.opsToLink ?? 0 },
                // "A crear" was translated in all three locales but never rendered, so the movements
                // the run generates (rule payments + difference postings) had no figure anywhere.
                { label: ui('financeReconcileAutomatchKpiNew'), value: kpis.willCreate ?? 0 },
                // ETP-5581 — only when the backend reports bounce pairs (flag on): the pairs still
                // offered, the same figure the card header shows.
                ...(kpis.bouncePairs == null ? [] : [
                  { label: ui('financeReconcileAutomatchKpiBouncePairs'), value: pairs.length },
                ]),
              ].map(({ label, value }) => (
                <div key={label} className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs leading-4 text-[hsl(var(--muted-foreground))]">{label}</span>
                  <span className="truncate text-sm font-medium leading-5 text-[hsl(var(--foreground))]">{value}</span>
                </div>
              ))}
            </div>

            {/* ── Cards ───────────────────────────────────────────────────── */}
            <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto">
              <AutoMatchBounceSection
                pairs={pairs}
                isChecked={isChecked}
                onToggle={toggle}
                onToggleAll={toggleAllPairs}
                onExclude={handleExclude}
                excluding={loading}
                onReview={onReviewPair}
                aiAssessments={assessments}
                isCheckable={isCheckable}
                pairOutflow={pairOutflow}
                currency={currency}
                formatDate={formatLineDate}
                data-testid="AutoMatchBounceSection__a89979" />
              {showGroupBlock && (
                <AutoMatchCard
                  tone="success"
                  testId="automatch-statements-section"
                  title={ui('financeReconcileAutomatchStatementsTitle')}
                  description={ui('financeReconcileAutomatchStatementsHint')}
                  info={ui('financeReconcileAutomatchStatementsInfo')}
                  action={(
                    <Button
                      type="button"
                      onClick={handleApply}
                      disabled={checkedGroups.length === 0 || loading}
                      data-testid="automatch-modal-apply"
                      className="h-8 flex-none rounded-full px-3">
                      {loading
                        ? ui('loading')
                        : ui('financeReconcileAutomatchActionReconcile', { count: checkedGroups.length })}
                    </Button>
                  )}
                  data-testid="AutoMatchCard__a89979">
                  <AutoMatchCardHeader
                    selectAll={(
                      // Shows a dash whenever there is any selection (same control as the rows).
                      <Checkbox
                        indeterminate={checkedGroups.length > 0}
                        onChange={toggleAll}
                        aria-label={ui('financeReconcileColSelect')}
                        data-testid="automatch-select-all" />
                    )}
                    leftTitle={ui('financeReconcileAutomatchColStatement')}
                    count={transactionGroups.length}
                    rightTitle={ui('financeReconcileAutomatchColOps')}
                    data-testid="AutoMatchCardHeader__a89979" />
                  {transactionGroups.length === 0 ? (
                    <p className="m-0 py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
                      {ui('financeReconcileAutomatchEmpty')}
                    </p>
                  ) : (
                    transactionGroups.map((group) => (
                      <GroupRow
                        key={group.groupKey}
                        group={group}
                        checked={isChecked(group)}
                        onToggle={toggle}
                        currency={currency}
                        glItemDifference={glItemDifference}
                        data-testid="GroupRow__a89979" />
                    ))
                  )}
                </AutoMatchCard>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmingClose && (
        <AutoMatchCloseConfirmDialog
          open
          onKeep={() => setConfirmingClose(false)}
          onConfirm={handleDismiss}
          data-testid="AutoMatchCloseConfirmDialog__a89979" />
      )}
    </>
  );
}
