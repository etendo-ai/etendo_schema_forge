/**
 * ETP-6365 — Currency Conversion: pure helpers (no React, no `@/` imports, so `node --test` can
 * load them). Wall-clock datetimes, rate formatting inputs, the history period bounds, the NEO
 * criteria of the history list and its grouping.
 *
 * ## Datetimes are server-local WALL CLOCK
 *
 * NEO answers `validFromDate` / `validToDate` as `yyyy-MM-ddTHH:mm:ss` with no offset
 * (NeoDateFormat convention, ETP-5100): the wall clock of the Etendo server. They are read and
 * written as TEXT here — never through `new Date(string)`, whose UTC/local reinterpretation
 * would shift the minute (or the day) by the viewer's offset. Ordering two such strings is a
 * plain string comparison: the format is fixed-width and big-endian.
 *
 * What the user SEES and TYPES is the browser's wall clock: {@link createZoneView} converts a
 * server value for display and a typed value back before it is sent, from the server zone id
 * `serverClock` answers (see "Time zones" below).
 *
 * ## Downloaded rates are CALENDAR DAYS
 *
 * The downloader (and the Classic window before ETP-6365, whose ValidFrom/ValidTo were date-only)
 * writes a range as whole days: `26/11 00:00 → 26/11 00:00`. Converting that midnight to the
 * viewer's zone moves it to the previous day (`25/11 21:00` in GMT-3, QA CP-3), so such a range is
 * shown as dates, never converted and never labelled with a zone — see {@link isCalendarDayRow}.
 */
import { parseCalendarDate } from '../../../lib/dateOnly.js';

/** A validity end at or after this year means "no end date" (the open range, `9999-12-31`). */
export const OPEN_END_YEAR = 2999;

/** Upper bound of one history read; the rates are grouped by currency client-side from one read. */
export const HISTORY_MAX_ROWS = 5000;

/** `etgoRateStatus` values (computed by the backend): the rate rules now, or it no longer does. */
export const RATE_STATUS = Object.freeze({ CURRENT: 'CURRENT', HISTORIC: 'HISTORIC' });

/** Period filter ids of the history. */
export const PERIODS = Object.freeze(['last30', 'thisMonth', 'thisYear', 'custom']);
export const DEFAULT_PERIOD = 'last30';

/** Status filter ids of the history (`all` plus every `RATE_STATUS`). */
export const STATUSES = Object.freeze(['all', RATE_STATUS.CURRENT, RATE_STATUS.HISTORIC]);

const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Splits a wall-clock string into its numeric parts, ignoring any trailing fraction or zone.
 *
 * @param {string|null|undefined} raw
 * @returns {{year:number,month:number,day:number,hour:number,minute:number}|null}
 */
export function parseWallClock(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(WALL_CLOCK_RE);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
  };
}

