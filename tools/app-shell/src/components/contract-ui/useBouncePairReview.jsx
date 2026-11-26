import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { isNetworkError } from '@etendo-ai/app-shell-core/auth';
import { useUI } from '@/i18n';
import { translateBackendErrorBody } from '@/lib/backendErrors.js';
import {
  useDiscardPair, useDismissPair, usePendingLineCounts, useRestoreBounceSuggestion, useRestorePair,
} from '@/hooks/useBouncePairActions.js';
import {
  BOUNCE_STATE, DISCARDED_STATE, bouncePanelModel, buildBounceOutflows, buildBouncePairRows,
  buildDiscardedPairRows, countBouncePairs, countsWithDismissedPairs,
  dismissPairPayload, pendingLinesStatusParam, withDismissedPairs,
} from './bouncePairs.js';
import { CHOICE_SOURCE_AI, CHOICE_SOURCE_USER, isAiStaleError } from './bounceAi.js';
import { visibleStatusCodes } from './reconciliationStatusFilter.js';
import { BounceDismissedNotice, BouncePairPanel } from './BouncePairPanel.jsx';

/*
 * ── Bounce pairs in the reconciliation split panel (ETP-5581) ──────────────────────────────────
 * Two hooks, called by ReconciliationSplitPanel at the two points it needs them: the lines (before
 * the selection is resolved) and the right panel (once a line is selected). With the backend flag
 * `bank-bounce-suggestions` off and no discarded line, both are pass-throughs: the lines, counts and
 * filter codes come out exactly as they went in, and no panel is ever returned. A third hook
 * (`usePairTableViews`, ETP-6359) builds the one-row-per-pair lists of the "Posibles rechazos" and
 * "Descartadas" filters.
 */

const EMPTY_COUNTS = {};
/** i18n key of the stale-AI-suggestion toast, when the refusal carries no translatable text. */
const AI_STALE_I18N_KEY = 'financeReconcileBounceAiStale';

/**
 * The toast text of a failed discard / restore: the coded refusal translated (its `AD_MESSAGE` key
 * travels in `error.messageKeys`), a request that got no answer by its own already-translated
 * message, or the action's fallback.
 */
function failureText(err, ui, fallbackKey) {
  return translateBackendErrorBody(err?.body, ui, null)
    || (isNetworkError(err) ? err.message : null)
    || ui(fallbackKey);
}

/**
 * The `choiceSource` of a discard (ETP-6359), ONE rule with the automatch modal (`pairChoiceSource`,
 * bouncePairs.js): 'user' for an outflow the user picked here, even the AI-recommended one or with no
 * AI data; 'ai' while the AI's preselection stands; null (the field is left out) otherwise. (A
 * discard always has a chosen outflow, so an AI-rated pair is either picked or preselected here.)
 */
function discardChoiceSource(model) {
  if (model.explicitPick) return CHOICE_SOURCE_USER;
  return model.aiPreselected ? CHOICE_SOURCE_AI : null;
}

/**
 * Whether a `pendingLines` answer is the `status=discarded` one: its counts carry only
 * `discarded`, never the `all` every default answer has.
 */
function isDiscardedAnswer(counts) {
  return counts?.discarded != null && counts?.all == null;
}

/** Whether two per-state count objects hold the same numbers. */
function sameCounts(a, b) {
  const x = a ?? EMPTY_COUNTS;
  const y = b ?? EMPTY_COUNTS;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k]);
}

/** The default answer's counts with the figures of a `status=discarded` answer on top. */
function withDiscardedCounts(defaultCounts, discardedCounts) {
  const out = { ...defaultCounts, discarded: discardedCounts.discarded };
  if (discardedCounts.discardedPairs != null) out.discardedPairs = discardedCounts.discardedPairs;
  return out;
}

/** The id of the left-panel row of a line, as `StatementLinesPanel` renders it. */
function lineRowSelector(lineId) {
  return `[data-testid="recon-line-row-${String(lineId).replaceAll('"', '')}"]`;
}

/** Scrolls the left-panel row of a line into view, once it has rendered. */
function scrollLineIntoView(lineId) {
  const run = () => {
    const row = typeof document === 'undefined' ? null : document.querySelector(lineRowSelector(lineId));
    row?.scrollIntoView?.({ block: 'center' });
  };
  if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(run);
  else setTimeout(run, 0);
}

