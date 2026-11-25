/**
 * Pure helpers of the AI second layer of the bounce suggestions (ETP-6359).
 *
 * The backend (com.etendoerp.go, behind the existing backend-only flag `bank-bounce-suggestions`) may add a top-level
 * `bounceAiAssessments` to the `autoMatch` answer:
 *
 *   { "<bounceLineId>": { probabilities: { "<outflowLineId>": 0-100 }, none: 0-100,
 *                         recommendedLineId: "<outflowLineId>" | null } }
 *
 * The field is ABSENT when there is no AI (flag off, failure, MCP, nothing to review), and every
 * helper here degrades to "no AI": null / the options untouched. The SPA never changes which pairs
 * exist, their `groupKey`, their confidence or the order of `candidates[]`; it only sorts for
 * DISPLAY and shows the percentages.
 *
 * Plain `.js` (no JSX, relative imports only) so node:test can import it.
 */

/** The id of an option, which may be a line object or a bare id. */
function optionId(option) {
  return option != null && typeof option === 'object' ? option.id : option;
}

/**
 * The assessment of one bounce line, or null when there is none.
 *
 * @param {Record<string, object>|null|undefined} assessments the answer's `bounceAiAssessments`
 * @param {string|null|undefined} bounceId the bounce line id
 * @returns {{ probabilities: Record<string, number>, none?: number,
 *   recommendedLineId?: string|null }|null}
 */
export function aiAssessmentFor(assessments, bounceId) {
  if (!assessments || bounceId == null) return null;
  const found = assessments[bounceId];
  return found && typeof found === 'object' && found.probabilities ? found : null;
}

/**
 * The probability (an integer 0-100) the assessment gives an outgoing line, or null when the
 * assessment is missing or does not rate that line.
 *
 * @param {object|null|undefined} assessment
 * @param {string|null|undefined} lineId
 * @returns {number|null}
 */
export function aiPercent(assessment, lineId) {
  const raw = lineId == null ? undefined : assessment?.probabilities?.[lineId];
  const value = typeof raw === 'string' ? Number(raw) : raw;
  return Number.isFinite(value) ? value : null;
}

/**
 * The options ordered by descending probability. Stable: equal (or unrated) options keep the order
 * the backend sent, and the same array comes back when there is no assessment.
 *
 * @param {Array<object|string>} options lines (with `id`) or bare ids
 * @param {object|null|undefined} assessment
 * @returns {Array<object|string>}
 */
export function sortOptionsByAi(options, assessment) {
  if (!assessment || !Array.isArray(options) || options.length < 2) return options;
  return options
    .map((option, index) => ({ option, index, pct: aiPercent(assessment, optionId(option)) ?? -1 }))
    .sort((a, b) => b.pct - a.pct || a.index - b.index)
    .map(({ option }) => option);
}

/**
 * The line the AI recommends, only when it is among the options actually shown; otherwise null.
 * It is a derived default, never stored state: the caller prefers an explicit pick over it.
 *
 * @param {object|null|undefined} assessment
 * @param {Array<object|string>} options
 * @returns {string|null}
 */
export function aiDefaultChoice(assessment, options) {
  const id = assessment?.recommendedLineId;
  if (id == null || !Array.isArray(options)) return null;
  return options.some((o) => optionId(o) === id) ? id : null;
}

/** `discardPair` `choiceSource` of a discard that follows the AI's preselection. */
export const CHOICE_SOURCE_AI = 'ai';
/** `discardPair` `choiceSource` of a discard whose original the user picked explicitly. */
export const CHOICE_SOURCE_USER = 'user';
/**
 * Coded refusal (409) of `discardPair` when an AI-sourced choice no longer matches the backend's
 * cached recommendation: the short `code` and the AD_MESSAGE key in `messageKeys`, like every
 * `ETGO_Bounce*` refusal (com.etendoerp.go docs/neo-headless.md §4.12.1.1).
 */
export const AI_STALE_CODE = 'BOUNCE_AI_SUGGESTION_STALE';
export const AI_STALE_MESSAGE_KEY = 'ETGO_BounceAiSuggestionStale';

/**
 * Whether a failed `discardPair` is the "AI suggestion is stale" refusal.
 *
 * @param {Error & { code?: string|null, body?: object|null }|null|undefined} err
 * @returns {boolean}
 */
export function isAiStaleError(err) {
  if (!err) return false;
  if (err.code === AI_STALE_CODE || err.body?.code === AI_STALE_CODE) return true;
  const body = err.body;
  const keys = body?.messageKeys ?? body?.response?.messageKeys ?? body?.error?.messageKeys;
  return Array.isArray(keys) && keys.includes(AI_STALE_MESSAGE_KEY);
}