/** `yyyy-MM-ddTHH:mm:00` from parts — the format sent to NEO. */
export function toWallClock({ year, month, day, hour = 0, minute = 0 }) {
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00`;
}

/** `yyyy-MM-dd` part of a wall-clock value (or of a date-only value). */
export function wallClockDate(raw) {
  const p = parseWallClock(raw);
  return p ? `${p.year}-${pad2(p.month)}-${pad2(p.day)}` : '';
}

/** `HH:mm` part of a wall-clock value. */
export function wallClockTime(raw) {
  const p = parseWallClock(raw);
  return p ? `${pad2(p.hour)}:${pad2(p.minute)}` : '';
}

/** `dd/MM/yyyy` of a wall-clock (or date-only) value; '' when unparseable. */
export function formatWallClockDate(raw) {
  const p = parseWallClock(raw);
  return p ? `${pad2(p.day)}/${pad2(p.month)}/${p.year}` : '';
}

/** `dd/MM/yyyy HH:mm` of a wall-clock value; '' when unparseable. */
export function formatWallClock(raw) {
  const p = parseWallClock(raw);
  return p ? `${formatWallClockDate(raw)} ${pad2(p.hour)}:${pad2(p.minute)}` : '';
}

/** Whether a wall-clock value is exactly midnight (`00:00:00`): how a date-only source stores a day. */
export function isMidnight(raw) {
  const m = raw ? String(raw).trim().match(WALL_CLOCK_RE) : null;
  return Boolean(m) && Number(m[4] ?? 0) === 0 && Number(m[5] ?? 0) === 0 && Number(m[6] ?? 0) === 0;
}

/**
 * Whether a rate row is a range of CALENDAR DAYS rather than of instants (QA CP-3): a downloaded
 * row (`sMFCRSynced`), or a row whose start is midnight and whose end is open or midnight too —
 * what a date-only source writes (the downloader; the Classic window, whose dates had no time
 * before ETP-6365). A range entered in this window starts at the minute typed and is closed at
 * `start − 1 minute`, so it is never both. Such a row is shown as dates: no zone conversion, no
 * zone label, the same day for every viewer.
 *
 * @param {{validFromDate?: string, validToDate?: string, sMFCRSynced?: boolean}} row
 */
export function isCalendarDayRow(row) {
  if (!row) return false;
  if (row.sMFCRSynced === true) return true;
  return isMidnight(row.validFromDate) && (isOpenEnded(row.validToDate) || isMidnight(row.validToDate));
}

/**
 * `dd/MM/yyyy` of the calendar day of a wall-clock (or date-only) value, through the canonical
 * date-only parser (`parseCalendarDate`): the day is never shifted by any zone. '' when unparseable.
 */
export function formatCalendarDay(raw) {
  const d = raw ? parseCalendarDate(wallClockDate(raw) || raw) : null;
  return d ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}` : '';
}

/**
 * The browser's current minute as a wall-clock string (seconds dropped), the default of
 * "Válido desde". Built from LOCAL getters, never `toISOString()` (UTC).
 *
 * @param {Date} [reference]
 */
export function nowWallClock(reference = new Date()) {
  return toWallClock({
    year: reference.getFullYear(),
    month: reference.getMonth() + 1,
    day: reference.getDate(),
    hour: reference.getHours(),
    minute: reference.getMinutes(),
  });
}

/**
 * Wall clock `raw` moved forward by `ms` milliseconds (local-time arithmetic on its parts), as
 * `yyyy-MM-ddTHH:mm:00`. Used to age the server clock read when a dialog opened.
 */
export function addMillisToWallClock(raw, ms) {
  const p = parseWallClock(raw);
  if (!p) return null;
  return nowWallClock(new Date(new Date(p.year, p.month - 1, p.day, p.hour, p.minute).getTime() + Math.max(0, ms || 0)));
}

/** True when the wall-clock `value` is later than the wall-clock `now` (same minute = not later). */
export function isAfterWallClock(value, now) {
  const a = parseWallClock(value);
  const b = parseWallClock(now);
  if (!a || !b) return false;
  return toWallClock(a) > toWallClock(b);
}

/** True when the validity end is missing or is the open range (year >= {@link OPEN_END_YEAR}). */
export function isOpenEnded(validTo) {
  const p = parseWallClock(validTo);
  return !p || p.year >= OPEN_END_YEAR;
}

/**
 * The END of a history row's range, as the server's wall clock (`yyyy-MM-ddTHH:mm:ss`):
 *
 * - open range (or none) → `null` (the caller shows «—»);
 * - automatic (downloaded, `sMFCRSynced`) row whose end is stored at `00:00` of a day on or
 *   after its start → that day at `23:59`. The downloader stores each daily range closing at
 *   00:00 of the same day (`17/11 00:00 → 17/11 00:00`), which reads as a zero-length range;
 *   the range really covers the whole (server) day, so it ends at `17/11/2026 23:59`;
 * - anything else → the stored end as is (manual ranges are closed at `start − 1 minute` by
 *   the server, e.g. `18/11/2026 14:29`).
 *
 * @param {{validFromDate?: string, validToDate?: string, sMFCRSynced?: boolean}} row
 * @returns {string|null}
 */
