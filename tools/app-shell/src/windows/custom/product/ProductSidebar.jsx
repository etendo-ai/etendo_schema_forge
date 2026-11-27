import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowsOutIcon, CubeIcon, CalendarBlankIcon, CaretDownIcon, CheckIcon } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUI, useLocaleSwitch } from '@/i18n';
import { SIDEBAR_PERIOD_OPTIONS, DEFAULT_SIDEBAR_PERIOD, formatPeriodRange } from './productSidebarPeriod';
import { niceScale } from '@/lib/dashboardNumberFormat';
import { formatStockQuantity, formatStockQuantityWithUnit, stockUnitSymbol } from './stockQuantityFormat';
import { buildXAxisLabels, buildTooltipModel, yAxisPadding } from './stockChartAxis';
import { buildChartModel, dayFraction, fractionToDay, valueAtDay } from './stockSeries';
import { useStockHistory } from './useStockHistory';
import StockChartTooltip from './StockChartTooltip';
import StockChartLegend from './StockChartLegend';
import StockWarehouseList from './StockWarehouseList';
import { resolveVisible, isolate, activeHighlight, dimmedOpacity, filterVisibleSeries, useSeriesVisibility } from './stockSeriesVisibility';
import { useApiFetch } from '@/auth/useApiFetch.js';
import ProductSidebarCollapsed from './ProductSidebarCollapsed';
import ViewMovementsLink from './ViewMovementsLink';
import ProductSidebarFrame from './ProductSidebarFrame';
import { SIDEBAR_PANEL_ID } from './ProductSidebarDividerToggle';
import { useSidebarCollapsed } from './useSidebarCollapsed';
import { chartSeriesColor, CHART_AREA_OPACITY_VAR } from '@/lib/chartPalette';

// Series fill colour (legend dots, swatches, warehouse card indicator) of the i-th warehouse.
const seriesFill = (i) => chartSeriesColor(i).fill;

// Exact range (DD/MM/AAAA – DD/MM/AAAA) covered by the selected period (ETP-5908 RF-05).
function PeriodRangeLabel({ period, className = '' }) {
  return (
    <span
      className={`text-xs font-normal text-muted-foreground ${className}`}
      data-testid="SidebarPeriodRange"
    >
      {formatPeriodRange(period)}
    </span>
  );
}

// Layout of the period selector (ETP-5908 PS-72.2 / PS-72.3). QA expects the button to hug its content, not to
// fill the 271 px of the panel; the exact Figma width may still change, so it lives in this one class (`self-start`
// = content width; swap for e.g. `w-[160px]` to pin it). The gap is the one between the selector and the date range.
// Title of the panel chart ("Movimiento de stock"): main text colour, weight 500 (the design's .ch-h is 14px/500).
const PANEL_CHART_TITLE_CLASS = 'text-sm font-medium text-foreground';
const PERIOD_SELECTOR_WIDTH_CLASS = 'self-start';
const PERIOD_SELECTOR_RANGE_GAP_CLASS = 'gap-2';
// Active period option (ETP-5908 PS-03 / RF-04), in the dropdown and in the modal: text is the brand blue
// (#325CFF, what the `primary` token maps to), background `--info-label-bg` (#EBEFFF, the "N ubicaciones" label;
// the token also has a dark-theme value) and a check icon on the right.
const ACTIVE_PERIOD_OPTION_CLASS = 'bg-[var(--info-label-bg)] text-primary';

