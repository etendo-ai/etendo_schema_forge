// @covers tools/app-shell/src/components/contract-ui/bouncePairs.js
/**
 * Unit tests for `bouncePairs.js` — the pure logic of the bank reconciliation bounce pairs
 * ("rechazos" bancarios in the UI). The backend detects them behind the `bank-bounce-suggestions` flag; this module only
 * reads what it answers (autoMatch groups with `kind: "bouncePair"`, `pendingLines` rows in the
 * `bounce` state with a `bouncePair` annotation, and the `status=discarded` rows with their
 * `bounceLink`). Contract: com.etendoerp.go docs/neo-headless.md §4.12.1.1.
 *
 * node:test on purpose: the module is plain `.js` so this runner can import it, same arrangement
 * as `reconciliationStatusFilter.test.js`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BOUNCE_PAIR_KIND,
  BOUNCE_STATE,
  DISCARDED_STATE,
  HIGH_CONFIDENCE,
  isBouncePairGroup,
  splitAutoMatchGroups,
  isAmbiguousPair,
  isSelectableGroup,
  defaultGroupChecked,
  bouncePairPayload,
  pairOriginalLines,
  daysBetween,
  bounceReason,
  pairNet,
  pendingLinesStatusParam,
  isBounceReviewLine,
  withDismissedPairs,
  countsWithDismissedPairs,
  bouncePanelModel,
  summarizeApplyResults,
  BOUNCE_DECISIONS_KEY,
  BOUNCE_DECISION,
  bounceDecisions,
  withBounceDecisions,
  dismissPairPayload,
  canPairOutflow,
  rowAsGroup,
  shownOutflow,
  pairOutflowPreference,
  pairChoiceSource,
  effectivePairPick,
  resolvePairOutflows,
  isLineNotPendingResult,
  LINE_NOT_PENDING_CODE,
  buildBouncePairRows,
  buildBounceOutflows,
  countBouncePairs,
  buildDiscardedPairRows,
  isDiscardedOutflow,
} from '../bouncePairs.js';

const MODULE_URL = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'bouncePairs.js'),
).href;

// --- Fixtures -------------------------------------------------------------

const ORIGINAL = { id: 'L-OUT', date: '2026-03-02', amount: -120.5, description: 'Transfer to ACME' };
const BOUNCE = { id: 'L-IN', date: '2026-03-05', amount: 120.5, description: 'DEVOLUCION ACME' };
const CAND_A = { id: 'L-OUT-A', date: '2026-03-01', amount: -80 };
const CAND_B = { id: 'L-OUT-B', date: '2026-03-03', amount: -80 };

function pairGroup(overrides = {}) {
  return {
    kind: BOUNCE_PAIR_KIND,
    groupKey: 'bp-1',
    confidence: 'review',
    statementLine: ORIGINAL,
    counterpartLine: BOUNCE,
    ...overrides,
  };
}

// --- Group classification ------------------------------------------------

describe('isBouncePairGroup / splitAutoMatchGroups', () => {
  it('reads only kind:"bouncePair" as a pair; a group without kind is a transaction group', () => {
    assert.equal(isBouncePairGroup(pairGroup()), true);
    assert.equal(isBouncePairGroup({ kind: 'transaction' }), false);
    assert.equal(isBouncePairGroup({}), false);
    assert.equal(isBouncePairGroup(null), false);
    assert.equal(isBouncePairGroup(undefined), false);
  });

  it('splits groups keeping the backend order inside each kind', () => {
    const t1 = { groupKey: 't1' };
    const t2 = { groupKey: 't2', kind: 'transaction' };
    const p1 = pairGroup({ groupKey: 'p1' });
    const p2 = pairGroup({ groupKey: 'p2' });
    const out = splitAutoMatchGroups([p1, t1, p2, t2]);
    assert.deepEqual(out.transactionGroups.map((g) => g.groupKey), ['t1', 't2']);
    assert.deepEqual(out.bouncePairs.map((g) => g.groupKey), ['p1', 'p2']);
  });

  it('treats the whole flag-off answer (no kind anywhere) as transaction groups', () => {
    const groups = [{ groupKey: 'a' }, { groupKey: 'b' }];
    const out = splitAutoMatchGroups(groups);
    assert.deepEqual(out.transactionGroups, groups);
    assert.deepEqual(out.bouncePairs, []);
  });

  it('tolerates a missing or null groups array', () => {
    assert.deepEqual(splitAutoMatchGroups(), { transactionGroups: [], bouncePairs: [] });
    assert.deepEqual(splitAutoMatchGroups(null), { transactionGroups: [], bouncePairs: [] });
  });
});

describe('isAmbiguousPair / isSelectableGroup / defaultGroupChecked', () => {
  it('reads ambiguous as a boolean', () => {
    assert.equal(isAmbiguousPair({ ambiguous: true }), true);
    assert.equal(isAmbiguousPair({ ambiguous: false }), false);
    assert.equal(isAmbiguousPair(null), false);
  });

  it('lets every transaction group be selected and start checked', () => {
    assert.equal(isSelectableGroup({ groupKey: 't' }), true);
    assert.equal(defaultGroupChecked({ groupKey: 't' }), true);
  });

  it('checks a high-confidence pair that names both lines', () => {
    const g = pairGroup({ confidence: HIGH_CONFIDENCE });
    assert.equal(isSelectableGroup(g), true);
    assert.equal(defaultGroupChecked(g), true);
  });

  it('leaves a pair to review selectable but unchecked', () => {
    const g = pairGroup({ confidence: 'review' });
    assert.equal(isSelectableGroup(g), true);
    assert.equal(defaultGroupChecked(g), false);
  });

  it('lets an ambiguous pair be ticked (it shows one outflow) but never checks it by default, even when marked high', () => {
    const g = pairGroup({
      ambiguous: true, confidence: HIGH_CONFIDENCE, statementLine: null, candidates: [{ line: CAND_A }, { line: CAND_B }],
    });
    assert.equal(isSelectableGroup(g), true);
    assert.equal(defaultGroupChecked(g), false);
    assert.equal(isSelectableGroup(pairGroup({ ambiguous: true, statementLine: null, candidates: [] })), false);
    assert.equal(isSelectableGroup(pairGroup({ ambiguous: true, statementLine: null, counterpartLine: null, candidates: [{ line: CAND_A }] })), false);
  });

  it('never lets a pair missing either line id be selected', () => {
    assert.equal(isSelectableGroup(pairGroup({ statementLine: { date: '2026-03-01' } })), false);
    assert.equal(isSelectableGroup(pairGroup({ counterpartLine: null })), false);
    assert.equal(defaultGroupChecked(pairGroup({ confidence: HIGH_CONFIDENCE, counterpartLine: null })), false);
  });
});

describe('bouncePairPayload / pairOriginalLines', () => {
  it('builds the applySuggestions entry: original as statementLineId, bounce as counterpartLineId', () => {
    assert.deepEqual(bouncePairPayload(pairGroup()), {
      kind: 'bouncePair',
      statementLineId: 'L-OUT',
      counterpartLineId: 'L-IN',
    });
  });

  it('offers the original of a plain pair', () => {
    assert.deepEqual(pairOriginalLines(pairGroup()), [ORIGINAL]);
  });

  it('offers the candidates of an ambiguous pair, skipping empty entries', () => {
    const g = pairGroup({
      ambiguous: true,
      statementLine: null,
      candidates: [{ line: CAND_A }, null, { line: null }, { line: CAND_B }],
    });
    assert.deepEqual(pairOriginalLines(g), [CAND_A, CAND_B]);
  });

  it('offers nothing when a plain pair has no original', () => {
    assert.deepEqual(pairOriginalLines(pairGroup({ statementLine: null })), []);
    assert.deepEqual(pairOriginalLines(pairGroup({ ambiguous: true, statementLine: null })), []);
  });
});

// --- bounceDecisions / withBounceDecisions / dismissPairPayload (KPI events) --

describe('bounceDecisions / withBounceDecisions (applySuggestions KPI report)', () => {
  const A = pairGroup({ groupKey: 'a' });
  const B = pairGroup({ groupKey: 'b' });
  const C = pairGroup({ groupKey: 'c' });
  const checked = new Set(['a']);
  const isChecked = (g) => checked.has(g.groupKey);

  it('names the body key and the decisions in one place', () => {
    assert.equal(BOUNCE_DECISIONS_KEY, 'bounceDecisions');
    assert.deepEqual({ ...BOUNCE_DECISION }, { UNCHECKED: 'unchecked', SENT_TO_PANEL: 'sent_to_panel' });
  });

  it('lists every not-checked pair, sent_to_panel when it was sent there, unchecked otherwise', () => {
    assert.deepEqual(bounceDecisions([A, B, C], isChecked, new Set(['c', 'a'])), [
      { groupKey: 'b', decision: 'unchecked' },
      { groupKey: 'c', decision: 'sent_to_panel' },
    ]);
  });

  it('tolerates no sent-to-panel set, no pairs, and pairs without a groupKey', () => {
    assert.deepEqual(bounceDecisions([B], isChecked), [{ groupKey: 'b', decision: 'unchecked' }]);
    assert.deepEqual(bounceDecisions(null, isChecked), []);
    assert.deepEqual(bounceDecisions([pairGroup({ groupKey: undefined })], isChecked), []);
  });

  it('carries no line id, amount or text: only groupKey and decision', () => {
    for (const entry of bounceDecisions([B, C], isChecked)) {
      assert.deepEqual(Object.keys(entry).sort(), ['decision', 'groupKey']);
    }
  });

  it('adds the key only when pairs were shown, even if every one is applied', () => {
    const body = { financialAccountId: 'acc', groups: [] };
    assert.equal(withBounceDecisions(body, [], isChecked), body);
    assert.equal(withBounceDecisions(body, null, isChecked), body);
    assert.deepEqual(withBounceDecisions(body, [A], isChecked), { ...body, bounceDecisions: [] });
    assert.ok(!('bounceDecisions' in body), 'the original body is not mutated');
  });
});

describe('dismissPairPayload ("No es un rechazo" KPI report)', () => {
  it('sends the selected line and the other line of the pair', () => {
    assert.deepEqual(dismissPairPayload('acc', { id: 'L-IN' }, { other: { id: 'L-OUT' } }), {
      financialAccountId: 'acc', statementLineId: 'L-IN', counterpartLineId: 'L-OUT',
    });
  });

  it('omits the counterpart while none is chosen', () => {
    assert.deepEqual(dismissPairPayload('acc', { id: 'L-IN' }, { other: null }), {
      financialAccountId: 'acc', statementLineId: 'L-IN',
    });
    assert.deepEqual(dismissPairPayload('acc', { id: 'L-IN' }, null), {
      financialAccountId: 'acc', statementLineId: 'L-IN',
    });
  });

  it('answers null without a line', () => {
    assert.equal(dismissPairPayload('acc', null, { other: { id: 'x' } }), null);
    assert.equal(dismissPairPayload('acc', {}, null), null);
  });
});

// --- daysBetween ------------------------------------------------------------

describe('daysBetween', () => {
  it('counts whole days between two business dates', () => {
    assert.equal(daysBetween('2026-03-02', '2026-03-05'), 3);
    assert.equal(daysBetween('2026-03-05', '2026-03-05'), 0);
    assert.equal(daysBetween('2026-03-05', '2026-03-02'), -3);
  });

  it('reads only the date part of a timestamp', () => {
    assert.equal(daysBetween('2026-03-02T23:30:00-03:00', '2026-03-03T00:10:00Z'), 1);
  });

  it('answers null when either date is missing', () => {
    assert.equal(daysBetween(null, '2026-03-02'), null);
    assert.equal(daysBetween('2026-03-02', undefined), null);
    assert.equal(daysBetween('', ''), null);
  });

  // `new Date('2026-03-02')` is UTC midnight; under a negative offset its local day is the 1st.
  // daysBetween goes through parseCalendarDate, so the count must not depend on the host zone, and
  // Math.round must absorb the 23 h / 25 h DST days.
  const ZONES = ['UTC', 'America/Argentina/Buenos_Aires', 'Pacific/Kiritimati', 'Europe/Madrid', 'America/Los_Angeles'];
  for (const tz of ZONES) {
    it(`gives the same counts under TZ=${tz}, DST changes included`, () => {
      const script = `
        const { daysBetween } = await import(${JSON.stringify(MODULE_URL)});
        console.log(JSON.stringify([
          daysBetween('2026-03-02', '2026-03-05'),
          daysBetween('2026-03-28', '2026-03-30'),
          daysBetween('2026-10-24', '2026-10-26'),
          daysBetween('2026-03-07', '2026-03-09'),
          daysBetween('2026-11-01', '2026-11-02'),
          daysBetween('2026-12-31', '2027-01-01'),
        ]));`;
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, TZ: tz },
        encoding: 'utf8',
      });
      assert.deepEqual(JSON.parse(out.trim()), [3, 2, 2, 2, 1, 1]);
    });
  }
});

// --- bounceReason -----------------------------------------------------------

describe('bounceReason — high confidence', () => {
  const SIGNALS = [
    ['pis_link', 'financeReconcileBounceSignalPisLink'],
    ['return_text', 'financeReconcileBounceSignalReturnText'],
    ['counterparty', 'financeReconcileBounceSignalCounterparty'],
  ];
  for (const [signal, key] of SIGNALS) {
    it(`names the "${signal}" signal`, () => {
      assert.deepEqual(
        bounceReason({ confidence: 'high', signal }, ORIGINAL, BOUNCE),
        { high: true, signalKey: key },
      );
    });
  }

  it('answers a null signal key for an unknown or missing signal', () => {
    assert.deepEqual(bounceReason({ confidence: 'high', signal: 'nope' }, ORIGINAL, BOUNCE), { high: true, signalKey: null });
    assert.deepEqual(bounceReason({ confidence: 'high' }, ORIGINAL, BOUNCE), { high: true, signalKey: null });
  });

  it('never reads an ambiguous pair as high', () => {
    const r = bounceReason({ confidence: 'high', ambiguous: true, candidates: [{}, {}] }, null, BOUNCE);
    assert.equal(r.high, false);
  });
});

describe('bounceReason — review reasons', () => {
  it('ambiguous with more than one candidate: the count', () => {
    assert.deepEqual(
      bounceReason({ confidence: 'review', ambiguous: true, candidates: [{}, {}, {}] }, null, BOUNCE),
      {
        high: false,
        shortKey: 'financeReconcileBounceReasonAmbiguousShort',
        longKey: 'financeReconcileBounceReasonAmbiguous',
        params: { count: 3 },
      },
    );
  });

  it('ambiguous seen from a candidate line (no candidates on the annotation): check the original', () => {
    const r = bounceReason({ role: 'candidate', ambiguous: true }, CAND_A, BOUNCE);
    assert.deepEqual(r, {
      high: false,
      shortKey: 'financeReconcileBounceReasonCheckShort',
      longKey: 'financeReconcileBounceReasonCheck',
      params: {},
    });
  });

  it('ambiguous with a single candidate left: check the original', () => {
    const r = bounceReason({ ambiguous: true, candidates: [{ line: CAND_A }] }, CAND_A, BOUNCE);
    assert.equal(r.shortKey, 'financeReconcileBounceReasonCheckShort');
  });

  it('only the counterparty matches', () => {
    assert.deepEqual(
      bounceReason({ confidence: 'review', signals: ['counterparty'] }, ORIGINAL, BOUNCE),
      {
        high: false,
        shortKey: 'financeReconcileBounceReasonCounterpartyShort',
        longKey: 'financeReconcileBounceReasonCounterparty',
        params: {},
      },
    );
  });

  it('wording but the bounce came N days later', () => {
    assert.deepEqual(
      bounceReason({ confidence: 'review', signals: ['return_text', 'counterparty'] }, ORIGINAL, BOUNCE),
      {
        high: false,
        shortKey: 'financeReconcileBounceReasonLateShort',
        longKey: 'financeReconcileBounceReasonLate',
        params: { days: 3 },
      },
    );
  });

  it('a payment link but the bounce came N days later', () => {
    const r = bounceReason({ confidence: 'review', signals: ['pis_link'] }, ORIGINAL, { ...BOUNCE, date: '2026-03-23' });
    assert.equal(r.longKey, 'financeReconcileBounceReasonLate');
    assert.deepEqual(r.params, { days: 21 });
  });

  it('a strong signal on the same day falls back to check', () => {
    const r = bounceReason({ confidence: 'review', signals: ['pis_link'] }, ORIGINAL, { ...BOUNCE, date: ORIGINAL.date });
    assert.equal(r.longKey, 'financeReconcileBounceReasonCheck');
  });

  it('a strong signal with an unknown original date falls back to check', () => {
    const r = bounceReason({ confidence: 'review', signals: ['return_text'] }, null, BOUNCE);
    assert.equal(r.longKey, 'financeReconcileBounceReasonCheck');
  });

  it('no signals at all: check', () => {
    assert.equal(bounceReason({ confidence: 'review' }, ORIGINAL, BOUNCE).longKey, 'financeReconcileBounceReasonCheck');
    assert.equal(bounceReason({ signals: 'pis_link' }, ORIGINAL, BOUNCE).longKey, 'financeReconcileBounceReasonCheck');
    assert.equal(bounceReason(null, null, null).longKey, 'financeReconcileBounceReasonCheck');
  });
});

// --- pairNet / pendingLinesStatusParam / isBounceReviewLine -------------------

describe('pairNet', () => {
  it('sums the two signed amounts rounded to cents (0 for a real bounce)', () => {
    assert.equal(pairNet(ORIGINAL, BOUNCE), 0);
    assert.equal(pairNet({ amount: '-10.10' }, { amount: '10.3' }), 0.2);
  });

  it('answers null when a line or an amount is missing', () => {
    assert.equal(pairNet(ORIGINAL, null), null);
    assert.equal(pairNet(null, BOUNCE), null);
    assert.equal(pairNet({ amount: null }, BOUNCE), null);
  });
});

describe('pendingLinesStatusParam', () => {
  it('asks for status=discarded only under the discarded filter', () => {
    assert.equal(pendingLinesStatusParam(DISCARDED_STATE), 'discarded');
  });

  it('sends nothing for every other filter (client-side over the default answer)', () => {
    for (const s of ['pending', 'suggested', 'byRule', 'difference', 'bounce', 'reconciled', '', null, undefined]) {
      assert.equal(pendingLinesStatusParam(s), undefined, String(s));
    }
  });
});

describe('isBounceReviewLine', () => {
  it('is true for a discarded line and for a bounce line with its annotation', () => {
    assert.equal(isBounceReviewLine({ state: DISCARDED_STATE }), true);
    assert.equal(isBounceReviewLine({ state: BOUNCE_STATE, bouncePair: { role: 'bounce' } }), true);
  });

  it('is false for a bounce state without annotation, other states, and no line', () => {
    assert.equal(isBounceReviewLine({ state: BOUNCE_STATE }), false);
    assert.equal(isBounceReviewLine({ state: 'pending', bouncePair: { role: 'bounce' } }), false);
    assert.equal(isBounceReviewLine(null), false);
  });
});

// --- Dismissal --------------------------------------------------------------

describe('withDismissedPairs / countsWithDismissedPairs', () => {
  const lines = [
    { id: 'A', state: BOUNCE_STATE, bouncePair: { groupKey: 'g1', role: 'original' } },
    { id: 'B', state: BOUNCE_STATE, bouncePair: { groupKey: 'g1', role: 'bounce' } },
    { id: 'C', state: BOUNCE_STATE, bouncePair: { groupKey: 'g2', role: 'bounce' } },
    { id: 'D', state: 'suggested' },
  ];
  const counts = { all: 4, pending: 1, suggested: 1, bounce: 3 };

  it('turns every line of a dismissed pair back into a plain pending line', () => {
    const out = withDismissedPairs(lines, new Set(['g1']));
    assert.deepEqual(out[0], { id: 'A', state: 'pending' });
    assert.deepEqual(out[1], { id: 'B', state: 'pending' });
    assert.equal(out[2], lines[2]);
    assert.equal(out[3], lines[3]);
    assert.equal(lines[0].state, BOUNCE_STATE, 'the input is not mutated');
  });

  it('returns the same array when nothing is dismissed or nothing matches', () => {
    assert.equal(withDismissedPairs(lines, new Set()), lines);
    assert.equal(withDismissedPairs(lines, null), lines);
    assert.equal(withDismissedPairs(lines, new Set(['other'])), lines);
  });

  it('ignores a non-bounce line that still carries the dismissed key', () => {
    const odd = [{ id: 'X', state: 'pending', bouncePair: { groupKey: 'g1' } }];
    assert.equal(withDismissedPairs(odd, new Set(['g1'])), odd);
  });

  it('moves the dismissed lines from bounce to pending; all is unchanged', () => {
    assert.deepEqual(countsWithDismissedPairs(counts, lines, new Set(['g1'])), {
      all: 4, pending: 3, suggested: 1, bounce: 1,
    });
  });

  it('never lets bounce go negative', () => {
    assert.equal(countsWithDismissedPairs({ bounce: 1, pending: 0 }, lines, new Set(['g1'])).bounce, 0);
  });

  it('returns the same counts object when nothing changes', () => {
    assert.equal(countsWithDismissedPairs(counts, lines, new Set()), counts);
    assert.equal(countsWithDismissedPairs(counts, lines, new Set(['other'])), counts);
    const flagOff = { all: 1, pending: 1 };
    assert.equal(countsWithDismissedPairs(flagOff, lines, new Set(['g1'])), flagOff);
  });
});

// --- bouncePanelModel ---------------------------------------------------------

describe('bouncePanelModel — lines of a detected pair', () => {
  it('answers null for no line, a plain line, or a bounce line without annotation', () => {
    assert.equal(bouncePanelModel(null), null);
    assert.equal(bouncePanelModel({ id: 'X', state: 'pending' }), null);
    assert.equal(bouncePanelModel({ id: 'X', state: BOUNCE_STATE }), null);
  });

  it('original role: lists the bounce line, the selected line is the original', () => {
    const line = { ...ORIGINAL, state: BOUNCE_STATE,
      bouncePair: { role: 'original', groupKey: 'g1', confidence: 'high', signal: 'pis_link', counterpartLine: BOUNCE } };
    const m = bouncePanelModel(line);
    assert.equal(m.mode, BOUNCE_STATE);
    assert.equal(m.role, 'original');
    assert.deepEqual(m.rows, [BOUNCE]);
    assert.equal(m.rowBadge, 'bounce');
    assert.equal(m.selectable, false);
    assert.equal(m.chosenId, 'L-IN');
    assert.equal(m.other, BOUNCE);
    assert.deepEqual(m.reason, { high: true, signalKey: 'financeReconcileBounceSignalPisLink' });
    assert.deepEqual(m.discard, { statementLineId: 'L-OUT', counterpartLineId: 'L-IN' });
    assert.equal(m.net, 0);
  });

  it('candidate role: the bounce is the counterpart, the candidate the original, reason check', () => {
    const line = { ...CAND_A, state: BOUNCE_STATE,
      bouncePair: { role: 'candidate', groupKey: 'g2', ambiguous: true, counterpartLine: { id: 'L-IN2', date: '2026-03-04', amount: 80 } } };
    const m = bouncePanelModel(line);
    assert.equal(m.role, 'candidate');
    assert.deepEqual(m.discard, { statementLineId: 'L-OUT-A', counterpartLineId: 'L-IN2' });
    assert.equal(m.reason.longKey, 'financeReconcileBounceReasonCheck');
    assert.equal(m.net, 0);
  });

  it('original role without a counterpart: no rows, nothing to discard', () => {
    const m = bouncePanelModel({ ...ORIGINAL, state: BOUNCE_STATE, bouncePair: { role: 'original' } });
    assert.deepEqual(m.rows, []);
    assert.equal(m.discard, null);
    assert.equal(m.chosenId, null);
    assert.equal(m.net, null);
  });

  it('bounce role, plain pair: lists the original, already chosen', () => {
    const line = { ...BOUNCE, state: BOUNCE_STATE,
      bouncePair: { role: 'bounce', confidence: 'review', signals: ['return_text'], counterpartLine: ORIGINAL } };
    const m = bouncePanelModel(line);
    assert.equal(m.role, 'bounce');
    assert.deepEqual(m.rows, [ORIGINAL]);
    assert.equal(m.rowBadge, 'bounceOriginal');
    assert.equal(m.selectable, false);
    assert.equal(m.chosenId, 'L-OUT');
    assert.deepEqual(m.discard, { statementLineId: 'L-OUT', counterpartLineId: 'L-IN' });
    assert.deepEqual(m.reason.params, { days: 3 });
    assert.equal(m.net, 0);
  });

  it('bounce role, ambiguous pair: radio rows, nothing preselected, nothing to discard yet', () => {
    const line = { id: 'L-IN3', date: '2026-03-04', amount: 80, state: BOUNCE_STATE,
      bouncePair: { role: 'bounce', ambiguous: true, candidates: [{ line: CAND_A }, { line: CAND_B }] } };
    const m = bouncePanelModel(line);
    assert.deepEqual(m.rows, [CAND_A, CAND_B]);
    assert.equal(m.selectable, true);
    assert.equal(m.chosenId, null);
    assert.equal(m.other, null);
    assert.equal(m.discard, null);
    assert.deepEqual(m.reason.params, { count: 2 });
    assert.equal(m.net, null);
  });

  it('bounce role, ambiguous pair, original chosen: the discard body names it', () => {
    const line = { id: 'L-IN3', date: '2026-03-04', amount: 80, state: BOUNCE_STATE,
      bouncePair: { role: 'bounce', ambiguous: true, candidates: [{ line: CAND_A }, { line: CAND_B }] } };
    const m = bouncePanelModel(line, { chosenOriginalId: 'L-OUT-B' });
    assert.equal(m.chosenId, 'L-OUT-B');
    assert.equal(m.other, CAND_B);
    assert.deepEqual(m.discard, { statementLineId: 'L-OUT-B', counterpartLineId: 'L-IN3' });
    assert.equal(m.net, 0);
  });

  it('bounce role, ambiguous pair, an unknown chosen id is ignored', () => {
    const line = { id: 'L-IN3', state: BOUNCE_STATE,
      bouncePair: { role: 'bounce', ambiguous: true, candidates: [{ line: CAND_A }] } };
    assert.equal(bouncePanelModel(line, { chosenOriginalId: 'nope' }).discard, null);
  });
});

describe('bouncePanelModel — two ambiguous pairs sharing a candidate', () => {
  // Both offered (neo-headless.md §4.12.1.1): L-IN3 over [A, B] and L-IN4 over [B, C], sharing B.
  const CAND_C = { id: 'L-OUT-C', date: '2026-03-03', amount: -80 };
  const first = { id: 'L-IN3', date: '2026-03-04', amount: 80, state: BOUNCE_STATE,
    bouncePair: { groupKey: 'g-a', role: 'bounce', ambiguous: true, candidates: [{ line: CAND_A }, { line: CAND_B }] } };
  const second = { id: 'L-IN4', date: '2026-03-05', amount: 80, state: BOUNCE_STATE,
    bouncePair: { groupKey: 'g-b', role: 'bounce', ambiguous: true, candidates: [{ line: CAND_B }, { line: CAND_C }] } };

  it('lists each pair with its own two candidates and a "2 salidas posibles" reason', () => {
    const a = bouncePanelModel(first);
    const b = bouncePanelModel(second);
    assert.deepEqual(a.rows, [CAND_A, CAND_B]);
    assert.deepEqual(b.rows, [CAND_B, CAND_C]);
    assert.equal(a.reason.shortKey, 'financeReconcileBounceReasonAmbiguousShort');
    assert.deepEqual(a.reason.params, { count: 2 });
    assert.deepEqual(b.reason.params, { count: 2 });
  });

  it('choosing the shared candidate discards it against the bounce of the pair it was chosen in', () => {
    assert.deepEqual(bouncePanelModel(first, { chosenOriginalId: 'L-OUT-B' }).discard,
      { statementLineId: 'L-OUT-B', counterpartLineId: 'L-IN3' });
    assert.deepEqual(bouncePanelModel(second, { chosenOriginalId: 'L-OUT-B' }).discard,
      { statementLineId: 'L-OUT-B', counterpartLineId: 'L-IN4' });
    // A candidate of the other pair only is not an option here.
    assert.equal(bouncePanelModel(second, { chosenOriginalId: 'L-OUT-A' }).discard, null);
  });
});

describe('bouncePanelModel — AI second layer (bounceAiAssessments)', () => {
  const line = { id: 'L-IN3', date: '2026-03-04', amount: 80, state: BOUNCE_STATE,
    bouncePair: { role: 'bounce', ambiguous: true, candidates: [{ line: CAND_A }, { line: CAND_B }] } };
  const ai = { 'L-IN3': { probabilities: { 'L-OUT-A': 10, 'L-OUT-B': 85 }, none: 5, recommendedLineId: 'L-OUT-B' } };
  const aiKeys = ['percents', 'aiRecommendedId', 'aiPreselected', 'aiPercent'];

  it('sorts the options by percentage and preselects the recommendation, flagged and derived', () => {
    const m = bouncePanelModel(line, { aiAssessments: ai });
    assert.deepEqual(m.rows, [CAND_B, CAND_A]);
    assert.equal(m.chosenId, 'L-OUT-B');
    assert.equal(m.aiPreselected, true);
    assert.equal(m.aiPercent, 85);
    assert.equal(m.aiRecommendedId, 'L-OUT-B');
    assert.deepEqual(m.percents, { 'L-OUT-B': 85, 'L-OUT-A': 10 });
    assert.deepEqual(m.discard, { statementLineId: 'L-OUT-B', counterpartLineId: 'L-IN3' });
  });

  it('lets an explicit pick override the AI default, which then stops standing', () => {
    const m = bouncePanelModel(line, { aiAssessments: ai, chosenOriginalId: 'L-OUT-A' });
    assert.equal(m.chosenId, 'L-OUT-A');
    assert.equal(m.aiPreselected, false);
    assert.equal(m.aiPercent, null);
    assert.equal(m.aiRecommendedId, 'L-OUT-B');
    assert.deepEqual(m.discard, { statementLineId: 'L-OUT-A', counterpartLineId: 'L-IN3' });
  });

  it('keeps nothing preselected when there is no recommendation (60/40), but still shows the percentages', () => {
    const tied = { 'L-IN3': { probabilities: { 'L-OUT-A': 40, 'L-OUT-B': 60 }, none: 0, recommendedLineId: null } };
    const m = bouncePanelModel(line, { aiAssessments: tied });
    assert.deepEqual(m.rows, [CAND_B, CAND_A]);
    assert.equal(m.chosenId, null);
    assert.equal(m.discard, null);
    assert.equal(m.aiPreselected, false);
    assert.equal(m.aiRecommendedId, null);
    assert.deepEqual(m.percents, { 'L-OUT-B': 60, 'L-OUT-A': 40 });
  });

  it('does not preselect a recommendation that is not among the shown options', () => {
    const stray = { 'L-IN3': { probabilities: { 'L-OUT-A': 10, 'L-OUT-B': 85 }, recommendedLineId: 'L-OUT-ZZZ' } };
    const m = bouncePanelModel(line, { aiAssessments: stray });
    assert.equal(m.chosenId, null);
    assert.equal(m.discard, null);
    assert.equal(m.aiPreselected, false);
    assert.equal(m.aiRecommendedId, null);
  });

  it('keeps the order of the backend for ties and ignores assessments of other bounce lines', () => {
    const other = { 'L-IN-OTHER': ai['L-IN3'] };
    const m = bouncePanelModel(line, { aiAssessments: other });
    assert.deepEqual(m.rows, [CAND_A, CAND_B]);
    assert.equal(m.chosenId, null);
    for (const key of aiKeys) assert.equal(key in m, false);
  });

  it('has no ai* keys at all without an assessment (identical to before)', () => {
    for (const m of [bouncePanelModel(line), bouncePanelModel(line, { aiAssessments: null }),
      bouncePanelModel(line, { aiAssessments: {} })]) {
      for (const key of aiKeys) assert.equal(key in m, false);
      assert.deepEqual(m.rows, [CAND_A, CAND_B]);
      assert.equal(m.chosenId, null);
      assert.equal(m.discard, null);
    }
  });

  it('shows the percentage of a single-original pair but never preselects (already chosen as before)', () => {
    const single = { ...BOUNCE, state: BOUNCE_STATE,
      bouncePair: { role: 'bounce', confidence: 'review', counterpartLine: ORIGINAL } };
    const m = bouncePanelModel(single, { aiAssessments: {
      [BOUNCE.id]: { probabilities: { 'L-OUT': 72 }, none: 28, recommendedLineId: 'L-OUT' } } });
    assert.deepEqual(m.percents, { 'L-OUT': 72 });
    assert.equal(m.aiPreselected, false);
    assert.equal(m.aiRecommendedId, null);
    assert.equal(m.chosenId, 'L-OUT');
  });

  it('never sends the AI default as counterpartLineId on "No es un rechazo"; an explicit pick still goes', () => {
    const preselected = bouncePanelModel(line, { aiAssessments: ai });
    assert.deepEqual(dismissPairPayload('acc', line, preselected), {
      financialAccountId: 'acc', statementLineId: 'L-IN3',
    });
    const explicit = bouncePanelModel(line, { aiAssessments: ai, chosenOriginalId: 'L-OUT-A' });
    assert.deepEqual(dismissPairPayload('acc', line, explicit), {
      financialAccountId: 'acc', statementLineId: 'L-IN3', counterpartLineId: 'L-OUT-A',
    });
  });

  it('does not change what is selectable or checked in the autoMatch group', () => {
    const ambiguous = pairGroup({ ambiguous: true, confidence: 'review', statementLine: null,
      counterpartLine: { ...BOUNCE, id: 'L-IN3' }, candidates: [{ line: CAND_A }, { line: CAND_B }] });
    assert.equal(isSelectableGroup(ambiguous), true);
    assert.equal(defaultGroupChecked(ambiguous), false);
    const single = pairGroup({ confidence: 'review' });
    assert.equal(isSelectableGroup(single), true);
    assert.equal(defaultGroupChecked(single), false);
  });
});

describe('bouncePanelModel — discarded lines', () => {
  // The partner points back at the line: a mutual link is what makes the two a restorable pair.
  const partner = {
    id: 'L-IN', state: DISCARDED_STATE, amount: 120.5, bounceLink: { counterpartLineId: ORIGINAL.id },
  };

  it('paired: lists the line it was discarded with, found in the discarded lines', () => {
    const line = { ...ORIGINAL, state: DISCARDED_STATE,
      bounceLink: { counterpartLineId: 'L-IN', signal: 'pis_link', confidence: 'high', discardedAt: '2026-03-10T10:00:00Z' } };
    const m = bouncePanelModel(line, { discardedLines: [line, partner] });
    assert.equal(m.mode, DISCARDED_STATE);
    assert.equal(m.paired, true);
    assert.deepEqual(m.rows, [partner]);
    assert.equal(m.rowBadge, DISCARDED_STATE);
    assert.equal(m.other, partner);
    assert.equal(m.link, line.bounceLink);
    assert.equal(m.net, 0);
  });

  it('paired but the counterpart is missing from the list: still paired, no row', () => {
    const line = { ...ORIGINAL, state: DISCARDED_STATE, bounceLink: { counterpartLineId: 'GONE' } };
    const m = bouncePanelModel(line, { discardedLines: [line] });
    assert.equal(m.paired, true);
    assert.deepEqual(m.rows, []);
    assert.equal(m.other, null);
    assert.equal(m.net, null);
  });

  it('a one-sided link (the partner on screen points elsewhere): a lone line, no row and no net', () => {
    const line = { ...ORIGINAL, state: DISCARDED_STATE, bounceLink: { counterpartLineId: 'L-IN' } };
    for (const other of [
      { ...partner, bounceLink: { counterpartLineId: 'SOMEONE-ELSE' } },
      { ...partner, bounceLink: null },
    ]) {
      const m = bouncePanelModel(line, { discardedLines: [line, other] });
      assert.equal(m.paired, false);
      assert.deepEqual(m.rows, []);
      assert.equal(m.other, null);
      assert.equal(m.net, null);
      assert.equal(m.link, line.bounceLink);
    }
  });

  it('alone (Classic per-line discard): not paired, no row, null link', () => {
    const m = bouncePanelModel({ ...ORIGINAL, state: DISCARDED_STATE, bounceLink: null });
    assert.equal(m.paired, false);
    assert.deepEqual(m.rows, []);
    assert.equal(m.link, null);
  });
});

// --- summarizeApplyResults ----------------------------------------------------

describe('summarizeApplyResults', () => {
  it('counts successful groups and pairs and collects the failures', () => {
    const fail = { kind: 'bouncePair', error: 'Has payment', code: 'HAS_PAYMENT' };
    const out = summarizeApplyResults([
      { groupKey: 't1' },
      { groupKey: 't2', kind: 'transaction' },
      { kind: 'bouncePair' },
      fail,
      { groupKey: 't3', error: 'boom' },
    ]);
    assert.equal(out.groupsOk, 2);
    assert.equal(out.pairsOk, 1);
    assert.equal(out.failures.length, 2);
    assert.equal(out.failures[0], fail);
  });

  it('answers zeros for no results', () => {
    assert.deepEqual(summarizeApplyResults(), { groupsOk: 0, pairsOk: 0, failures: [] });
    assert.deepEqual(summarizeApplyResults(null), { groupsOk: 0, pairsOk: 0, failures: [] });
  });
});

describe('canPairOutflow (the backend discardPair shape: opposite sign, exact amount, at most 60 days apart either way)', () => {
  const bounce = { amount: 0.61, date: '2026-08-24' };
  it('accepts an exact opposite amount on the same day, before or AFTER the rejection', () => {
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-08-24' }, bounce), true);
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-08-25' }, bounce), true);
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-06-25' }, bounce), true);
  });
  it('allows day 60 and refuses day 61, in both directions', () => {
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-06-25' }, bounce), true); // 60 days before
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-06-24' }, bounce), false); // 61 days before
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-10-23' }, bounce), true); // 60 days after
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-10-24' }, bounce), false); // 61 days after
  });
  it('refuses another amount or the same sign', () => {
    assert.equal(canPairOutflow({ amount: -0.62, date: '2026-08-24' }, bounce), false);
    assert.equal(canPairOutflow({ amount: 0.61, date: '2026-08-24' }, bounce), false);
    assert.equal(canPairOutflow(null, bounce), false);
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-08-24' }, null), false);
  });
  it('compares to the exact cent and never pairs a zero amount', () => {
    assert.equal(canPairOutflow({ amount: -0.6, date: '2026-08-24' }, { amount: 0.61, date: '2026-08-24' }), false);
    assert.equal(canPairOutflow({ amount: -0.1 - 0.2, date: '2026-08-24' }, { amount: 0.3, date: '2026-08-24' }), true);
    assert.equal(canPairOutflow({ amount: 0, date: '2026-08-24' }, { amount: 0, date: '2026-08-24' }), false);
  });
  it('does not hold a missing date against the pair, and counts the 60th day as inside the window', () => {
    assert.equal(canPairOutflow({ amount: -0.61 }, bounce), true);
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-06-25' }, bounce), true);
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-08-24' }, { amount: 0.61 }), true);
  });
});

// --- The "Posibles rechazos" two-table view (ETP-6359) --------------------

describe('rowAsGroup / buildBouncePairRows / buildBounceOutflows / countBouncePairs', () => {
  const ann = (groupKey, role, extra = {}) => ({
    groupKey, role, ambiguous: false, confidence: 'review', signals: ['x'], signal: 'x', ...extra,
  });
  const line = (id, date, amount, bouncePair, extra = {}) => ({
    id, date, amount, state: BOUNCE_STATE, status: 'pending', bouncePair, ...extra,
  });
  // Plain pair P1; ambiguous pairs A1 / A2 share the candidate C2 (full row "C2" with partner).
  const o1 = { id: 'O1', date: '2026-05-01', amount: -45, description: 'Recibo gimnasio' };
  const c1 = { id: 'C1', date: '2026-05-02', amount: -80, description: 'Pago ACME 1' };
  const c2 = { id: 'C2', date: '2026-05-03', amount: -80, description: 'Pago ACME 2' };
  const c3 = { id: 'C3', date: '2026-04-20', amount: -80, description: 'Pago ACME 0' };
  const lines = [
    line('B-A1', '2026-05-09', 80, ann('A1', 'bounce', { ambiguous: true, candidates: [{ line: c1 }, { line: c2 }] })),
    line('B-P1', '2026-05-06', 45, ann('P1', 'bounce', { counterpartLine: o1 })),
    line('B-A2', '2026-05-10', 80, ann('A2', 'bounce', { ambiguous: true, candidates: [{ line: c2 }, { line: c3 }] })),
    line('C2', '2026-05-03', -80, ann('A1', 'candidate', { ambiguous: true, counterpartLine: { id: 'B-A1' } }), { partnerName: 'ACME SL' }),
    { id: 'PLAIN', state: 'pending', amount: 1, date: '2026-05-01' },
    { id: 'DISC', state: DISCARDED_STATE, amount: 1, date: '2026-05-01' },
  ];

  it('rowAsGroup: a bounce row is the rejection and its annotation holds the original', () => {
    const g = rowAsGroup(lines[1]);
    assert.equal(g.kind, BOUNCE_PAIR_KIND);
    assert.equal(g.groupKey, 'P1');
    assert.equal(g.counterpartLine, lines[1]);
    assert.deepEqual(g.statementLine, o1);
    assert.equal(g.ambiguous, false);
  });
  it('rowAsGroup: an ambiguous bounce row has no original and carries its candidates', () => {
    const g = rowAsGroup(lines[0]);
    assert.equal(g.ambiguous, true);
    assert.equal(g.statementLine, null);
    assert.deepEqual(g.candidates.map((c) => c.line.id), ['C1', 'C2']);
  });
  it('rowAsGroup: an original / candidate row is the original, the annotation holds the rejection', () => {
    const g = rowAsGroup(lines[3]);
    assert.equal(g.statementLine, lines[3]);
    assert.deepEqual(g.counterpartLine, { id: 'B-A1' });
    assert.deepEqual(g.candidates.map((c) => c.line.id), ['C2']);
  });

  it('buildBouncePairRows: one entry per pair, in the order the lines come, anchored on the bounce row', () => {
    const rows = buildBouncePairRows(lines);
    assert.deepEqual(rows.map((r) => r.groupKey), ['A1', 'P1', 'A2']);
    assert.deepEqual(rows.map((r) => r.anchor.id), ['B-A1', 'B-P1', 'B-A2']);
    assert.deepEqual(rows[0].outflowIds, ['C1', 'C2']);
    assert.deepEqual(rows[1].outflowIds, ['O1']);
  });
  it('buildBouncePairRows: ignores non-bounce rows, tolerates no lines and anchors on any row when the bounce is cut off', () => {
    assert.deepEqual(buildBouncePairRows(null), []);
    assert.equal(buildBouncePairRows(lines).some((r) => r.key === 'PLAIN' || r.key === 'DISC'), false);
    const onlyCandidate = buildBouncePairRows([lines[3]]);
    assert.equal(onlyCandidate.length, 1);
    assert.equal(onlyCandidate[0].anchor.id, 'C2');
  });
  it('buildBouncePairRows: the query keeps a pair matching either side (description, partner or reference)', () => {
    assert.deepEqual(buildBouncePairRows(lines, { query: 'gimnasio' }).map((r) => r.groupKey), ['P1']);
    assert.deepEqual(buildBouncePairRows(lines, { query: '  ACME SL ' }).map((r) => r.groupKey), ['A1']);
    assert.deepEqual(buildBouncePairRows(lines, { query: 'pago acme 0' }).map((r) => r.groupKey), ['A2']);
    assert.deepEqual(buildBouncePairRows(lines, { query: 'zzz' }), []);
  });

  it('buildBounceOutflows: every distinct outflow once, by date, listing the pairs that offer it', () => {
    const outs = buildBounceOutflows(lines);
    assert.deepEqual(outs.map((o) => o.line.id), ['C3', 'O1', 'C1', 'C2']);
    assert.deepEqual(outs.find((o) => o.line.id === 'C2').pairKeys, ['A1', 'A2']);
    assert.deepEqual(outs.find((o) => o.line.id === 'O1').pairKeys, ['P1']);
  });
  it('buildBounceOutflows: the full pendingLines row wins over the short annotation object', () => {
    const c2 = buildBounceOutflows(lines).find((o) => o.line.id === 'C2');
    assert.equal(c2.line.partnerName, 'ACME SL');
  });
  it('buildBounceOutflows: the query narrows the outflows to those of the pairs that match', () => {
    assert.deepEqual(buildBounceOutflows(lines, { query: 'gimnasio' }).map((o) => o.line.id), ['O1']);
    assert.deepEqual(buildBounceOutflows(null), []);
  });

  it('countBouncePairs counts pairs, not lines', () => {
    assert.equal(lines.filter((l) => l.state === BOUNCE_STATE).length, 4);
    assert.equal(countBouncePairs(lines), 3);
    assert.equal(countBouncePairs([]), 0);
    assert.equal(countBouncePairs(undefined), 0);
  });
});

describe('canPairOutflow — exact, symmetric decimal comparison (as the server\'s BigDecimal)', () => {
  const pair = (a, b) => canPairOutflow({ amount: a, date: '2026-08-24' }, { amount: b, date: '2026-08-24' });
  it('is symmetric for amounts that a *100 rounding handles asymmetrically', () => {
    assert.equal(pair(-0.615, 0.615), true);
    assert.equal(pair(-1.005, 1.005), true);
    assert.equal(pair(-2.675, 2.675), true);
  });
  it('treats a float artifact as the decimal it was meant to be', () => {
    assert.equal(pair(-(0.1 + 0.2), 0.3), true);
  });
  it('accepts numeric strings and mixed forms', () => {
    assert.equal(pair('-1.005', '1.005'), true);
    assert.equal(pair('-80.00', 80), true);
    assert.equal(pair(-80, '80.0'), true);
  });
  it('drops only the fraction\'s trailing zeros, never the integer\'s', () => {
    assert.equal(pair('-1.500', 1.5), true);
    assert.equal(pair('-100.000', '100'), true);
    assert.equal(pair('-10', 1), false);
    assert.equal(pair('-1.050', '1.05'), true);
    assert.equal(pair('-1.050', '1.5'), false);
    assert.equal(pair('-0.000', '0'), false);
  });
  it('refuses a difference of a single digit, equal signs and zero', () => {
    assert.equal(pair(-0.615, 0.616), false);
    assert.equal(pair(-1.005, 1.004), false);
    assert.equal(pair(1.005, 1.005), false);
    assert.equal(pair(0, 0), false);
  });
});

describe('bouncePanelModel — an explicit pick outside the pair\'s originals (two-table view)', () => {
  const o1 = { id: 'O1', amount: -5, date: '2026-10-01' };
  const x = { id: 'X', amount: -5, date: '2026-10-02' };
  const line = {
    id: 'B', state: BOUNCE_STATE, amount: 5, date: '2026-10-03',
    bouncePair: { role: 'bounce', ambiguous: false, confidence: 'review', counterpartLine: o1 },
  };
  it('defaults to the single original, and an explicit pick overrides it', () => {
    assert.equal(bouncePanelModel(line).chosenId, 'O1');
    const model = bouncePanelModel(line, { chosenOriginalId: 'X', chosenOriginalLine: x });
    assert.equal(model.chosenId, 'X');
    assert.equal(model.explicitPick, true);
    assert.deepEqual(model.discard, { statementLineId: 'X', counterpartLineId: 'B' });
    assert.equal(model.net, 0);
  });
});

describe('dismissPairPayload — only a pick among the pair\'s own originals travels', () => {
  const c1 = { id: 'C1', amount: -8, date: '2026-10-01' };
  const c2 = { id: 'C2', amount: -8, date: '2026-10-02' };
  const foreign = { id: 'F', amount: -8, date: '2026-10-02' };
  const line = {
    id: 'B', state: BOUNCE_STATE, amount: 8, date: '2026-10-03',
    bouncePair: { role: 'bounce', ambiguous: true, confidence: 'review', candidates: [{ line: c1 }, { line: c2 }] },
  };
  const ai = { B: { probabilities: { C1: 10, C2: 85 }, none: 5, recommendedLineId: 'C2' } };
  it('sends a pick among its own candidates', () => {
    const model = bouncePanelModel(line, { chosenOriginalId: 'C1' });
    assert.deepEqual(dismissPairPayload('A', line, model), { financialAccountId: 'A', statementLineId: 'B', counterpartLineId: 'C1' });
  });
  it('omits a free pick of a foreign outflow', () => {
    const model = bouncePanelModel(line, { chosenOriginalId: 'F', chosenOriginalLine: foreign });
    assert.deepEqual(dismissPairPayload('A', line, model), { financialAccountId: 'A', statementLineId: 'B' });
  });
  it('still omits the AI default', () => {
    const model = bouncePanelModel(line, { aiAssessments: ai });
    assert.equal(model.aiPreselected, true);
    assert.deepEqual(dismissPairPayload('A', line, model), { financialAccountId: 'A', statementLineId: 'B' });
  });
  it('re-clicking the single original of a non-ambiguous pair is not an explicit pick', () => {
    const single = { ...line, bouncePair: { role: 'bounce', ambiguous: false, counterpartLine: c1 } };
    assert.equal(bouncePanelModel(single, { chosenOriginalId: 'C1' }).explicitPick, false);
    assert.equal(bouncePanelModel(single, { chosenOriginalId: 'F', chosenOriginalLine: foreign }).explicitPick, true);
  });
});

describe('shownOutflow (the outflow an ambiguous pair shows in the modal and a tick excludes with)', () => {
  const amb = (candidates = [CAND_A, CAND_B]) => pairGroup({
    ambiguous: true, statementLine: null, candidates: candidates.map((line) => ({ line })),
  });
  const ai = (probabilities, recommendedLineId, none = 5) => ({ [BOUNCE.id]: { probabilities, none, recommendedLineId } });

  it('without AI data it is the first candidate in detector order, with no source', () => {
    assert.deepEqual(shownOutflow(amb(), null), { line: CAND_A, source: null });
    assert.deepEqual(shownOutflow(amb(), {}), { line: CAND_A, source: null });
  });
  it('the AI-recommended candidate is shown, sourced "ai"', () => {
    assert.deepEqual(shownOutflow(amb(), ai({ 'L-OUT-A': 10, 'L-OUT-B': 85 }, 'L-OUT-B')), { line: CAND_B, source: 'ai' });
  });
  it('without a recommendation the most probable candidate is shown, sourced "user"', () => {
    assert.deepEqual(shownOutflow(amb(), ai({ 'L-OUT-A': 40, 'L-OUT-B': 60 }, null)), { line: CAND_B, source: 'user' });
  });
  it('when none wins the detector order is kept, still sourced "user" (the AI rated the pair)', () => {
    assert.deepEqual(shownOutflow(amb(), ai({ 'L-OUT-A': 10, 'L-OUT-B': 40 }, null, 50)), { line: CAND_A, source: 'user' });
  });
  it('a recommendation that is not among the candidates is ignored', () => {
    assert.deepEqual(shownOutflow(amb(), ai({ X: 90 }, 'X')), { line: CAND_A, source: 'user' });
  });
  it('answers the single original of a plain pair and nothing for a transaction group or no group', () => {
    assert.deepEqual(shownOutflow(pairGroup()), { line: pairGroup().statementLine, source: null });
    assert.deepEqual(shownOutflow({ groupKey: 't' }), { line: null, source: null });
    assert.deepEqual(shownOutflow(null), { line: null, source: null });
  });
});

describe('bouncePairPayload(group, shown, choiceSource)', () => {
  const ambiguous = pairGroup({ ambiguous: true, statementLine: null, candidates: [{ line: CAND_A }, { line: CAND_B }] });
  it('an ambiguous pair travels with the shown outflow as statementLineId', () => {
    assert.deepEqual(bouncePairPayload(ambiguous, CAND_B), {
      kind: BOUNCE_PAIR_KIND, statementLineId: 'L-OUT-B', counterpartLineId: 'L-IN',
    });
  });
  it('choiceSource travels only when given; a plain pair keeps its own original unless another is shown', () => {
    assert.equal(bouncePairPayload(ambiguous, CAND_A, 'ai').choiceSource, 'ai');
    assert.equal(bouncePairPayload(ambiguous, CAND_A, 'user').choiceSource, 'user');
    assert.equal('choiceSource' in bouncePairPayload(ambiguous, CAND_A, null), false);
    assert.equal(bouncePairPayload(pairGroup()).statementLineId, 'L-OUT');
    // ETP-6359 — the outflow the row shows wins: an outflow the user picked in the panel.
    assert.equal(bouncePairPayload(pairGroup(), CAND_A).statementLineId, 'L-OUT-A');
  });
});

// --- ETP-6359: the outflow each modal row shows, shared outflows and panel picks ------------

const CAND_C = { id: 'L-OUT-C', date: '2026-03-04', amount: -80 };
const FOREIGN = { id: 'L-OUT-F', date: '2026-02-20', amount: -80 };
/** An ambiguous pair over `candidates`, with its own rejection line. */
const ambPair = (key, bounceId, candidates = [CAND_A, CAND_B]) => pairGroup({
  groupKey: key, ambiguous: true, statementLine: null,
  counterpartLine: { ...BOUNCE, id: bounceId, amount: 80 },
  candidates: candidates.map((line) => ({ line })),
});
const assess = (bounceId, probabilities, recommendedLineId = null, none = 5) => (
  { [bounceId]: { probabilities, none, recommendedLineId } });

