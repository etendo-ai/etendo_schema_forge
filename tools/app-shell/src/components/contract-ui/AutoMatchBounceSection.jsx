import { ArrowUpRightIcon, CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useUI } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { AutoMatchCard, AutoMatchCardHeader } from './AutoMatchCard.jsx';
import { AutoMatchPairRow, AutoMatchPairSide } from './AutoMatchPairRow.jsx';
import {
  bounceReason, isAmbiguousPair, isSelectableGroup, pairOriginalLines, shownOutflow,
} from './bouncePairs.js';
import { AiPercentText } from './BouncePairPanel.jsx';
import { aiAssessmentFor, visibleAiPercent } from './bounceAi.js';

const TAG_CLS = 'inline-flex h-6 shrink-0 items-center gap-0.5 rounded-full px-2 py-1 text-xs font-normal';
/**
 * "Revisar en el panel": the shared `Button` outline variant with the app's secondary colours (the
 * same formula as the bounce panel's "No es un rechazo"), at the row's compact pill size.
 */
const REVIEW_BTN = 'h-8 flex-none gap-1 rounded-full border-[hsl(var(--border-control))] bg-card px-3 text-sm font-medium text-[hsl(var(--foreground))] shadow-[0_1px_2px_rgba(18,18,23,0.05)] hover:bg-muted hover:text-[hsl(var(--foreground))] [&_svg]:size-4';

/**
 * The badge of a pair row — "Confianza alta" or "Revisar" — and, SEPARATE from it, the reason text
 * (ETP-6359). The badge is the confidence; the reason is why ("2 salidas posibles", "solo coincide
 * la contraparte"…). The signals behind it are spelled out in the reconciliation panel.
 *
 * @returns {{ badge: import('react').ReactNode, reason: import('react').ReactNode }}
 */