export function validToWallClock(row) {
  if (!row || isOpenEnded(row.validToDate)) return null;
  const to = parseWallClock(row.validToDate);
  if (row.sMFCRSynced === true && to.hour === 0 && to.minute === 0
      && wallClockDate(row.validToDate) >= wallClockDate(row.validFromDate)) {
    return `${wallClockDate(row.validToDate)}T23:59:00`;
  }
  return row.validToDate;
}

/**
 * The "Válido hasta" text of a history row (`dd/MM/yyyy HH:mm`, see {@link validToWallClock}),
 * in the viewer's zone when `zone` (a {@link createZoneView}) is given; the calendar day alone for a
 * range of days ({@link isCalendarDayRow}); `null` for an open range.
 *
 * @param {{validFromDate?: string, validToDate?: string, sMFCRSynced?: boolean}} row
 * @param {{show: (raw: string) => string}} [zone]
 * @returns {string|null}
 */
export function displayValidTo(row, zone) {
  const end = validToWallClock(row);
  if (end == null) return null;
  if (isCalendarDayRow(row)) return formatCalendarDay(end);
  return formatWallClock(zone ? zone.show(end) : end);
}

/**
 * The "Válido desde" text of a history row: `dd/MM/yyyy HH:mm` in the viewer's zone, or the
 * calendar day alone (`dd/MM/yyyy`, unconverted) for a range of days ({@link isCalendarDayRow}).
 *
 * @param {{validFromDate?: string, validToDate?: string, sMFCRSynced?: boolean}} row
 * @param {{show: (raw: string) => string}} [zone]
 */
export function displayValidFrom(row, zone) {
  if (!row?.validFromDate) return '';
  if (isCalendarDayRow(row)) return formatCalendarDay(row.validFromDate);
  return formatWallClock(zone ? zone.show(row.validFromDate) : row.validFromDate);
}

// ── Time zones ───────────────────────────────────────────────────────────────
//
// Storage and the server keep the wall clock of the SERVER's zone (`serverClock.timeZone`, e.g.
// `UTC` in production). The window shows and takes every datetime in the BROWSER's zone: a
// value is converted server → browser to be shown and browser → server before it is sent. The
// conversion goes through `Intl` with both zone ids, so it is DST-correct (never a fixed offset).
// With an unknown or invalid server zone nothing is converted and no zone is labelled (the
// behaviour before the zone was known).

const PARTS_FORMATS = new Map();

function partsFormat(zone) {
  let format = PARTS_FORMATS.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    PARTS_FORMATS.set(zone, format);
  }
  return format;
}