describe('pairOutflowPreference (panel pick, then AI recommendation, then highest %, then detector order)', () => {
  const amb = ambPair('bp-a', 'IN-A', [CAND_A, CAND_B, CAND_C]);
  const ids = (lines) => lines.map((l) => l.id);

  it('without AI data and no pick it is the detector order', () => {
    assert.deepEqual(ids(pairOutflowPreference(amb)), ['L-OUT-A', 'L-OUT-B', 'L-OUT-C']);
  });
  it('the recommendation comes first even when another candidate has a higher %', () => {
    const ai = assess('IN-A', { 'L-OUT-A': 10, 'L-OUT-B': 60, 'L-OUT-C': 30 }, 'L-OUT-C');
    assert.deepEqual(ids(pairOutflowPreference(amb, ai)), ['L-OUT-C', 'L-OUT-B', 'L-OUT-A']);
  });
  it('without a recommendation the candidates go by descending %, ties in detector order', () => {
    const ai = assess('IN-A', { 'L-OUT-A': 20, 'L-OUT-B': 50, 'L-OUT-C': 20 });
    assert.deepEqual(ids(pairOutflowPreference(amb, ai)), ['L-OUT-B', 'L-OUT-A', 'L-OUT-C']);
  });
  it('a panel pick comes before the recommendation, and may be an outflow the detector did not offer', () => {
    const ai = assess('IN-A', { 'L-OUT-A': 10, 'L-OUT-B': 85 }, 'L-OUT-B');
    assert.deepEqual(ids(pairOutflowPreference(amb, ai, CAND_A)), ['L-OUT-A', 'L-OUT-B', 'L-OUT-C']);
    assert.deepEqual(ids(pairOutflowPreference(amb, ai, FOREIGN)), ['L-OUT-F', 'L-OUT-B', 'L-OUT-A', 'L-OUT-C']);
  });
  it('a single-original pair offers its original, after a pick when there is one', () => {
    assert.deepEqual(ids(pairOutflowPreference(pairGroup())), ['L-OUT']);
    assert.deepEqual(ids(pairOutflowPreference(pairGroup(), null, FOREIGN)), ['L-OUT-F', 'L-OUT']);
  });
  it('nothing for a transaction group or no group', () => {
    assert.deepEqual(pairOutflowPreference({ groupKey: 't' }), []);
    assert.deepEqual(pairOutflowPreference(null), []);
  });
});