export function pairBadgeAndReason(
  ui, group, original, aiPct = null, reviewTagKey = 'financeReconcileBounceTagReviewPlain',
) {
  const reason = bounceReason(group, original, group.counterpartLine);
  const reasonCls = 'text-xs leading-4 text-[hsl(var(--muted-foreground))]';
  if (reason.high) {
    return {
      badge: (
        <span
          className={cn(TAG_CLS, 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]')}
          data-testid={`automatch-bounce-tag-high-${group.groupKey}`}>
          <CheckCircleIcon className="size-3.5 text-[var(--status-success-fg)]" weight="fill" />
          {ui('financeReconcileBounceTagHigh')}
        </span>
      ),
      reason: reason.signalKey ? (
        <span className={reasonCls} data-testid={`automatch-bounce-reason-${group.groupKey}`}>
          {ui(reason.signalKey)}
        </span>
      ) : null,
    };
  }
  // ETP-6359 — the AI's probability, next to (never inside) the badge: its own element after the reason.
  const aiText = aiPct == null ? null : (
    <AiPercentText
      rowId={group.groupKey}
      pct={aiPct}
      testId={`automatch-bounce-ai-pct-${group.groupKey}`} />
  );

  return {
    badge: (
      <span
        className={cn(TAG_CLS, 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]')}
        data-testid={`automatch-bounce-tag-review-${group.groupKey}`}>
        <WarningCircleIcon className="size-3.5 text-[var(--status-warning-fg)]" weight="fill" />
        {ui(reviewTagKey)}
      </span>
    ),
    reason: aiText ? (
      <>
        <span className={reasonCls} data-testid={`automatch-bounce-reason-${group.groupKey}`}>
          {ui(reason.shortKey, reason.params)}
        </span>
        {aiText}
      </>
    ) : (
      <span className={reasonCls} data-testid={`automatch-bounce-reason-${group.groupKey}`}>
        {ui(reason.shortKey, reason.params)}
      </span>
    ),
  };
}

/**
 * The muted second-line text of one side: its line's date, then its bank reference. Two lines of the
 * same text and amount the same day are told apart by that reference.
 */
function sideMeta(ui, formatDate, line) {
  const date = line?.date ? formatDate(line.date) : '';
  const ref = line ? String(line.referenceNo ?? '').trim() : '';
  return [date, ref ? ui('financeReconcileBounceRef', { ref }) : null].filter(Boolean).join(' · ');
}

/** The fallback outflow of a row when the caller resolves none: the pair on its own. */
function ownOutflow(group, aiAssessments) {
  const { line, source } = shownOutflow(group, aiAssessments);
  return {
    line, source, checkable: isSelectableGroup(group), blocked: false, needsPanel: false,
  };
}

/**
 * The check's label: what a tick does, or why the row cannot be ticked right now. A pair with no AI
 * data and no panel pick needs the panel first, even when its candidates are all held; one whose
 * pick (or every outflow) another checked row holds says so.
 */
function checkLabelKey(outflow) {
  if (outflow?.needsPanel && !outflow.picked) return 'financeReconcileAutomatchBounceAmbiguousCheck';
  if (outflow?.blocked) return 'financeReconcileAutomatchBounceOutflowTaken';
  if (outflow?.needsPanel) return 'financeReconcileAutomatchBounceAmbiguousCheck';
  return 'financeReconcileAutomatchBounceCheck';
}

function BouncePairRow({
  group, checked, onToggle, onReview, currency, formatDate, aiAssessments = null, outflow = null,
}) {
  const ui = useUI();
  const ambiguous = isAmbiguousPair(group);
  const assessment = aiAssessmentFor(aiAssessments, group.counterpartLine?.id);
  // ETP-6359 — the outflow the row shows is the one a tick excludes: the panel's pick, else the AI's
  // recommendation, else the most probable candidate, else the first in detector order — minus the
  // outflows a checked row already takes (`outflow`, from resolvePairOutflows). Its own date and
  // bank reference are shown, so the user sees exactly which line the tick discards.
  const shown = outflow ?? ownOutflow(group, aiAssessments);
  // A row with no free outflow names none (every one it could take is held by a checked row): only
  // the amount its outflows share, disabled, with the reason on its check.
  const shownOriginal = shown.line ?? { amount: pairOriginalLines(group)[0]?.amount };
  const bounce = group.counterpartLine ?? {};
  const review = group.confidence !== 'high' || ambiguous;
  const disabled = !checked && !shown.checkable;
  // One rule with the panel: no percentage when "none" wins (aiNoneWins, bounceAi.js).
  const aiPct = assessment ? visibleAiPercent(assessment, shownOriginal.id) : null;
  const { badge, reason } = pairBadgeAndReason(ui, group, ambiguous ? null : shownOriginal, aiPct);
  return (
    <AutoMatchPairRow
      checked={checked}
      disabled={disabled}
      onToggle={() => onToggle(group)}
      checkLabel={ui(disabled ? checkLabelKey(shown) : 'financeReconcileAutomatchBounceCheck')}
      checkTestId={`automatch-bounce-check-${group.groupKey}`}
      testId={`automatch-bounce-row-${group.groupKey}`}
      left={(
        <AutoMatchPairSide
          description={shownOriginal.description || shownOriginal.referenceNo}
          amount={shownOriginal.amount}
          currency={currency}
          strong
          dateText={sideMeta(ui, formatDate, shownOriginal)}
          badge={badge}
          reason={reason}
          testId={`automatch-bounce-original-${group.groupKey}`}
          metaTestId={`automatch-bounce-original-meta-${group.groupKey}`} />
      )}
      right={(
        <AutoMatchPairSide
          description={bounce.description || bounce.referenceNo}
          amount={bounce.amount}
          currency={currency}
          dateText={sideMeta(ui, formatDate, bounce)}
          action={review && onReview ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => onReview(group)}
              className={REVIEW_BTN}
              data-testid={`automatch-bounce-review-${group.groupKey}`}>
              <ArrowUpRightIcon
                className="h-4 w-4 text-[hsl(var(--text-disabled))]"
                data-testid="ArrowUpRight__bounce-review" />
              {ui('financeReconcileAutomatchBounceReview')}
            </Button>
          ) : null}
          testId={`automatch-bounce-line-${group.groupKey}`}
          metaTestId={`automatch-bounce-line-meta-${group.groupKey}`} />
      )} />
  );
}