/** Wall-clock parts of the instant `epoch` (ms) in `zone`. */
function wallPartsAt(epoch, zone) {
  const out = {};
  for (const { type, value } of partsFormat(zone).formatToParts(epoch)) {
    if (type !== 'literal') out[type] = Number(value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
}

/** Offset (ms) of `zone` from UTC at the instant `epoch`. */
function offsetAt(epoch, zone) {
  const p = wallPartsAt(epoch, zone);
  const wholeSeconds = epoch - (((epoch % 1000) + 1000) % 1000);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - wholeSeconds;
}

/**
 * The instant (epoch ms) a wall clock of `zone` stands for. Two passes, so a wall clock on the
 * other side of a DST change than its first guess still lands on the right offset.
 */
function wallClockToEpoch(parts, zone) {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const guess = asUtc - offsetAt(asUtc, zone);
  return asUtc - offsetAt(guess, zone);
}

/** Whether `zone` is a time zone id `Intl` knows. */
export function isKnownTimeZone(zone) {
  if (!zone || typeof zone !== 'string') return false;
  try {
    partsFormat(zone);
    return true;
  } catch {
    return false;
  }
}

/** The browser's time zone id (`America/Argentina/Buenos_Aires`), or null. */
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Wall clock `raw` of `fromZone` as the wall clock of `toZone` at the same instant
 * (`yyyy-MM-ddTHH:mm:00`). Returned unchanged when the zones are equal or missing, when it does
 * not parse, or when it is the open end (year ≥ {@link OPEN_END_YEAR}).
 */
export function convertWallClock(raw, fromZone, toZone) {
  const p = parseWallClock(raw);
  if (!p || p.year >= OPEN_END_YEAR || !fromZone || !toZone || fromZone === toZone) return raw;
  try {
    return toWallClock(wallPartsAt(wallClockToEpoch(p, fromZone), toZone));
  } catch {
    return raw;
  }
}

/** Compact name of `zone`'s offset at `epoch`: `GMT-3`, `GMT+5:30`, `GMT` (UTC). The fallback name. */
export function zoneOffsetLabel(zone, epoch = Date.now()) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(epoch)
      .find((p) => p.type === 'timeZoneName');
    return part?.value || zone;
  } catch {
    return zone;
  }
}

/** Longest region name used inside a date field (its suffix); a longer one falls back to the offset. */
export const COMPACT_ZONE_NAME_MAX = 14;

/** `es_ES` → `es-ES`; anything unusable → undefined (the browser's locale). */
function intlLocale(locale) {
  return typeof locale === 'string' && locale ? locale.replace('_', '-') : undefined;
}

/** A readable region name, not an abbreviation or an offset (`CET`, `ART`, `GMT-3` are not). */
function isReadableZoneName(name) {
  return typeof name === 'string' && /\p{Ll}/u.test(name) && !/^(GMT|UTC)[+-]?/.test(name);
}