function SidebarPeriodSelector({ period, onChangePeriod, ui, disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const current = SIDEBAR_PERIOD_OPTIONS.find(o => o.value === period) ?? SIDEBAR_PERIOD_OPTIONS[0];

  return (
    <div ref={ref} className={`flex flex-col ${PERIOD_SELECTOR_RANGE_GAP_CLASS}`}>
      <div className={`relative ${PERIOD_SELECTOR_WIDTH_CLASS}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`h-10 flex items-center gap-1 px-3 border border-border-control rounded-lg shadow-[0px_1px_2px_hsl(var(--foreground) / 0.05)] text-sm font-medium transition-colors
          ${disabled ? 'bg-muted text-disabled cursor-not-allowed' : 'bg-card text-foreground'}`}
      >
        <CalendarBlankIcon
          className={`h-5 w-5 shrink-0 ${disabled ? 'text-disabled' : 'text-muted-foreground'}`}
          data-testid="Calendar__59b33d" />
        <span className="flex-1 text-left mx-1">{ui(current.key)}</span>
        <CaretDownIcon
          className={`h-5 w-5 shrink-0 ${disabled ? 'text-disabled' : 'text-muted-foreground'}`}
          data-testid="ChevronDown__59b33d" />
      </button>
      {open && (
        // committed-selection-ok: three fixed options, all visible; the committed one is marked with aria-selected and a check.
        <div role="listbox" aria-label={ui(current.key)} className="absolute top-11 left-0 z-50 min-w-full bg-card border border-border-control rounded-lg shadow-md overflow-hidden">
          {SIDEBAR_PERIOD_OPTIONS.map(opt => {
            const active = period === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChangePeriod(opt.value); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm whitespace-nowrap ${active ? `font-medium ${ACTIVE_PERIOD_OPTION_CLASS}` : 'font-normal text-foreground hover:bg-muted'}`}
                data-testid="SidebarPeriodOption"
              >
                {ui(opt.key)}
                {active ? <CheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" data-testid="SidebarPeriodOptionCheck" /> : null}
              </button>
            );
          })}
        </div>
      )}
      </div>
      <PeriodRangeLabel period={period} data-testid="PeriodRangeLabel__59b33d" />
    </div>
  );
}

// The big number of the widget: a placeholder bar while loading, a labelled dash when the stock read failed,
// a plain dash when there is no value.
function AvailabilityValue({ value, loading, unavailable, ui }) {
  if (loading) {
    return <Skeleton className="my-2 h-5 w-16" aria-hidden="true" data-testid="AvailabilityValueSkeleton" />;
  }
  if (unavailable) {
    return <span className="text-muted-foreground" role="img" aria-label={ui('stockUnavailable')} title={ui('stockUnavailable')} data-testid="AvailabilityUnavailable">—</span>;
  }
  if (value === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return value;
}

const CARD_BASE = 'flex-1 w-full flex items-center gap-2.5 pl-3 pr-2 py-2 bg-card border border-border-subtle rounded-lg shadow-[0px_1px_2px_hsl(var(--foreground) / 0.05)] text-left';
const CARD_CLICKABLE = 'cursor-pointer transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';
// "N locations" / warehouse name: a plain, non-interactive label (info tokens), never a link.
const PILL_CLASS = 'px-1.5 py-0.5 rounded-full bg-[var(--info-label-bg)] text-[var(--info-label-fg)] text-xs font-medium whitespace-nowrap';
// A count is never cut ("3 ubicaciones" drops under the label when the row is too narrow); a long warehouse NAME still ellipsizes.
const COUNT_PILL_CLASS = `${PILL_CLASS} shrink-0`;
const NAME_PILL_CLASS = `${PILL_CLASS} truncate min-w-0 max-w-full`;

// Horizontal availability widget: icon box + label + locations pill + big number.
// With `onClick` the WHOLE card is a real button (opens the Warehouses tab); without it (loading / unavailable) it is plain.
function AvailabilityWidget({ label, value, badge, badgeIsName = false, onClick, loading = false, unavailable = false }) {
  const ui = useUI();
  const Root = onClick ? 'button' : 'div';
  const rootProps = onClick
    ? { type: 'button', onClick, className: `${CARD_BASE} ${CARD_CLICKABLE}` }
    : { className: CARD_BASE };
  return (
    <Root {...rootProps} data-testid={onClick ? 'AvailabilityCardButton' : 'AvailabilityCard'}>
      <div className="w-10 h-10 shrink-0 flex items-center justify-center bg-card border border-border-control rounded-lg shadow-[0px_1px_2px_hsl(var(--foreground) / 0.05)]">
        <CubeIcon className="w-6 h-6 text-disabled" data-testid="Box__59b33d" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0" data-testid="AvailabilityLabelRow">
          <span className="text-xs text-muted-foreground shrink-0">{label}</span>
          {badge && (
            <span className={badgeIsName ? NAME_PILL_CLASS : COUNT_PILL_CLASS} title={badgeIsName ? badge : undefined} data-testid="AvailabilityWarehousePill">{badge}</span>
          )}
        </div>
        <span className="text-2xl font-medium tracking-[-0.01em] text-foreground leading-9">
          <AvailabilityValue value={value} loading={loading} unavailable={unavailable} ui={ui} data-testid="AvailabilityValue__59b33d" />
        </span>
      </div>
    </Root>
  );
}

function smoothPath(xs, ys) {
  if (xs.length < 2) return xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' ');
  const d = [`M${xs[0]},${ys[0]}`];
  for (let i = 1; i < xs.length; i++) {
    const cpX = (xs[i - 1] + xs[i]) / 2;
    d.push(`C${cpX},${ys[i - 1]} ${cpX},${ys[i]} ${xs[i]},${ys[i]}`);
  }
  return d.join(' ');
}