/**
 * "Posibles rechazos bancarios" — the yellow card of the automatch modal (ETP-5581, redesigned in
 * ETP-6359): left the original movement, right the bank's rejection of it.
 *
 * - High-confidence pairs start checked; pairs to review start unchecked and carry a
 *   "Revisar en el panel" button.
 * - Every row shows ONE outflow, with its own date and bank reference, and a tick excludes the
 *   pair with exactly that one (`pairOutflow`, see `resolvePairOutflows`): the outflow picked in
 *   the panel, else for an ambiguous pair the AI-recommended one, else the most probable, else the
 *   first in detector order. A row whose outflow a checked row already takes shows its next free
 *   one, or cannot be ticked while none is left. An ambiguous pair is never checked by default,
 *   and without AI data it cannot be ticked until its outflow is picked in the panel ("Revisar en
 *   el panel").
 * - The header checkbox toggles every pair that can be checked right now.
 * - The card's own footer button, "Excluir de la conciliación (N)", acts at once and on its own:
 *   `onExclude` discards the checked pairs (the modal applies them without any transaction group).
 *   Disabled with none checked.
 *
 * Presentational: the checks live with the caller ({@link useAutoMatchSelection}).
 *
 * @param {{ pairs: Array<object>, isChecked: (group: object) => boolean,
 *   onToggle: (group: object) => void, onToggleAll: (checked: boolean) => void,
 *   onExclude: () => void, excluding?: boolean, onReview?: (group: object) => void,
 *   currency: string, formatDate: (raw: string) => string,
 *   aiAssessments?: Record<string, object>|null, isCheckable?: (group: object) => boolean,
 *   pairOutflow?: (group: object) => object|null }} props `aiAssessments` (ETP-6359): the
 *   automatch's `bounceAiAssessments` (the percentage and the AI order); `isCheckable` and
 *   `pairOutflow` (ETP-6359, from {@link useAutoMatchSelection}): whether a row can be ticked right
 *   now and the outflow it shows. Without them each pair is taken on its own.
 */
export function AutoMatchBounceSection({
  pairs, isChecked, onToggle, onToggleAll, onExclude, excluding = false, onReview, currency,
  formatDate, aiAssessments = null, isCheckable = isSelectableGroup, pairOutflow = null,
}) {
  const ui = useUI();
  if (!pairs?.length) return null;
  const selectable = pairs.filter((p) => isChecked(p) || isCheckable(p));
  const checkedCount = selectable.filter(isChecked).length;
  const allChecked = selectable.length > 0 && checkedCount === selectable.length;
  return (
    <AutoMatchCard
      tone="warning"
      testId="automatch-bounce-section"
      title={ui('financeReconcileAutomatchBounceTitle')}
      description={ui('financeReconcileAutomatchBounceHint')}
      info={ui('financeReconcileAutomatchBounceInfo')}
      action={(
        <Button
          type="button"
          onClick={onExclude}
          disabled={checkedCount === 0 || excluding}
          className="h-8 flex-none rounded-full px-3"
          data-testid="automatch-bounce-exclude">
          {ui('financeReconcileAutomatchBounceExclude', { count: checkedCount })}
        </Button>
      )}>
      <AutoMatchCardHeader
        selectAll={(
          <Checkbox
            indeterminate={checkedCount > 0}
            disabled={selectable.length === 0}
            onChange={() => onToggleAll(!allChecked)}
            aria-label={ui('financeReconcileAutomatchBounceSelectAll')}
            data-testid="automatch-bounce-select-all" />
        )}
        leftTitle={ui('financeReconcileAutomatchBounceColOriginal')}
        count={pairs.length}
        countTestId="automatch-bounce-count"
        rightTitle={ui('financeReconcileAutomatchBounceColBounce')} />
      {pairs.map((group) => (
        <BouncePairRow
          key={group.groupKey}
          group={group}
          checked={isChecked(group)}
          onToggle={onToggle}
          onReview={onReview}
          currency={currency}
          formatDate={formatDate}
          aiAssessments={aiAssessments}
          outflow={pairOutflow ? pairOutflow(group) : null}
          data-testid="BouncePairRow__automatch" />
      ))}
    </AutoMatchCard>
  );
}

export default AutoMatchBounceSection;