describe('pairChoiceSource', () => {
  const amb = ambPair('bp-a', 'IN-A');
  const ai = assess('IN-A', { 'L-OUT-A': 10, 'L-OUT-B': 85 }, 'L-OUT-B');

  it('"ai" for the recommended candidate of an ambiguous pair', () => {
    assert.equal(pairChoiceSource(amb, CAND_B, ai), 'ai');
  });
  it('"user" for another outflow of an AI-rated pair (picked or not)', () => {
    assert.equal(pairChoiceSource(amb, CAND_A, ai), 'user');
    assert.equal(pairChoiceSource(amb, CAND_A, ai, CAND_A), 'user');
    assert.equal(pairChoiceSource(amb, CAND_B, assess('IN-A', { 'L-OUT-A': 40, 'L-OUT-B': 60 })), 'user');
  });
  it('without AI data: "user" only for the panel pick, null otherwise', () => {
    assert.equal(pairChoiceSource(amb, CAND_A, null), null);
    assert.equal(pairChoiceSource(amb, CAND_A, null, CAND_A), 'user');
    assert.equal(pairChoiceSource(amb, CAND_A, null, CAND_B), null);
  });
  it('a single-original pair: no source for its own original, "user" for another outflow picked in the panel', () => {
    assert.equal(pairChoiceSource(pairGroup(), ORIGINAL), null);
    assert.equal(pairChoiceSource(pairGroup(), FOREIGN, null, FOREIGN), 'user');
  });
  it('an AI assessment of a single-original pair is ignored', () => {
    assert.equal(pairChoiceSource(pairGroup(), ORIGINAL, assess(BOUNCE.id, { 'L-OUT': 90 }, 'L-OUT')), null);
  });
  it('null with no line or no bounce pair', () => {
    assert.equal(pairChoiceSource(amb, null, ai), null);
    assert.equal(pairChoiceSource({ groupKey: 't' }, CAND_A, ai), null);
  });
});