/**
 * The lines, counts and filter codes of the left panel, with the bounce pairs applied:
 * - the pairs the user dismissed ("No es un rechazo") read as plain pending lines again. The backend
 *   persists the dismissal (ETP-6359) and stops proposing the pair, so this is only the optimistic
 *   hide until the reload that follows lands;
 * - while the `discarded` filter is active the panel's request asks for `status=discarded`
 *   (`pendingLinesStatusParam`, bouncePairs.js), whose counts carry only `discarded`: the other filters keep
 *   the counts of the last default answer;
 * - the filter codes include `bounce` / `discarded` only when the backend reports them.
 *
 * `review` is the host's shared review state (`useAutoMatchReview().panel`): with it, a pair
 * dismissed here is hidden in the automatch modal too. Without it the panel keeps its own.
 *
 * `refreshDefaultCounts()` re-reads the default answer's counts while "Descartadas" is shown (a
 * restore there moves lines back to the other filters); `accountId`, `dateFrom` and `dateTo` are
 * the panel's own request filters, for that read. `clearDismissed()` forgets the pairs hidden with
 * "No es un rechazo" (after "Volver a considerar como posible rechazo" the pair may come back).
 *
 * @param {{ lines: Array<object>, counts: object, status: string|null,
 *   review?: object|null, accountId?: string, dateFrom?: string, dateTo?: string }} args
 */
export function useBounceLines({
  lines, counts, status, review = null, accountId = null, dateFrom, dateTo,
}) {
  const [ownDismissed, setOwnDismissed] = useState(() => new Set());
  const ownDismiss = useCallback((groupKey) => {
    setOwnDismissed((prev) => {
      if (!groupKey || prev.has(groupKey)) return prev;
      const next = new Set(prev);
      next.add(groupKey);
      return next;
    });
  }, []);
  const ownClearDismissed = useCallback(() => {
    setOwnDismissed((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);
  const dismissedKeys = review?.dismissedKeys ?? ownDismissed;
  const dismiss = review?.onDismiss ?? ownDismiss;
  const clearDismissed = review?.onClearDismissed ?? ownClearDismissed;

  // The counts of the last default answer, for the filters the discarded answer does not count.
  // Taken from each default answer (in an effect, not during render), so they hold still while the
  // discarded one is shown — until `refreshDefaultCounts` re-reads them after a restore there.
  const [defaultCounts, setDefaultCounts] = useState(counts ?? EMPTY_COUNTS);
  const discardedAnswer = isDiscardedAnswer(counts);
  useEffect(() => {
    if (discardedAnswer) return;
    // A loading resource answers a fresh `{}` on every render: keep the same object when nothing
    // changed, or this effect would re-render forever.
    setDefaultCounts((prev) => (sameCounts(prev, counts) ? prev : (counts ?? EMPTY_COUNTS)));
  }, [counts, discardedAnswer]);
  // ETP-6359 — `discardedPairs` (the "Descartadas" figure) follows the discarded answer too when
  // it carries one; else the default answer's holds.
  const baseCounts = useMemo(
    () => (discardedAnswer ? withDiscardedCounts(defaultCounts, counts) : counts),
    [counts, discardedAnswer, defaultCounts],
  );

  const fetchCounts = usePendingLineCounts();
  const refreshDefaultCounts = useCallback(async () => {
    if (status !== DISCARDED_STATE || !accountId) return;
    try {
      const fresh = await fetchCounts({ financialAccountId: accountId, dateFrom, dateTo });
      if (fresh && !isDiscardedAnswer(fresh)) setDefaultCounts(fresh);
    } catch {
      // Keep the last counts: leaving "Descartadas" reloads the default answer, and with it them.
    }
  }, [status, accountId, dateFrom, dateTo, fetchCounts]);

  const shownLines = useMemo(() => withDismissedPairs(lines, dismissedKeys), [lines, dismissedKeys]);
  const shownCounts = useMemo(
    () => countsWithDismissedPairs(baseCounts, lines, dismissedKeys),
    [baseCounts, lines, dismissedKeys],
  );
  const statusCodes = useMemo(() => visibleStatusCodes(shownCounts, status), [shownCounts, status]);
  const discardedLines = useMemo(
    () => (status === DISCARDED_STATE ? lines.filter((l) => l?.state === DISCARDED_STATE) : []),
    [lines, status],
  );

  return {
    lines: shownLines,
    counts: shownCounts,
    statusCodes,
    discardedLines,
    dismiss,
    clearDismissed,
    refreshDefaultCounts,
  };
}

/**
 * "Revisar en el panel" (ETP-5581): the host asks the panel to show the bounce line of a pair. The
 * filter moves to "Posibles rechazos" and the search is cleared; once the lines have loaded the line
 * is selected and scrolled into view. A line outside the active date range widens it to any date
 * once; a line that is still not there is given up on. Either way the request is consumed, so a
 * later visit does not replay it.
 *
 * The lines on screen are searched right away, in the same commit as the request — unless the
 * active filter is one with its own request (`Descartadas`, `status=discarded`): leaving it reloads
 * the lines, and the discarded ones on screen cannot hold the bounce line, so the search waits for
 * that reload.
 */
function useFocusRequest({
  focus, onFocusConsumed, lines, loading, status, setStatus, setSearch, dateRange, setDateRange,
  selectLine,
}) {
  const pendingRef = useRef(null);
  // `widened`: the date range was already opened once for this request. `reloaded`: a reload was
  // seen since — until then the lines on screen are still those of the narrower range.
  const widenedRef = useRef(false);
  const reloadedRef = useRef(true);

  // The active status, read when a request arrives: changing it must not, by itself, restart one.
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!focus?.lineId) return;
    pendingRef.current = focus;
    widenedRef.current = false;
    // Leaving a filter with its own request reloads the lines: wait for that reload.
    reloadedRef.current = pendingLinesStatusParam(statusRef.current) === undefined;
    setStatus(BOUNCE_STATE);
    setSearch('');
  }, [focus, setStatus, setSearch]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (loading) {
      reloadedRef.current = true;
      return;
    }
    if (!reloadedRef.current) return;
    const line = lines.find((l) => l.id === pending.lineId);
    if (line) {
      pendingRef.current = null;
      selectLine(line);
      scrollLineIntoView(line.id);
      onFocusConsumed?.();
      return;
    }
    if (!widenedRef.current && dateRange) {
      widenedRef.current = true;
      reloadedRef.current = false;
      setDateRange(null);
      return;
    }
    pendingRef.current = null;
    onFocusConsumed?.();
  }, [focus, lines, loading, dateRange, setDateRange, selectLine, onFocusConsumed]);
}

