import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUI } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { getDateBounds } from '@/lib/dateRangeBounds.js';
import { PORTAL_ERROR, fetchPortalDocuments } from '@/lib/portal/portalApi.js';
import { PortalListToolbar as DesktopToolbar, PortalListTable as DesktopTable } from './PortalListDesktop.jsx';
import { PortalLogoTile } from './PortalShell.jsx';
import {
  PortalDesktopHeader, PortalMain, PortalSearchPill, PortalCreatedWithTile, usePortalTabLabel,
} from './PortalBits.jsx';
import { PortalMobileCard, PortalMobileFilters, usePortalCardActions } from './PortalListMobile.jsx';
import {
  PORTAL_KIND_GROUPS, PORTAL_KIND_META, defaultPortalRange, isAllTimeGroup, isPortalSubtype,
  toCalendarParam,
} from './portalPresentation.js';

const SEARCH_DEBOUNCE_MS = 300;

/** The opening range: all time on a search from the URL, else the rolling last month (D-2). */
function initialRange(search) {
  return search ? null : defaultPortalRange();
}

/** Whether two picker values name the same calendar days (presets and `null` compare as is). */
function sameCalendarRange(a, b) {
  if (!a || !b || !('from' in a) || !('from' in b)) return a === b;
  return toCalendarParam(a.from) === toCalendarParam(b.from) && toCalendarParam(a.to) === toCalendarParam(b.to);
}

/**
 * What a new `kind` / `search` prop does to the list's own state. `changed`: either prop differs
 * from the one last rendered. `reset`: start over from the defaults — a new kind, or a new search
 * from the URL; a search that went away (a document opened over the list, then closed) keeps the
 * customer's search and filters.
 */
function listPropsChange(shown, kind, search) {
  const kindChanged = shown.kind !== kind;
  return {
    changed: kindChanged || shown.search !== search,
    reset: kindChanged || Boolean(search),
  };
}

/**
 * The range the list asks for and whether the date button is "active". A state tab (CP-18b) shows
 * all time unless the customer picked a range on that very tab; the others show `range`. Active,
 * as in the app's toolbar, when the range is not the tab's default (all time on a state tab, the
 * rolling last month on the others).
 */
function listDateState({ group, range, stateRange }) {
  if (isAllTimeGroup(group)) {
    const effectiveRange = stateRange.group === group ? stateRange.range : null;
    return { effectiveRange, dateActive: effectiveRange != null };
  }
  return { effectiveRange: range, dateActive: !sameCalendarRange(range, defaultPortalRange()) };
}

/** The segmented status tabs: the kind's customer-facing groups, the selected one from the URL. */
function PortalStatusTabs({ tabs, group, onSelect, mobile }) {
  const ui = useUI();
  const tabLabel = usePortalTabLabel();
  return (
    <div
      role="tablist"
      aria-label={ui('portalColStatus')}
      // Never wraps (M1): on a narrow phone the segmented control scrolls sideways with no visible
      // scrollbar, as the app's horizontal rails do (`PendingTasksRail`).
      className={cn('flex overflow-x-auto p-1', mobile ? 'gap-1 rounded-xl bg-[#F3F5F9]' : 'gap-0.5 rounded-lg bg-muted')}
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {tabs.map((tab) => {
        const selected = (group ?? null) === tab.code;
        return (
          <button
            key={tab.code ?? 'all'}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.code)}
            className={cn(
              'rounded-lg font-medium text-foreground',
              'shrink-0 whitespace-nowrap',
              mobile ? 'h-8 px-3 text-sm font-normal leading-6' : 'h-8 px-3',
              selected ? 'bg-card shadow-sm' : '',
              mobile && selected ? 'font-medium' : '',
            )}
            data-testid={`portal-status-tab-${(tab.code ?? 'all').toLowerCase()}${mobile ? '-mobile' : ''}`}
          >
            {tabLabel(tab)}
          </button>
        );
      })}
    </div>
  );
}