describe('resolvePairOutflows (two checked rows never share an outflow)', () => {
  const A = ambPair('bp-a', 'IN-A');
  const B = ambPair('bp-b', 'IN-B');
  const C = ambPair('bp-c', 'IN-C');
  const aiAll = {
    ...assess('IN-A', { 'L-OUT-A': 80, 'L-OUT-B': 20 }, 'L-OUT-A'),
    ...assess('IN-B', { 'L-OUT-A': 70, 'L-OUT-B': 30 }, 'L-OUT-A'),
    ...assess('IN-C', { 'L-OUT-A': 60, 'L-OUT-B': 40 }, 'L-OUT-A'),
  };
  const shown = (plan, key) => plan.get(key).line?.id ?? null;

  it('nothing checked: every row shows its own first choice and can be checked', () => {
    const plan = resolvePairOutflows([A, B, C], { assessments: aiAll });
    for (const key of ['bp-a', 'bp-b', 'bp-c']) {
      assert.equal(shown(plan, key), 'L-OUT-A');
      assert.equal(plan.get(key).checkable, true);
      assert.equal(plan.get(key).checked, false);
    }
    assert.equal(plan.get('bp-a').source, 'ai');
  });
  it('a checked row takes its outflow; the next moves to the free one ("user"), the third is blocked', () => {
    const plan = resolvePairOutflows([A, B, C], { assessments: aiAll, checkedKeys: ['bp-a'] });
    assert.equal(shown(plan, 'bp-a'), 'L-OUT-A');
    assert.equal(plan.get('bp-a').checked, true);
    assert.equal(shown(plan, 'bp-b'), 'L-OUT-B');
    assert.equal(plan.get('bp-b').source, 'user');
    assert.equal(plan.get('bp-b').checkable, true);
    const both = resolvePairOutflows([A, B, C], { assessments: aiAll, checkedKeys: ['bp-a', 'bp-b'] });
    assert.equal(shown(both, 'bp-b'), 'L-OUT-B');
    assert.equal(both.get('bp-c').line, null);
    assert.equal(both.get('bp-c').blocked, true);
    assert.equal(both.get('bp-c').checkable, false);
  });
  it('check order decides who keeps the outflow: the later tick moves, and a blocked wish to check is refused', () => {
    const plan = resolvePairOutflows([A, B, C], { assessments: aiAll, checkedKeys: ['bp-c', 'bp-a', 'bp-b'] });
    assert.equal(shown(plan, 'bp-c'), 'L-OUT-A');
    assert.equal(shown(plan, 'bp-a'), 'L-OUT-B');
    assert.equal(plan.get('bp-b').checked, false);
    assert.equal(plan.get('bp-b').blocked, true);
  });
  it('an ambiguous pair without AI data needs the panel: not checkable, even when asked to be checked', () => {
    const plan = resolvePairOutflows([A], { checkedKeys: ['bp-a'] });
    assert.equal(plan.get('bp-a').needsPanel, true);
    assert.equal(plan.get('bp-a').checkable, false);
    assert.equal(plan.get('bp-a').checked, false);
    assert.equal(shown(plan, 'bp-a'), 'L-OUT-A');
  });
  it('a panel pick makes a no-AI ambiguous pair checkable, sourced "user"', () => {
    const picks = new Map([['IN-A', CAND_B]]);
    const plan = resolvePairOutflows([A], { picks, checkedKeys: ['bp-a'] });
    assert.equal(shown(plan, 'bp-a'), 'L-OUT-B');
    assert.equal(plan.get('bp-a').needsPanel, false);
    assert.equal(plan.get('bp-a').checked, true);
    assert.equal(plan.get('bp-a').source, 'user');
  });
  it('an AI-rated row whose pick a checked row already holds falls back to its next free outflow', () => {
    const picks = new Map([['IN-B', CAND_A]]);
    const withAi = resolvePairOutflows([A, B], { assessments: aiAll, picks, checkedKeys: ['bp-a'] });
    assert.equal(shown(withAi, 'bp-b'), 'L-OUT-B');
    assert.equal(withAi.get('bp-b').checkable, true);
  });
  it('a single-original pair re-paired in the panel shows the pick, sourced "user"', () => {
    const single = pairGroup({ groupKey: 'bp-s' });
    const plan = resolvePairOutflows([single], { picks: new Map([[BOUNCE.id, FOREIGN]]) });
    assert.equal(shown(plan, 'bp-s'), 'L-OUT-F');
    assert.equal(plan.get('bp-s').source, 'user');
    assert.equal(plan.get('bp-s').checkable, true);
  });
  it('a single-original pair whose original a checked row took is blocked', () => {
    const single = pairGroup({ groupKey: 'bp-s', statementLine: CAND_A, counterpartLine: { ...BOUNCE, id: 'IN-S' } });
    const plan = resolvePairOutflows([A, single], { assessments: aiAll, checkedKeys: ['bp-a'] });
    assert.equal(plan.get('bp-s').blocked, true);
    assert.equal(plan.get('bp-s').checkable, false);
  });
  it('ignores transaction groups and unknown checked keys; empty input gives an empty plan', () => {
    const plan = resolvePairOutflows([{ groupKey: 't' }, A], { assessments: aiAll, checkedKeys: ['nope', 't'] });
    assert.deepEqual([...plan.keys()], ['bp-a']);
    assert.equal(resolvePairOutflows(null).size, 0);
  });
});

