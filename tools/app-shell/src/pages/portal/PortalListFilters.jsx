import { forwardRef, useMemo, useState } from 'react';
import { CalendarBlankIcon, CaretDownIcon } from '@phosphor-icons/react';
import { useLocaleSwitch, useUI } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DateRangePopoverContent, computeTriggerLabel } from '@/components/ui/date-range-popover';
import { DistinctValuesList } from '@/components/contract-ui/DistinctValuesList.jsx';
import { TOOLBAR_SELECT_CLASS } from '@/components/contract-ui/listToolbarStyles.js';
import { normalizeSearchText as normalize } from '@/lib/searchText.js';
import { PORTAL_KIND_SUBTYPES } from './portalPresentation.js';

/*
 * The portal list's quick filters (ETP-6209, product decision after the review call): the same
 * controls as the app's list toolbar (`ListFilterBar`) — an outline `Button` in
 * `TOOLBAR_SELECT_CLASS` whose border tells an active filter apart, a `Popover` with the shared
 * `DistinctValuesList` (search box, "all" row, check on the committed value) or the shared
 * `DateRangePopoverContent`. The data is the portal's own: the type options are the kind's
 * document types, a fixed short list, so they are filtered in memory instead of through NEO's
 * distinct-values endpoint. No advanced filter (the portal API takes no NEO criteria) and no status
 * selector: the segmented status tabs already cover it, as the app hides its own status dropdown
 * where tabs do (`hideStatusFilter`).
 */

// A fake `useDistinctValues` result over a fixed list: only the search box state, never loading or paging.
function useStaticDistinct() {
  const [search, setSearch] = useState('');
  return useMemo(() => ({
    search,
    setSearch,
    values: [],
    loading: false,
    loadingMore: false,
    hasMore: false,
    loadMore: () => {},
  }), [search]);
}

/** The trigger: the app toolbar's button, with the active border of a set filter. */
const ToolbarButton = forwardRef(function ToolbarButton({
  active, testId, className, children, 'data-testid': _codemodTestId, ...props
}, ref) {
  return (
    <Button
      ref={ref}
      variant="outline"
      size="sm"
      aria-haspopup="listbox"
      className={cn(TOOLBAR_SELECT_CLASS, active && 'border-primary/40', className)}
      {...props}
      data-testid={testId}
    >
      {children}
      <CaretDownIcon className="!size-4" aria-hidden="true" data-testid="CaretDown__9c41e2" />
    </Button>
  );
});

/**
 * One single-choice selector over a fixed list of codes (`null` = all). Each option label carries
 * `${optionTestId}-${code}` (and `-all`), so a test or E2E can pick it; the row itself is the
 * shared `DistinctValuesList` option (`aria-selected` on the committed one).
 */
function StaticSelect({
  codes, labelFor, value, onChange, allLabel, triggerLabel, searchPlaceholder, testId,
  optionTestId, suffix = '',
}) {
  const [open, setOpen] = useState(false);
  const distinct = useStaticDistinct();
  const term = normalize(distinct.search).trim();
  const shown = term ? codes.filter((code) => normalize(labelFor(code)).includes(term)) : codes;
  const optionLabel = (code, label) => (
    <span data-testid={`${optionTestId}-${String(code).toLowerCase()}${suffix}`}>{label}</span>
  );
  return (
    <Popover open={open} onOpenChange={setOpen} data-testid="Popover__9c41e2">
      <PopoverTrigger asChild data-testid="PopoverTrigger__9c41e2">
        <ToolbarButton active={Boolean(value)} testId={testId} data-testid="ToolbarButton__9c41e2">
          <span className="truncate">{triggerLabel}</span>
        </ToolbarButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0" data-testid="PopoverContent__9c41e2">
        <DistinctValuesList
          activeCode={value ?? null}
          allLabel={<span data-testid={`${optionTestId}-all${suffix}`}>{allLabel}</span>}
          codes={shown}
          labelFor={labelFor}
          renderOption={optionLabel}
          distinct={distinct}
          onSelect={(code) => {
            onChange(code ?? null);
            setOpen(false);
          }}
          searchPlaceholder={searchPlaceholder}
          data-testid="DistinctValuesList__9c41e2" />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The document type selector of a kind that mixes types (invoices and credit notes,
 * {@link PORTAL_KIND_SUBTYPES}); nothing for the other kinds.
 */
export function PortalTypeSelect({ kind, subtype, onSubtype, suffix = '' }) {
  const ui = useUI();
  const subtypes = PORTAL_KIND_SUBTYPES[kind] ?? null;
  if (!subtypes) return null;
  const byCode = new Map(subtypes.map((option) => [option.code, option]));
  const labelFor = (code) => ui(byCode.get(code)?.labelKey);
  return (
    <StaticSelect
      codes={subtypes.map((option) => option.code)}
      labelFor={labelFor}
      value={subtype}
      onChange={(code) => onSubtype?.(code)}
      allLabel={ui('allTypes')}
      triggerLabel={subtype && byCode.has(subtype) ? labelFor(subtype) : ui('allTypes')}
      searchPlaceholder={ui('searchTypes')}
      testId={`portal-filter-type${suffix}`}
      optionTestId="portal-list-subtype"
      suffix={suffix}
      data-testid="StaticSelect__9c41e2" />
  );
}

/** The range a trigger names: the preset, the days of a custom range, or all time. */
export function usePortalRangeLabel(value) {
  const ui = useUI();
  const { locale } = useLocaleSwitch();
  return computeTriggerLabel(value, undefined, ui, (locale || 'es_ES').replace('_', '-'));
}

/**
 * The date range selector (desktop): the app toolbar's date button with the shared picker in its
 * default two-calendar layout. `active`: the range differs from the tab's default.
 */
export function PortalDateSelect({ value, onChange, active = false }) {
  const [open, setOpen] = useState(false);
  const label = usePortalRangeLabel(value);
  return (
    <Popover open={open} onOpenChange={setOpen} data-testid="Popover__9c41e2">
      <PopoverTrigger asChild data-testid="PopoverTrigger__9c41e2">
        <ToolbarButton active={active} testId="portal-date-range" aria-haspopup="dialog" data-testid="ToolbarButton__9c41e2">
          <CalendarBlankIcon aria-hidden="true" data-testid="CalendarBlank__9c41e2" />
          <span className="truncate">{label}</span>
        </ToolbarButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0" data-testid="PopoverContent__9c41e2">
        <DateRangePopoverContent
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
          data-testid="DateRangePopoverContent__9c41e2" />
      </PopoverContent>
    </Popover>
  );
}