/**
 * The right panel for the selected line when it is a line of a possible bounce pair or a discarded
 * line ({@link BouncePairPanel}), or `null` — then the split panel shows its candidate operations as
 * always. Owns the choice of original of an ambiguous pair, the discard / restore calls and their
 * toasts, and the "Revisar en el panel" focus request.
 *
 * @param {object} args
 * @returns {{ panel: JSX.Element|null, parts: object|null }}
 */
export function useBouncePairPanel({
  accountId, currency, bcpLocale, selectedLine, lines, loading, discardedLines,
  reloadLines, onChanged, onRestored, dismiss, windowReadOnly = false,
  review = null, status = null, setStatus, setSearch, dateRange, setDateRange, selectLine,
}) {
  const ui = useUI();
  const { discardPair, loading: discarding } = useDiscardPair();
  const { restorePair, loading: restoring } = useRestorePair();
  const { dismissPair, loading: dismissing } = useDismissPair();
  // ETP-6359 — what the last automatch brought: the AI's percentage per candidate (null without AI).
  const freshAssessments = review?.aiAssessments ?? null;
  // BUG-1 — bounce lines whose AI recommendation the backend refused as stale (409): their default
  // is ignored locally (no preselection, badge or AI notice; the percentages stay) until a fresh
  // automatch brings new assessments. Without it the radio would stay pre-checked and every retry
  // would send choiceSource 'ai' and get the same 409.
  const [aiInvalidated, setAiInvalidated] = useState(() => new Set());
  useEffect(() => {
    setAiInvalidated((prev) => (prev.size === 0 ? prev : new Set()));
  }, [freshAssessments]);
  const aiAssessments = useMemo(() => {
    if (!freshAssessments || aiInvalidated.size === 0) return freshAssessments;
    const out = { ...freshAssessments };
    for (const id of aiInvalidated) {
      if (out[id]) out[id] = { ...out[id], recommendedLineId: null };
    }
    return out;
  }, [freshAssessments, aiInvalidated]);
  // The original chosen for an ambiguous pair. With the host's shared review state (ETP-6359) it is
  // kept there, per bounce line, so the automatch modal shows and excludes the same outflow;
  // without it the panel remembers the last one itself.
  const [ownChosen, setOwnChosen] = useState({ lineId: null, originalId: null, original: null });
  const sharedPicks = review?.onPick ? (review.picks ?? null) : null;
  const onPick = review?.onPick ?? null;
  const chosen = useMemo(() => {
    if (!onPick) return ownChosen;
    const lineId = selectedLine?.id ?? null;
    const original = lineId == null ? null : (sharedPicks?.get?.(lineId) ?? null);
    return { lineId, originalId: original?.id ?? null, original };
  }, [onPick, ownChosen, sharedPicks, selectedLine?.id]);

  useFocusRequest({
    focus: review?.focus ?? null,
    onFocusConsumed: review?.onFocusConsumed,
    lines, loading, status, setStatus, setSearch, dateRange, setDateRange, selectLine,
  });

  const model = useMemo(() => bouncePanelModel(selectedLine, {
    discardedLines,
    chosenOriginalId: chosen.lineId === selectedLine?.id ? chosen.originalId : null,
    chosenOriginalLine: chosen.lineId === selectedLine?.id ? chosen.original : null,
    aiAssessments,
  }), [selectedLine, discardedLines, chosen, aiAssessments]);

  const refresh = useCallback(() => {
    reloadLines?.();
    onChanged?.();
  }, [reloadLines, onChanged]);

  // `pick` is an outflow id (the single-line panel's radios) or the outflow line itself (the
  // two-table view, where it may be any outflow of the same amount, not only a detected candidate).
  const choose = useCallback((pick) => {
    const original = pick != null && typeof pick === 'object' ? pick : null;
    const lineId = selectedLine?.id ?? null;
    if (onPick) {
      // The shared store keeps the line itself: the modal row renders it.
      const line = original ?? model?.rows?.find((r) => r.id === pick) ?? null;
      if (lineId != null && line) onPick(lineId, line);
      return;
    }
    setOwnChosen({ lineId, originalId: original ? original.id : pick, original });
  }, [selectedLine?.id, onPick, model]);

  // "No es un rechazo" (ETP-6359: persisted). The backend marks the pair's rejection line and stops
  // proposing it; the pair is hidden at once (`dismiss`, shared with the automatch modal) and the
  // lines and the suggestions reload, which drop it for good. A write: closed under read-only.
  const onDismiss = useCallback(async () => {
    const groupKey = selectedLine?.bouncePair?.groupKey;
    const body = dismissPairPayload(accountId, selectedLine, model);
    if (windowReadOnly || !groupKey || !body) return;
    let result;
    try {
      result = await dismissPair(body);
    } catch (err) {
      toast.error(failureText(err, ui, 'financeReconcileBounceToastDismissError'));
      return;
    }
    dismiss(groupKey);
    // No `dismissedLineId`: nothing was stored (the backend's column is not mapped yet, or the lines
    // are no longer a detected pair), so the pair is only hidden for now and may come back.
    toast.success(ui(result?.dismissedLineId == null
      ? 'financeReconcileBounceToastDismissedSession'
      : 'financeReconcileBounceToastDismissed'));
    refresh();
  }, [selectedLine, dismiss, ui, windowReadOnly, accountId, model, dismissPair, refresh]);

  // ETP-6359 — "Deshacer" on the success notice of a discard that followed the AI's preselection:
  // restores the pair through the same call as "Restaurar par".
  const undoDiscard = useCallback(async (lineId) => {
    try {
      await restorePair({ financialAccountId: accountId, lineId });
      toast.success(ui('financeReconcileBounceToastRestored'));
      refresh();
    } catch (err) {
      toast.error(failureText(err, ui, 'financeReconcileBounceToastRestoreError'));
    }
  }, [restorePair, accountId, ui, refresh]);

  const onDiscard = useCallback(async () => {
    if (windowReadOnly || !model?.discard) return;
    // `choiceSource` travels only when the AI rated this pair: 'ai' while its preselection stands,
    // 'user' for an explicit pick. Without AI data the body is exactly what it always was.
    const choiceSource = discardChoiceSource(model);
    const aiDiscard = model.aiPreselected;
    const bounceLineId = model.discard.counterpartLineId;
    try {
      await discardPair({
        financialAccountId: accountId,
        ...model.discard,
        ...(choiceSource ? { choiceSource } : {}),
      });
      if (aiDiscard) {
        toast.success(ui('financeReconcileBounceToastDiscarded'), {
          action: {
            label: ui('financeReconcileBounceAiUndo'),
            onClick: () => { undoDiscard(bounceLineId); },
          },
        });
      } else {
        toast.success(ui('financeReconcileBounceToastDiscarded'));
      }
      refresh();
    } catch (err) {
      if (isAiStaleError(err)) {
        // The suggestion no longer holds (the statement changed since it was shown): say so and
        // reload, so the panel shows the current proposal, and the AI default of this rejection
        // is dropped for good (until a fresh automatch).
        setAiInvalidated((prev) => new Set(prev).add(bounceLineId));
        toast.error(translateBackendErrorBody(err?.body, ui, null) || ui(AI_STALE_I18N_KEY));
        refresh();
        return;
      }
      toast.error(failureText(err, ui, 'financeReconcileBounceToastDiscardError'));
    }
  }, [windowReadOnly, model, discardPair, accountId, ui, refresh, undoDiscard]);

  const onRestore = useCallback(async () => {
    if (windowReadOnly || !selectedLine?.id) return;
    try {
      const result = await restorePair({ financialAccountId: accountId, lineId: selectedLine.id });
      const restored = Array.isArray(result?.restored) ? result.restored.length : 0;
      toast.success(ui(restored > 1
        ? 'financeReconcileBounceToastRestored'
        : 'financeReconcileBounceToastRestoredLine'));
      refresh();
      onRestored?.();
    } catch (err) {
      // A line discarded on its own is restored alone: its failure names the line, not a pair.
      toast.error(failureText(err, ui, model?.paired === false
        ? 'financeReconcileBounceToastRestoreLineError'
        : 'financeReconcileBounceToastRestoreError'));
    }
  }, [windowReadOnly, selectedLine, restorePair, accountId, ui, refresh, onRestored, model]);

  const panel = model ? (
    <BouncePairPanel
      model={model}
      line={selectedLine}
      currency={currency}
      bcpLocale={bcpLocale}
      onChoose={choose}
      onDismiss={onDismiss}
      onDiscard={onDiscard}
      onRestore={onRestore}
      busy={discarding || restoring || dismissing}
      windowReadOnly={windowReadOnly}
      data-testid="BouncePairPanel__d0f4d5" />
  ) : null;

  // ETP-6359 — the pieces of the same panel for the two-table "Posibles rechazos" view, which lays
  // them out itself: the model, the selected line and the handlers (null without a model).
  const parts = model
    ? {
      model, line: selectedLine, onChoose: choose, onDismiss, onDiscard, onRestore,
      busy: discarding || restoring || dismissing, windowReadOnly,
    }
    : null;

  return { panel, parts };
}