describe('isLineNotPendingResult', () => {
  it('true for the coded refusal, by code on the entry, on its error, or by message key', () => {
    assert.equal(LINE_NOT_PENDING_CODE, 'LINE_NOT_PENDING');
    assert.equal(isLineNotPendingResult({ code: 'LINE_NOT_PENDING', error: { message: 'x' } }), true);
    assert.equal(isLineNotPendingResult({ error: { code: 'LINE_NOT_PENDING' } }), true);
    assert.equal(isLineNotPendingResult({ error: { messageKeys: ['ETGO_BounceLineNotPending'] } }), true);
    assert.equal(isLineNotPendingResult({ messageKeys: ['ETGO_BounceLineNotPending'], error: {} }), true);
  });
  it('false for a success, another refusal, or nothing', () => {
    assert.equal(isLineNotPendingResult({ code: 'LINE_NOT_PENDING' }), false);
    assert.equal(isLineNotPendingResult({ discarded: true }), false);
    assert.equal(isLineNotPendingResult({ code: 'HAS_PAYMENT', error: { messageKeys: ['ETGO_BounceHasPayment'] } }), false);
    assert.equal(isLineNotPendingResult(null), false);
    assert.equal(isLineNotPendingResult(undefined), false);
  });
});

// --- ETP-6359 (final): effective panel picks, one choiceSource rule, ticks pin their outflow ------

