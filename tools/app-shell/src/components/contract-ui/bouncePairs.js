/**
 * Pure logic of the bounce pairs of the bank reconciliation (ETP-5581).
 *
 * A bounce ("rechazo" bancario in the UI) is an outgoing bank-statement line plus the line that reverses it: opposite
 * sign, exact amount, a few days later. The backend (com.etendoerp.go, behind the per-account flag
 * `bank-bounce-suggestions`) detects them; the SPA only renders what it answers:
 * - `autoMatch` groups with `kind: "bouncePair"` (the flag-off answer has no `kind` at all, and a
 *   group without one is a transaction group);
 * - `pendingLines` rows in the `bounce` state with a `bouncePair` annotation (role `original`,
 *   `bounce` or `candidate`), and `counts.bounce`;
 * - `pendingLines?status=discarded`, the discarded lines with their `bounceLink`.
 * Contract: com.etendoerp.go docs/neo-headless.md §4.12.1.1, "Discarded lines and bounce pairs".
 *
 * Plain `.js` (no JSX) so node:test can import it, same arrangement as
 * `reconciliationStatusFilter.js`.
 */

import { parseCalendarDate } from '../../lib/dateOnly.js';
import {
  CHOICE_SOURCE_AI, CHOICE_SOURCE_USER, aiAssessmentFor, aiDefaultChoice, sortOptionsByAi,
  visibleAiPercent,
} from './bounceAi.js';

/** `kind` of an autoMatch group that is a bounce pair. */
export const BOUNCE_PAIR_KIND = 'bouncePair';
/** Line state of a line of a detected pair (pendingLines). */
export const BOUNCE_STATE = 'bounce';
/** Line state of a discarded line (pendingLines?status=discarded). */
export const DISCARDED_STATE = 'discarded';
/** Confidence the backend gives a pair it would discard without asking. */
export const HIGH_CONFIDENCE = 'high';

const SIGNAL_PIS_LINK = 'pis_link';
const SIGNAL_RETURN_TEXT = 'return_text';
const SIGNAL_COUNTERPARTY = 'counterparty';

/** i18n key of the signal named in a high-confidence notice. */
const SIGNAL_LABEL_KEY = {
  [SIGNAL_PIS_LINK]: 'financeReconcileBounceSignalPisLink',
  [SIGNAL_RETURN_TEXT]: 'financeReconcileBounceSignalReturnText',
  [SIGNAL_COUNTERPARTY]: 'financeReconcileBounceSignalCounterparty',
};