/**
 * The "Posibles rechazos" view of the split panel's left list (ETP-6359): ONE ROW PER PAIR instead
 * of one row per line, the outflows a pair's original can be picked from, and the pair count the
 * status filter shows for that entry.
 *
 * - `pairMode` is whether the "Posibles rechazos" filter is the active one; outside it the rows are
 *   `null` and the outflows empty, so the host lists its lines as always.
 * - `bouncePairCount` is `null` while the backend reports no bounce count (which keeps the entry out
 *   of the filter anyway). While "Descartadas" is shown, or the lines are still loading, `lines`
 *   does not hold the default answer: the last settled figure is kept (like the counts, see
 *   {@link useBounceLines}), so the filter never flashes 0 meanwhile.
 * - A pair's original / candidate line selected under another filter reads as its pair here: the
 *   selection moves (through `selectLine`) to the pair's bounce row, the anchor the pair panel's
 *   model keys on.
 *
 * @param {{ lines: Array<object>, search: string, status: string|null, loading: boolean,
 *   statusCounts: object|null|undefined, selectedLine: object|null,
 *   selectLine: (line: object) => void }} args
 * @returns {{ pairMode: boolean, bouncePairRows: Array<object>|null, bounceOutflows: Array<object>,
 *   bouncePairCount: number|null }}
 */