/** "Mostrando X de Y" + "Cargar más", or "Todos los registros cargados"; nothing on an empty list. */
function ListFooter({ shown, total, onLoadMore, loadingMore }) {
  const ui = useUI();
  if (shown === 0) return null;
  const hasMore = shown < total;
  return (
    <div className="flex flex-col items-center gap-2" data-testid="portal-pagination">
      {/* Desktop shows nothing once everything is loaded, as the Figma's table ends on its totals. */}
      <p className={cn('text-sm text-muted-foreground md:text-xs', hasMore ? '' : 'md:hidden')}>
        {hasMore
          ? ui('portalShowingDocuments', { shown, total })
          : ui('portalAllLoaded')}
      </p>
      {hasMore ? (
        <Button variant="outline" onClick={onLoadMore} disabled={loadingMore} data-testid="portal-load-more">
          {ui('portalLoadMore')}
        </Button>
      ) : null}
    </div>
  );
}

/** The list's error, or its empty state once loaded; nothing otherwise. */
function ListState({ failed, empty }) {
  const ui = useUI();
  if (failed) {
    return (
      <p className="text-sm text-destructive" role="alert" data-testid="portal-list-error">
        {ui('portalLoadErrorDescription')}
      </p>
    );
  }
  if (!empty) return null;
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" data-testid="portal-list-empty">
      <p className="font-medium">{ui('portalListEmpty')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{ui('portalListEmptyHint')}</p>
    </div>
  );
}

/**
 * One document kind's list (design Listado / Movil-Listado).
 *
 * The header carries the title with the count chip, the breadcrumb and the search (by number or
 * reference) as a centred pill. The toolbar: the kind's status groups as segmented tabs (the
 * customer-facing groups of `PORTAL_KIND_GROUPS`, the tab in the URL), the date button (the
 * rolling last month by default, D-2; all time when the link named a group) and refresh. Columns follow the design,
 * adapted per kind: quotations show "Válido hasta" with its dot, invoices their due date,
 * payment state and outstanding; shipments carry no amounts. A totals row closes the table and
 * "Todos los registros cargados" the list. Checkboxes and "Descargar seleccionados" are out (PO
 * answer: bulk download is a performance risk; a document downloads from its detail), and so are
 * the advanced "Filtros". The status is filtered by the tabs alone; the other quick filters —
 * document type (CP-16) and date range — are the app list toolbar's own controls
 * (`PortalListFilters.jsx`, ETP-6209), in the funnel's panel on mobile. A `search` from the URL
 * (`q`) opens the list on that search, all time.
 *
 * **Every figure refers to the set shown** (QA 24/11 f): the header's count chip, "Mostrando X de
 * Y" and the totals row all come from the current query (kind, tab, type, range, search). The
 * rail's chips are a different figure on purpose — what needs attention (quotations to answer,
 * overdue invoices) — and say so in their tooltip.
 */