describe('effectivePairPick', () => {
  it('a pick of a single-original pair\'s own original is not a pick; another outflow is', () => {
    assert.equal(effectivePairPick(pairGroup(), ORIGINAL), null);
    assert.equal(effectivePairPick(pairGroup(), FOREIGN), FOREIGN);
  });
  it('any pick of an ambiguous pair counts, its first candidate included', () => {
    const amb = ambPair('bp-a', 'IN-A');
    assert.equal(effectivePairPick(amb, CAND_A), CAND_A);
    assert.equal(effectivePairPick(amb, CAND_B), CAND_B);
  });
  it('no pick, or a pick without an id, is nothing', () => {
    assert.equal(effectivePairPick(pairGroup(), null), null);
    assert.equal(effectivePairPick(pairGroup(), { description: 'x' }), null);
  });
});

describe('pairChoiceSource — one rule with the panel', () => {
  const amb = ambPair('bp-a', 'IN-A');
  const ai = assess('IN-A', { 'L-OUT-A': 10, 'L-OUT-B': 85 }, 'L-OUT-B');

  it('a panel pick is "user" even when it is the AI recommendation', () => {
    assert.equal(pairChoiceSource(amb, CAND_B, ai, CAND_B), 'user');
  });
  it('a panel pick is "user" with no AI data', () => {
    assert.equal(pairChoiceSource(amb, CAND_A, null, CAND_A), 'user');
  });
  it('a pick of a single-original pair\'s own original counts as no pick: nothing is sent', () => {
    assert.equal(pairChoiceSource(pairGroup(), ORIGINAL, null, ORIGINAL), null);
  });
  it('a non-ambiguous pair the AI rated but the user did not pick sends nothing', () => {
    assert.equal(pairChoiceSource(pairGroup(), ORIGINAL, assess(BOUNCE.id, { 'L-OUT': 90 }, 'L-OUT')), null);
  });
  it('a pick that is not the outflow shown does not make it "user": the AI rule applies to the shown one', () => {
    assert.equal(pairChoiceSource(amb, CAND_B, ai, CAND_A), 'ai');
    assert.equal(pairChoiceSource(amb, CAND_A, null, CAND_B), null);
  });
});