export function useBouncePairRows({
  lines, search, status, loading, statusCounts, selectedLine, selectLine,
}) {
  const pairMode = status === BOUNCE_STATE;
  const bouncePairRows = useMemo(
    () => (pairMode ? buildBouncePairRows(lines, { query: search }) : null),
    [pairMode, lines, search],
  );
  const bounceOutflows = useMemo(
    () => (pairMode ? buildBounceOutflows(lines, { query: search }) : []),
    [pairMode, lines, search],
  );
  const currentPairCount = useMemo(() => countBouncePairs(lines), [lines]);
  const pairCountSettled = !loading && status !== DISCARDED_STATE && statusCounts?.bounce != null;
  const settledPairCount = useSettledValue(currentPairCount, pairCountSettled);
  const bouncePairCount = statusCounts?.bounce == null ? null : settledPairCount;

  useLandOnAnchor(pairMode, bouncePairRows, selectedLine, selectLine, bounceAnchorOf);

  return { pairMode, bouncePairRows, bounceOutflows, bouncePairCount };
}

/**
 * `value` while `settled`; otherwise the last value taken while it was (null before the first).
 * The no-flash rule of the pair counts: a count read off lines that are not the answer it is
 * computed from (another filter's, or a stale one while loading) keeps its last real figure.
 */