export default function PortalDocumentListView({
  apiFetch, token, kind, group = null, search: initialSearch = null, identity = null, logoUrl = null,
  onNavigate, onInvalid,
}) {
  const ui = useUI();
  // The range of the period tabs (Todos, Pagado, Aceptado…): the rolling last month by default —
  // all time when the list opens on a search ("Ver todos en …" of Inicio's search, ETP-6209),
  // whose hits are not limited to a period, so the list shows what the search found.
  const [range, setRange] = useState(() => initialRange(initialSearch));
  // A range the customer picked while on a state tab, for that tab only (QA pass 3).
  const [stateRange, setStateRange] = useState({ group: null, range: null });
  // CP-16: the document type inside the kind (invoice / credit note), from the type selector.
  const [subtype, setSubtype] = useState(null);
  const [searchInput, setSearchInput] = useState(initialSearch ?? '');
  const [search, setSearch] = useState(initialSearch ?? '');
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reload, setReload] = useState(0);
  // Mobile card options (redesign 2026-11-25): PDF download and accept / reject.
  const cardActions = usePortalCardActions({
    apiFetch, token, tenantName: identity?.tenantName, onInvalid,
  });

  // A new kind starts from the defaults: the rolling last month on the period tabs. Reset DURING
  // render (React's "adjust state when a prop changes"), not in an effect: an effect ran after the
  // first commit — on mount too — and its fresh `defaultPortalRange()` object changed the query, so
  // every list was requested twice (QA pass 3: each GET /documents went out twice). Now the first
  // commit already holds the final state, and a mount or a kind change sends one request.
  // The same for a new search from the URL (`q`, ETP-6209): "Ver todos en …" of Inicio's search
  // opens the list on that search even when this kind's list is already mounted. A `q` that goes
  // away (a document opened over the list, then closed) changes nothing: the customer's own search
  // and filters stay as they were.
  const [shown, setShown] = useState({ kind, search: initialSearch });
  const change = listPropsChange(shown, kind, initialSearch);
  if (change.changed) {
    setShown({ kind, search: initialSearch });
    if (change.reset) {
      setRange(initialRange(initialSearch));
      setStateRange({ group: null, range: null });
      setSubtype(null);
      setSearchInput(initialSearch ?? '');
      setSearch(initialSearch ?? '');
    }
  }

  // CP-18b + QA pass 3: a "state" tab (Vencido, Pendiente, Bajo evaluación, En proceso) lists
  // everything in that state, so it shows all time (the date button shows the all-time label), as an
  // Inicio tile does — unless the customer picks a range on that very tab. It is DERIVED, not set
  // by an effect: entering the tab sends one request, and going back to a period tab restores the
  // range the customer had there.
  const allTimeTab = isAllTimeGroup(group);
  const { effectiveRange, dateActive } = listDateState({ group, range, stateRange });
  const changeRange = useCallback((next) => {
    if (allTimeTab) setStateRange({ group, range: next });
    else setRange(next);
  }, [allTimeTab, group]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = useMemo(() => {
    const { from, to } = getDateBounds(effectiveRange);
    return {
      kind,
      group,
      subtype: isPortalSubtype(kind, subtype) ? subtype : null,
      dateFrom: toCalendarParam(from),
      dateTo: toCalendarParam(to),
      search,
    };
  }, [kind, group, subtype, effectiveRange, search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    fetchPortalDocuments(apiFetch, token, query).then((result) => {
      if (!active) return;
      setPage(result);
      setLoading(false);
    }).catch((error) => {
      if (!active) return;
      if (error?.code === PORTAL_ERROR.invalidLink) {
        onInvalid();
        return;
      }
      setFailed(true);
      setLoading(false);
    });
    return () => { active = false; };
  }, [apiFetch, token, query, reload, onInvalid]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const next = await fetchPortalDocuments(apiFetch, token, {
        ...query, offset: page?.documents?.length ?? 0,
      });
      setPage((current) => (current
        ? { ...next, documents: [...current.documents, ...next.documents] } : next));
    } catch (error) {
      if (error?.code === PORTAL_ERROR.invalidLink) onInvalid();
      else setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [apiFetch, token, query, page?.documents?.length, onInvalid]);

  const documents = page?.documents ?? [];
  const totalCount = page?.totalCount ?? 0;
  const plural = ui(PORTAL_KIND_META[kind].pluralKey);
  // The document keeps this list's tab, so closing it returns here as it was.
  const open = (document) => onNavigate({
    view: 'doc', kind: document.kind || kind, id: document.id, ...(group ? { group } : {}),
  }, 'list');
  const selectGroup = (code) => onNavigate(code ? { view: 'list', kind, group: code } : { view: 'list', kind });

  const tabs = [{ code: null, labelKey: 'portalStatusAll' }, ...(PORTAL_KIND_GROUPS[kind] ?? [])];
  const searchPill = (mobile) => (
    <PortalSearchPill
      value={searchInput}
      onChange={setSearchInput}
      placeholder={ui('portalSearchPlaceholder')}
      testId={mobile ? 'portal-search-mobile' : 'portal-search'}
      className={mobile ? 'flex-1' : undefined}
      data-testid="PortalSearchPill__c7f7d2" />
  );

  return (
    <>
      {/* Mobile header (redesign 2026-11-25): the title with its count, the search with the funnel
          (the quick filters, CP-37), then the status tabs. The company logo leads it (CP-46) and
          Etendo's compact link stays on the right (marketing has not decided the mobile one). */}
      <header className="flex shrink-0 flex-col gap-4 border-b border-[#E3E7EC] bg-white px-4 pb-5 pt-4 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <PortalLogoTile identity={identity} logoUrl={logoUrl} size="lg" data-testid="PortalLogoTile__c7f7d2" />
            <h1 className="truncate text-2xl font-medium leading-9 text-[#1B1A1F] [font-family:'Plus_Jakarta_Sans','Inter',sans-serif]">{plural}</h1>
            <span className="shrink-0 rounded-lg bg-[#F3F5F9] px-2 py-0.5 text-xs leading-4 text-[#40465C] tabular-nums" data-testid="portal-count-chip">
              {totalCount}
            </span>
          </div>
          <PortalCreatedWithTile data-testid="PortalCreatedWithTile__c7f7d2" />
        </div>
        <div className="flex items-center gap-2">
          {searchPill(true)}
          <PortalMobileFilters
            kind={kind}
            subtype={subtype}
            onSubtype={setSubtype}
            range={effectiveRange}
            onRange={changeRange}
            data-testid="PortalMobileFilters__c7f7d2" />
        </div>
        <PortalStatusTabs tabs={tabs} group={group} onSelect={selectGroup} mobile data-testid="PortalStatusTabs__c7f7d2" />
      </header>

      <PortalDesktopHeader
        title={plural}
        // The set shown (QA 24/11 f): the same figure as "Mostrando X de Y" and the mobile chip.
        // It was the kind's all-time total (the home tile), which disagreed with both.
        count={totalCount}
        breadcrumb={<>{ui('portalNavMyDocuments')} / <span className="text-[#1B1A1F]">{plural}</span></>}
        search={searchPill(false)}
        size="lg"
        data-testid="PortalDesktopHeader__c7f7d2" />

      <PortalMain
        className="overflow-y-auto bg-[#F3F5F9] px-4 pb-28 pt-4 md:gap-0 md:rounded-xl md:bg-card md:p-0"
        testId="portal-document-list"
        data-testid="PortalMain__c7f7d2">
        <DesktopToolbar
          kind={kind}
          tabs={tabs}
          group={group}
          onGroup={selectGroup}
          range={effectiveRange}
          onRange={changeRange}
          subtype={subtype}
          onSubtype={setSubtype}
          dateActive={dateActive}
          onRefresh={() => setReload((value) => value + 1)}
          data-testid="DesktopToolbar__c7f7d2" />

        <div className="md:px-3">
          <ListState failed={failed} empty={!loading && documents.length === 0} data-testid="ListState__c7f7d2" />
        </div>

        {documents.length > 0 ? (
          <>
            <DesktopTable
              kind={kind}
              documents={documents}
              totals={page?.totals}
              convertedTotal={page?.convertedTotal}
              onOpen={open}
              data-testid="DesktopTable__c7f7d2" />
            <ul className="flex flex-col gap-4 md:hidden" data-testid="portal-document-cards">
              {documents.map((document) => (
                <li key={document.id}>
                  <PortalMobileCard
                    document={document}
                    kind={kind}
                    onOpen={open}
                    onDownload={cardActions.download}
                    onDecide={cardActions.decide}
                    data-testid="PortalMobileCard__c7f7d2" />
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="md:py-3">
          <ListFooter
            shown={documents.length}
            total={totalCount}
            onLoadMore={loadMore}
            loadingMore={loadingMore}
            data-testid="ListFooter__c7f7d2" />
        </div>
      </PortalMain>
      {cardActions.popups}
    </>
  );
}
