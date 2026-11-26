import { CalendarBlankIcon } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { MoneyAmount } from '@/components/ui/money-amount';
import { TruncatedText } from '@/components/ui/truncated-text';
import { cn } from '@/lib/utils';

/**
 * The column layout shared by the rows and the header of every card, so the divider cannot drift:
 * two equal grid tracks (`minmax(0,1fr)`, padding never changes a track's width) and the same cell
 * padding and divider on each half. The bordered cell never carries vertical padding or margin (it stretches the full height of its row, the padding goes on an inner wrapper), so the divider is one continuous line from the header to the last row.
 */
export const AUTOMATCH_COLUMNS = 'grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)]';
export const AUTOMATCH_LEFT_CELL = 'min-w-0 pl-3 pr-6';
export const AUTOMATCH_RIGHT_CELL = 'min-w-0 border-l border-[hsl(var(--border-subtle))] px-6';

/**
 * The ONE row of the automatch modal (ETP-6359): a checkbox column and two cells split by a divider. Both cards use it — the possible bank rejections (original movement |
 * rejection) and the bank statement lines (statement line | system operations) — so they cannot
 * drift apart.
 *
 * Three looks, all from the Figma "Fila Extractos Bancarios" component: default (white), selected
 * (muted background, filled checkbox) and hover (white with a large shadow).
 *
 * Presentational: the host owns the check state and fills the two cells; every test id is passed in
 * so each card keeps its own (`automatch-group-*`, `automatch-bounce-*`).
 *
 * @param {{ checked: boolean, disabled?: boolean, onToggle: () => void, checkLabel: string,
 *   checkTestId: string, testId: string, left: import('react').ReactNode,
 *   right: import('react').ReactNode }} props
 */
export function AutoMatchPairRow({
  checked, disabled = false, onToggle, checkLabel, checkTestId, testId, left, right,
}) {
  return (
    <div
      className={cn(
        'relative flex flex-row items-stretch border-b border-[hsl(var(--border-subtle))] transition-shadow last:border-b-0 last:rounded-b-lg',
        checked ? 'bg-[hsl(var(--muted))]' : 'bg-card',
        'hover:z-10 hover:shadow-lg',
      )}
      data-testid={testId}>
      <div className="flex w-8 flex-none items-start justify-center pt-3 pl-2">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={checkLabel}
          title={disabled ? checkLabel : undefined}
          data-testid={checkTestId} />
      </div>
      <div className={AUTOMATCH_COLUMNS}>
        {/* The bordered cell stretches the full row height; the vertical padding lives on the inner
            wrapper so the divider is one continuous line with the header's. */}
        <div className={cn(AUTOMATCH_LEFT_CELL, 'flex')}>
          <div className="flex min-w-0 flex-1 py-3">{left}</div>
        </div>
        <div className={cn(AUTOMATCH_RIGHT_CELL, 'flex')}>
          <div className="flex min-w-0 flex-1 py-3">{right}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * One side of an {@link AutoMatchPairRow}: description, a meta line (calendar icon + date, then the
 * badge and the reason as SEPARATE elements) and the amount column with an optional action under
 * the amount ("Revisar en el panel").
 *
 * @param {{ description: string, amount: number, currency: string, strong?: boolean,
 *   dateText?: string, badge?: import('react').ReactNode, reason?: import('react').ReactNode,
 *   action?: import('react').ReactNode, testId?: string, metaTestId?: string,
 *   compact?: boolean }} props `compact` (the reconciliation panel's pair lists): the amount column
 *   shrinks to its content instead of the modal's fixed 160 px
 */
export function AutoMatchPairSide({
  description, amount, currency, strong = false, dateText = '', badge = null, reason = null,
  action = null, testId, metaTestId, compact = false,
}) {
  const value = Number(amount ?? 0);
  return (
    <div className={cn('flex min-w-0 flex-1', compact ? 'gap-2' : 'gap-3 min-[1100px]:gap-10')} data-testid={testId}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Clipped with an ellipsis, the full text on hover: bank descriptions often differ only
            in their last characters ("…CONCEPTO 10000268 100-1" / "…-2"). */}
        <TruncatedText
          text={description || '—'}
          className={cn('min-w-0 text-sm leading-5 text-[hsl(var(--foreground))]', strong ? 'font-semibold' : 'font-medium')}
          data-testid={testId ? `${testId}-desc` : undefined} />
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {dateText ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <CalendarBlankIcon
                className="size-3.5 flex-none text-[hsl(var(--text-disabled))]"
                data-testid="CalendarBlankIcon__c26634" />
              <span
                className="min-w-0 truncate text-xs leading-4 text-[hsl(var(--muted-foreground))]"
                data-testid={metaTestId}>
                {dateText}
              </span>
            </span>
          ) : null}
          {badge}
          {reason}
        </div>
      </div>
      <div className={cn('flex flex-none flex-col items-end gap-1', compact ? 'w-auto max-w-[45%]' : 'w-auto min-[1100px]:w-40')}>
        <MoneyAmount
          value={value}
          currency={currency || 'EUR'}
          tone={value < 0 ? 'negative' : 'positive'}
          className="flex-none text-sm font-semibold"
          data-testid="MoneyAmount__automatch-pair" />
        {action}
      </div>
    </div>
  );
}

export default AutoMatchPairRow;