function useSettledValue(value, settled) {
  const [last, setLast] = useState(null);
  useEffect(() => {
    if (settled) setLast(value);
  }, [settled, value]);
  return settled ? value : last;
}

/**
 * While `active`, moves the selection to the anchor of the pair row that holds the selected line
 * (`anchorOf(rows, line)`: that anchor, or null when the line belongs to no row). The pair views
 * key their selection on one line per pair, so another line of the pair, selected elsewhere, lands
 * on its row. `anchorOf` must be stable (a module-level function).
 */
function useLandOnAnchor(active, rows, selectedLine, selectLine, anchorOf) {
  useEffect(() => {
    if (!active || !rows || !selectedLine) return;
    const anchor = anchorOf(rows, selectedLine);
    if (anchor && anchor.id !== selectedLine.id) selectLine(anchor);
  }, [active, rows, selectedLine, selectLine, anchorOf]);
}

/** "Posibles rechazos": an original / candidate line lands on its pair's bounce row. */
function bounceAnchorOf(rows, line) {
  const pair = line.bouncePair;
  if (!pair || pair.role === 'bounce') return null;
  const entry = rows.find((e) => e.groupKey === pair.groupKey);
  return entry?.anchor.bouncePair.role === 'bounce' ? entry.anchor : null;
}

/** "Descartadas": the rejection of a discarded pair lands on the pair's outflow row. */
function discardedAnchorOf(rows, line) {
  return rows.find((e) => e.counterpart?.id === line.id)?.anchor ?? null;
}

/**
 * The figure of "Descartadas" in the status filter (ETP-6359): the number of discarded PAIRS, which
 * the backend sends as `counts.discardedPairs` with the flag on (`counts.discarded` stays the line
 * count). The counts already hold still while "Descartadas" or a reload is shown (`useBounceLines`);
 * on top of that the last figure is kept if a later answer leaves the field out (no flash). Null
 * while none has come, the filter then shows the backend's line count, and with the flag off.
 */
function useDiscardedPairCount(statusCounts) {
  const flagOn = statusCounts?.bounce != null;
  const raw = statusCounts?.discardedPairs;
  const pairs = raw == null ? null : Number(raw) || 0;
  const count = useSettledValue(pairs, pairs != null);
  return flagOn ? count : null;
}

/**
 * The "Descartadas" view of the split panel's left list (ETP-6359), the twin of
 * {@link useBouncePairRows}: ONE ROW PER DISCARDED PAIR, keyed on its outflow
 * ({@link buildDiscardedPairRows}), and the pair count the status filter shows for that entry.
 *
 * - `discardedMode` is whether "Descartadas" is the active filter with the backend flag on (read,
 *   as everywhere, off `counts.bounce`); outside it the rows are `null` and the host lists the
 *   lines as always, so with the flag off the filter behaves as it did.
 * - The rejection of a pair, selected elsewhere, lands on the pair's outflow row.
 *
 * @returns {{ discardedMode: boolean, discardedPairRows: Array<object>|null,
 *   discardedPairCount: number|null }}
 */
