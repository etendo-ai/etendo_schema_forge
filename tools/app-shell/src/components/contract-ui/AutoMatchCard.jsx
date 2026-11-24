import { InfoIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { AUTOMATCH_COLUMNS, AUTOMATCH_LEFT_CELL, AUTOMATCH_RIGHT_CELL } from './AutoMatchPairRow.jsx';

/** The tinted frame of each tone, from the shared status tokens (no raw colours). */
const TONE = {
  warning: {
    frame: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]',
    title: 'text-[var(--status-warning-fg)]',
  },
  success: {
    frame: 'border-[var(--status-success-border)] bg-[var(--status-success-bg)]',
    title: 'text-[var(--status-success-fg)]',
  },
};

/**
 * A card of the automatch modal (ETP-6359): a tinted frame with a title and a subtitle, the white
 * table of rows inside, and a footer with an info sentence and the card's own action button.
 * Yellow for the possible bank rejections, green for the bank statement lines.
 *
 * @param {{ tone: 'warning'|'success', title: string, description: string, info: string,
 *   action: import('react').ReactNode, testId: string, children: import('react').ReactNode }} props
 */
export function AutoMatchCard({ tone, title, description, info, action, testId, children }) {
  const cfg = TONE[tone] ?? TONE.success;
  return (
    <section className={cn('flex flex-col rounded-lg border px-1 pt-1', cfg.frame)} data-testid={testId}>
      <div className="flex flex-col gap-0.5 px-2 pb-3 pt-1">
        <h3 className={cn('m-0 text-base font-medium leading-6', cfg.title)}>{title}</h3>
        <p className="m-0 text-xs leading-4 text-[hsl(var(--muted-foreground))]">{description}</p>
      </div>
      <div className="flex flex-col rounded-lg border border-[hsl(var(--border-subtle))] bg-card shadow-[0_1px_2px_rgba(18,18,23,0.05)]">
        {children}
      </div>
      <div className="flex items-center justify-between gap-4 px-1 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <InfoIcon className="size-4 flex-none text-[hsl(var(--text-disabled))]" data-testid="Info__automatch-card" />
          <span className="text-xs leading-4 text-[hsl(var(--muted-foreground))]">{info}</span>
        </div>
        {action}
      </div>
    </section>
  );
}

/**
 * The header row of a card's table: the select-all checkbox, the title of the left column (with its
 * counter) and the title of the right one, aligned with the cells of {@link AutoMatchPairRow}.
 *
 * @param {{ selectAll: import('react').ReactNode, leftTitle: string, count: number|string,
 *   rightTitle: string, countTestId?: string }} props
 */
export function AutoMatchCardHeader({ selectAll, leftTitle, count, rightTitle, countTestId }) {
  return (
    <div className="flex h-10 flex-row items-stretch rounded-t-lg border-b border-[hsl(var(--border-subtle))]">
      <div className="flex w-8 flex-none items-center justify-center pl-2">{selectAll}</div>
      <div className={AUTOMATCH_COLUMNS}>
        <div className={cn(AUTOMATCH_LEFT_CELL, 'flex items-center gap-2')}>
          <span className="text-xs font-semibold leading-4 text-[hsl(var(--foreground))]">{leftTitle}</span>
          <span
            className="rounded-lg bg-[hsl(var(--muted))] px-1.5 py-0.5 text-xs text-[hsl(var(--muted-foreground))]"
            data-testid={countTestId}>
            {count}
          </span>
        </div>
        <div className={cn(AUTOMATCH_RIGHT_CELL, 'flex items-center')}>
          <span className="text-xs font-semibold leading-4 text-[hsl(var(--foreground))]">{rightTitle}</span>
        </div>
      </div>
    </div>
  );
}

export default AutoMatchCard;