/** i18n keys of each review reason: the short form (modal tag) and the long one (panel notice). */
const REASON_KEYS = {
  ambiguous: {
    short: 'financeReconcileBounceReasonAmbiguousShort',
    long: 'financeReconcileBounceReasonAmbiguous',
  },
  counterpartyOnly: {
    short: 'financeReconcileBounceReasonCounterpartyShort',
    long: 'financeReconcileBounceReasonCounterparty',
  },
  late: {
    short: 'financeReconcileBounceReasonLateShort',
    long: 'financeReconcileBounceReasonLate',
  },
  check: {
    short: 'financeReconcileBounceReasonCheckShort',
    long: 'financeReconcileBounceReasonCheck',
  },
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whether an autoMatch group is a bounce pair. A group with no `kind` is a transaction group: that
 * is the whole flag-off answer.
 *
 * @param {object|null|undefined} group
 * @returns {boolean}
 */
export function isBouncePairGroup(group) {
  return group?.kind === BOUNCE_PAIR_KIND;
}

/**
 * Splits the autoMatch groups into transaction groups and bounce pairs, keeping each in the order
 * the backend sent it.
 *
 * @param {Array<object>} [groups]
 * @returns {{ transactionGroups: Array<object>, bouncePairs: Array<object> }}
 */
export function splitAutoMatchGroups(groups = []) {
  const transactionGroups = [];
  const bouncePairs = [];
  for (const group of groups ?? []) {
    if (isBouncePairGroup(group)) bouncePairs.push(group);
    else transactionGroups.push(group);
  }
  return { transactionGroups, bouncePairs };
}

/**
 * Whether a pair (an autoMatch group or a `bouncePair` row annotation) has several candidate
 * originals. Such a pair names no original, so it cannot be discarded until one is chosen.
 *
 * @param {object|null|undefined} pair
 * @returns {boolean}
 */
export function isAmbiguousPair(pair) {
  return !!pair?.ambiguous;
}

/**
 * The outflows a pair can be excluded with, in the order the modal tries them (ETP-6359):
 * - the outflow the user picked for this rejection in the reconciliation panel, first (it may be
 *   one the detector did not offer: the two-table view pairs any outflow of the same amount);
 * - then, for an AMBIGUOUS pair, the AI-recommended candidate (when it is among the candidates),
 *   the rest by descending visible AI percentage, ties and unrated ones in detector order
 *   (`sortOptionsByAi` keeps that order with no AI data or when "none" wins);
 * - for a single-original pair, its original.
 *
 * @param {object|null|undefined} group an autoMatch bounce-pair group
 * @param {Record<string, object>|null} [assessments] the answer's `bounceAiAssessments`
 * @param {object|null} [pick] the outflow line picked in the panel for this rejection
 * @returns {Array<object>}
 */
export function pairOutflowPreference(group, assessments = null, pick = null) {
  if (!isBouncePairGroup(group)) return [];
  const lines = pairOriginalLines(group);
  let ordered = lines;
  if (isAmbiguousPair(group)) {
    const assessment = aiAssessmentFor(assessments, group.counterpartLine?.id);
    const aiId = aiDefaultChoice(assessment, lines);
    const sorted = sortOptionsByAi(lines, assessment);
    ordered = aiId == null
      ? sorted
      : [...sorted.filter((l) => l.id === aiId), ...sorted.filter((l) => l.id !== aiId)];
  }
  if (!pick?.id) return ordered;
  return [pick, ...ordered.filter((l) => l.id !== pick.id)];
}

/**
 * The panel pick of a pair that counts as a choice: none for a single-original pair whose pick is its
 * own original (re-clicking it changes nothing, as in the panel's `explicitPick`).
 *
 * @param {object} group an autoMatch bounce-pair group
 * @param {object|null} pick the outflow picked in the panel for this rejection
 * @returns {object|null}
 */
export function effectivePairPick(group, pick) {
  if (pick?.id == null) return null;
  if (!isAmbiguousPair(group) && pick.id === pairOriginalLines(group)[0]?.id) return null;
  return pick;
}

/**
 * The `choiceSource` a pair is excluded with when the modal shows `line` (ETP-6359). ONE rule with
 * the panel's discard (`discardChoiceSource`, useBouncePairReview.jsx):
 * - `user` when the shown outflow is the one the user picked in the panel, even when that pick is
 *   the AI recommendation or there is no AI data;
 * - otherwise, with AI data for an ambiguous pair: `ai` when the shown outflow IS the recommended
 *   candidate (the backend then refuses the group as stale if the recommendation no longer holds),
 *   `user` when it is another;
 * - null (the field is left out) with no AI data and no pick.
 *
 * @param {object} group an autoMatch bounce-pair group
 * @param {object|null} line the outflow the row shows
 * @param {Record<string, object>|null} [assessments]
 * @param {object|null} [pick] the outflow picked in the panel for this rejection
 * @returns {'ai'|'user'|null}
 */
export function pairChoiceSource(group, line, assessments = null, pick = null) {
  if (!line || !isBouncePairGroup(group)) return null;
  const own = effectivePairPick(group, pick);
  if (own && line.id === own.id) return CHOICE_SOURCE_USER;
  const assessment = isAmbiguousPair(group) ? aiAssessmentFor(assessments, group.counterpartLine?.id) : null;
  if (!assessment) return null;
  return aiDefaultChoice(assessment, pairOriginalLines(group)) === line.id ? CHOICE_SOURCE_AI : CHOICE_SOURCE_USER;
}

/**
 * The outflow a pair shows in the modal, and a tick excludes it with, when no other row competes
 * for it: the first of {@link pairOutflowPreference} and its {@link pairChoiceSource}. The modal
 * itself goes through {@link resolvePairOutflows}, which also keeps two checked rows off the same
 * outflow.
 *
 * @param {object|null|undefined} group an autoMatch bounce-pair group
 * @param {Record<string, object>|null} [assessments] the answer's `bounceAiAssessments`
 * @returns {{ line: object|null, source: 'ai'|'user'|null }}
 */
export function shownOutflow(group, assessments = null) {
  if (!isBouncePairGroup(group)) return { line: null, source: null };
  const line = pairOutflowPreference(group, assessments)[0] ?? null;
  return { line, source: pairChoiceSource(group, line, assessments) };
}

/**
 * The outflow every bounce pair of the modal shows, and whether its row can be checked (ETP-6359).
 *
 * Two rejections may list the same outflow. Excluding both with it makes the backend refuse the
 * second (409 `LINE_NOT_PENDING`: one call takes each line once), so:
 * - a CHECKED pair keeps the outflow it held when it was ticked (`pins`), whatever happens to the
 *   other rows; a pair checked by default (no pin) takes the first of its
 *   {@link pairOutflowPreference}. Checked pairs go first, in check order (`checkedKeys`). A pinned
 *   outflow that is no longer available (it left the pair's options, or an earlier checked pair
 *   holds it) leaves the pair unchecked;
 * - only the UNCHECKED pairs re-resolve: each shows the first outflow no checked pair holds. When
 *   none is left it shows none and cannot be checked (`blocked`) until a checked pair that holds one
 *   is unchecked; then it shows its original choice again.
 *
 * An ambiguous pair with no AI assessment for its rejection (AI off or failed, or the assessment
 * dropped after a stale refusal) is never matched to a candidate by the modal: without a panel pick
 * it cannot be checked (`needsPanel`, it shows its first free candidate for reference only); with
 * one it can, with exactly that outflow, and while another checked pair holds it the pair shows none
 * and is `blocked`.
 *
 * @param {Array<object>} pairs the bounce pairs, in the modal's order
 * @param {{ assessments?: Record<string, object>|null, picks?: Map<string, object>|null,
 *   checkedKeys?: Array<string>, pins?: Map<string, string>|null }} [options] `picks`: the outflow
 *   picked in the panel, by bounce line id; `checkedKeys`: the `groupKey`s checked, in check order;
 *   `pins`: the outflow line id each user-checked pair was ticked with, by `groupKey`
 * @returns {Map<string, { line: object|null, source: 'ai'|'user'|null, checkable: boolean,
 *   checked: boolean, blocked: boolean, needsPanel: boolean, picked: boolean }>} by `groupKey`;
 *   `picked`: the rejection has a panel pick that counts ({@link effectivePairPick})
 */
export function resolvePairOutflows(pairs, {
  assessments = null, picks = null, checkedKeys = [], pins = null,
} = {}) {
  const byKey = new Map();
  for (const pair of pairs ?? []) {
    if (isBouncePairGroup(pair) && pair.groupKey != null) byKey.set(pair.groupKey, pair);
  }
  const taken = new Set();
  const out = new Map();
  const free = (l) => l?.id != null && !taken.has(l.id);
  const assign = (group, wantsCheck) => {
    const bounceId = group.counterpartLine?.id ?? null;
    const pick = effectivePairPick(group, (bounceId == null ? null : picks?.get?.(bounceId)) ?? null);
    const noAi = isAmbiguousPair(group) && !aiAssessmentFor(assessments, bounceId);
    // Without AI data the modal never chooses a candidate on its own: only the panel pick counts.
    const preference = noAi && pick ? [pick] : pairOutflowPreference(group, assessments, pick);
    const pin = wantsCheck ? (pins?.get?.(group.groupKey) ?? null) : null;
    const pinned = pin == null ? null : preference.find((l) => l?.id === pin && free(l)) ?? null;
    // A pinned outflow that is gone: the pair is resolved later, with the unchecked ones, so it can
    // never show an outflow a checked pair after it holds.
    if (pin != null && !pinned) return;
    const line = pinned ?? preference.find(free) ?? null;
    const needsPanel = noAi && !(pick && line?.id === pick.id);
    const blocked = line == null && preference.length > 0;
    const checkable = isSelectableGroup(group) && line != null && !needsPanel;
    const checked = wantsCheck && checkable;
    if (checked) taken.add(line.id);
    out.set(group.groupKey, {
      line,
      source: pairChoiceSource(group, line, assessments, pick),
      checkable,
      checked,
      blocked,
      needsPanel,
      picked: pick != null,
    });
  };
  for (const key of checkedKeys ?? []) {
    const group = byKey.get(key);
    if (group && !out.has(key)) assign(group, true);
  }
  for (const [key, group] of byKey) {
    if (!out.has(key)) assign(group, false);
  }
  return out;
}

/**
 * Whether an autoMatch group can be checked in the modal, by its shape alone. Every transaction
 * group can; a bounce pair when it names both lines; an ambiguous pair when it has a rejection and
 * at least one candidate. Whether it can be checked NOW (its outflow is free, an ambiguous pair has
 * AI data or a panel pick) is {@link resolvePairOutflows}.
 *
 * @param {object|null|undefined} group
 * @returns {boolean}
 */
export function isSelectableGroup(group) {
  if (!isBouncePairGroup(group)) return true;
  if (isAmbiguousPair(group)) return !!group.counterpartLine?.id && pairOriginalLines(group).length > 0;
  return !!group.statementLine?.id && !!group.counterpartLine?.id;
}

/**
 * Whether an autoMatch group starts checked: every transaction group (as before ETP-5581), and a
 * bounce pair only with high confidence. A pair "to review" starts unchecked.
 *
 * @param {object|null|undefined} group
 * @returns {boolean}
 */
export function defaultGroupChecked(group) {
  if (!isBouncePairGroup(group)) return true;
  // An ambiguous pair is never checked by default: excluding discards data, the user ticks it.
  return !isAmbiguousPair(group) && isSelectableGroup(group) && group.confidence === HIGH_CONFIDENCE;
}

/**
 * The `applySuggestions` body entry of a bounce pair.
 *
 * @param {object} group a selectable bounce-pair group
 * @param {object|null} [picked] the outflow the modal row shows (its `statementLineId`): a
 *   candidate of an ambiguous pair, or an outflow the user picked in the panel; without it, the
 *   pair's own original
 * @param {'ai'|'user'|null} [choiceSource] how an ambiguous pair's outflow was chosen: `ai` when the
 *   shown outflow is the AI-recommended one (the backend then refuses the group as stale if the
 *   recommendation no longer holds), `user` when the AI rated the pair but the shown one is not the
 *   recommended; omitted without AI data
 * @returns {{ kind: string, statementLineId: string, counterpartLineId: string, choiceSource?: string }}
 */
export function bouncePairPayload(group, picked = null, choiceSource = null) {
  return {
    kind: BOUNCE_PAIR_KIND,
    statementLineId: picked?.id ?? group.statementLine?.id,
    counterpartLineId: group.counterpartLine?.id,
    ...(choiceSource ? { choiceSource } : {}),
  };
}

/**
 * The `applySuggestions` body key that reports, for the KPI events the backend emits, what became of
 * every bounce pair the modal SHOWED but is not applying (ETP-5581). One constant, so the field name
 * lives in one place.
 */
export const BOUNCE_DECISIONS_KEY = 'bounceDecisions';

/** The decision a shown, not-applied pair is reported with in {@link BOUNCE_DECISIONS_KEY}. */
export const BOUNCE_DECISION = Object.freeze({
  /** Left (or turned) unchecked in the modal. */
  UNCHECKED: 'unchecked',
  /** Sent to the panel with "Revisar en el panel" during this modal session, and not re-checked. */
  SENT_TO_PANEL: 'sent_to_panel',
});

/**
 * The {@link BOUNCE_DECISIONS_KEY} entries of an apply: one per shown pair that is not checked
 * (one that cannot be checked right now included). A checked pair is not listed: it travels in
 * `groups` as before. Only the `groupKey` goes, never a line id, amount or text.
 *
 * @param {Array<object>} pairs the bounce pairs the modal shows (dismissed ones already left out)
 * @param {(group: object) => boolean} isChecked the modal's check state
 * @param {Set<string>|null} [sentToPanelKeys] pairs sent to the panel during this modal session
 * @returns {Array<{ groupKey: string, decision: string }>}
 */
export function bounceDecisions(pairs, isChecked, sentToPanelKeys = null) {
  return (pairs ?? [])
    .filter((pair) => pair?.groupKey && !isChecked(pair))
    .map((pair) => ({
      groupKey: pair.groupKey,
      decision: sentToPanelKeys?.has(pair.groupKey)
        ? BOUNCE_DECISION.SENT_TO_PANEL
        : BOUNCE_DECISION.UNCHECKED,
    }));
}

/**
 * The `applySuggestions` body with {@link BOUNCE_DECISIONS_KEY} added — only when the modal showed
 * bounce pairs; an apply without pairs keeps the body it always had.
 *
 * @param {object} payload the body without bounce decisions
 * @param {Array<object>} pairs the bounce pairs the modal shows
 * @param {(group: object) => boolean} isChecked
 * @param {Set<string>|null} [sentToPanelKeys]
 * @returns {object}
 */
export function withBounceDecisions(payload, pairs, isChecked, sentToPanelKeys = null) {
  if (!pairs?.length) return payload;
  return { ...payload, [BOUNCE_DECISIONS_KEY]: bounceDecisions(pairs, isChecked, sentToPanelKeys) };
}

/**
 * The `dismissPair` body of "No es un rechazo" (ETP-5581): the line selected in the panel and, when
 * the card shows one, the other line of the pair (the chosen original of an ambiguous pair; left
 * out while none is chosen). Null when there is no line.
 *
 * @param {string} financialAccountId
 * @param {object|null} line the selected row
 * @param {object|null} model its {@link bouncePanelModel}
 * @returns {{ financialAccountId: string, statementLineId: string, counterpartLineId?: string }|null}
 */
export function dismissPairPayload(financialAccountId, line, model) {
  if (!line?.id) return null;
  // ETP-6359 — only an EXPLICIT pick travels: the original the AI preselected is not a user choice,
  // so "No es un rechazo" keeps its KPI meaning (the user rejected the pair, not a counterpart).
  // A free pick (an outflow that is not one of the pair's own originals / candidates, maybe the
  // original of ANOTHER pair) is not sent either: the backend's KPI lookup would find no proposed
  // pair for it.
  const picked = model?.aiPreselected ? null : model?.other ?? null;
  const own = model?.role === 'bounce'
    ? pairOriginalLines(rowAsGroup(line)).some((l) => l?.id === picked?.id)
    : true;
  const counterpartLineId = (own ? picked?.id : null) ?? null;
  return {
    financialAccountId,
    statementLineId: line.id,
    ...(counterpartLineId ? { counterpartLineId } : {}),
  };
}

/**
 * The original lines a pair offers: its candidates when ambiguous, else its original.
 *
 * @param {object} group an autoMatch bounce-pair group
 * @returns {Array<object>}
 */
export function pairOriginalLines(group) {
  if (isAmbiguousPair(group)) {
    return (group.candidates ?? []).map((c) => c?.line).filter(Boolean);
  }
  return group?.statementLine ? [group.statementLine] : [];
}

/**
 * Whole days from `fromRaw` to `toRaw`, both business dates, or null when either is missing.
 * Goes through `parseCalendarDate`, so the host's timezone never shifts a day.
 *
 * @param {string|null|undefined} fromRaw
 * @param {string|null|undefined} toRaw
 * @returns {number|null}
 */
export function daysBetween(fromRaw, toRaw) {
  const from = parseCalendarDate(fromRaw);
  const to = parseCalendarDate(toRaw);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Why a pair is offered with the confidence it has, as i18n keys and their parameters.
 *
 * The backend sends the confidence and the signals, not a sentence. Its rule
 * (`BankBounceDetector.confidence`) is: high with bounce wording on the same day, or with a PSD2
 * payment link backed by timing or wording, and never when ambiguous. So a "review" pair is one of:
 * - ambiguous (several originals);
 * - only the counterparty matches (no wording, no payment link);
 * - wording or a payment link, but the bounce came days later;
 * - anything else (e.g. an ambiguous group reduced to one candidate by the payment guard), which
 *   only asks the user to check the original.
 *
 * @param {object} pair an autoMatch group or a `bouncePair` annotation
 * @param {object|null} original the original line (null when unknown)
 * @param {object|null} bounce the bounce line
 * @returns {{ high: true, signalKey: string|null }
 *   | { high: false, shortKey: string, longKey: string, params: object }}
 */
export function bounceReason(pair, original, bounce) {
  if (pair?.confidence === HIGH_CONFIDENCE && !isAmbiguousPair(pair)) {
    return { high: true, signalKey: SIGNAL_LABEL_KEY[pair.signal] ?? null };
  }
  const reason = reviewReason(pair, original, bounce);
  return {
    high: false,
    shortKey: REASON_KEYS[reason.code].short,
    longKey: REASON_KEYS[reason.code].long,
    params: reason.params,
  };
}

/** The review reason code and its parameters; see {@link bounceReason}. */
function reviewReason(pair, original, bounce) {
  if (isAmbiguousPair(pair)) {
    // Only the bounce line (and the autoMatch group) carries the candidates; the annotation of a
    // `candidate` line does not, so there the count is unknown and the user is asked to check.
    const count = (pair.candidates ?? []).length;
    return count > 1 ? { code: 'ambiguous', params: { count } } : { code: 'check', params: {} };
  }
  const signals = Array.isArray(pair?.signals) ? pair.signals : [];
  const strong = signals.includes(SIGNAL_PIS_LINK) || signals.includes(SIGNAL_RETURN_TEXT);
  if (!strong && signals.includes(SIGNAL_COUNTERPARTY)) {
    return { code: 'counterpartyOnly', params: {} };
  }
  const days = daysBetween(original?.date, bounce?.date);
  if (strong && days != null && days > 0) {
    return { code: 'late', params: { days } };
  }
  return { code: 'check', params: {} };
}

/**
 * Sum of two signed line amounts, rounded to cents. The net effect of a pair; 0 for a real bounce.
 *
 * @param {object|null} a
 * @param {object|null} b
 * @returns {number|null} null when either line is missing
 */
export function pairNet(a, b) {
  if (!a || !b || a.amount == null || b.amount == null) return null;
  return Number(((Number(a.amount) || 0) + (Number(b.amount) || 0)).toFixed(2));
}

/**
 * The `status` parameter of the left panel's `pendingLines` request: `discarded` while that filter
 * is active, nothing otherwise (every other filter is applied client-side over the default answer,
 * and the backend answers `status=discarded` with the discarded lines only).
 *
 * @param {string|null|undefined} status the active filter code
 * @returns {string|undefined}
 */
export function pendingLinesStatusParam(status) {
  return status === DISCARDED_STATE ? DISCARDED_STATE : undefined;
}

/**
 * Whether the reconciliation panel shows the bounce-pair panel, instead of the candidate
 * operations, for this line: a line of a detected pair, or a discarded line.
 *
 * @param {object|null|undefined} line a pendingLines row as shown (after dismissals)
 * @returns {boolean}
 */
export function isBounceReviewLine(line) {
  if (!line) return false;
  if (line.state === DISCARDED_STATE) return true;
  return line.state === BOUNCE_STATE && !!line.bouncePair;
}

/**
 * The pendingLines rows with every line of a dismissed pair ("No es un rechazo") turned back into a
 * plain pending line. Nothing is persisted: the backend still proposes the pair, the user just
 * asked not to see it again in this session.
 *
 * Only a pending line can be offered as a bounce (`BankBounceSuggestions.PanelView.finish`), so
 * `pending` is the state it had before.
 *
 * @param {Array<object>} lines
 * @param {Set<string>} dismissedKeys `groupKey`s of the dismissed pairs
 * @returns {Array<object>} the same array when nothing changes
 */
export function withDismissedPairs(lines, dismissedKeys) {
  if (!dismissedKeys || dismissedKeys.size === 0) return lines;
  let changed = false;
  const out = lines.map((line) => {
    if (line?.state !== BOUNCE_STATE || !dismissedKeys.has(line.bouncePair?.groupKey)) return line;
    changed = true;
    const rest = { ...line, state: 'pending' };
    delete rest.bouncePair;
    return rest;
  });
  return changed ? out : lines;
}

/**
 * The per-state counts after {@link withDismissedPairs}: each line turned back moves from
 * `bounce` to `pending`. `all` does not change.
 *
 * @param {Record<string, number>} counts per-state counts from pendingLines
 * @param {Array<object>} lines the rows as the backend sent them
 * @param {Set<string>} dismissedKeys
 * @returns {Record<string, number>} the same object when nothing changes
 */
export function countsWithDismissedPairs(counts, lines, dismissedKeys) {
  if (!dismissedKeys || dismissedKeys.size === 0 || counts?.bounce == null) return counts;
  const moved = lines.filter((line) => line?.state === BOUNCE_STATE
    && dismissedKeys.has(line.bouncePair?.groupKey)).length;
  if (moved === 0) return counts;
  return {
    ...counts,
    bounce: Math.max(0, (Number(counts.bounce) || 0) - moved),
    pending: (Number(counts.pending) || 0) + moved,
  };
}

/**
 * What the bounce-pair panel shows for the selected line, or null when it is not a bounce or
 * discarded line.
 *
 * - The BOUNCE line of a pair lists its possible originals: the original, or the candidates of an
 *   ambiguous pair, which the user picks with a radio (`chosenOriginalId`).
 * - An ORIGINAL or a CANDIDATE line lists the bounce line; the selected line is the original.
 * - A DISCARDED line lists the line it was discarded with (`bounceLink.counterpartLineId`, looked
 *   up in `discardedLines`), or nothing when it was discarded on its own (Classic's per-line
 *   discard).
 *
 * `discard` is the `discardPair` body (original as `statementLineId`, bounce as
 * `counterpartLineId`, the same shape as the autoMatch group), null while no original is chosen.
 *
 * ETP-6359: `aiAssessments` is the autoMatch answer's `bounceAiAssessments` (absent = no AI). Only
 * the bounce role uses it, see {@link bounceRoleModel}. `chosenOriginalLine` is the line object of
 * an explicit pick that is NOT one of the pair's own originals (the two-table "Posibles rechazos"
 * view lets the user pair the rejection with any outflow of the same amount).
 *
 * @param {object|null} line the selected row
 * @param {{ discardedLines?: Array<object>, chosenOriginalId?: string|null,
 *   chosenOriginalLine?: object|null, aiAssessments?: Record<string, object>|null }} [options]
 * @returns {object|null}
 */
export function bouncePanelModel(
  line,
  {
    discardedLines = [], chosenOriginalId = null, chosenOriginalLine = null, aiAssessments = null,
  } = {},
) {
  if (!line) return null;
  if (line.state === DISCARDED_STATE) return discardedModel(line, discardedLines);
  const pair = line.state === BOUNCE_STATE ? line.bouncePair : null;
  if (!pair) return null;
  if (pair.role === 'bounce') {
    return bounceRoleModel(line, pair, { chosenOriginalId, chosenOriginalLine, aiAssessments });
  }
  const bounce = pair.counterpartLine ?? null;
  return {
    mode: BOUNCE_STATE,
    role: pair.role,
    pair,
    rows: bounce ? [bounce] : [],
    rowBadge: 'bounce',
    selectable: false,
    chosenId: bounce?.id ?? null,
    other: bounce,
    reason: bounceReason(pair, line, bounce),
    discard: bounce ? { statementLineId: line.id, counterpartLineId: bounce.id } : null,
    net: pairNet(line, bounce),
  };
}

/**
 * {@link bouncePanelModel} for the bounce line of a pair.
 *
 * With an AI assessment (ETP-6359) the options are sorted by percentage for display, each row's
 * percentage is exposed in `percents`, and an ambiguous pair with no explicit pick defaults to the
 * AI's recommendation: `chosen = explicit pick ?? AI default ?? null`, DERIVED here (never stored),
 * flagged by `aiPreselected`. A single-original pair shows its percentage but is never
 * preselected. Without an assessment the model is exactly what it was.
 */
function bounceRoleModel(line, pair, { chosenOriginalId, chosenOriginalLine, aiAssessments }) {
  const ambiguous = isAmbiguousPair(pair);
  const assessment = aiAssessmentFor(aiAssessments, line.id);
  const baseOptions = ambiguous
    ? (pair.candidates ?? []).map((c) => c?.line).filter(Boolean)
    : [pair.counterpartLine].filter(Boolean);
  const options = ambiguous ? sortOptionsByAi(baseOptions, assessment) : baseOptions;
  // chosen = explicit pick ?? AI default ?? (the single original of a non-ambiguous pair). An
  // explicit pick may be any outflow (also one the detector did not offer for this rejection).
  let chosen = options.find((o) => o.id === chosenOriginalId) ?? null;
  if (!chosen && chosenOriginalId != null && chosenOriginalLine?.id === chosenOriginalId) {
    chosen = chosenOriginalLine;
  }
  // Only a pick that DIFFERS from the default is an explicit one: re-clicking the single original
  // of a non-ambiguous pair changes nothing (and must not report a 'user' choice).
  const explicitPick = chosen != null && (ambiguous || chosen.id !== options[0]?.id);
  let aiPreselected = false;
  if (!chosen && ambiguous) {
    const aiId = aiDefaultChoice(assessment, options);
    chosen = options.find((o) => o.id === aiId) ?? null;
    aiPreselected = chosen != null;
  } else if (!chosen) {
    chosen = options[0] ?? null;
  }
  const model = {
    mode: BOUNCE_STATE,
    role: 'bounce',
    pair,
    rows: options,
    rowBadge: 'bounceOriginal',
    selectable: ambiguous,
    chosenId: chosen?.id ?? null,
    other: chosen,
    explicitPick,
    reason: bounceReason(pair, chosen, line),
    discard: chosen ? { statementLineId: chosen.id, counterpartLineId: line.id } : null,
    net: pairNet(line, chosen),
  };
  if (!assessment) return model;
  // Shown percentages: all null when "none" wins (one rule with the modal, see aiNoneWins).
  const percents = {};
  for (const option of options) percents[option.id] = visibleAiPercent(assessment, option.id);
  const recommendedId = aiDefaultChoice(assessment, options);
  return {
    ...model,
    percents,
    aiRecommendedId: ambiguous ? recommendedId : null,
    aiPreselected,
    aiPercent: aiPreselected ? percents[chosen.id] : null,
  };
}

/** Whether `partner`'s discard link points back at `line` (what makes the two a restorable pair). */
function pointsBack(partner, line) {
  return partner?.bounceLink?.counterpartLineId === line?.id;
}

/**
 * {@link bouncePanelModel} for a discarded line. Its partner is the line its `bounceLink` names,
 * looked up in `discardedLines`, but only when that line points back (ETP-6359, the same rule as
 * {@link buildDiscardedPairRows}). A partner on screen that does not is a one-sided (legacy) link:
 * the backend's "Restaurar" restores this line alone, so it reads as a lone line (`paired: false`,
 * no row, no net, "Restaurar línea"). A partner that is not on screen (outside the date range)
 * keeps `paired`: the backend restores both when the link is mutual.
 */
function discardedModel(line, discardedLines) {
  const link = line.bounceLink ?? null;
  const counterpartId = link?.counterpartLineId ?? null;
  const found = counterpartId
    ? (discardedLines.find((l) => l.id === counterpartId) ?? null)
    : null;
  const oneSided = found != null && !pointsBack(found, line);
  const counterpart = oneSided ? null : found;
  return {
    mode: DISCARDED_STATE,
    link,
    rows: counterpart ? [counterpart] : [],
    rowBadge: DISCARDED_STATE,
    other: counterpart,
    paired: !!counterpartId && !oneSided,
    net: pairNet(line, counterpart),
  };
}

/**
 * The outcome of an `applySuggestions` call that carried bounce pairs: how many transaction groups
 * and pairs succeeded, and the failed entries (a bounce refusal carries `code` and `error`).
 *
 * @param {Array<object>} results the `results` of the answer
 * @returns {{ groupsOk: number, pairsOk: number, failures: Array<object> }}
 */
export function summarizeApplyResults(results = []) {
  let groupsOk = 0;
  let pairsOk = 0;
  const failures = [];
  for (const r of results ?? []) {
    if (r?.error) {
      failures.push(r);
    } else if (r?.kind === BOUNCE_PAIR_KIND) {
      pairsOk += 1;
    } else {
      groupsOk += 1;
    }
  }
  return { groupsOk, pairsOk, failures };
}

/** Code (and AD_MESSAGE key) of the refusal of a pair whose line is no longer pending. */
export const LINE_NOT_PENDING_CODE = 'LINE_NOT_PENDING';
const LINE_NOT_PENDING_MESSAGE_KEY = 'ETGO_BounceLineNotPending';

/**
 * Whether an `applySuggestions` result entry is the 409 `LINE_NOT_PENDING` refusal of a bounce pair:
 * one of its lines was already taken (another group of the same call, or a change since the
 * suggestions were computed). The suggestions on screen are then stale.
 *
 * @param {object|null|undefined} result
 * @returns {boolean}
 */
export function isLineNotPendingResult(result) {
  if (!result?.error) return false;
  if ((result.code ?? result.error?.code) === LINE_NOT_PENDING_CODE) return true;
  const keys = result.error?.messageKeys ?? result.messageKeys;
  return Array.isArray(keys) && keys.includes(LINE_NOT_PENDING_MESSAGE_KEY);
}

/**
 * A pendingLines row of a detected pair, in the shape of an autoMatch bounce-pair group, so the
 * reconciliation panel's "Posibles rechazos" list renders it with the same row as the automatch
 * modal (original on the left, rejection on the right). Pure adapter, nothing is invented:
 * - the BOUNCE row (role `bounce`) is the rejection (`counterpartLine`); its original is the
 *   annotation's `counterpartLine` (a short object), or, when ambiguous, its `candidates`;
 * - an ORIGINAL or CANDIDATE row (only when its pair has no bounce row on screen) is the original
 *   (`statementLine`) and the annotation's `counterpartLine` is the rejection.
 *
 * @param {object} row a pendingLines row with state `bounce` and a `bouncePair`
 * @returns {object} an autoMatch-group-shaped object
 */
export function rowAsGroup(row) {
  const pair = row?.bouncePair ?? {};
  const base = {
    kind: BOUNCE_PAIR_KIND,
    groupKey: pair.groupKey,
    confidence: pair.confidence,
    signal: pair.signal,
    signals: pair.signals,
    ambiguous: !!pair.ambiguous,
  };
  if (pair.role === 'bounce') {
    return {
      ...base,
      candidates: pair.candidates ?? [],
      statementLine: isAmbiguousPair(pair) ? null : (pair.counterpartLine ?? null),
      counterpartLine: row,
    };
  }
  return {
    ...base,
    candidates: isAmbiguousPair(pair) ? [{ line: row }] : [],
    statementLine: row,
    counterpartLine: pair.counterpartLine ?? null,
  };
}

/** Whether any text field of a line contains the (lower-cased) query. */
function lineMatchesQuery(line, q) {
  return [line?.description, line?.partnerName, line?.referenceNo]
    .some((v) => (v || '').toLowerCase().includes(q));
}

/** A free-text query as the pair lists match it: trimmed and lower-cased ('' for none). */
function normalizedQuery(query) {
  return String(query ?? '').trim().toLowerCase();
}

/**
 * `items` ordered by the business date `dateOf` reads, then as they came (a stable sort): the order
 * of the pair views' left tables.
 *
 * @template T
 * @param {Array<T>} items
 * @param {(item: T) => string|null|undefined} dateOf
 * @returns {Array<T>}
 */
function sortByDate(items, dateOf) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => String(dateOf(a.item) ?? '').localeCompare(String(dateOf(b.item) ?? '')) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * One entry per detected pair for the panel's "Posibles rechazos" list: the `bounce`-state rows
 * grouped by `bouncePair.groupKey`, anchored on the pair's bounce row (or, when the date range cut
 * it off, on whichever row exists) and ordered as the anchors come in `lines`. A shared candidate
 * outflow never gets a row of its own: it appears inside each bounce's candidates.
 *
 * `query` (free text, already trimmed or not) keeps a pair when it matches the description, partner
 * or reference of ANY of its lines on screen or of its short counterpart objects.
 *
 * @param {Array<object>} lines the left panel's lines (after dismissals)
 * @param {{ query?: string }} [options]
 * @returns {Array<{ key: string, groupKey: string|undefined, anchor: object, group: object }>}
 */
export function buildBouncePairRows(lines, { query = '' } = {}) {
  const entries = new Map();
  (lines ?? []).forEach((line, index) => {
    if (line?.state !== BOUNCE_STATE || !line.bouncePair) return;
    const key = line.bouncePair.groupKey ?? `line-${line.id}`;
    const entry = entries.get(key);
    if (!entry) {
      entries.set(key, { key, anchor: line, index, rows: [line] });
      return;
    }
    entry.rows.push(line);
    if (line.bouncePair.role === 'bounce' && entry.anchor.bouncePair.role !== 'bounce') {
      entry.anchor = line;
      entry.index = index;
    }
  });
  const q = normalizedQuery(query);
  return [...entries.values()]
    .filter((e) => {
      if (!q) return true;
      const pair = e.anchor.bouncePair;
      const shortLines = [pair.counterpartLine, ...(pair.candidates ?? []).map((c) => c?.line)];
      return [...e.rows, ...shortLines].some((l) => lineMatchesQuery(l, q));
    })
    .sort((a, b) => a.index - b.index)
    .map(({ key, anchor }) => {
      const group = rowAsGroup(anchor);
      return {
        key,
        groupKey: anchor.bouncePair.groupKey,
        anchor,
        group,
        // The outflows this pair lists: its original, or its candidates, in the backend's order.
        outflowIds: pairOriginalLines(group).map((l) => l.id),
      };
    });
}

/**
 * The outflows of the "Posibles rechazos" view (ETP-6359): every distinct original / candidate
 * outflow of the pairs, ONCE (deduplicated by line id: a candidate shared by two rejections is one
 * entry), each with the `groupKey`s of the pairs that list it. Ordered by date, then as first seen.
 * A full `pendingLines` row of the outflow (it has the partner name) wins over the short object the
 * annotation carries.
 *
 * @param {Array<object>} lines the left panel's lines (after dismissals)
 * @param {{ query?: string }} [options] the same free-text query as {@link buildBouncePairRows}
 * @returns {Array<{ line: object, pairKeys: Array<string|undefined> }>}
 */
export function buildBounceOutflows(lines, { query = '' } = {}) {
  const fullById = new Map();
  for (const l of lines ?? []) {
    if (l?.state === BOUNCE_STATE && l.bouncePair && l.bouncePair.role !== 'bounce') fullById.set(l.id, l);
  }
  const byId = new Map();
  for (const entry of buildBouncePairRows(lines, { query })) {
    for (const short of pairOriginalLines(entry.group)) {
      const found = byId.get(short.id);
      if (found) {
        found.pairKeys.push(entry.groupKey);
      } else {
        byId.set(short.id, { line: fullById.get(short.id) ?? short, pairKeys: [entry.groupKey] });
      }
    }
  }
  return sortByDate([...byId.values()], (e) => e.line.date);
}

/**
 * How many detected pairs the lines hold: the figure "Posibles rechazos" shows in the status filter
 * (the backend's `counts.bounce` counts LINES, three or more per pair).
 *
 * @param {Array<object>} lines
 * @returns {number}
 */
export function countBouncePairs(lines) {
  return buildBouncePairRows(lines).length;
}

/**
 * Whether `line` is the OUTFLOW (the original) of the discarded pair it forms with `other`
 * (ETP-6359). A discard stores no role, both lines just point at each other, so the roles are read
 * the way the server decides them when it discards (`BankBouncePairService`): the EARLIER line is
 * the original; on the same day (or with a date missing) the outgoing line, i.e. the lower amount,
 * the detector's own fallback (`BankBounceDetector.originalFirstOnSameDay`). A full tie keeps
 * `line`.
 *
 * @param {object} line a discarded line
 * @param {object} other the line it was discarded with
 * @returns {boolean}
 */
export function isDiscardedOutflow(line, other) {
  const days = daysBetween(line?.date, other?.date);
  if (days != null && days !== 0) return days > 0;
  return (Number(line?.amount) || 0) <= (Number(other?.amount) || 0);
}

/**
 * The line `line` was discarded with, when it is among `byId` and still free AND points back at
 * `line` (what "Restaurar par" needs to restore both, see {@link discardedModel}); else null.
 */
function mutualDiscardPartner(line, byId, taken) {
  const partner = byId.get(line.bounceLink?.counterpartLineId);
  if (!partner || partner === line || taken.has(partner.id)) return null;
  return pointsBack(partner, line) ? partner : null;
}

/**
 * One entry per discarded pair for the panel's "Descartadas" view (ETP-6359), the twin of
 * {@link buildBouncePairRows}: the `discarded` rows grouped with the line each was discarded with
 * when both point at each other (`bounceLink.counterpartLineId`), anchored on the pair's OUTFLOW
 * ({@link isDiscardedOutflow}) with the rejection as `counterpart`.
 *
 * A line with no partner on screen is an entry of its own (`counterpart: null`), never dropped, so
 * it can still be selected and restored: one discarded on its own in Classic (`bounceLink: null`),
 * one whose partner is outside the date range, or a one-sided link (legacy data).
 *
 * `query` keeps an entry when the description, partner or reference of EITHER line matches. The
 * entries are ordered by the anchor's date, then as their first line came in `lines`.
 *
 * @param {Array<object>} lines the left panel's lines (the `status=discarded` answer)
 * @param {{ query?: string }} [options]
 * @returns {Array<{ key: string, anchor: object, counterpart: object|null }>}
 */
export function buildDiscardedPairRows(lines, { query = '' } = {}) {
  const discarded = (lines ?? []).filter((l) => l?.state === DISCARDED_STATE);
  const byId = new Map(discarded.map((l) => [l.id, l]));
  const taken = new Set();
  const entries = [];
  for (const line of discarded) {
    if (taken.has(line.id)) continue;
    taken.add(line.id);
    const partner = mutualDiscardPartner(line, byId, taken);
    if (partner) taken.add(partner.id);
    const lineFirst = !partner || isDiscardedOutflow(line, partner);
    const anchor = lineFirst ? line : partner;
    entries.push({ key: anchor.id, anchor, counterpart: lineFirst ? partner : line });
  }
  const q = normalizedQuery(query);
  const shown = q
    ? entries.filter((e) => lineMatchesQuery(e.anchor, q) || lineMatchesQuery(e.counterpart, q))
    : entries;
  return sortByDate(shown, (e) => e.anchor.date);
}


/** Days two lines of a pair may be apart (the backend's `BankBounceDetector.WINDOW_DAYS`). */
export const BOUNCE_WINDOW_DAYS = 60;

/**
 * Whether an outflow can be paired with a rejection, as the backend's `discardPair` validates it:
 * opposite sign and EXACTLY the same amount (non-zero), and the two lines at most
 * {@link BOUNCE_WINDOW_DAYS} days apart IN EITHER DIRECTION (the server decides which line is the
 * original by DATE and stores the roles that way, so an outflow dated after the rejection is
 * accepted too; else 409 `SIGN_MISMATCH`, `AMOUNT_MISMATCH` or `DISCARD_NOT_ALLOWED`). A missing
 * date is not held against the pair. The server decides in the end (a registered payment is only
 * known there); this only keeps the panel from offering what is certain to be refused.
 *
 * @param {object|null} outflow an outflow line (`amount`, `date`)
 * @param {object|null} bounce the rejection line
 * @returns {boolean}
 */
export function canPairOutflow(outflow, bounce) {
  if (!outflow || !bounce) return false;
  const a = decimalParts(outflow.amount);
  const b = decimalParts(bounce.amount);
  if (!a || !b || a.abs === '0' || a.neg === b.neg || a.abs !== b.abs) return false;
  const days = daysBetween(outflow.date, bounce.date);
  return days == null || Math.abs(days) <= BOUNCE_WINDOW_DAYS;
}

/**
 * A digit string without its trailing zeros ('500' -> '5', '000' -> ''). An index scan rather than
 * a `/0+$/` replace, which backtracks super-linearly on a long run of zeros not at the end.
 *
 * @param {string} digits
 * @returns {string}
 */
function withoutTrailingZeros(digits) {
  let end = digits.length;
  while (end > 0 && digits[end - 1] === '0') end -= 1;
  return digits.slice(0, end);
}

/**
 * A decimal amount (number or numeric string) as its sign and canonical absolute digits, so two
 * amounts compare EXACTLY and symmetrically, like the server's BigDecimal compare (no scaling by
 * 100 and rounding, which is asymmetric for negatives: -1.005 vs 1.005). A number is read through
 * 15 significant digits, so a float artifact (0.30000000000000004) equals 0.3.
 *
 * @param {number|string|null|undefined} value
 * @returns {{ neg: boolean, abs: string }|null} null when it is not a finite decimal
 */
function decimalParts(value) {
  if (value == null || value === '') return { neg: false, abs: '0' };
  // A number goes through 15 significant digits (the precision of a double that survives JSON), so
  // a float artifact (0.1 + 0.2) reads as the decimal it was meant to be; a string is taken as is.
  let text = typeof value === 'string' ? value.trim() : Number(value).toPrecision(15);
  if (/e/i.test(text)) text = Number(text).toFixed(12);
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[2] === '' && !m[3])) return null;
  const int = m[2].replace(/^0+/, '') || '0';
  const frac = withoutTrailingZeros(m[3] ?? '');
  const abs = frac ? `${int}.${frac}` : int;
  return { neg: m[1] === '-' && abs !== '0', abs };
}
