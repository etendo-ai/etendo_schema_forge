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
  buildBouncePairRows,
  buildBounceOutflows,
  countBouncePairs,
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

  it('never lets an ambiguous pair be selected, even when marked high', () => {
    const g = pairGroup({ ambiguous: true, confidence: HIGH_CONFIDENCE, statementLine: null });
    assert.equal(isSelectableGroup(g), false);
    assert.equal(defaultGroupChecked(g), false);
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
    assert.equal(isSelectableGroup(ambiguous), false);
    assert.equal(defaultGroupChecked(ambiguous), false);
    const single = pairGroup({ confidence: 'review' });
    assert.equal(isSelectableGroup(single), true);
    assert.equal(defaultGroupChecked(single), false);
  });
});

describe('bouncePanelModel — discarded lines', () => {
  const partner = { id: 'L-IN', state: DISCARDED_STATE, amount: 120.5 };

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

describe('canPairOutflow (the backend discardPair shape: opposite sign, exact amount, 0..60 days)', () => {
  const bounce = { amount: 0.61, date: '2026-08-24' };
  it('accepts an exact opposite amount dated on or before the rejection', () => {
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-08-24' }, bounce), true);
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-06-25' }, bounce), true);
  });
  it('refuses another amount, the same sign, a later outflow or one more than 60 days earlier', () => {
    assert.equal(canPairOutflow({ amount: -0.62, date: '2026-08-24' }, bounce), false);
    assert.equal(canPairOutflow({ amount: 0.61, date: '2026-08-24' }, bounce), false);
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-08-25' }, bounce), false);
    assert.equal(canPairOutflow({ amount: -0.61, date: '2026-06-24' }, bounce), false);
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