describe('resolvePairOutflows — a checked pair keeps the outflow it was ticked with (pins)', () => {
  const A = ambPair('bp-a', 'IN-A');
  const B = ambPair('bp-b', 'IN-B');
  const C = ambPair('bp-c', 'IN-C');
  const aiAll = {
    ...assess('IN-A', { 'L-OUT-A': 80, 'L-OUT-B': 20 }, 'L-OUT-A'),
    ...assess('IN-B', { 'L-OUT-A': 70, 'L-OUT-B': 30 }, 'L-OUT-A'),
    ...assess('IN-C', { 'L-OUT-A': 60, 'L-OUT-B': 40 }, 'L-OUT-A'),
  };
  const shown = (plan, key) => plan.get(key).line?.id ?? null;

  it('tick a, tick b, untick a: b keeps the outflow it was ticked with; only the unchecked a moves', () => {
    const plan = resolvePairOutflows([A, B], {
      assessments: aiAll, checkedKeys: ['bp-b'], pins: new Map([['bp-b', 'L-OUT-B']]),
    });
    assert.equal(shown(plan, 'bp-b'), 'L-OUT-B');
    assert.equal(plan.get('bp-b').checked, true);
    assert.equal(plan.get('bp-b').source, 'user');
    assert.equal(shown(plan, 'bp-a'), 'L-OUT-A');
    assert.equal(plan.get('bp-a').checked, false);
  });
  it('a pin wins over the pair\'s first preference, and the unchecked rows avoid it', () => {
    const plan = resolvePairOutflows([A, B, C], {
      assessments: aiAll, checkedKeys: ['bp-a'], pins: new Map([['bp-a', 'L-OUT-B']]),
    });
    assert.equal(shown(plan, 'bp-a'), 'L-OUT-B');
    assert.equal(shown(plan, 'bp-b'), 'L-OUT-A');
    assert.equal(shown(plan, 'bp-c'), 'L-OUT-A');
  });
  it('a pin an earlier checked pair already holds leaves the pair unchecked, re-resolved with the unchecked rows', () => {
    const plan = resolvePairOutflows([A, B], {
      assessments: aiAll, checkedKeys: ['bp-a', 'bp-b'], pins: new Map([['bp-a', 'L-OUT-A'], ['bp-b', 'L-OUT-A']]),
    });
    assert.equal(plan.get('bp-a').checked, true);
    assert.equal(plan.get('bp-b').checked, false);
    assert.equal(shown(plan, 'bp-b'), 'L-OUT-B');
  });
  it('a pin that is no longer among the pair\'s options leaves it unchecked', () => {
    const plan = resolvePairOutflows([A], { assessments: aiAll, checkedKeys: ['bp-a'], pins: new Map([['bp-a', 'GONE']]) });
    assert.equal(plan.get('bp-a').checked, false);
    assert.equal(shown(plan, 'bp-a'), 'L-OUT-A');
  });
  it('a no-AI pair whose panel pick a checked row holds is blocked: no outflow, not checkable', () => {
    const plan = resolvePairOutflows([A, B], {
      assessments: assess('IN-A', { 'L-OUT-A': 80 }, 'L-OUT-A'),
      picks: new Map([['IN-B', CAND_A]]),
      checkedKeys: ['bp-a'],
    });
    assert.equal(plan.get('bp-b').line, null);
    assert.equal(plan.get('bp-b').blocked, true);
    assert.equal(plan.get('bp-b').checkable, false);
  });
  it('`picked` tells a row with an effective panel pick from one without', () => {
    const plan = resolvePairOutflows([A, B, pairGroup({ groupKey: 'bp-s' })], {
      picks: new Map([['IN-A', CAND_B], [BOUNCE.id, ORIGINAL]]),
    });
    assert.equal(plan.get('bp-a').picked, true);
    assert.equal(plan.get('bp-b').picked, false);
    // A pick of its own original is not a pick.
    assert.equal(plan.get('bp-s').picked, false);
  });
  it('a no-AI pair with a free panel pick shows exactly that pick, checkable as "user"', () => {
    const plan = resolvePairOutflows([A], { picks: new Map([['IN-A', CAND_B]]) });
    assert.equal(shown(plan, 'bp-a'), 'L-OUT-B');
    assert.equal(plan.get('bp-a').checkable, true);
    assert.equal(plan.get('bp-a').source, 'user');
  });
  it('a single-original pair picked with its own original keeps its own source (no pick)', () => {
    const plan = resolvePairOutflows([pairGroup({ groupKey: 'bp-s', confidence: 'high' })], {
      picks: new Map([[BOUNCE.id, ORIGINAL]]), checkedKeys: ['bp-s'],
    });
    assert.equal(plan.get('bp-s').checked, true);
    assert.equal(plan.get('bp-s').source, null);
  });
});

