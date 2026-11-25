import { formatCalendarDate } from '@/lib/dateOnly';
import { formatStockQuantity } from './stockQuantityFormat';
import { dateFromDay, dayNumber, dayFraction, valueAtDay } from './stockSeries';

// Pure helpers for the product side-panel / modal stock chart (ETP-5908 RF-10..RF-12).

const toIntlLocale = (appLocale) => (appLocale || 'es_ES').replace('_', '-');

/**
 * Abbreviated month name (0-based index) in the app language: first letter uppercase, no trailing
 * dot (es: Ene, Abr, Ago; en: Jan, Apr, Aug). Same pattern as date-range-popover.jsx.
 */
export function shortMonthName(monthIndex, appLocale) {
  const raw = formatCalendarDate(new Date(2024, monthIndex, 1), toIntlLocale(appLocale), { month: 'short' })
    .replace(/\.$/, '')
    // ICU gives "sept" for es: cap at 3 letters so every month is Ene..Dic / Jan..Dec as in the design.
    .slice(0, 3);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// SVG cannot measure text, so widths are estimated from the font size: a digit is about 0.6 em wide and a
// separator (thousands dot / comma) about 0.3 em, which matches what the browser draws at 10 px ("2.500" is 27 px).
const DIGIT_EM = 0.6;
const SEPARATOR_EM = 0.3;

/** Estimated rendered width, in px, of a short axis label at `fontSize`. */
export function estimateTextWidth(text, fontSize) {
  let em = 0;
  for (const ch of String(text ?? '')) em += /\d/.test(ch) ? DIGIT_EM : /[.,\s']/.test(ch) ? SEPARATOR_EM : DIGIT_EM + 0.05;
  return em * fontSize;
}

// Space between a y label's right edge and the plot (the label sits at plotLeft - Y_LABEL_GAP), plus 1 px of slack
// for the estimate, so the left of the widest label never goes under the svg's left edge.
const Y_LABEL_GAP = 5;
const Y_LABEL_SLACK = 1;

/**
 * Left padding of the plot: `minPad` (the design's 28 px column) or, when a y label is wider, whatever the widest
 * label needs to be fully inside the svg. Never shrinks below `minPad`.
 */
export function yAxisPadding(labels, fontSize, minPad) {
  const widest = Math.max(0, ...labels.map((l) => estimateTextWidth(l, fontSize)));
  return Math.max(minPad, Math.ceil(widest) + Y_LABEL_GAP + Y_LABEL_SLACK);
}

const AXIS_MAX_STEPS = 6;
// Minimum clear space, in px, between two consecutive x labels (text extents estimated, not measured).
const X_LABEL_MIN_GAP_PX = 4;
// A label closer than this share of the window to the previous kept one would overlap it.
const MIN_LABEL_GAP = 0.08;
// A label this close to the right edge is anchored inward so it is never cut.
const END_ZONE = 0.04;

/** "28 Oct 2026": full date title of the tooltip (system-language short month, capitalised, no dot). */
export function formatFullDate(day, appLocale) {
  const d = dateFromDay(day);
  return `${d.getDate()} ${shortMonthName(d.getMonth(), appLocale)} ${d.getFullYear()}`;
}

// 1st of every month of the window (the first label sits at the window start itself).
function monthStarts(range) {
  const start = dateFromDay(range.startDay);
  const end = dateFromDay(range.endDay);
  const months = [{ day: range.startDay, year: start.getFullYear(), monthIndex: start.getMonth() }];
  for (let d = new Date(start.getFullYear(), start.getMonth() + 1, 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push({ day: dayNumber(d), year: d.getFullYear(), monthIndex: d.getMonth() });
  }
  return months;
}

function labelAnchor(isFirst, day, range) {
  if (isFirst) return 'start';
  return dayFraction(day, range) > 1 - END_ZONE ? 'end' : 'middle';
}

/**
 * X-axis labels on the date scale (`range` = { startDay, endDay }). One label per month up to 6 months,
 * every 2 months for 12 or 13 (ceil((n - 1) / 6) in general); each sits at the 1st of its month and
 * the first one at the window start. `year` is set only on the first label and wherever the year
 * changes. When the second label would overlap the first (window starting late in a month) the first
 * is dropped. First / last-edge labels are anchored inward; the rest are centred.
 * @returns {{day:number, text:string, year:string|null, anchor:'start'|'middle'|'end'}[]}
 */
export function buildXAxisLabels(range, appLocale, { plotWidth = null, fontSize = 10 } = {}) {
  const months = monthStarts(range);
  const step = Math.max(1, Math.ceil((months.length - 1) / AXIS_MAX_STEPS));
  let picked = months.filter((_, i) => i % step === 0);
  if (picked.length > 1 && dayFraction(picked[1].day, range) < MIN_LABEL_GAP) picked = picked.slice(1);
  const labels = picked.map((m, i) => ({
    day: m.day,
    text: shortMonthName(m.monthIndex, appLocale),
    year: String(m.year),
    partialStart: i === 0 && m.day === range.startDay && dateFromDay(m.day).getDate() !== 1,
    anchor: labelAnchor(i === 0, m.day, range),
  }));
  const visible = plotWidth ? dropCollidingLabels(labels, range, plotWidth, fontSize) : labels;
  let lastYear = null;
  return visible.map((l) => {
    const label = { day: l.day, text: l.text, year: l.year === lastYear ? null : l.year, anchor: l.anchor };
    lastYear = l.year;
    return label;
  });
}

// Horizontal extent [left, right] of a label given where its anchor puts it.
function labelExtent(l, range, plotWidth, fontSize, showsYear) {
  const x = dayFraction(l.day, range) * plotWidth;
  const width = Math.max(estimateTextWidth(l.text, fontSize), showsYear ? estimateTextWidth(l.year, fontSize) : 0);
  if (l.anchor === 'start') return [x, x + width];
  if (l.anchor === 'end') return [x - width, x];
  return [x - width / 2, x + width / 2];
}

/**
 * Keeps at least X_LABEL_MIN_GAP_PX between consecutive labels (a label that shows its year counts as wide as the
 * wider of the month and the year). On a collision the first label goes when it is the partial start-of-range month (not a month
 * boundary), otherwise the later one is skipped. A label left first after a drop is anchored `start` when it sits
 * within 14 px of the plot's left edge (the design's rule), else centred.
 */
function dropCollidingLabels(labels, range, plotWidth, fontSize) {
  const kept = [];
  for (const l of labels) {
    const prev = kept[kept.length - 1];
    if (prev) {
      // The year line only counts for a label that shows it: the first visible one and the one after a year change.
      const [, prevRight] = labelExtent(prev, range, plotWidth, fontSize, kept.length === 1 || prev.year !== kept[kept.length - 2].year);
      const [left] = labelExtent(l, range, plotWidth, fontSize, l.year !== prev.year);
      if (left - prevRight < X_LABEL_MIN_GAP_PX) {
        if (kept.length === 1 && prev.partialStart) {
          kept.pop();
        } else {
          continue;
        }
      }
    }
    kept.push(l);
  }
  const [first] = kept;
  if (first && first.anchor !== 'start') {
    const x = dayFraction(first.day, range) * plotWidth;
    if (x < 14) first.anchor = 'start';
  }
  return kept;
}

/**
 * Tooltip content for the hovered day: full-date title, one row per visible series (balance on that
 * day) sorted from largest to smallest, and a Total row only when more than one series is visible.
 */
export function buildTooltipModel({ series, day, locale, totalLabel, unitLabel }) {
  const withUnit = (v) => `${formatStockQuantity(v)} ${unitLabel}`;
  const rows = series
    .map(s => ({ name: s.name ?? totalLabel, color: s.color, value: valueAtDay(s.points, day) }))
    .sort((a, b) => b.value - a.value)
    .map(r => ({ name: r.name, color: r.color, valueText: withUnit(r.value) }));
  const sum = series.reduce((acc, s) => acc + valueAtDay(s.points, day), 0);
  return {
    title: formatFullDate(day, locale),
    rows,
    total: series.length > 1 ? { label: totalLabel, valueText: withUnit(sum) } : null,
  };
}