export function useDiscardedPairRows({
  lines, search, status, statusCounts, selectedLine, selectLine,
}) {
  const discardedMode = status === DISCARDED_STATE && statusCounts?.bounce != null;
  const discardedPairRows = useMemo(
    () => (discardedMode ? buildDiscardedPairRows(lines, { query: search }) : null),
    [discardedMode, lines, search],
  );
  useLandOnAnchor(discardedMode, discardedPairRows, selectedLine, selectLine, discardedAnchorOf);
  const discardedPairCount = useDiscardedPairCount(statusCounts);
  return { discardedMode, discardedPairRows, discardedPairCount };
}

/**
 * The two pair views of the split panel's left list (ETP-6359), in one call for the host:
 * "Posibles rechazos" ({@link useBouncePairRows}) and "Descartadas" ({@link useDiscardedPairRows}).
 * `tableView` is whether either is the active one (the host then hides its own right panel), and
 * `pairCounts` the figures the status filter shows for their entries (null = the backend's count).
 *
 * @returns {{ tableView: boolean, bouncePairRows: Array<object>|null, bounceOutflows: Array<object>,
 *   discardedPairRows: Array<object>|null,
 *   pairCounts: { bounce: number|null, discarded: number|null } }}
 */
export function usePairTableViews(args) {
  const {
    pairMode, bouncePairRows, bounceOutflows, bouncePairCount,
  } = useBouncePairRows(args);
  const { discardedMode, discardedPairRows, discardedPairCount } = useDiscardedPairRows(args);
  const pairCounts = useMemo(
    () => ({ bounce: bouncePairCount, discarded: discardedPairCount }),
    [bouncePairCount, discardedPairCount],
  );
  return {
    tableView: pairMode || discardedMode,
    bouncePairRows,
    bounceOutflows,
    discardedPairRows,
    pairCounts,
  };
}

/**
 * The right panel's notice for a line the user marked "No es un rechazo" (ETP-6359): the backend
 * persists the mark on the pair's rejection line (`bounceDismissedAt` on its `pendingLines` row) and
 * never proposes it as a rejection again. The notice says when, and "Volver a considerar como
 * posible rechazo" clears the mark (`restoreBounceSuggestion`), then the pairs hidden in this
 * session are forgotten (the line may form one again) and the lines and the automatch suggestions
 * reload. Null for any other line and with the flag off (no `counts.bounce`). The undo is a write:
 * disabled under the read-only tier. It reports no KPI event.
 *
 * @param {{ accountId: string, line: object|null, statusCounts: object|null, bcpLocale: string,
 *   windowReadOnly?: boolean, reloadLines?: () => void, onChanged?: () => void,
 *   clearDismissed?: () => void }} args
 * @returns {JSX.Element|null}
 */
export function useDismissedSuggestionNotice({
  accountId, line, statusCounts, bcpLocale, windowReadOnly = false, reloadLines, onChanged,
  clearDismissed,
}) {
  const ui = useUI();
  const { restoreBounceSuggestion, loading } = useRestoreBounceSuggestion();
  const dismissedAt = statusCounts?.bounce == null ? null : (line?.bounceDismissedAt ?? null);
  const lineId = line?.id ?? null;
  const onRestore = useCallback(async () => {
    if (windowReadOnly || !lineId) return;
    try {
      await restoreBounceSuggestion({ financialAccountId: accountId, statementLineId: lineId });
    } catch (err) {
      toast.error(failureText(err, ui, 'financeReconcileBounceToastSuggestionRestoreError'));
      return;
    }
    toast.success(ui('financeReconcileBounceToastSuggestionRestored'));
    clearDismissed?.();
    reloadLines?.();
    onChanged?.();
  }, [windowReadOnly, lineId, restoreBounceSuggestion, accountId, ui, clearDismissed, reloadLines,
    onChanged]);
  if (!dismissedAt) return null;
  return (
    <BounceDismissedNotice
      dismissedAt={dismissedAt}
      bcpLocale={bcpLocale}
      onRestore={onRestore}
      busy={loading}
      windowReadOnly={windowReadOnly}
      data-testid="BounceDismissedNotice__d0f4d5" />
  );
}