// --- The "Descartadas" pair view (ETP-6359) -------------------------------

/** A discarded line linked to `partnerId` (null: discarded on its own). */
function discardedLine(id, amount, date, partnerId, extra = {}) {
  return {
    id, amount, date, state: DISCARDED_STATE, status: DISCARDED_STATE, discarded: true,
    bounceLink: partnerId ? { counterpartLineId: partnerId, discardedAt: '2026-09-10T10:00:00Z' } : null,
    ...extra,
  };
}
const pairKeys = (rows) => rows.map((r) => [r.anchor.id, r.counterpart?.id ?? null]);

describe('isDiscardedOutflow (which line of a discarded pair is the original)', () => {
  it('the earlier line is the outflow, whatever its sign', () => {
    const early = { date: '2026-09-01', amount: -50 };
    const late = { date: '2026-09-03', amount: 50 };
    assert.equal(isDiscardedOutflow(early, late), true);
    assert.equal(isDiscardedOutflow(late, early), false);
    // An outflow dated AFTER its rejection: the earlier (positive) line is read as the original.
    const positiveFirst = { date: '2026-09-01', amount: 50 };
    const negativeLater = { date: '2026-09-02', amount: -50 };
    assert.equal(isDiscardedOutflow(positiveFirst, negativeLater), true);
    assert.equal(isDiscardedOutflow(negativeLater, positiveFirst), false);
  });
  it('on the same day, or with a date missing, the lower amount is the outflow', () => {
    const out = { date: '2026-09-01', amount: -50 };
    const back = { date: '2026-09-01', amount: 50 };
    assert.equal(isDiscardedOutflow(out, back), true);
    assert.equal(isDiscardedOutflow(back, out), false);
    assert.equal(isDiscardedOutflow({ amount: -5 }, { date: '2026-09-01', amount: 5 }), true);
    assert.equal(isDiscardedOutflow({ date: '2026-09-01', amount: 5 }, { amount: -5 }), false);
  });
  it('a full tie keeps the first line as the outflow', () => {
    const a = { date: '2026-09-01', amount: -5 };
    assert.equal(isDiscardedOutflow(a, { ...a }), true);
  });
});

describe('buildDiscardedPairRows (one row per discarded pair, anchored on the outflow)', () => {
  const D1 = discardedLine('D1', -50, '2026-09-01', 'D2', { description: 'Cuota gimnasio' });
  const D2 = discardedLine('D2', 50, '2026-09-03', 'D1', { description: 'Cuota devuelta', referenceNo: 'REF-77' });
  const D3 = discardedLine('D3', -7, '2026-08-20', null, { description: 'Comision' });

  it('pairs two lines that point at each other, anchored on the earlier one', () => {
    assert.deepEqual(pairKeys(buildDiscardedPairRows([D1, D2])), [['D1', 'D2']]);
    const [entry] = buildDiscardedPairRows([D1, D2]);
    assert.equal(entry.key, 'D1');
    assert.equal(entry.anchor, D1);
    assert.equal(entry.counterpart, D2);
  });
  it('the earlier line is the anchor even when the rejection is listed first', () => {
    assert.deepEqual(pairKeys(buildDiscardedPairRows([D2, D1])), [['D1', 'D2']]);
  });
  it('on the same day the lower amount is the anchor', () => {
    const out = discardedLine('S1', -30, '2026-09-05', 'S2');
    const back = discardedLine('S2', 30, '2026-09-05', 'S1');
    assert.deepEqual(pairKeys(buildDiscardedPairRows([back, out])), [['S1', 'S2']]);
  });
  it('an outflow dated after its rejection: the earlier positive line is the anchor', () => {
    const back = discardedLine('R1', 40, '2026-09-01', 'R2');
    const out = discardedLine('R2', -40, '2026-09-04', 'R1');
    assert.deepEqual(pairKeys(buildDiscardedPairRows([out, back])), [['R1', 'R2']]);
  });
  it('a line discarded on its own is a row of its own, never dropped', () => {
    assert.deepEqual(pairKeys(buildDiscardedPairRows([D3])), [['D3', null]]);
  });
  it('a line whose partner is not on screen (outside the date range) is a row alone', () => {
    assert.deepEqual(pairKeys(buildDiscardedPairRows([D2])), [['D2', null]]);
  });
  it('a one-sided link (legacy data) gives two rows, each alone', () => {
    const a = discardedLine('A1', -10, '2026-09-01', 'A2');
    const b = discardedLine('A2', 10, '2026-09-02', 'ZZ');
    assert.deepEqual(pairKeys(buildDiscardedPairRows([a, b])), [['A1', null], ['A2', null]]);
  });
  it('a line linked to itself is a row alone', () => {
    const self = discardedLine('SELF', -10, '2026-09-01', 'SELF');
    assert.deepEqual(pairKeys(buildDiscardedPairRows([self])), [['SELF', null]]);
  });
  it('the search keeps a pair matching only its rejection (description, partner or reference)', () => {
    const rows = [D1, D2, D3];
    assert.deepEqual(pairKeys(buildDiscardedPairRows(rows, { query: 'devuelta' })), [['D1', 'D2']]);
    assert.deepEqual(pairKeys(buildDiscardedPairRows(rows, { query: '  ref-77 ' })), [['D1', 'D2']]);
    assert.deepEqual(pairKeys(buildDiscardedPairRows(rows, { query: 'comision' })), [['D3', null]]);
    assert.deepEqual(buildDiscardedPairRows(rows, { query: 'zzz' }), []);
  });
  it('orders the rows by the anchor\'s date, then as their first line came', () => {
    const t1 = discardedLine('T1', -1, '2026-09-01', null);
    const t2 = discardedLine('T2', -2, '2026-09-01', null);
    // D1, T2 and T1 share a date: the pair keeps the place of its first line (D2), the earliest.
    assert.deepEqual(pairKeys(buildDiscardedPairRows([D2, t2, D1, D3, t1])), [
      ['D3', null], ['D1', 'D2'], ['T2', null], ['T1', null],
    ]);
  });
  it('ignores the lines that are not discarded, and tolerates no lines', () => {
    const pending = { id: 'P1', state: 'pending', amount: 50, date: '2026-09-03', bounceLink: { counterpartLineId: 'X1' } };
    const partnerPending = discardedLine('X1', -50, '2026-09-01', 'P1');
    assert.deepEqual(pairKeys(buildDiscardedPairRows([pending, partnerPending, D3])), [['D3', null], ['X1', null]]);
    assert.deepEqual(buildDiscardedPairRows(null), []);
    assert.deepEqual(buildDiscardedPairRows(undefined), []);
  });
});