function ChartSVG({ unitSymbol = null, range, series, W, H, PAD_X, PAD_Y, fontSize = 10, PAD_R = PAD_X, highlight = null, onClick, className = 'cursor-crosshair', preserveAspectRatio = 'xMidYMid meet' }) {
  const [hoveredDay, setHoveredDay] = useState(null);
  const ui = useUI();
  const { locale } = useLocaleSwitch();

  // A single unnamed series is the aggregated line; named ones are per-warehouse. Both take their palette colours from the model.
  const multi = series.length > 0 && series[0].name != null;

  // Global Y scale spanning every series. Baseline is always 0 (stock can't be negative);
  // niceScale gives a rounded max + ticks, same as the dashboard / sibling charts.
  const allVals = series.flatMap(s => s.points.map(p => p.value));
  const maxVal = Math.max(...allVals, 0);
  const { niceMax, ticks: yTicks } = niceScale(maxVal);

  const yLabels = yTicks.map(t => ({ v: t, label: formatStockQuantity(t) }));
  // PAD_X is the minimum left column; it grows when a y label (e.g. "2.500") needs more so none is clipped.
  const padX = yAxisPadding(yLabels.map(yl => yl.label), fontSize, PAD_X);
  const plotW = W - padX - PAD_R;
  const toY = v => PAD_Y + (H - PAD_Y * 2) * (1 - Math.max(v, 0) / niceMax);
  // Points sit on a date scale: window start .. today, proportional to their day.
  const toX = day => padX + dayFraction(day, range) * plotW;

  const paths = series.map((s, idx) => {
    const xs = s.points.map(p => toX(p.day));
    const ys = s.points.map(p => toY(p.value));
    const linePath = smoothPath(xs, ys);
    const areaPath = `${linePath} L${xs[xs.length - 1]},${H} L${xs[0]},${H} Z`;
    return { fill: s.fill, line: s.line, idx, linePath, areaPath, opacity: dimmedOpacity(s.name, highlight), emphasis: highlight != null && s.name === highlight };
  });

  const xLabels = buildXAxisLabels(range, locale, { plotWidth: plotW, fontSize });
  const ANCHOR = { start: 'start', middle: 'middle', end: 'end' };

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const viewX = ((e.clientX - rect.left) / rect.width) * W;
    setHoveredDay(fractionToDay((viewX - padX) / plotW, range));
  };

  const hx = hoveredDay !== null ? toX(hoveredDay) : null;
  const tooltipModel = hoveredDay !== null
    ? buildTooltipModel({ series, day: hoveredDay, locale, totalLabel: ui('total'), unitLabel: unitSymbol })
    : null;

  return (
    <svg viewBox={`0 0 ${W} ${H + 20 + fontSize + 2}`} preserveAspectRatio={preserveAspectRatio} className={`w-full h-full ${className}`}
      onClick={onClick}
      onMouseMove={handleMouseMove} onMouseLeave={() => setHoveredDay(null)}>
      {yLabels.map((yl) => (
        <line key={yl.v} x1={padX} y1={toY(yl.v)} x2={W - PAD_R} y2={toY(yl.v)} stroke="hsl(var(--border-subtle))" strokeWidth="1" strokeDasharray="4,3" />
      ))}
      {yLabels.map((yl) => (
        <text key={yl.label} x={padX - 5} y={toY(yl.v) + 4} textAnchor="end" fontSize={fontSize} fill="hsl(var(--text-disabled))">{yl.label}</text>
      ))}
      {paths.map((p) => (
        <path key={`area-${p.idx}`} d={p.areaPath} fill={p.fill} style={{ fillOpacity: CHART_AREA_OPACITY_VAR }} opacity={p.opacity} data-testid="StockChartArea" />
      ))}
      {paths.map((p) => (
        <path key={`line-${p.idx}`} d={p.linePath} fill="none" stroke={p.line} strokeWidth={p.emphasis ? 3 : 2} opacity={p.opacity}
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
      {hoveredDay !== null && (
        <>
          <line x1={hx} y1={PAD_Y} x2={hx} y2={H} stroke="hsl(var(--text-disabled))" strokeWidth="1" strokeDasharray="3,2" />
          {series.map((s) => (
            <circle key={s.name ?? 'single'} cx={hx} cy={toY(valueAtDay(s.points, hoveredDay))} r={multi ? 4 : 5} fill="white" stroke={s.line} strokeWidth="2" />
          ))}
          <StockChartTooltip model={tooltipModel} hx={hx} W={W} PAD_X={padX} PAD_R={PAD_R} PAD_Y={PAD_Y} fontSize={fontSize} data-testid="StockChartTooltip__59b33d" />
        </>
      )}
      {xLabels.map((l) => (
        <g key={l.day} data-testid="StockChartXLabel">
          <text x={toX(l.day)} y={H + 14} textAnchor={ANCHOR[l.anchor]} fontSize={fontSize} fontWeight="400" fill="hsl(var(--text-disabled))">{l.text}</text>
          {l.year && (
            <text x={toX(l.day)} y={H + 14 + fontSize + 2} textAnchor={ANCHOR[l.anchor]} fontSize={fontSize} fontWeight="400" fill="hsl(var(--muted-foreground))">{l.year}</text>
          )}
        </g>
      ))}
    </svg>
  );
}


function StockEmptyState({ onAdjustStock, onReplenish }) {
  const ui = useUI();
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-6">
      <div className="flex flex-col items-center gap-1">
        <span className="text-xl font-semibold text-foreground text-center">{ui('noStockMovements')}</span>
        <span className="text-xs font-normal text-foreground text-center">{ui('noStockMovementsDesc')}</span>
      </div>
      <div className="flex flex-row items-center gap-3">
        <button
          type="button"
          onClick={onAdjustStock}
          className="flex items-center justify-center px-2 py-1 h-8 bg-card border border-border-control shadow-[0px_1px_2px_hsl(var(--foreground) / 0.05)] rounded-lg text-sm font-medium text-foreground"
        >
          {ui('adjustStock')}
        </button>
        <button
          type="button"
          onClick={onReplenish}
          className="flex items-center justify-center px-2 py-1 h-8 bg-foreground rounded-lg text-sm font-medium text-primary-foreground"
        >
          {ui('replenishStock')}
        </button>
      </div>
    </div>
  );
}

// A failed read of the stock or of the movement history: never drawn as 0 or as an empty product.
function StockUnavailableNote({ message }) {
  return (
    <div className="px-4 py-6 flex items-center justify-center" role="status" data-testid="StockUnavailableNote">
      <span className="text-xs text-muted-foreground text-center">{message}</span>
    </div>
  );
}

function PartialHistoryNote({ partial }) {
  const ui = useUI();
  if (!partial) return null;
  return <span className="text-xs text-muted-foreground" data-testid="StockChartPartialNote">{ui('stockHistoryPartial')}</span>;
}

// Panel chart canvas (design: lienzo drawn at its real width, never stretched): a 28 px column for the y labels,
// a 4 px right margin and 176 px of height including the month / year axis labels (H + 20 + fontSize + 2 = 176).
const PANEL_CHART = { PAD_X: 28, PAD_R: 4, PAD_Y: 10, H: 144, HEIGHT: 176, FALLBACK_W: 268 };

/** Real pixel width of the element behind `ref`, kept current with a ResizeObserver (`fallback` until measured). */
function useMeasuredWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function StockChart({
  transactions, partial = false, currentStock, locationRows = [], locatorToWarehouse = {},
  // Inline chart time window (driven by the sidebar period selector). Modal keeps its own period.
  inlineMonths = 12,
  // Panel period; the modal starts on it each time it opens, then keeps its own state.
  panelPeriod = DEFAULT_SIDEBAR_PERIOD,
  // External control: open modal pre-filtered to a warehouse
  externalOpen, externalWarehouse, onExternalClose,
  // Series visible in the panel (Set of warehouse names) + its toggle handler; owned by ProductSidebar.
  panelVisible, onTogglePanelSeries,
  // Unit symbol of the product's UOM ("kg"), printed after each quantity; null when the backend sent none.
  unitSymbol = null,
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [panelChartRef, panelChartWidth] = useMeasuredWidth(PANEL_CHART.FALLBACK_W);
  const [period, setPeriod] = useState(panelPeriod);
  // Modal visibility: a copy of the panel's set taken on every open; never written back to the panel.
  const [modalVisibleRaw, setModalVisibleRaw] = useState(null);
  const [panelHover, setPanelHover] = useState(null);
  const [modalHover, setModalHover] = useState(null);
  const ui = useUI();

  const isOpen = externalOpen || internalOpen;

  // Every open: inherit the panel period (RF-02) and the panel's visible series (RF-15), or the
  // warehouse requested from outside; changes inside the modal stay local.
  useEffect(() => {
    if (!isOpen) return;
    setPeriod(panelPeriod);
    setModalVisibleRaw(externalOpen && externalWarehouse ? new Set([externalWarehouse]) : new Set(panelVisible));
    setModalHover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleOpenChange = (open) => {
    if (!open) {
      setModalVisibleRaw(null);
      setInternalOpen(false);
      onExternalClose?.();
    }
  };

  const sortedRows = [...locationRows].sort((a, b) => b.quantityOnHand - a.quantityOnHand);
  const modalMonths = SIDEBAR_PERIOD_OPTIONS.find(o => o.value === period)?.months ?? 6;
  const modelOf = (months) => buildChartModel({
    transactions, currentStock, warehouses: sortedRows, locatorToWarehouse, months, today: new Date(),
  });
  // Inline chart (panel period) and modal chart (its own period): both slice the same loaded history.
  const chart = modelOf(inlineMonths);
  const chartLarge = isOpen ? modelOf(modalMonths) : null;

  if (!chart) return null;

  const legendItems = sortedRows.map((b, i) => ({ name: b.binName, color: seriesFill(i) }));
  const large = chartLarge ?? chart;
  const allKeys = sortedRows.map(b => b.binName);
  const panelShown = resolveVisible(panelVisible, allKeys);
  const panelHighlight = activeHighlight(panelHover, panelShown);
  const modalShown = resolveVisible(modalVisibleRaw ?? panelVisible, allKeys);
  const modalHighlight = activeHighlight(modalHover, modalShown);
  const handleModalSelect = (name) => setModalVisibleRaw(isolate(modalShown, name, allKeys));

  return (
    <>
      {/* Mini chart shown in Summary tab */}
      <div className="px-4 pt-2 pb-3 flex flex-col gap-2">
        {/* Title + icon-only expand button */}
        <div className="flex items-center justify-between gap-1.5">
          <span className={`${PANEL_CHART_TITLE_CLASS} flex-1`} data-testid="StockChartPanelTitle">{ui('stockMovement')}</span>
          <button
            type="button"
            onClick={() => setInternalOpen(true)}
            title={ui('expand')}
            aria-label={ui('expand')}
            className="inline-flex items-center justify-center w-6 h-6 rounded-sm text-muted-foreground hover:text-foreground shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            data-testid="StockChartExpandButton"
          >
            <ArrowsOutIcon size={16} aria-hidden="true" data-testid="Maximize2__59b33d" />
          </button>
        </div>
        <StockChartLegend items={legendItems} visible={panelShown} highlight={panelHighlight} onToggle={onTogglePanelSeries} onHover={setPanelHover} data-testid="StockChartLegend__59b33d" />
        <div ref={panelChartRef} style={{ height: PANEL_CHART.HEIGHT }} data-testid="StockChartPanelCanvas">
          <ChartSVG
            unitSymbol={unitSymbol}
            range={chart.range}
            series={filterVisibleSeries(chart.series, panelShown)}
            highlight={panelHighlight}
            W={panelChartWidth}
            H={PANEL_CHART.H}
            PAD_X={PANEL_CHART.PAD_X}
            PAD_R={PANEL_CHART.PAD_R}
            PAD_Y={PANEL_CHART.PAD_Y}
            fontSize={10}
            onClick={() => setInternalOpen(true)}
            className="cursor-pointer"
            data-testid="ChartSVG__59b33d" />
        </div>
        <PartialHistoryNote partial={partial} data-testid="PartialHistoryNote__59b33d" />
      </div>

      {/* Expanded modal */}
      <Dialog
        open={isOpen}
        onOpenChange={handleOpenChange}
        data-testid="Dialog__59b33d">
        <DialogContent className="max-w-4xl w-full" data-testid="DialogContent__59b33d">
          <DialogHeader data-testid="DialogHeader__59b33d">
            <DialogTitle data-testid="DialogTitle__59b33d">
              <div className="flex items-center justify-between gap-4 pr-8">
                <div className="flex flex-col gap-0.5">
                  <span>{ui('stockMovement')}</span>
                  <PeriodRangeLabel period={period} data-testid="PeriodRangeLabel__59b33d" />
                </div>
                <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                  {SIDEBAR_PERIOD_OPTIONS.map(opt => (
                    <button key={opt.value} type="button" onClick={() => setPeriod(opt.value)} aria-pressed={period === opt.value}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-md text-sm font-medium transition-colors ${period === opt.value ? ACTIVE_PERIOD_OPTION_CLASS : 'text-muted-foreground hover:text-foreground'}`}
                      data-testid="ModalPeriodOption">
                      {ui(opt.key)}
                      {period === opt.value ? <CheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" data-testid="ModalPeriodOptionCheck" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </DialogTitle>
          </DialogHeader>
          <StockChartLegend items={legendItems} visible={modalShown} highlight={modalHighlight} onToggle={handleModalSelect} onHover={setModalHover} data-testid="StockChartLegend__59b33d" />
          <PartialHistoryNote partial={partial} data-testid="PartialHistoryNote__59b33d" />
          <div className="flex gap-6 pt-2">
            <div className="flex-1 min-w-0" style={{ height: 300 }}>
              <ChartSVG
            unitSymbol={unitSymbol}
                range={large.range}
                series={filterVisibleSeries(large.series, modalShown)}
                highlight={modalHighlight}
                W={600}
                H={250}
                PAD_X={60}
                PAD_Y={16}
                fontSize={13}
                data-testid="ChartSVG__59b33d" />
            </div>
            {sortedRows.length > 0 && (
              <StockWarehouseList rows={sortedRows} colors={sortedRows.map((_, i) => seriesFill(i))} visible={modalShown} onSelect={handleModalSelect} total={currentStock} unitSymbol={unitSymbol} data-testid="StockWarehouseList__59b33d" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


// One card per warehouse: series-coloured dot + name + "Available" left / "N u" right (ETP-5908 RF-08/RF-09).
// No reserved data: Etendo does not manage reservations.
function WarehouseCards({ rows, ui, unitSymbol }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-[10px]" data-testid="WarehouseCards">
      {rows.map((b, i) => (
        <div key={b.binName} className="flex flex-col gap-2 bg-[var(--surface-subtle)] rounded-lg p-3" data-testid="WarehouseCard">
          <div className="flex items-center gap-1 h-6">
            <span className="w-6 h-6 flex items-center justify-center flex-shrink-0">
              <span
                className="w-2.5 h-2.5 rounded-[3px]"
                style={{ backgroundColor: seriesFill(i) }}
                data-testid="WarehouseCardDot"
              />
            </span>
            <span className="text-xs font-semibold text-muted-foreground truncate" title={b.binName}>{b.binName}</span>
          </div>
          <div className="flex items-center justify-between gap-2 pl-1 text-sm" data-testid="WarehouseCardAvailability">
            <span className="text-muted-foreground">{ui('stockAvailableLabel')}</span>
            <span className="font-semibold text-foreground">{formatStockQuantityWithUnit(b.quantityOnHand, unitSymbol)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const UNKNOWN_LOCATION = 'Unknown';

// Storage bin -> warehouse name, for the bins that carry one.
function buildLocatorToWarehouse(stockRows) {
  return (stockRows ?? []).reduce((map, r) => {
    if (r.storageBin) map[r.storageBin] = r['warehouse$_identifier'] ?? r.warehouse ?? UNKNOWN_LOCATION;
    return map;
  }, {});
}

// Quantity on hand per location, keeping only the locations that hold stock.
function buildLocationRows(stockRows) {
  const binMap = (stockRows ?? []).reduce((acc, r) => {
    const binName = r['warehouse$_identifier'] ?? r.warehouse ?? r['storageBin$_identifier'] ?? r.storageBin ?? UNKNOWN_LOCATION;
    if (!acc[binName]) acc[binName] = { binName, quantityOnHand: 0 };
    acc[binName].quantityOnHand += Number(r.quantityOnHand) || 0;
    return acc;
  }, {});
  return Object.values(binMap).filter(b => b.quantityOnHand > 0);
}

// Subtitle of the "Available" card: the single location's name, or how many locations hold stock.
function resolveOnHandSubtitle(locationRows, ui) {
  if (locationRows.length === 1) return locationRows[0]?.binName ?? null;
  if (locationRows.length > 1) return ui('stockLocationsCount', { count: locationRows.length });
  return null;
}

// What replaces the chart: a failure note, the empty-state call to action, or nothing while the history loads.
function StockFallback({ stockFailed, historyFailed, historyLoaded, ui, navigate }) {
  if (stockFailed || historyFailed) {
    const messageKey = stockFailed ? 'stockUnavailableDesc' : 'stockHistoryUnavailable';
    return <StockUnavailableNote message={ui(messageKey)} data-testid="StockUnavailableNote__59b33d" />;
  }
  if (!historyLoaded) return null;
  return <StockEmptyState
    onAdjustStock={() => navigate('/physical-inventory/new')}
    onReplenish={() => navigate('/purchase-order/new')}
    data-testid="StockEmptyState__59b33d" />;
}

export default function ProductSidebar({ recordId, data, token, apiBaseUrl }) {
  const ui = useUI();
  const apiFetch = useApiFetch(apiBaseUrl);
  // DetailView first mounts this panel with an empty record (`data` = {}) and mounts it again, a fraction of a second later,
  // once the record arrives. Reading on the first mount fired the stock and history requests twice (the first pair
  // aborted by the remount), so the reads wait for the loaded record and happen once per product.
  const recordLoaded = data != null && Object.keys(data).length > 0;
  const { stockRows, transactions, partial, stockFailed, historyFailed } = useStockHistory(recordLoaded ? recordId : null, apiFetch);
  const [activeTab, setActiveTab] = useState('summary');
  // RF-16: collapsed is only different markup; every hook above/below stays mounted, so period, hidden series and history survive.
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  // Focus handoff: a strip tab icon unmounts when it reopens the panel, so focus moves to the matching tab (never on mount).
  // The divider button stays mounted, so it keeps its own focus (focusTestId null).
  const pendingFocus = useRef(null);
  const toggle = (next, focusTestId) => { pendingFocus.current = focusTestId; setCollapsed(next); };
  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target) document.querySelector(`[data-testid="${target}"]`)?.focus();
  }, [collapsed]);
  const [period, setPeriod] = useState(DEFAULT_SIDEBAR_PERIOD);
  const [chartTrigger, setChartTrigger] = useState({ open: false, warehouse: null });

  const onHand = stockRows?.reduce((s, r) => s + (Number(r.quantityOnHand) || 0), 0) ?? null;

  const locatorToWarehouse = buildLocatorToWarehouse(stockRows);
  const locationRows = buildLocationRows(stockRows);

  const unitSymbol = stockUnitSymbol(stockRows);
  const fmt = v => (v === null ? null : formatStockQuantityWithUnit(v, unitSymbol));

  const onHandSubtitle = resolveOnHandSubtitle(locationRows, ui);

  // Without a trusted stock there is no anchor for the series: no chart rather than a flat zero one.
  const hasChart = transactions !== null && transactions.length > 0 && !stockFailed;
  // The stock is still being read: the "Available" value shows a placeholder bar instead of a number.
  // The card shows whenever the stock rows loaded, whatever the history did (a failed history only replaces the chart).
  const stockKnown = stockRows !== null;
  const stockLoading = (stockRows === null && !stockFailed) || transactions === null;
  // The "Available" card: with a chart, while the stock is read, or when something failed (stock, or history over known stock).
  const showAvailability = hasChart || stockLoading || stockFailed || (stockKnown && historyFailed);
  const sortedRows = [...locationRows].sort((a, b) => b.quantityOnHand - a.quantityOnHand);
  const navigate = useNavigate();

  // Panel series visibility, shared by the Summary and Warehouses tabs; resets per product / warehouse set.
  const warehouseKeys = sortedRows.map(b => b.binName);
  const [panelVisible, onTogglePanelSeries] = useSeriesVisibility(`${recordId}|${warehouseKeys.join('\u0001')}`, warehouseKeys);

  const inlineMonths = (SIDEBAR_PERIOD_OPTIONS.find(o => o.value === period) ?? SIDEBAR_PERIOD_OPTIONS[0]).months;

  const stockChartProps = {
    transactions,
    partial,
    currentStock: onHand,
    locationRows,
    locatorToWarehouse,
    inlineMonths,
    panelPeriod: period,
    panelVisible,
    onTogglePanelSeries,
    externalOpen: chartTrigger.open,
    externalWarehouse: chartTrigger.warehouse,
    onExternalClose: () => setChartTrigger({ open: false, warehouse: null }),
    unitSymbol,
  };

  // Service/Expense/Resource products are not stockable — no stock section to
  // show (ETP-4606, extended to Expense/Resource in ETP-5091).
  if (['S', 'E', 'R'].includes(data?.productType)) return null;

  // ONE divider button in both states, owned by the frame (CSS-anchored to the column, see ProductSidebarFrame).
  const frameProps = { collapsed, onToggle: () => toggle(!collapsed, null) };

  if (collapsed) {
    return (
      <ProductSidebarFrame {...frameProps} data-testid="ProductSidebarFrame__59b33d">
        <ProductSidebarCollapsed
          onSelectTab={(tab) => { setActiveTab(tab); toggle(false, `ProductSidebarTab-${tab}`); }}
          data-testid="ProductSidebarCollapsed__59b33d" />
      </ProductSidebarFrame>
    );
  }

  return (
    <ProductSidebarFrame {...frameProps} data-testid="ProductSidebarFrame__59b33d">
      <div id={SIDEBAR_PANEL_ID} className="flex flex-col gap-3" data-product-sidebar-collapsed="false">
        {/* ── Inventory overview ── */}
        <div>

          {/* Segmented tabs (pill) — full width, no title */}
          <div className="px-4 pt-2 flex items-center gap-2">
            <div className="flex-1 min-w-0 flex items-center gap-1 p-1 h-10 rounded-xl" style={{ background: 'hsl(var(--muted))' }}>
              {['summary', 'warehouses'].map(tab => (
                <button
                  key={tab}
                  data-testid={`ProductSidebarTab-${tab}`}
                  onClick={() => setActiveTab(tab)}
                  className="flex-1 h-8 px-3 text-sm rounded-lg transition-all"
                  style={
                    activeTab === tab
                      ? { background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', fontWeight: 500,
                          boxShadow: '0px 1px 3px rgba(18,18,23,0.10), 0px 1px 2px rgba(18,18,23,0.06)' }
                      : { color: 'hsl(var(--foreground))', fontWeight: 400 }
                  }
                >
                  {tab === 'summary' ? ui('summary') : ui('warehouses')}
                </button>
              ))}
            </div>
          </div>

          {/* Summary tab content */}
          {activeTab === 'summary' && (
            <div className="px-4 pt-3 pb-4 flex flex-col gap-3">
              <SidebarPeriodSelector
                period={period}
                onChangePeriod={setPeriod}
                ui={ui}
                disabled={!hasChart}
                data-testid="SidebarPeriodSelector__59b33d" />
              {showAvailability && <AvailabilityWidget
                label={ui('productSidebarStockAvailable')}
                value={stockLoading ? null : fmt(onHand)}
                loading={stockLoading}
                unavailable={stockFailed}
                badge={onHandSubtitle}
                badgeIsName={locationRows.length === 1}
                onClick={stockLoading || stockFailed ? undefined : () => setActiveTab('warehouses')}
                data-testid="AvailabilityWidget__59b33d" />}
            </div>
          )}

          {/* Warehouses tab content */}
          {activeTab === 'warehouses' && (
            <div className="px-4 pt-3 pb-4 flex flex-col gap-3">
              <SidebarPeriodSelector
                period={period}
                onChangePeriod={setPeriod}
                ui={ui}
                disabled={!hasChart}
                data-testid="SidebarPeriodSelector__59b33d" />
              {stockFailed && <StockUnavailableNote message={ui('stockUnavailableDesc')} data-testid="StockUnavailableNote__59b33d" />}
              <WarehouseCards rows={sortedRows} ui={ui} unitSymbol={unitSymbol} data-testid="WarehouseCards__59b33d" />
            </div>
          )}
        </div>
        {/* ── Divider ── */}
        {(hasChart || transactions !== null) && (
          <div className="px-4">
            <div className="border-t border-border-subtle" />
          </div>
        )}
        {/* ── Stock movement or empty state ── */}
        {hasChart
          ? <StockChart {...stockChartProps} data-testid="StockChart__59b33d" />
          : <StockFallback
            stockFailed={stockFailed}
            historyFailed={historyFailed}
            historyLoaded={transactions !== null}
            ui={ui}
            navigate={navigate}
            data-testid="StockFallback__59b33d" />
        }
        {/* ETP-5908: under the chart, in both tabs (once: the hidden chart below is only a modal host) */}
        {hasChart && <ViewMovementsLink period={period} data-testid="ViewMovementsLink__59b33d" />}
        {/* Hidden StockChart for warehouse tab modal trigger */}
        {activeTab === 'warehouses' && hasChart && (
          <div className="hidden">
            <StockChart {...stockChartProps} data-testid="StockChart__59b33d" />
          </div>
        )}
      </div>
    </ProductSidebarFrame>
  );
}
