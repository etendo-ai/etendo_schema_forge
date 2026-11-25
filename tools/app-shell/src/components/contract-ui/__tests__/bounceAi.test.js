// @covers tools/app-shell/src/components/contract-ui/bounceAi.js
/**
 * Unit tests for `bounceAi.js` — the pure helpers of the AI second layer of the bank-rejection
 * suggestions. The autoMatch answer may carry `bounceAiAssessments`; every helper degrades to
 * "no AI" (null / the options untouched) when it is missing.
 *
 * node:test on purpose: the module is plain `.js`, same arrangement as `bouncePairs.test.js`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiAssessmentFor,
  aiPercent,
  aiNoneWins,
  visibleAiPercent,
  sortOptionsByAi,
  aiDefaultChoice,
  isAiStaleError,
  CHOICE_SOURCE_AI,
  CHOICE_SOURCE_USER,
  AI_STALE_CODE,
  AI_STALE_MESSAGE_KEY,
} from '../bounceAi.js';

const A = { id: 'L-OUT-A' };
const B = { id: 'L-OUT-B' };
const C = { id: 'L-OUT-C' };
const ASSESSMENT = { probabilities: { 'L-OUT-A': 10, 'L-OUT-B': 85 }, none: 5, recommendedLineId: 'L-OUT-B' };

describe('aiAssessmentFor', () => {
  it('answers the assessment of the bounce line', () => {
    assert.equal(aiAssessmentFor({ 'L-IN': ASSESSMENT }, 'L-IN'), ASSESSMENT);
  });

  it('answers null for missing, empty or malformed assessments', () => {
    assert.equal(aiAssessmentFor(null, 'L-IN'), null);
    assert.equal(aiAssessmentFor(undefined, 'L-IN'), null);
    assert.equal(aiAssessmentFor({}, 'L-IN'), null);
    assert.equal(aiAssessmentFor({ 'L-IN': ASSESSMENT }, null), null);
    assert.equal(aiAssessmentFor({ 'L-IN': ASSESSMENT }, 'other'), null);
    assert.equal(aiAssessmentFor({ 'L-IN': {} }, 'L-IN'), null);
    assert.equal(aiAssessmentFor({ 'L-IN': 'x' }, 'L-IN'), null);
  });
});

describe('aiPercent', () => {
  it('answers the integer rated for a line', () => {
    assert.equal(aiPercent(ASSESSMENT, 'L-OUT-B'), 85);
    assert.equal(aiPercent({ probabilities: { x: 0 } }, 'x'), 0);
  });

  it('accepts a numeric string', () => {
    assert.equal(aiPercent({ probabilities: { x: '60' } }, 'x'), 60);
  });

  it('answers null when the line is not rated or there is no assessment', () => {
    assert.equal(aiPercent(ASSESSMENT, 'L-OUT-C'), null);
    assert.equal(aiPercent(ASSESSMENT, null), null);
    assert.equal(aiPercent(null, 'L-OUT-B'), null);
    assert.equal(aiPercent({}, 'L-OUT-B'), null);
    assert.equal(aiPercent({ probabilities: { x: 'abc' } }, 'x'), null);
  });
});

describe('aiNoneWins / visibleAiPercent (one rule for the modal and the panel)', () => {
  const none = (n, probabilities = { 'L-OUT-A': 49, 'L-OUT-B': 10 }) => ({ probabilities, none: n });
  it('is true only when none is strictly greater than the best candidate', () => {
    assert.equal(aiNoneWins(none(50)), true);
    assert.equal(aiNoneWins(none(49)), false);
    assert.equal(aiNoneWins(none(10)), false);
  });
  it('is false without `none`, without candidates or without an assessment', () => {
    assert.equal(aiNoneWins({ probabilities: { 'L-OUT-A': 10 } }), false);
    assert.equal(aiNoneWins({ probabilities: {}, none: 90 }), false);
    assert.equal(aiNoneWins(null), false);
  });
  it('hides every candidate percentage when none wins and shows them otherwise', () => {
    assert.equal(visibleAiPercent(none(50), 'L-OUT-A'), null);
    assert.equal(visibleAiPercent(none(50), 'L-OUT-B'), null);
    assert.equal(visibleAiPercent(none(5), 'L-OUT-A'), 49);
    assert.equal(visibleAiPercent({ probabilities: { 'L-OUT-A': 49 } }, 'L-OUT-A'), 49);
  });
});

describe('sortOptionsByAi', () => {
  it('orders by descending percentage', () => {
    assert.deepEqual(sortOptionsByAi([A, B], ASSESSMENT), [B, A]);
  });

  it('is stable: ties keep the backend order', () => {
    const tied = { probabilities: { 'L-OUT-A': 40, 'L-OUT-B': 40, 'L-OUT-C': 20 } };
    assert.deepEqual(sortOptionsByAi([A, B, C], tied), [A, B, C]);
    assert.deepEqual(sortOptionsByAi([B, A, C], tied), [B, A, C]);
  });

  it('puts unrated options last, in their original order', () => {
    assert.deepEqual(sortOptionsByAi([C, A, B], ASSESSMENT), [B, A, C]);
    assert.deepEqual(sortOptionsByAi([C, B, A], { probabilities: { 'L-OUT-A': 10 } }), [A, C, B]);
  });

  it('does not mutate the input', () => {
    const input = [A, B];
    sortOptionsByAi(input, ASSESSMENT);
    assert.deepEqual(input, [A, B]);
  });

  it('returns the very same array without an assessment or with fewer than two options', () => {
    const input = [A, B];
    assert.equal(sortOptionsByAi(input, null), input);
    assert.equal(sortOptionsByAi(input, undefined), input);
    const one = [A];
    assert.equal(sortOptionsByAi(one, ASSESSMENT), one);
    assert.equal(sortOptionsByAi(null, ASSESSMENT), null);
  });

  it('also sorts bare ids', () => {
    assert.deepEqual(sortOptionsByAi(['L-OUT-A', 'L-OUT-B'], ASSESSMENT), ['L-OUT-B', 'L-OUT-A']);
  });
});

describe('aiDefaultChoice', () => {
  it('answers the recommended id when it is among the shown options', () => {
    assert.equal(aiDefaultChoice(ASSESSMENT, [A, B]), 'L-OUT-B');
    assert.equal(aiDefaultChoice(ASSESSMENT, ['L-OUT-A', 'L-OUT-B']), 'L-OUT-B');
  });

  it('answers null when the recommendation is not among the shown options', () => {
    assert.equal(aiDefaultChoice(ASSESSMENT, [A, C]), null);
    assert.equal(aiDefaultChoice(ASSESSMENT, []), null);
  });

  it('answers null without a recommendation or an assessment', () => {
    assert.equal(aiDefaultChoice({ ...ASSESSMENT, recommendedLineId: null }, [A, B]), null);
    assert.equal(aiDefaultChoice({ probabilities: {} }, [A, B]), null);
    assert.equal(aiDefaultChoice(null, [A, B]), null);
    assert.equal(aiDefaultChoice(undefined, [A, B]), null);
    assert.equal(aiDefaultChoice(ASSESSMENT, null), null);
  });
});

describe('isAiStaleError', () => {
  it('matches the short code on the error or its body', () => {
    assert.equal(isAiStaleError({ code: AI_STALE_CODE }), true);
    assert.equal(isAiStaleError({ body: { code: AI_STALE_CODE } }), true);
  });

  it('matches the message key in the messageKeys of the body, wherever the envelope puts them', () => {
    assert.equal(isAiStaleError({ body: { messageKeys: [AI_STALE_MESSAGE_KEY] } }), true);
    assert.equal(isAiStaleError({ body: { response: { messageKeys: ['x', AI_STALE_MESSAGE_KEY] } } }), true);
    assert.equal(isAiStaleError({ body: { error: { messageKeys: [AI_STALE_MESSAGE_KEY] } } }), true);
  });

  it('does not match other refusals or no error', () => {
    assert.equal(isAiStaleError(null), false);
    assert.equal(isAiStaleError(undefined), false);
    assert.equal(isAiStaleError({}), false);
    assert.equal(isAiStaleError({ code: 'BOUNCE_LINE_NOT_PENDING' }), false);
    assert.equal(isAiStaleError({ body: { messageKeys: ['ETGO_BounceLineNotPending'] } }), false);
    assert.equal(isAiStaleError({ body: { messageKeys: 'ETGO_BounceAiSuggestionStale' } }), false);
  });
});

describe('constants', () => {
  it('exposes the discardPair choiceSource values and the stale wire names', () => {
    assert.equal(CHOICE_SOURCE_AI, 'ai');
    assert.equal(CHOICE_SOURCE_USER, 'user');
    assert.equal(AI_STALE_CODE, 'BOUNCE_AI_SUGGESTION_STALE');
    assert.equal(AI_STALE_MESSAGE_KEY, 'ETGO_BounceAiSuggestionStale');
  });
});
