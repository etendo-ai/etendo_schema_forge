import { ArrowUpRightIcon, CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useUI } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { AutoMatchCard, AutoMatchCardHeader } from './AutoMatchCard.jsx';
import { AutoMatchPairRow, AutoMatchPairSide } from './AutoMatchPairRow.jsx';
import {
  bounceReason, isAmbiguousPair, isSelectableGroup, pairOriginalLines,
} from './bouncePairs.js';

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
function pairBadgeAndReason(ui, group, original) {
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
  return {
    badge: (
      <span
        className={cn(TAG_CLS, 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]')}
        data-testid={`automatch-bounce-tag-review-${group.groupKey}`}>
        <WarningCircleIcon className="size-3.5 text-[var(--status-warning-fg)]" weight="fill" />
        {ui('financeReconcileBounceTagReviewPlain')}
      </span>
    ),
    reason: (
      <span className={reasonCls} data-testid={`automatch-bounce-reason-${group.groupKey}`}>
        {ui(reason.shortKey, reason.params)}
      </span>
    ),
  };
}

/**
 * The muted second-line text of one side: the date(s), then the bank reference when the side names
 * one line. Two lines of the same text and amount the same day are told apart by that reference.
 */
function sideMeta(ui, dates, line) {
  const ref = line ? String(line.referenceNo ?? '').trim() : '';
  return [dates, ref ? ui('financeReconcileBounceRef', { ref }) : null].filter(Boolean).join(' · ');
}

function BouncePairRow({ group, checked, onToggle, onReview, currency, formatDate }) {
  const ui = useUI();
  const ambiguous = isAmbiguousPair(group);
  const originals = pairOriginalLines(group);
  // An ambiguous pair shows its first candidate (they all carry the same amount) and every
  // candidate's date, but no reference: which one it is gets decided in the panel.
  const original = ambiguous ? null : originals[0] ?? null;
  const shownOriginal = originals[0] ?? {};
  const originalDates = originals.map((l) => formatDate(l.date)).filter(Boolean).join(' · ');
  const bounce = group.counterpartLine ?? {};
  const review = group.confidence !== 'high' || ambiguous;
  const selectable = isSelectableGroup(group);
  const ariaLabel = ui(selectable
    ? 'financeReconcileAutomatchBounceCheck'
    : 'financeReconcileAutomatchBounceAmbiguousCheck');
  const { badge, reason } = pairBadgeAndReason(ui, group, original);
  return (
    <AutoMatchPairRow
      checked={checked}
      disabled={!selectable}
      onToggle={() => onToggle(group)}
      checkLabel={ariaLabel}
      checkTestId={`automatch-bounce-check-${group.groupKey}`}
      testId={`automatch-bounce-row-${group.groupKey}`}
      left={(
        <AutoMatchPairSide
          description={shownOriginal.description || shownOriginal.referenceNo}
          amount={shownOriginal.amount}
          currency={currency}
          strong
          dateText={sideMeta(ui, originalDates, original)}
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
          dateText={sideMeta(ui, formatDate(bounce.date), bounce)}
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
 * - An ambiguous pair (several possible outgoing lines) cannot be checked here: its original is
 *   chosen in the reconciliation panel, reached with the same button.
 * - The header checkbox toggles every pair that can be checked.
 * - The card's own footer button, "Excluir de la conciliación (N)", acts at once and on its own:
 *   `onExclude` discards the checked pairs (the modal applies them without any transaction group).
 *   Disabled with none checked.
 *
 * Presentational: the checks live with the caller ({@link useAutoMatchSelection}).
 *
 * @param {{ pairs: Array<object>, isChecked: (group: object) => boolean,
 *   onToggle: (group: object) => void, onToggleAll: (checked: boolean) => void,
 *   onExclude: () => void, excluding?: boolean, onReview?: (group: object) => void,
 *   currency: string, formatDate: (raw: string) => string }} props
 */
export function AutoMatchBounceSection({
  pairs, isChecked, onToggle, onToggleAll, onExclude, excluding = false, onReview, currency,
  formatDate,
}) {
  const ui = useUI();
  if (!pairs?.length) return null;
  const selectable = pairs.filter(isSelectableGroup);
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
          data-testid="BouncePairRow__automatch" />
      ))}
    </AutoMatchCard>
  );
}

export default AutoMatchBounceSection;