function intlZoneName(zone, epoch, locale, style) {
  try {
    const part = new Intl.DateTimeFormat(intlLocale(locale), { timeZone: zone, timeZoneName: style })
      .formatToParts(epoch)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * The name of `zone` a person reads (QA CP-2/7/11), in the UI `locale`:
 *
 * - full (default): `Intl` `longGeneric` — *hora estándar de Argentina*, *hora de Europa central*,
 *   *Argentina Standard Time* — for list headers, print columns, subtitles and sentences;
 * - `compact: true`: `Intl` `shortGeneric` — *hora de Córdoba*, *hora de India* — when it is a
 *   readable name of at most {@link COMPACT_ZONE_NAME_MAX} characters, for the suffix inside a date
 *   field, where the long name would squeeze the date.
 *
 * Either falls back to the GMT offset ({@link zoneOffsetLabel}) when `Intl` gives nothing readable
 * (an abbreviation such as `CET` / `ART`, an offset, or no support), e.g. `GMT` for UTC.
 *
 * @param {string} zone IANA zone id
 * @param {{epoch?: number, locale?: string, compact?: boolean}} [options]
 */
export function zoneName(zone, { epoch = Date.now(), locale, compact = false } = {}) {
  const name = intlZoneName(zone, epoch, locale, compact ? 'shortGeneric' : 'longGeneric');
  const fits = !compact || (name ?? '').length <= COMPACT_ZONE_NAME_MAX;
  return isReadableZoneName(name) && fits ? name : zoneOffsetLabel(zone, epoch);
}

/**
 * The zone view of the window: how a server wall clock is shown and how a typed one is sent.
 *
 * - `show(raw)` server → browser wall clock; `send(raw)` browser → server wall clock;
 * - `label` the browser zone's name now (*hora estándar de Argentina*, {@link zoneName}), for
 *   column headers, subtitles and sentences; `compactLabel` its short form (*hora de Córdoba*, or
 *   the offset `GMT-3`), for the suffix inside a date field;
 * - `labelAt(shown)` the name at a shown (browser) wall clock — the same as `label` except when it
 *   falls back to the offset across a DST change — for a datetime inside a sentence.
 *
 * Inactive (identity, no labels) when either zone is unknown, e.g. `serverClock` failed.
 *
 * @param {string|null} serverZone `serverClock.timeZone`
 * @param {string|null} [viewerZone] defaults to the browser's zone
 * @param {Date} [reference] "now", for `label`
 * @param {string} [locale] the UI locale (`es_ES`), for the zone name
 */
export function createZoneView(serverZone, viewerZone = browserTimeZone(), reference = new Date(), locale = undefined) {
  const active = isKnownTimeZone(serverZone) && isKnownTimeZone(viewerZone);
  if (!active) {
    return {
      active: false, show: (raw) => raw, send: (raw) => raw, label: null, compactLabel: null, labelAt: () => null,
    };
  }
  const epoch = reference.getTime();
  const label = zoneName(viewerZone, { epoch, locale });
  return {
    active: true,
    show: (raw) => convertWallClock(raw, serverZone, viewerZone),
    send: (raw) => convertWallClock(raw, viewerZone, serverZone),
    label,
    compactLabel: zoneName(viewerZone, { epoch, locale, compact: true }),
    labelAt: (shown) => {
      const p = parseWallClock(shown);
      return p ? zoneName(viewerZone, { epoch: wallClockToEpoch(p, viewerZone), locale }) : label;
    },
  };
}

/** The zone view that converts nothing (no server zone known). */
export const NO_ZONE = createZoneView(null);

/** `text (GMT-3)` through the i18n key `convRateWithZone`; `text` alone without a zone. */
export function withZone(text, zoneLabel, ui) {
  return text && zoneLabel ? ui('convRateWithZone', { text, zone: zoneLabel }) : text;
}

/**
 * A server wall clock as the viewer reads it inside a sentence: `dd/MM/yyyy HH:mm (GMT-3)`
 * (no zone suffix when the view is inactive); '' when unparseable.
 */
export function formatInZone(raw, zone, ui) {
  const shown = zone.show(raw);
  return withZone(formatWallClock(shown), zone.labelAt(shown), ui);
}

/**
 * The start of a rate inside a sentence (*Desde …*, the delete question, *Tasa vigente … desde …*):
 * {@link formatInZone}, or the calendar day alone for a range of days ({@link isCalendarDayRow}).
 *
 * @param {{validFromDate?: string, validToDate?: string, sMFCRSynced?: boolean}} row
 */
export function formatStartInSentence(row, zone, ui) {
  if (!row?.validFromDate) return '';
  return isCalendarDayRow(row) ? formatCalendarDay(row.validFromDate) : formatInZone(row.validFromDate, zone, ui);
}

/**
 * The rate in force of a currency entry ({@link buildCurrencyList}) as a row: the listed row it
 * starts with, when the period holds it, else what `currentRates` says — `origin: AUTO` is a
 * downloaded range, `MANUAL` a manual one, with no end known.
 */
export function currentRateRow(entry) {
  if (!entry?.validFrom) return null;
  const listed = (entry.rows ?? []).find((r) => r.validFromDate === entry.validFrom);
  return listed ?? { validFromDate: entry.validFrom, validToDate: null, sMFCRSynced: entry.automatic === true };
}

/** `ETGO_ConvRateOverlap`, the server's refusal of an overlapping range. */
export const OVERLAP_KEY = 'ETGO_ConvRateOverlap';

/**
 * The overlap refusal worded in the viewer's zone (QA CP-13). The server words it in ITS zone, so
 * the times read wrong in another one; it also sends them structured (`error.details` of a write,
 * `errorDetails` of `previewManualRate`): `{conflictFrom, conflictTo, conflictOpen, suggestedFrom,
 * timeZone}`, server wall clock. They are converted like every other datetime of the window and the
 * viewer's zone is named once, after the suggested start. Without an active zone view they stay
 * server time and the server's zone id is named instead.
 *
 * @param {object|null} details the structured overlap
 * @param {{fromIso: string, toIso: string}} isos the pair
 * @param {ReturnType<typeof createZoneView>} zone
 * @param {(key: string, params?: object) => string} ui
 * @returns {string|null} null when there are no details (the caller keeps the server's text)
 */
export function overlapMessage(details, { fromIso, toIso }, zone, ui) {
  if (!details || typeof details !== 'object' || !details.suggestedFrom) return null;
  const shown = (raw) => (raw ? formatWallClock(zone.show(raw)) : '—');
  const end = details.conflictOpen ? ui('convRateNoEndDate') : shown(details.conflictTo);
  const zoneLabel = zone.active ? zone.labelAt(zone.show(details.suggestedFrom)) : details.timeZone;
  return ui('convRateOverlapError', {
    from: fromIso || '—',
    to: toIso || '—',
    start: shown(details.conflictFrom),
    end,
    suggested: withZone(shown(details.suggestedFrom), zoneLabel, ui),
  });
}

function calendarISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDaysISO(iso, days) {
  const p = parseWallClock(iso);
  if (!p) return null;
  // Local-time constructor: rolls month/year over and is DST-immune.
  return calendarISO(new Date(p.year, p.month - 1, p.day + days));
}

/**
 * Datetime bounds `[from, to)` of a history period, as wall-clock strings. A day is
 * `[D 00:00, D+1 00:00)`, so the end of a range is the START of the day after its last day.
 *
 * @param {string} period one of {@link PERIODS}
 * @param {{from?: string, to?: string}} [custom] `yyyy-MM-dd` days of the custom range
 * @param {Date} [reference] "today"
 * @returns {{from: string|null, to: string|null}}
 */
export function periodBounds(period, custom = {}, reference = new Date()) {
  const y = reference.getFullYear();
  const m = reference.getMonth();
  const todayIso = calendarISO(reference);
  let fromIso = null;
  let toIso = null;
  if (period === 'last30') {
    fromIso = addDaysISO(todayIso, -29);
    toIso = addDaysISO(todayIso, 1);
  } else if (period === 'thisMonth') {
    fromIso = calendarISO(new Date(y, m, 1));
    toIso = calendarISO(new Date(y, m + 1, 1));
  } else if (period === 'thisYear') {
    fromIso = calendarISO(new Date(y, 0, 1));
    toIso = calendarISO(new Date(y + 1, 0, 1));
  } else if (period === 'custom') {
    fromIso = custom.from ? wallClockDate(custom.from) || null : null;
    toIso = custom.to ? addDaysISO(custom.to, 1) : null;
  }
  return {
    from: fromIso ? `${fromIso}T00:00:00` : null,
    to: toIso ? `${toIso}T00:00:00` : null,
  };
}

/**
 * NEO criteria of the history list. The period filters by the START of the range (story
 * ETP-6365: "Solo se muestran tasas con Válido desde dentro de los últimos 30 días"):
 * `periodStart <= validFromDate < periodEnd`. Only FORWARD rows are listed (`currency` = the
 * organization currency); the inverse row of each period is never shown, its value is the
 * forward row's `divideRateBy`. Every filter is a real column, so it runs in the backend.
 *
 * @param {object} filters
 * @param {string|null} filters.orgCurrencyId
 * @param {string|null} [filters.currencyId] `toCurrency` filter (null = all)
 * @param {string} [filters.status] one of {@link STATUSES}
 * @param {{from: string|null, to: string|null}} [filters.bounds] from {@link periodBounds}
 * @returns {Array<object>}
 */
export function buildHistoryCriteria({ orgCurrencyId, currencyId, status = 'all', bounds }) {
  const criteria = [];
  if (orgCurrencyId) criteria.push({ fieldName: 'currency', operator: 'equals', value: orgCurrencyId });
  if (currencyId) criteria.push({ fieldName: 'toCurrency', operator: 'equals', value: currencyId });
  if (status && status !== 'all') criteria.push({ fieldName: 'etgoRateStatus', operator: 'equals', value: status });
  if (bounds?.from) criteria.push({ fieldName: 'validFromDate', operator: 'greaterOrEqual', value: bounds.from });
  if (bounds?.to) criteria.push({ fieldName: 'validFromDate', operator: 'lessThan', value: bounds.to });
  return criteria;
}

/** Query string of the history read: every matching forward row, newest first. */
export function buildHistoryQuery(criteria) {
  const params = new URLSearchParams({
    _startRow: '0',
    _endRow: String(HISTORY_MAX_ROWS),
    _sortBy: '-validFromDate',
  });
  if (criteria?.length) params.set('criteria', JSON.stringify(criteria));
  return params.toString();
}

/** Whether the hover actions (Modificar / Eliminar) apply: every manual row, whatever its state. */
export function isEditableRate(row) {
  return Boolean(row) && row.sMFCRSynced !== true;
}

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * The accordion list: one entry per currency that has rates — every currency with a rate in
 * force now (`currentRates`, in its order) plus any other currency that has rows in the read
 * (then by ISO code) — narrowed to `currencyId` when the Divisa filter is set. Each entry carries
 * the header data (current forward rate, its start or the last download) and `rows`: its rates of
 * the period, newest first, then ordered by `sort` (`{key, direction}`).
 *
 * A currency known only from its rows (no rate in force) takes its ISO code from the row
 * identifier and its origin from the rows' `sMFCRSynced`; name and symbol stay empty for the
 * caller to fill.
 *
 * @param {Array<object>} currentRates action `currentRates`
 * @param {Array<object>} rows forward rows of the period
 * @param {{currencyId?: string|null, sort?: {key: string, direction: 'asc'|'desc'}}} [opts]
 * @returns {Array<{currencyId: string, isoCode: string, name: string, symbol: string,
 *   automatic: boolean, rate: number|null, validFrom: string|null, lastDownloadAt: string|null,
 *   rows: object[]}>}
 */
export function buildCurrencyList(currentRates, rows, { currencyId = null, sort } = {}) {
  const byId = new Map();
  for (const r of currentRates ?? []) {
    byId.set(r.currencyId, {
      currencyId: r.currencyId,
      isoCode: r.isoCode ?? '',
      name: r.name ?? '',
      symbol: r.symbol ?? '',
      automatic: r.origin === 'AUTO',
      rate: r.rate ?? null,
      validFrom: r.validFrom ?? null,
      lastDownloadAt: r.lastDownloadAt ?? null,
      rows: [],
    });
  }
  const extra = [];
  for (const row of rows ?? []) {
    let entry = byId.get(row.toCurrency);
    if (!entry) {
      entry = {
        currencyId: row.toCurrency,
        isoCode: row['toCurrency$_identifier'] ?? '',
        name: '',
        symbol: '',
        automatic: row.sMFCRSynced === true,
        rate: null,
        validFrom: null,
        lastDownloadAt: null,
        rows: [],
      };
      byId.set(row.toCurrency, entry);
      extra.push(entry);
    }
    entry.rows.push(row);
  }
  extra.sort((a, b) => a.isoCode.localeCompare(b.isoCode));
  const ordered = [...(currentRates ?? []).map((r) => byId.get(r.currencyId)), ...extra]
    .filter((e) => !currencyId || e.currencyId === currencyId);
  for (const entry of ordered) {
    entry.rows.sort((a, b) => compareValues(b.validFromDate, a.validFromDate));
    if (sort?.key) {
      const sign = sort.direction === 'asc' ? 1 : -1;
      entry.rows.sort((a, b) => sign * compareValues(a[sort.key], b[sort.key]));
    }
  }
  return ordered;
}
