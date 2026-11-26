// @covers tools/app-shell/src/components/contract-ui/AutoMatchSuggestionModal.jsx
// @covers tools/app-shell/src/components/contract-ui/AutoMatchBounceSection.jsx
// @covers tools/app-shell/src/components/contract-ui/AutoMatchCard.jsx
// @covers tools/app-shell/src/components/contract-ui/AutoMatchPairRow.jsx
// @covers tools/app-shell/src/components/contract-ui/AutoMatchCloseConfirmDialog.jsx
// @covers tools/app-shell/src/components/contract-ui/BouncePairPanel.jsx
// @covers tools/app-shell/src/components/contract-ui/ReconciliationSplitPanel.jsx
// @covers tools/app-shell/src/components/contract-ui/bouncePairs.js
// @covers tools/app-shell/src/components/contract-ui/bounceAi.js
// @covers tools/app-shell/src/components/contract-ui/useBouncePairReview.jsx
// @covers tools/app-shell/src/hooks/useAutoMatchReview.js
// @covers tools/app-shell/src/windows/custom/financial-account/index.jsx
// @covers tools/app-shell/src/hooks/useBouncePairActions.js
// @covers tools/app-shell/src/lib/bounceSuggestionsTelemetry.js
import { test, expect } from '../../helpers/test.js';
import { login } from '../../helpers/auth.js';

/**
 * Bounce-pair suggestions (the modal's yellow "Posibles rechazos bancarios" card, the panel's
 * "Posibles rechazos" filter) in the bank reconciliation — mocked.
 *
 * The backend detects bounce pairs behind the per-account flag `bank-bounce-suggestions`; the SPA
 * never evaluates it and renders what the backend answers. With the flag on, `autoMatch` carries
 * `kind: "bouncePair"` groups and `kpis.bouncePairs`, and `pendingLines` puts `state: "bounce"` and
 * a `bouncePair` annotation on their lines. With it off, none of that exists and the UI must be
 * unchanged. Contract: com.etendoerp.go docs/neo-headless.md §4.12.1.1.
 *
 * Covered here:
 *   1. the automatch modal auto-opens with the yellow "Posibles rechazos bancarios" card ABOVE the
 *      green "Líneas del extracto bancario" card, the "Posibles rechazos" KPI and no global footer
 *      (no "Cancelar"): one transaction group and three pairs (high, review, ambiguous) — high
 *      checked, review unchecked, ambiguous unchecked but tickable, with "Revisar en el panel";
 *   2. "Revisar en el panel" on the ambiguous pair closes the modal, switches the panel filter to
 *      "Posibles rechazos" and selects the bounce line, with no review banner; each candidate shows
 *      its bank reference ("Ref. X") and the footer the selected bounce's, the clipped description is
 *      on hover; choosing the original and "Descartar par" POSTs `discardPair` with the original and
 *      the bounce;
 *   3. "Excluir de la conciliación (N)" is IMMEDIATE and independent: ONE `applySuggestions` with
 *      ONLY `bouncePair` groups and no `bounceDecisions`; the excluded rows leave at once without an
 *      automatch refetch, the KPI and the count drop, the toast says "N rechazo(s) excluido(s)…" and
 *      the button is disabled at N=0; a pair the backend refuses stays on screen with a translated
 *      error toast while the others are excluded;
 *   4. "Conciliar seleccionadas (N)" POSTs ONLY transaction groups plus `bounceDecisions` for every
 *      pair still on screen (`unchecked`, or `sent_to_panel` for a pair sent to the panel), after the
 *      Automatch button reopened the modal with the checks kept;
 *   5. closing (X, Esc, backdrop, "Ir a conciliación manual") with rows checked asks "¿Deseas cerrar
 *      la ventana?": "Seguir trabajando" keeps the modal and the selection, "Cerrar" closes it; with
 *      nothing checked there is no dialog;
 *   6. "Descartadas" (`status=discarded`) lists ONE ROW PER DISCARDED PAIR, on its outflow, counted by
 *      `counts.discardedPairs`; the selected pair's footer names both lines ("Salida descartada",
 *      "Rechazo") and "Restaurar par" POSTs `restorePair`;
 *   7. flag off: no yellow card, no bounce KPI, the original apply payload;
 *   8. "No es un rechazo" is stored (ETP-6359): it POSTs `dismissPair` with the selected line and the
 *      other line of the pair, then the lines and the suggestions reload and the pair never comes
 *      back; a failing `dismissPair` shows an error toast and keeps the pair; a line marked so shows
 *      its notice under "Pendientes", and "Volver a considerar como posible rechazo" POSTs
 *      `restoreBounceSuggestion` and reloads;
 *   9. a pair sent to the panel, then checked and unchecked again in the reopened modal, is
 *      reported as `unchecked`, not `sent_to_panel`;
 *  10. read-only tier: the modal never opens and "No es un rechazo" is disabled (nothing is posted);
 *  11. (E2E_TELEMETRY=configured only) the `bounce_suggestions_viewed` / `_dismissed` Mixpanel
 *      events, read from the requests to the Mixpanel host — see the describe below.
 *
 *  13. (ETP-6359) the "Posibles rechazos" filter is TWO native tables: left "Salidas (N)" (every
 *      distinct outflow once, date order), right "Rechazos (N)"; nothing selected shows only the
 *      placeholder; clicking an outflow selects / re-targets a rejection and narrows the right
 *      list; any pairable outflow is an explicit pick; the footer lives in the right column only;
 *      the modal also auto-opens when the run found only pairs (see the describe at the end).
 *  12. the AI second layer (`bounceAiAssessments` on the autoMatch answer): the modal row of an
 *      ambiguous pair shows ONE outflow (the recommended one, else the most probable, else the
 *      first in detector order) with its percentage, and a tick excludes the pair with THAT outflow
 *      (`choiceSource` 'ai' / 'user', none without AI data); the panel sorts the options, pre-checks the
 *      recommended one (badge + notice) and `discardPair` carries `choiceSource` 'ai' / 'user';
 *      "Deshacer" posts `restorePair`; a 409 stale answer shows its toast; without a recommendation
 *      (60/40, or no AI data at all) "Revisar en el panel" opens on the outflow the modal row showed,
 *      a preselection that discards as 'user' on an AI-rated pair and with no `choiceSource` without
 *      AI data (last describe of the file).
 *
 * Mock mode only (run against plain `make dev`, not `make dev-mock`). Every route is installed AFTER
 * `login()` so it beats the generic `**\/sws\/**` stub (Playwright matches in reverse order).
 */

const ACCOUNT_ID = 'acc-bounce';

const ACCOUNT = {
  id: ACCOUNT_ID,
  name: 'Banco Rechazos',
  type: 'B',
  currentBalance: 1000,
  currencyId: '102',
  currencyIso: 'EUR',
  iban: 'ES1212340000000000000009',
  isDefault: true,
  pendingCount: 7,
  bankConnected: false,
  amountTolerance: 0,
  glItemDifferenceId: '',
  glItemDifferenceName: '',
};

const SUMMARY = {
  totalBalance: 1000,
  byCurrency: [{ currencyIso: 'EUR', total: 1000 }],
  pending: { accountsWithPending: 1, suggestionsReady: 1, byRule: 0 },
};

// ── Lines ─────────────────────────────────────────────────────────────────────

const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const TX_LINE = { id: 'bsl-tx', date: day(9), description: 'Cobro cliente ACME', amount: 300 };
const HIGH_ORIGINAL = { id: 'bsl-high-out', date: day(8), description: 'Pago proveedor Luz', amount: -120 };
const HIGH_BOUNCE = { id: 'bsl-high-in', date: day(8), description: 'DEVOLUCION RECIBO Luz', amount: 120 };
const REVIEW_ORIGINAL = { id: 'bsl-rev-out', date: day(7), description: 'Recibo gimnasio', amount: -45 };
const REVIEW_BOUNCE = { id: 'bsl-rev-in', date: day(4), description: 'RECIBO DEVUELTO gimnasio', amount: 45 };
// The candidates carry the bank reference that tells them apart; the first one's description is
// long enough to be clipped in the panel, so its full text is only on hover.
const AMB_LONG_DESC = 'TRANSFERENCIA INMEDIATA A FAVOR DE ACME SUMINISTROS INDUSTRIALES SL CONCEPTO PAGO FACTURA 10000268 100-1';
const AMB_CAND_1 = { id: 'bsl-amb-out-1', date: day(6), description: AMB_LONG_DESC, amount: -80, referenceNo: 'REF-AMB-OUT-1' };
const AMB_CAND_2 = { id: 'bsl-amb-out-2', date: day(5), description: 'Pago ACME factura 2', amount: -80, referenceNo: 'REF-AMB-OUT-2' };
const AMB_BOUNCE = { id: 'bsl-amb-in', date: day(3), description: 'Abono ACME', amount: 80, referenceNo: 'REF-AMB-IN' };

// Extra pairs some tests add (`extraPairs` of installMocks). FREE: an outflow of the same amount
// as the ambiguous pair's candidates that the detector did NOT offer for it (a free pick).
// ORPHAN: an outflow whose rejection came more than 60 days later, so no rejection can take it.
const FREE_ORIGINAL = { id: 'bsl-free-out', date: day(10), description: 'Pago ACME factura 3', amount: -80, referenceNo: 'REF-FREE-OUT' };
const FREE_BOUNCE = { id: 'bsl-free-in', date: day(2), description: 'RECIBO DEVUELTO ACME 3', amount: 80, referenceNo: 'REF-FREE-IN' };
const ORPHAN_ORIGINAL = { id: 'bsl-orph-out', date: day(100), description: 'Cuota anual', amount: -33 };
const ORPHAN_BOUNCE = { id: 'bsl-orph-in', date: day(2), description: 'CUOTA DEVUELTA', amount: 33 };

const TX_GROUP = {
  kind: 'transaction',
  groupKey: 'grp-tx',
  statementLine: TX_LINE,
  operations: [{ id: 'trx-1', documentNo: 'COB-0001', partnerName: 'ACME', amount: 300, isNew: false }],
  origin: 'standard',
  isNew: false,
  difference: 0,
};

const pair = (overrides) => ({
  kind: 'bouncePair', origin: 'bounce', operations: [], isNew: false, difference: 0, ambiguous: false, ...overrides,
});

const HIGH_PAIR = pair({
  groupKey: 'bp-high', confidence: 'high', signal: 'return_text', signals: ['return_text'],
  statementLine: HIGH_ORIGINAL, counterpartLine: HIGH_BOUNCE,
});
const REVIEW_PAIR = pair({
  groupKey: 'bp-review', confidence: 'review', signal: 'return_text', signals: ['return_text'],
  statementLine: REVIEW_ORIGINAL, counterpartLine: REVIEW_BOUNCE,
});
const AMB_PAIR = pair({
  groupKey: 'bp-amb', confidence: 'review', ambiguous: true, signal: 'counterparty', signals: ['counterparty'],
  statementLine: null, counterpartLine: AMB_BOUNCE,
  candidates: [
    { line: AMB_CAND_1, signals: ['counterparty'], signal: 'counterparty' },
    { line: AMB_CAND_2, signals: ['counterparty'], signal: 'counterparty' },
  ],
});

const FREE_PAIR = pair({
  groupKey: 'bp-free', confidence: 'review', signal: 'return_text', signals: ['return_text'],
  statementLine: FREE_ORIGINAL, counterpartLine: FREE_BOUNCE,
});
const ORPHAN_PAIR = pair({
  groupKey: 'bp-orph', confidence: 'review', signal: 'return_text', signals: ['return_text'],
  statementLine: ORPHAN_ORIGINAL, counterpartLine: ORPHAN_BOUNCE,
});
// AMB2: a second AMBIGUOUS pair that shares the candidate AMB_CAND_2 with the first one.
const AMB_CAND_3 = { id: 'bsl-amb-out-3', date: day(4), description: 'Pago ACME factura 4', amount: -80, referenceNo: 'REF-AMB-OUT-3' };
const AMB2_BOUNCE = { id: 'bsl-amb2-in', date: day(2), description: 'Abono ACME 2', amount: 80, referenceNo: 'REF-AMB2-IN' };
const AMB2_PAIR = pair({
  groupKey: 'bp-amb2', confidence: 'review', ambiguous: true, signal: 'counterparty', signals: ['counterparty'],
  statementLine: null, counterpartLine: AMB2_BOUNCE,
  candidates: [
    { line: AMB_CAND_2, signals: ['counterparty'], signal: 'counterparty' },
    { line: AMB_CAND_3, signals: ['counterparty'], signal: 'counterparty' },
  ],
});
// Pairs for the window of a pairable outflow (opposite sign, exact amount, at most 60 days apart,
// in EITHER direction): AFTER is dated after the ambiguous rejection; D60 / D61 are the outflow 60 /
// 61 days BEFORE its own rejection, D60B / D61B the outflow 60 / 61 days AFTER it.
const windowPair = (key, amount, outflowDay, rejectionDay) => pair({
  groupKey: `bp-${key}`, confidence: 'review', signal: 'return_text', signals: ['return_text'],
  statementLine: { id: `bsl-${key}-out`, date: day(outflowDay), description: `Salida ${key}`, amount: -amount },
  counterpartLine: { id: `bsl-${key}-in`, date: day(rejectionDay), description: `RECHAZO ${key}`, amount },
});
const WINDOW_PAIRS = {
  after: windowPair('after', 80, 1, 0),
  d60: windowPair('d60', 61, 70, 10),
  d61: windowPair('d61', 62, 71, 10),
  d60b: windowPair('d60b', 63, 10, 70),
  d61b: windowPair('d61b', 64, 10, 71),
};
const EXTRA_PAIRS = { free: FREE_PAIR, orphan: ORPHAN_PAIR, amb2: AMB2_PAIR, ...WINDOW_PAIRS };

/** The `bouncePair` annotation `pendingLines` puts on each line of a pair. */
function annotate(group, role, counterpartLine, extra = {}) {
  return {
    groupKey: group.groupKey, role, ambiguous: !!group.ambiguous, confidence: group.confidence,
    signals: group.signals, signal: group.signal, counterpartLine, ...extra,
  };
}

const bounceLine = (line, annotation) => ({
  ...line, status: 'pending', state: 'bounce', bouncePair: annotation,
});

const PENDING_LINES = [
  { ...TX_LINE, status: 'pending', state: 'suggested' },
  bounceLine(HIGH_ORIGINAL, annotate(HIGH_PAIR, 'original', HIGH_BOUNCE)),
  bounceLine(HIGH_BOUNCE, annotate(HIGH_PAIR, 'bounce', HIGH_ORIGINAL)),
  bounceLine(REVIEW_ORIGINAL, annotate(REVIEW_PAIR, 'original', REVIEW_BOUNCE)),
  bounceLine(REVIEW_BOUNCE, annotate(REVIEW_PAIR, 'bounce', REVIEW_ORIGINAL)),
  bounceLine(AMB_CAND_1, annotate(AMB_PAIR, 'candidate', AMB_BOUNCE)),
  bounceLine(AMB_CAND_2, annotate(AMB_PAIR, 'candidate', AMB_BOUNCE)),
  bounceLine(AMB_BOUNCE, annotate(AMB_PAIR, 'bounce', null, { candidates: AMB_PAIR.candidates })),
];
const PENDING_COUNTS = {
  all: PENDING_LINES.length, pending: 0, suggested: 1, byRule: 0, difference: 0, reconciled: 0,
  bounce: PENDING_LINES.length - 1, discarded: 2, discardedPairs: 1,
};

const DISCARDED_AT = `${day(20)}T09:30:00Z`;
const DISCARDED_LINES = [
  {
    id: 'bsl-disc-out', date: day(25), description: 'Cuota seguro', amount: -60,
    status: 'discarded', state: 'discarded', discarded: true,
    bounceLink: { counterpartLineId: 'bsl-disc-in', discardedAt: DISCARDED_AT, signal: 'pis_link', confidence: 'high' },
  },
  {
    id: 'bsl-disc-in', date: day(22), description: 'Devolucion cuota seguro', amount: 60,
    status: 'discarded', state: 'discarded', discarded: true,
    bounceLink: { counterpartLineId: 'bsl-disc-out', discardedAt: DISCARDED_AT, signal: 'pis_link', confidence: 'high' },
  },
];

// ETP-6359 — when "No es un rechazo" was stored: the backend puts `bounceDismissedAt` on the pair's
// rejection line, which is a plain pending line from then on. MARKED_LINE is one such line.
const DISMISSED_MARK_AT = `${day(1)}T10:00:00Z`;
const MARKED_LINE = {
  id: 'bsl-marked-in', date: day(6), description: 'ABONO CLIENTE SIN RECHAZO', amount: 15,
  status: 'pending', state: 'pending', bounceDismissedAt: DISMISSED_MARK_AT,
};

/**
 * The answers once "No es un rechazo" is stored for the pair `statementLineId` belongs to: its group
 * leaves the automatch answer, its lines are plain pending lines and the rejection carries the mark.
 */
function withoutDismissedPair(data, statementLineId) {
  const key = data.lines.find((l) => l.id === statementLineId)?.bouncePair?.groupKey;
  if (!key) return data;
  const freed = data.lines.filter((l) => l.bouncePair?.groupKey === key).length;
  const lines = data.lines.map((l) => {
    if (l.bouncePair?.groupKey !== key) return l;
    const { bouncePair: annotation, ...plain } = l;
    return { ...plain, state: 'pending', ...(annotation.role === 'bounce' ? { bounceDismissedAt: DISMISSED_MARK_AT } : {}) };
  });
  return {
    groups: data.groups.filter((g) => g.groupKey !== key),
    kpis: { ...data.kpis, bouncePairs: data.kpis.bouncePairs - 1 },
    lines,
    counts: { ...data.counts, bounce: data.counts.bounce - freed, pending: data.counts.pending + freed },
  };
}

/** The flag-on answer, and the flag-off one (no kind, no bouncePairs, no bounce state). */
function answers(flagOn) {
  if (flagOn) {
    return {
      groups: [TX_GROUP, HIGH_PAIR, REVIEW_PAIR, AMB_PAIR],
      kpis: { pendingLines: PENDING_LINES.length, groupsFound: 1, opsToLink: 1, willCreate: 0, bouncePairs: 3 },
      lines: PENDING_LINES,
      counts: PENDING_COUNTS,
    };
  }
  const { kind: _kind, ...flagOffGroup } = TX_GROUP;
  const plain = [TX_LINE, HIGH_ORIGINAL, HIGH_BOUNCE].map((l, i) => ({
    ...l, status: 'pending', state: i === 0 ? 'suggested' : 'pending',
  }));
  return {
    groups: [flagOffGroup],
    kpis: { pendingLines: plain.length, groupsFound: 1, opsToLink: 1, willCreate: 0 },
    lines: plain,
    counts: { all: plain.length, pending: 2, suggested: 1, byRule: 0, difference: 0, reconciled: 0 },
  };
}

/**
 * What the backend answers after the FREE pick of the 'free' pair's original was discarded against
 * the ambiguous pair's rejection: both of those lines are gone, and the 'free' rejection is
 * re-detected against the candidates the ambiguous pair freed (a new ambiguous pair).
 */
function freeReloadAnswer() {
  const candidates = [AMB_CAND_1, AMB_CAND_2].map((line) => ({ line, signals: ['counterparty'], signal: 'counterparty' }));
  const reGroup = pair({
    groupKey: 'bp-free-re', confidence: 'review', ambiguous: true, signal: 'counterparty', signals: ['counterparty'],
    statementLine: null, counterpartLine: FREE_BOUNCE, candidates,
  });
  const lines = [
    { ...TX_LINE, status: 'pending', state: 'suggested' },
    bounceLine(HIGH_ORIGINAL, annotate(HIGH_PAIR, 'original', HIGH_BOUNCE)),
    bounceLine(HIGH_BOUNCE, annotate(HIGH_PAIR, 'bounce', HIGH_ORIGINAL)),
    bounceLine(REVIEW_ORIGINAL, annotate(REVIEW_PAIR, 'original', REVIEW_BOUNCE)),
    bounceLine(REVIEW_BOUNCE, annotate(REVIEW_PAIR, 'bounce', REVIEW_ORIGINAL)),
    bounceLine(AMB_CAND_1, annotate(reGroup, 'candidate', FREE_BOUNCE)),
    bounceLine(AMB_CAND_2, annotate(reGroup, 'candidate', FREE_BOUNCE)),
    bounceLine(FREE_BOUNCE, annotate(reGroup, 'bounce', null, { candidates })),
  ];
  return {
    groups: [TX_GROUP, HIGH_PAIR, REVIEW_PAIR, reGroup],
    kpis: { pendingLines: lines.length, groupsFound: 1, opsToLink: 1, willCreate: 0, bouncePairs: 3 },
    lines,
    counts: { ...PENDING_COUNTS, all: lines.length, bounce: lines.length - 1 },
  };
}

const MOVEMENTS_PAYLOAD = {
  response: {
    data: {
      transactions: [],
      totals: { balance: 1000, inflows: 0, outflows: 0, currency: 'EUR' },
      paymentMethods: [],
      trxTypes: [],
      enabledDimensions: [],
      headerDimensions: [],
    },
  },
};

const LONG_BANK_TEXT = `TRANSFERENCIA INMEDIATA A FAVOR DE ACME SUMINISTROS INDUSTRIALES SL CONCEPTO PAGO FACTURA 10000268 ${'ES9121000418450200051332'.repeat(6)} ${'OBSERVACIONES DEL BANCO '.repeat(8)}`;

const json = (route, body, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

/**
 * Installs every route the account detail's reconciliation tab needs and records the POSTs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ flagOn?: boolean, dismissPairStatus?: number, refusePairs?: string[],
 *   ai?: object|null, discardPairStale?: boolean }} [opts]
 *   `refusePairs`: `statementLineId`s of the bounce pairs `applySuggestions` refuses with the coded
 *   "has payment" refusal (HTTP 201, the reason travels in `results[]`), or `{ statementLineId,
 *   counterpartLineId?, code, key, times? }` for another coded refusal (stale AI, LINE_NOT_PENDING).
 *   `ai`: the `bounceAiAssessments` the autoMatch answer carries (ETP-6359); null = none, as with
 *   the backend-only AI flag off. `discardPairStale`: `discardPair` answers the 409 stale-AI refusal (true = always, N = the first N
 *   calls). `aiAfterReload`: the AI layer of the automatch answers after the first one.
 *   `longDescriptions`: the second candidate and the bounce carry a very long bank text.
 *   `discardRefusals`: refusals (`{ status, code, key }`) the first `discardPair` calls answer, in
 *   order (409 HAS_PAYMENT / AMOUNT_MISMATCH / DISCARD_NOT_ALLOWED). `reloadAfterDiscard`: 'free'
 *   = once a discard succeeds, the lines / groups the next reads answer are those of FREE_RELOAD
 *   (the discarded pair's lines are gone and the other pair is re-detected).
 *   `extraPairs`: 'free' and/or 'orphan', see EXTRA_PAIRS. `onlyPairs`: the answer holds possible
 *   rejections only (no transaction group). `markedLine`: the answer also holds MARKED_LINE.
 *   A successful `dismissPair` stores the dismissal (`withoutDismissedPair`), and a
 *   `restoreBounceSuggestion` clears the line's mark, for the reads that follow.
 * @returns {Promise<{ posts: Record<string, object[]>, pendingQueries: URLSearchParams[],
 *   autoMatchRequests: { count: number } }>}
 */
async function installMocks(page, {
  flagOn = true, dismissPairStatus = 200, refusePairs = [], ai = null, discardPairStale = false,
  longDescriptions = false, aiAfterReload, extraPairs = [], onlyPairs = false, discardRefusals = [], reloadAfterDiscard = null,
  markedLine = false,
} = {}) {
  let data = answers(flagOn);
  if (markedLine) {
    data = {
      ...data,
      lines: [...data.lines, MARKED_LINE],
      counts: { ...data.counts, all: data.counts.all + 1, pending: data.counts.pending + 1 },
    };
  }
  if (onlyPairs) {
    // A run that found only possible rejections: no transaction group, and its line is not pending.
    data = {
      ...data,
      groups: data.groups.filter((g) => g.kind === 'bouncePair'),
      kpis: { ...data.kpis, groupsFound: 0, opsToLink: 0 },
      lines: data.lines.filter((l) => l.id !== TX_LINE.id),
      counts: { ...data.counts, all: data.counts.all - 1, suggested: 0 },
    };
  }
  for (const key of extraPairs) {
    const group = EXTRA_PAIRS[key];
    const extraLines = group.ambiguous ? [
      bounceLine(AMB_CAND_3, annotate(group, 'candidate', group.counterpartLine)),
      bounceLine(group.counterpartLine, annotate(group, 'bounce', null, { candidates: group.candidates })),
    ] : [
      bounceLine(group.statementLine, annotate(group, 'original', group.counterpartLine)),
      bounceLine(group.counterpartLine, annotate(group, 'bounce', group.statementLine)),
    ];
    data = {
      ...data,
      groups: [...data.groups, group],
      kpis: { ...data.kpis, bouncePairs: data.kpis.bouncePairs + 1, pendingLines: data.kpis.pendingLines + 2 },
      lines: [...data.lines, ...extraLines],
      counts: { ...data.counts, all: data.counts.all + 2, bounce: data.counts.bounce + 2 },
    };
  }
  if (longDescriptions) {
    // The bank text of the second candidate and of the bounce, as very long strings (one with an
    // unbroken IBAN-like token), in the groups and in the panel's lines alike.
    data = JSON.parse(JSON.stringify(data)
      .replaceAll(AMB_CAND_2.description, LONG_BANK_TEXT)
      .replaceAll(AMB_BOUNCE.description, LONG_BANK_TEXT));
  }
  // `discardPairStale`: true = every discardPair is refused as stale; a number = the first N only.
  let staleLeft = discardPairStale === true ? Infinity : Number(discardPairStale) || 0;
  const refusalsLeft = [...discardRefusals];
  let reloadPending = reloadAfterDiscard;
  const posts = {
    discardPair: [], restorePair: [], applySuggestions: [], dismissPair: [], restoreBounceSuggestion: [],
  };
  const pendingQueries = [];
  const autoMatchRequests = { count: 0 };

  await page.route(/\/sws\/neo\/financial-account\/account\?/, async (route) => {
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    await json(route, { response: { data: [ACCOUNT], totalRows: 1, summary: SUMMARY } });
  });
  await page.route('**/sws/neo/financial-accounts-page', (route) => json(route, {
    response: { data: { accounts: [ACCOUNT], summary: SUMMARY } },
  }));
  const transactions = (route) => json(route, MOVEMENTS_PAYLOAD);
  await page.route('**/sws/neo/financial-account-transactions/**', transactions);
  await page.route('**/sws/neo/financial-account-transactions**', transactions);

  await page.route(/\/sws\/neo\/bank-reconciliation\?/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.searchParams.get('action');

    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() ?? '{}');
      if (action === 'discardPair') {
        posts.discardPair.push(body);
        const refusal = refusalsLeft.shift();
        if (refusal) {
          await json(route, {
            error: { status: refusal.status ?? 409, code: refusal.code, message: 'Refused', messageKeys: [refusal.key] },
          }, refusal.status ?? 409);
          return;
        }
        if (staleLeft > 0) {
          staleLeft -= 1;
          const message = 'The AI suggestion is stale';
          await json(route, {
            error: { status: 409, code: 'BOUNCE_AI_SUGGESTION_STALE', message, messageKeys: ['ETGO_BounceAiSuggestionStale'] },
          }, 409);
          return;
        }
        if (reloadPending === 'free') { data = freeReloadAnswer(); reloadPending = null; }
        await json(route, { response: { data: { discarded: true, ...body, signal: 'counterparty', confidence: 'review' } } });
        return;
      }
      if (action === 'dismissPair') {
        posts.dismissPair.push(body);
        if (dismissPairStatus !== 200) {
          await json(route, { error: { status: dismissPairStatus, message: 'Internal error' } }, dismissPairStatus);
          return;
        }
        data = withoutDismissedPair(data, body.statementLineId);
        await json(route, { response: { data: { ok: true, dismissedLineId: body.statementLineId, bounceDismissedAt: DISMISSED_MARK_AT } } });
        return;
      }
      if (action === 'restoreBounceSuggestion') {
        posts.restoreBounceSuggestion.push(body);
        data = {
          ...data,
          lines: data.lines.map((l) => {
            if (l.id !== body.statementLineId) return l;
            const { bounceDismissedAt: _mark, ...unmarked } = l;
            return unmarked;
          }),
        };
        await json(route, { response: { data: { restored: true, statementLineId: body.statementLineId } } });
        return;
      }
      if (action === 'restorePair') {
        posts.restorePair.push(body);
        await json(route, { response: { data: { restored: ['bsl-disc-out', 'bsl-disc-in'], lineId: body.lineId, counterpartLineId: 'bsl-disc-in' } } });
        return;
      }
      if (action === 'applySuggestions') {
        posts.applySuggestions.push(body);
        const results = (body.groups ?? []).map((g) => {
          if (g.kind !== 'bouncePair') return { statementLineId: g.statementLineId, reconciliationId: 'rec-1' };
          const base = { kind: 'bouncePair', statementLineId: g.statementLineId, counterpartLineId: g.counterpartLineId };
          // `refusePairs`: a plain statementLineId (HAS_PAYMENT) or `{ statementLineId, counterpartLineId?,
          // code, key, times? }` (e.g. the stale-AI refusal, answered the first `times` calls only).
          const refusal = refusePairs.map((r) => (typeof r === 'string'
            ? { statementLineId: r, code: 'HAS_PAYMENT', key: 'ETGO_BounceHasPayment' } : r))
            .find((r) => r.statementLineId === g.statementLineId
              && (r.counterpartLineId == null || r.counterpartLineId === g.counterpartLineId)
              && (r.times == null || (r.used = (r.used ?? 0) + 1) <= r.times));
          if (!refusal) return { ...base, discarded: true };
          const message = 'Refused';
          return {
            ...base, code: refusal.code, message,
            error: { message, status: 409, code: refusal.code, messageKeys: [refusal.key] },
          };
        });
        await json(route, { response: { data: { results } } }, 201);
        return;
      }
      await route.fallback();
      return;
    }

    if (action === 'autoMatch') {
      autoMatchRequests.count += 1;
      // `aiAfterReload` (when given) is the AI layer of every automatch after the first one: the
      // fresh answer the host fetches after a write (null = the fresh answer carries no AI).
      const aiNow = autoMatchRequests.count > 1 && aiAfterReload !== undefined ? aiAfterReload : ai;
      await json(route, {
        response: { data: { groups: data.groups, kpis: data.kpis, ...(aiNow ? { bounceAiAssessments: aiNow } : {}) } },
      });
      return;
    }
    if (action === 'pendingLines') {
      pendingQueries.push(url.searchParams);
      const discarded = url.searchParams.get('status') === 'discarded';
      const lines = discarded ? DISCARDED_LINES : data.lines;
      const counts = discarded ? { discarded: DISCARDED_LINES.length, discardedPairs: 1 } : data.counts;
      await json(route, { response: { data: { lines, total: lines.length, counts, draftReconciliationCount: 0 } } });
      return;
    }
    if (action === 'candidates') {
      await json(route, { response: { data: { candidates: [], counts: {} } } });
      return;
    }
    await route.fallback();
  });

  return { posts, pendingQueries, autoMatchRequests };
}

/** Opens the reconciliation tab; the automatch modal pops once the suggestions land. */
async function openReconciliation(page) {
  await page.goto(`/financial-account/${ACCOUNT_ID}?tab=reconciliation`);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await expect(page.getByTestId('detail-tab-reconciliation')).toBeVisible();
}

const modal = (page) => page.getByTestId('automatch-suggestion-modal');
// The ONE outflow an ambiguous pair's row shows in the modal (its left side), and that row's AI mark.
const shownOutflow = (page, key = 'bp-amb') => page.getByTestId(`automatch-bounce-original-${key}`);
const rowPct = (page, key = 'bp-amb') => page.getByTestId(`automatch-bounce-ai-pct-${key}`);
const pairCheck = (page, key) => page.getByTestId(`automatch-bounce-check-${key}`);
// The shared Checkbox puts the test id on its <label>; the state lives on the input inside it.
const pairInput = (page, key) => pairCheck(page, key).getByRole('checkbox');
const excludeButton = (page) => page.getByTestId('automatch-bounce-exclude');
const applyButton = (page) => page.getByTestId('automatch-modal-apply');
const closeConfirm = (page) => page.getByTestId('automatch-close-confirm');
const confirmClose = (page) => page.getByTestId('automatch-close-confirm-action');
const keepWorking = (page) => page.getByTestId('automatch-close-keep');
const requestsOf = (page, action) => page.waitForRequest(
  (r) => r.method() === 'POST' && r.url().includes(`action=${action}`));

/**
 * A deterministic barrier for "nothing else happened" assertions (instead of a fixed sleep): two
 * animation frames let any pending render / handler run, then a round trip through the page's own
 * routes (answered in order) guarantees every request the page made before it has already been
 * seen by the route handlers and the `request` listeners.
 */
async function settle(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await fetch('/sws/neo/bank-reconciliation?action=candidates').then((r) => r.text());
  });
}

/**
 * Activates "Descartar par" from the keyboard. A toast of a previous attempt sits over the
 * bottom-right footer and intercepts the pointer (and Sonner keeps it open while the cursor is over
 * it), so the retry does not depend on the toast being gone.
 */
async function pressDiscard(page) {
  const button = page.getByTestId('recon-bounce-panel').getByTestId('recon-bounce-discard');
  await button.focus();
  await page.keyboard.press('Enter');
}

/** The X of the modal's own dialog (the close-confirmation dialog has its own, and is not open). */
const modalX = (page) => modal(page).getByRole('button', { name: 'Close' });

/**
 * Closes the modal while rows are checked: `via` triggers the close, the confirmation appears and
 * "Cerrar" confirms it.
 */
async function closeThroughConfirmation(page, via) {
  await via();
  await expect(closeConfirm(page)).toBeVisible();
  await confirmClose(page).click();
  await expect(modal(page)).toHaveCount(0);
}

test.describe('Reconciliation — bounce-pair suggestions (mocked)', () => {
  test('the automatch modal opens with the yellow card above the green one and the default checks', async ({ page }) => {
    await login(page);
    await installMocks(page);
    await openReconciliation(page);

    await expect(modal(page)).toBeVisible();
    const section = modal(page).getByTestId('automatch-bounce-section');
    const statements = modal(page).getByTestId('automatch-statements-section');
    await expect(section).toBeVisible();
    await expect(statements).toBeVisible();
    // The yellow card of the possible rejections sits ABOVE the green card of the statement lines.
    const [sectionBox, statementsBox] = [await section.boundingBox(), await statements.boundingBox()];
    expect(sectionBox.y).toBeLessThan(statementsBox.y);
    await expect(section).toContainText('Posibles rechazos bancarios');
    await expect(statements).toContainText('Líneas del extracto bancario');
    await expect(section.getByTestId('automatch-bounce-count')).toHaveText('3');
    // The UI's own wording is "rechazo", never "rebote" nor "devolución" (the bank descriptions may say it).
    await expect(section).toContainText('Detectamos movimientos que el banco rechazó');
    await expect(section.locator('h3')).not.toContainText(/rebote|devoluci[oó]n/i);
    await expect(section.getByText(/^Detectamos movimientos/)).not.toContainText(/rebote|devoluci[oó]n/i);
    // The KPI strip: "Posibles rechazos" with the same figure as the card header.
    const kpi = modal(page).getByText('Posibles rechazos', { exact: true });
    await expect(kpi).toHaveCount(1);
    await expect(kpi.locator('xpath=following-sibling::span')).toHaveText('3');

    // No global footer: each card owns its info sentence and its button.
    await expect(page.getByTestId('automatch-modal-cancel')).toHaveCount(0);
    await expect(modal(page).getByRole('button', { name: 'Cancelar' })).toHaveCount(0);
    await expect(section.getByTestId('Info__automatch-card')).toBeVisible();
    await expect(statements.getByTestId('Info__automatch-card')).toBeVisible();
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (1)');
    await expect(applyButton(page)).toHaveText('Conciliar seleccionadas (1)');
    await expect(section.getByTestId('automatch-bounce-exclude')).toBeVisible();
    await expect(statements.getByTestId('automatch-modal-apply')).toBeVisible();

    await expect(pairInput(page, 'bp-high')).toHaveAttribute('aria-checked', 'true');
    await expect(pairInput(page, 'bp-review')).toHaveAttribute('aria-checked', 'false');
    // The ambiguous pair is never checked by default.
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('automatch-bounce-tag-high-bp-high')).toBeVisible();
    await expect(page.getByTestId('automatch-bounce-review-bp-amb')).toBeVisible();
    await expect(page.getByTestId('automatch-bounce-review-bp-high')).toHaveCount(0);
    // The badge and the reason are separate elements: "Revisar" + "rechazo 3 día(s) después".
    const reviewTag = page.getByTestId('automatch-bounce-tag-review-bp-review');
    const reviewReason = page.getByTestId('automatch-bounce-reason-bp-review');
    await expect(reviewTag).toHaveText('Revisar');
    await expect(reviewReason).toContainText('rechazo 3 día(s) después');
    await expect(reviewReason).not.toContainText(/devoluci[oó]n/i);
    // The bounce of the ambiguous pair names its bank reference; the reason says how many outflows
    // are possible. There is no outflow selector in the modal.
    await expect(page.getByTestId('automatch-bounce-line-meta-bp-amb')).toContainText(`Ref. ${AMB_BOUNCE.referenceNo}`);
    await expect(page.getByTestId('automatch-bounce-reason-bp-amb')).toHaveText('2 salidas posibles');
    await expect(page.getByTestId('automatch-bounce-row-bp-amb').getByRole('radio')).toHaveCount(0);
    await expect(modal(page).locator('[data-testid^="automatch-bounce-pick-"]')).toHaveCount(0);
  });

  test('"Revisar en el panel" on the ambiguous pair, then "Descartar par" sends discardPair', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await page.getByTestId('automatch-bounce-review-bp-amb').click();

    await expect(modal(page)).toHaveCount(0);
    // No review banner and no way back: the Automatch button is how the user returns.
    await expect(page.getByTestId('recon-bounce-review-banner')).toHaveCount(0);
    await expect(page.getByTestId('recon-bounce-review-back')).toHaveCount(0);
    // The filter moved to "Posibles rechazos": the suggested transaction line is gone.
    // The figure is the number of PAIRS (3), not the backend's count of lines.
    await expect(page.getByRole('button', { name: /^Posibles rechazos \(3\)/ })).toBeVisible();
    // The rejection is selected directly: the right side is never the placeholder.
    await expect(page.getByTestId('recon-right-empty')).toHaveCount(0);
    await expect(page.getByTestId(`recon-line-row-${TX_LINE.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`recon-line-radio-${AMB_BOUNCE.id}`)).toBeChecked();

    const panel = page.getByTestId('recon-bounce-panel');
    await expect(panel).toBeVisible();
    // No AI data: the panel opens on the outflow the modal row showed (the first candidate).
    await expectOpensOn(panel, AMB_CAND_1, AMB_CAND_2);
    // Each candidate row shows its bank reference; the footer opens with the selected bounce.
    await expect(panel.getByTestId(`recon-bounce-ref-${AMB_CAND_1.id}`)).toHaveText(`Ref. ${AMB_CAND_1.referenceNo}`);
    await expect(panel.getByTestId(`recon-bounce-ref-${AMB_CAND_2.id}`)).toHaveText(`Ref. ${AMB_CAND_2.referenceNo}`);
    await expect(panel.getByTestId('recon-bounce-total-selected')).toContainText('Rechazo seleccionado');
    await expect(panel.getByTestId('recon-bounce-total-selected-meta')).toContainText(`Ref. ${AMB_BOUNCE.referenceNo}`);
    // The clipped description reveals its full text on hover.
    await panel.getByTestId(`recon-bounce-desc-${AMB_CAND_1.id}`).hover();
    await expect(page.getByTestId(`recon-bounce-desc-${AMB_CAND_1.id}-tooltip`)).toContainText(AMB_LONG_DESC);

    await panel.getByTestId(`recon-bounce-radio-${AMB_CAND_2.id}`).check();
    await expect(panel.getByTestId('recon-bounce-discard')).toBeEnabled();
    await expect(panel.getByTestId('recon-bounce-total-other-meta')).toContainText(`Ref. ${AMB_CAND_2.referenceNo}`);

    const post = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('action=discardPair'));
    await panel.getByTestId('recon-bounce-discard').click();
    await post;

    // An outflow the user picked in the panel is a user choice, also with no AI data.
    expect(posts.discardPair).toEqual([{
      financialAccountId: ACCOUNT_ID,
      statementLineId: AMB_CAND_2.id,
      counterpartLineId: AMB_BOUNCE.id,
      choiceSource: 'user',
    }]);
    await expect(page.locator('[data-type="success"]').first()).toBeVisible();
    // A discard reloads the suggestions, but never pops the modal again on its own.
    await expect(modal(page)).toHaveCount(0);
  });

  test('the Automatch button reopens the modal with the checks kept, and "Conciliar seleccionadas" sends only the groups plus the bounceDecisions', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await pairCheck(page, 'bp-review').click();
    await expect(pairInput(page, 'bp-review')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('automatch-bounce-review-bp-amb').click();
    await expect(modal(page)).toHaveCount(0);

    // Back through the Automatch button: the suggestions did not reload, so the checks are kept.
    await page.getByTestId('financial-account-automatch').click();
    await expect(modal(page)).toBeVisible();
    await expect(pairInput(page, 'bp-high')).toHaveAttribute('aria-checked', 'true');
    await expect(pairInput(page, 'bp-review')).toHaveAttribute('aria-checked', 'true');
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (2)');

    const post = requestsOf(page, 'applySuggestions');
    await applyButton(page).click();
    await post;

    // The pairs are NOT applied here (Excluir does that): the call carries the transaction group
    // only, and reports every pair still on screen, checked or not, because none was excluded.
    expect(posts.applySuggestions).toHaveLength(1);
    expect(posts.applySuggestions[0]).toEqual({
      financialAccountId: ACCOUNT_ID,
      groups: [{ statementLineId: TX_LINE.id, operationIds: ['trx-1'] }],
      bounceDecisions: [
        { groupKey: 'bp-high', decision: 'unchecked' },
        { groupKey: 'bp-review', decision: 'unchecked' },
        { groupKey: 'bp-amb', decision: 'sent_to_panel' },
      ],
    });
    await expect(modal(page)).toHaveCount(0);
    await expect(page.locator('[data-type="success"]').first()).toBeVisible();
  });

  test('"Excluir de la conciliación" is immediate: one call with only the pairs, the rows leave without a refetch', async ({ page }) => {
    await login(page);
    const { posts, autoMatchRequests } = await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (1)');
    const autoMatchBefore = autoMatchRequests.count;

    const post = requestsOf(page, 'applySuggestions');
    await excludeButton(page).click();
    await post;

    expect(posts.applySuggestions).toHaveLength(1);
    expect(posts.applySuggestions[0]).toEqual({
      financialAccountId: ACCOUNT_ID,
      groups: [{ kind: 'bouncePair', statementLineId: HIGH_ORIGINAL.id, counterpartLineId: HIGH_BOUNCE.id }],
    });
    expect(posts.applySuggestions[0]).not.toHaveProperty('bounceDecisions');

    // The excluded row is gone, the KPI and the count drop, the modal stays open.
    await expect(page.getByTestId('automatch-bounce-row-bp-high')).toHaveCount(0);
    await expect(page.getByTestId('automatch-bounce-row-bp-review')).toBeVisible();
    await expect(modal(page).getByTestId('automatch-bounce-count')).toHaveText('2');
    const kpi = modal(page).getByText('Posibles rechazos', { exact: true });
    await expect(kpi.locator('xpath=following-sibling::span')).toHaveText('2');
    await expect(page.locator('[data-type="success"]').first()).toContainText('1 rechazo(s) excluido(s) de la conciliación');
    await expect(modal(page)).toBeVisible();
    // The transaction group is untouched and still checked; nothing reloaded the suggestions.
    await expect(applyButton(page)).toHaveText('Conciliar seleccionadas (1)');
    expect(autoMatchRequests.count).toBe(autoMatchBefore);
    // Nothing is checked among the pairs that stayed: the button is disabled at N=0.
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (0)');
    await expect(excludeButton(page)).toBeDisabled();
  });

  test('"Excluir de la conciliación" after select-all sends every pair, the AI-rated ambiguous one with the outflow its row shows', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { ai: AI_85_10 });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await page.getByTestId('automatch-bounce-select-all').click();
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (3)');
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'true');
    const post = requestsOf(page, 'applySuggestions');
    await excludeButton(page).click();
    await post;

    // The ambiguous pair travels as a plain bouncePair group with its shown outflow (the
    // AI-recommended one) and choiceSource "ai".
    expect(posts.applySuggestions[0].groups).toEqual([
      { kind: 'bouncePair', statementLineId: HIGH_ORIGINAL.id, counterpartLineId: HIGH_BOUNCE.id },
      { kind: 'bouncePair', statementLineId: REVIEW_ORIGINAL.id, counterpartLineId: REVIEW_BOUNCE.id },
      { kind: 'bouncePair', statementLineId: AMB_CAND_2.id, counterpartLineId: AMB_BOUNCE.id, choiceSource: 'ai' },
    ]);
    // Every pair was excluded, the ambiguous one included.
    await expect(page.getByTestId('automatch-bounce-row-bp-amb')).toHaveCount(0);
    await expect(page.getByTestId('automatch-bounce-row-bp-review')).toHaveCount(0);
    await expect(page.locator('[data-type="success"]').first()).toContainText('3 rechazo(s) excluido(s) de la conciliación');
  });

  test('"Excluir de la conciliación" is disabled with no pair checked and sends nothing', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await pairCheck(page, 'bp-high').click();
    await expect(pairInput(page, 'bp-high')).toHaveAttribute('aria-checked', 'false');
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (0)');
    await expect(excludeButton(page)).toBeDisabled();
    await excludeButton(page).click({ force: true });
    await settle(page);
    expect(posts.applySuggestions).toEqual([]);
  });

  test('a pair the backend refuses stays on screen with a translated error; the others are excluded', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { refusePairs: [REVIEW_ORIGINAL.id] });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await pairCheck(page, 'bp-review').click();
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (2)');
    const post = requestsOf(page, 'applySuggestions');
    await excludeButton(page).click();
    await post;
    expect(posts.applySuggestions[0].groups).toHaveLength(2);

    // Partial: a warning with the count and the translated coded refusal (not the English text).
    const warning = page.locator('[data-type="warning"]').first();
    await expect(warning).toContainText('1 rechazo(s) excluido(s) de la conciliación');
    await expect(warning).toContainText('1 rechazo(s) no se pudieron excluir');
    await expect(warning).toContainText('pago registrado en Etendo');
    await expect(warning).not.toContainText('One of the lines');
    await expect(page.getByTestId('automatch-bounce-row-bp-high')).toHaveCount(0);
    await expect(page.getByTestId('automatch-bounce-row-bp-review')).toBeVisible();
    await expect(modal(page).getByTestId('automatch-bounce-count')).toHaveText('2');
    await expect(modal(page)).toBeVisible();
  });

  test('every pair refused: an error toast with the translated refusal and every row stays', async ({ page }) => {
    await login(page);
    await installMocks(page, { refusePairs: [HIGH_ORIGINAL.id] });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await excludeButton(page).click();
    const error = page.locator('[data-type="error"]').first();
    await expect(error).toContainText('pago registrado en Etendo');
    await expect(error).not.toContainText('One of the lines');
    await expect(page.locator('[data-type="success"]')).toHaveCount(0);
    await expect(page.getByTestId('automatch-bounce-row-bp-high')).toBeVisible();
    await expect(modal(page).getByTestId('automatch-bounce-count')).toHaveText('3');
  });

  test('closing with rows checked asks first: "Seguir trabajando" keeps the selection, "Cerrar" closes', async ({ page }) => {
    await login(page);
    await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await pairCheck(page, 'bp-review').click();

    // X, Esc and "Ir a conciliación manual" all ask before closing; "Seguir trabajando" keeps the
    // modal and the selection as they were.
    for (const via of [
      () => modalX(page).click(),
      () => page.keyboard.press('Escape'),
      () => page.getByTestId('automatch-modal-open-reconciliation').click(),
    ]) {
      await via();
      await expect(closeConfirm(page)).toBeVisible();
      await expect(closeConfirm(page)).toContainText('¿Deseas cerrar la ventana?');
      await keepWorking(page).click();
      await expect(closeConfirm(page)).toHaveCount(0);
      await expect(modal(page)).toBeVisible();
      await expect(pairInput(page, 'bp-high')).toHaveAttribute('aria-checked', 'true');
      await expect(pairInput(page, 'bp-review')).toHaveAttribute('aria-checked', 'true');
    }

    await closeThroughConfirmation(page, () => page.getByTestId('automatch-modal-open-reconciliation').click());
    // The suggestions are kept by the host: the Automatch button reopens them as they were.
    await page.getByTestId('financial-account-automatch').click();
    await expect(modal(page)).toBeVisible();
    await expect(pairInput(page, 'bp-review')).toHaveAttribute('aria-checked', 'true');
  });

  test('the backdrop asks first too', async ({ page }) => {
    await login(page);
    await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await page.getByTestId('DialogOverlay__6a5928').last().click({ position: { x: 5, y: 5 } });
    await expect(closeConfirm(page)).toBeVisible();
    await keepWorking(page).click();
    await expect(modal(page)).toBeVisible();
    await expect(pairInput(page, 'bp-high')).toHaveAttribute('aria-checked', 'true');
  });

  test('with nothing checked there is no confirmation: X closes at once', async ({ page }) => {
    await login(page);
    await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    // Uncheck the one pair and the one group that start checked.
    await pairCheck(page, 'bp-high').click();
    await page.getByTestId('automatch-select-all').click();
    await expect(excludeButton(page)).toBeDisabled();
    await expect(applyButton(page)).toBeDisabled();

    await modalX(page).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(closeConfirm(page)).toHaveCount(0);
  });

  test('"Descartadas" lists the discarded pair and "Restaurar par" sends restorePair', async ({ page }) => {
    await login(page);
    const { posts, pendingQueries } = await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await closeThroughConfirmation(page, () => modalX(page).click());

    await page.getByRole('button', { name: /^Pendientes \(/ }).click();
    // The figure is the number of discarded PAIRS (`counts.discardedPairs`), not of lines.
    await page.getByRole('option', { name: /^Descartadas \(1\)/ }).click();

    // One row per pair, on its outflow (the earlier line): the rejection has no row on the left.
    const discardedRow = page.getByTestId('recon-line-row-bsl-disc-out');
    await expect(discardedRow).toBeVisible();
    await expect(page.getByTestId('recon-line-row-bsl-disc-in')).toHaveCount(0);
    expect(pendingQueries.some((q) => q.get('status') === 'discarded')).toBe(true);
    await expect(page.getByTestId(`recon-line-row-${TX_LINE.id}`)).toHaveCount(0);
    await expect(page.getByTestId('recon-right-empty')).toBeVisible();

    await discardedRow.click();
    const panel = page.getByTestId('recon-bounce-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('recon-bounce-row-bsl-disc-in')).toBeVisible();
    await expect(panel.getByTestId('recon-bounce-dismiss')).toHaveCount(0);
    // The footer names both lines of the pair, outflow first, then the net and "Restaurar par".
    await expect(panel.getByTestId('recon-bounce-total-selected')).toContainText('Salida descartada');
    await expect(panel.getByTestId('recon-bounce-total-other')).toContainText('Rechazo');
    await expect(panel.getByTestId('recon-bounce-total-net')).toBeVisible();
    await expect(panel.getByTestId('recon-bounce-restore')).toHaveText(/Restaurar par/);

    const post = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('action=restorePair'));
    await panel.getByTestId('recon-bounce-restore').click();
    await post;

    expect(posts.restorePair).toEqual([{ financialAccountId: ACCOUNT_ID, lineId: 'bsl-disc-out' }]);
    await expect(page.locator('[data-type="success"]').first()).toBeVisible();
  });

  test('flag off: no yellow card, no bounce KPI and the original apply payload', async ({ page }) => {
    await login(page);
    const { posts, pendingQueries } = await installMocks(page, { flagOn: false });
    await openReconciliation(page);

    await expect(modal(page)).toBeVisible();
    await expect(page.getByTestId('automatch-bounce-section')).toHaveCount(0);
    await expect(modal(page)).not.toContainText('Posibles rechazos');
    await expect(page.getByTestId('automatch-bounce-exclude')).toHaveCount(0);
    // The green card is the whole modal, with its own button.
    await expect(modal(page).getByTestId('automatch-statements-section')).toContainText('Líneas del extracto bancario');
    await expect(applyButton(page)).toHaveText('Conciliar seleccionadas (1)');

    const post = requestsOf(page, 'applySuggestions');
    await applyButton(page).click();
    await post;
    expect(posts.applySuggestions).toEqual([{
      financialAccountId: ACCOUNT_ID,
      groups: [{ statementLineId: TX_LINE.id, operationIds: ['trx-1'] }],
    }]);
    await expect(modal(page)).toHaveCount(0);

    // The panel offers neither of the bounce entries, and never asks for status=discarded.
    await page.getByRole('button', { name: /^Pendientes \(/ }).click();
    await expect(page.getByRole('option', { name: /^Conciliadas/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /^Posibles rechazos/ })).toHaveCount(0);
    await expect(page.getByRole('option', { name: /^Descartadas/ })).toHaveCount(0);
    expect(pendingQueries.every((q) => !q.has('status'))).toBe(true);
  });
});

const FINANCIAL_ACCOUNT_WINDOW_ID = '94EAA455D2644E04AB25D93BE5157B6D';

/** Records every `dismissPair` request the page attempts, whatever its answer. */
function recordDismissPairRequests(page) {
  const seen = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('action=dismissPair')) seen.push(req.url());
  });
  return seen;
}

/** Switches the panel to the "Posibles rechazos" entry of the status filter (the two tables). */
async function openPairView(page) {
  await page.getByRole('button', { name: /^Pendientes \(/ }).click();
  await page.getByRole('option', { name: /^Posibles rechazos/ }).click();
}

/**
 * Selects a rejection in the panel: in the pair view the rejection rows only exist once an outflow
 * is chosen, so the user clicks the outflow first, which selects the rejection it can be paired with.
 */
async function selectBounceLineInPanel(page, bounceId, outflowId) {
  await openPairView(page);
  await page.getByTestId(`recon-outflow-row-${outflowId}`).click();
  await page.getByTestId(`recon-line-row-${bounceId}`).click();
}

/**
 * "Revisar en el panel" on the pair `key` of the open modal: the modal closes and the panel shows
 * the pair's rejection. Returns the panel.
 */
async function reviewPairInPanel(page, key) {
  await expect(modal(page)).toBeVisible();
  await page.getByTestId(`automatch-bounce-review-${key}`).click();
  await expect(modal(page)).toHaveCount(0);
  const panel = page.getByTestId('recon-bounce-panel');
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * The panel opened from the modal on `outflow`, the one the modal row showed (ETP-6359): its radio
 * checked and `other` not, the footer naming it and "Descartar par" enabled. A preselection, not a
 * pick: the notice does not ask to choose.
 */
async function expectOpensOn(panel, outflow, other) {
  await expect(panel.getByTestId(`recon-bounce-radio-${outflow.id}`)).toBeChecked();
  await expect(panel.getByTestId(`recon-bounce-radio-${other.id}`)).not.toBeChecked();
  await expect(panel.getByTestId('recon-bounce-total-other-meta')).toContainText(`Ref. ${outflow.referenceNo}`);
  await expect(panel.getByTestId('recon-bounce-notice')).not.toContainText('Elige la salida original');
  await expect(panel.getByTestId('recon-bounce-discard')).toBeEnabled();
}

/** How many times the page has read the lines and the suggestions so far. */
const readsOf = (pendingQueries, autoMatchRequests) => ({
  lines: pendingQueries.length, autoMatch: autoMatchRequests.count,
});

/** Waits until both the lines and the suggestions were read again after `before`. */
async function expectReloaded(pendingQueries, autoMatchRequests, before) {
  await expect.poll(() => pendingQueries.length).toBeGreaterThan(before.lines);
  await expect.poll(() => autoMatchRequests.count).toBeGreaterThan(before.autoMatch);
}

/** Reopens the automatch modal with its button. */
async function reopenAutomatch(page) {
  await page.getByTestId('financial-account-automatch').click();
  await expect(modal(page)).toBeVisible();
}

test.describe('Reconciliation — bounce-pair KPI reporting (mocked)', () => {
  // ETP-6359 — "No es un rechazo" is stored: the pair is never proposed again.
  test('"No es un rechazo" posts dismissPair with both lines, then the lines and the suggestions reload without the pair', async ({ page }) => {
    await login(page);
    const { posts, pendingQueries, autoMatchRequests } = await installMocks(page);
    await openReconciliation(page);
    const panel = await reviewPairInPanel(page, 'bp-review');
    await expect(page.getByTestId(`recon-line-radio-${REVIEW_BOUNCE.id}`)).toBeChecked();
    const before = readsOf(pendingQueries, autoMatchRequests);

    const post = requestsOf(page, 'dismissPair');
    await panel.getByTestId('recon-bounce-dismiss').click();
    await post;

    expect(posts.dismissPair).toEqual([{
      financialAccountId: ACCOUNT_ID,
      statementLineId: REVIEW_BOUNCE.id,
      counterpartLineId: REVIEW_ORIGINAL.id,
    }]);
    await expect(page.locator('[data-type="success"]', { hasText: 'Marcada como no rechazo. No se volverá a sugerir.' })).toBeVisible();
    await expectReloaded(pendingQueries, autoMatchRequests, before);
    // Neither of its lines is left in either table, while the other pairs' outflows stay.
    await expect(page.getByTestId(`recon-line-row-${REVIEW_BOUNCE.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`recon-outflow-row-${REVIEW_ORIGINAL.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`recon-outflow-row-${HIGH_ORIGINAL.id}`)).toBeVisible();
    // The reopened modal, from the reloaded suggestions, does not offer it again.
    await reopenAutomatch(page);
    await expect(pairCheck(page, 'bp-high')).toBeVisible();
    await expect(pairCheck(page, 'bp-review')).toHaveCount(0);
  });

  test('a failing dismissPair shows an error toast and keeps the pair', async ({ page }) => {
    await login(page);
    const { posts, pendingQueries } = await installMocks(page, { dismissPairStatus: 500 });
    await openReconciliation(page);
    const panel = await reviewPairInPanel(page, 'bp-review');
    const linesRead = pendingQueries.length;

    const answered = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('action=dismissPair'));
    await panel.getByTestId('recon-bounce-dismiss').click();
    expect((await answered).status()).toBe(500);
    expect(posts.dismissPair).toHaveLength(1);

    await expect(page.locator('[data-type="error"]').first()).toBeVisible();
    await expect(page.locator('[data-type="success"]')).toHaveCount(0);
    // Nothing is hidden nor reloaded: the pair stays selected, in both tables.
    await expect(page.getByTestId(`recon-line-radio-${REVIEW_BOUNCE.id}`)).toBeChecked();
    await expect(page.getByTestId(`recon-outflow-row-${REVIEW_ORIGINAL.id}`)).toBeVisible();
    await expect(panel).toBeVisible();
    await settle(page);
    expect(pendingQueries.length).toBe(linesRead);
    // The reopened modal still offers it.
    await reopenAutomatch(page);
    await expect(pairCheck(page, 'bp-review')).toBeVisible();
  });

  test('a line marked "No es un rechazo" shows its notice; "Volver a considerar" posts restoreBounceSuggestion and reloads', async ({ page }) => {
    await login(page);
    const { posts, pendingQueries, autoMatchRequests } = await installMocks(page, { markedLine: true });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await closeThroughConfirmation(page, () => modalX(page).click());

    // Under "Pendientes" it is a plain pending line; selected, it says when it was marked.
    await page.getByTestId(`recon-line-row-${MARKED_LINE.id}`).click();
    await expect(page.getByTestId(`recon-line-radio-${MARKED_LINE.id}`)).toBeChecked();
    const notice = page.getByTestId('recon-bounce-dismissed-notice');
    await expect(notice).toContainText('Marcada como no rechazo el');
    await expect(page.getByTestId('recon-bounce-panel')).toHaveCount(0);
    const before = readsOf(pendingQueries, autoMatchRequests);

    const post = requestsOf(page, 'restoreBounceSuggestion');
    await notice.getByTestId('recon-bounce-restore-suggestion').click();
    await post;

    expect(posts.restoreBounceSuggestion).toEqual([{ financialAccountId: ACCOUNT_ID, statementLineId: MARKED_LINE.id }]);
    await expect(page.locator('[data-type="success"]', { hasText: 'La línea vuelve a considerarse como posible rechazo.' })).toBeVisible();
    await expectReloaded(pendingQueries, autoMatchRequests, before);
    // The reloaded line carries no mark any more: still selected, without the notice.
    await expect(page.getByTestId(`recon-line-radio-${MARKED_LINE.id}`)).toBeChecked();
    await expect(notice).toHaveCount(0);
  });

  test('a pair sent to the panel, then checked and unchecked again, is reported as unchecked', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await page.getByTestId('automatch-bounce-review-bp-review').click();
    await expect(modal(page)).toHaveCount(0);

    await page.getByTestId('financial-account-automatch').click();
    await expect(modal(page)).toBeVisible();
    await pairCheck(page, 'bp-review').click();
    await expect(pairInput(page, 'bp-review')).toHaveAttribute('aria-checked', 'true');
    await pairCheck(page, 'bp-review').click();
    await expect(pairInput(page, 'bp-review')).toHaveAttribute('aria-checked', 'false');

    const post = requestsOf(page, 'applySuggestions');
    await applyButton(page).click();
    await post;

    expect(posts.applySuggestions).toHaveLength(1);
    expect(posts.applySuggestions[0].groups).toEqual([{ statementLineId: TX_LINE.id, operationIds: ['trx-1'] }]);
    expect(posts.applySuggestions[0].bounceDecisions).toEqual([
      { groupKey: 'bp-high', decision: 'unchecked' },
      { groupKey: 'bp-review', decision: 'unchecked' },
      { groupKey: 'bp-amb', decision: 'unchecked' },
    ]);
  });

  test('read-only tier: the modal never opens and "No es un rechazo" is disabled', async ({ page }) => {
    await login(page, { windowAccessOverrides: { [FINANCIAL_ACCOUNT_WINDOW_ID]: 'read-only' } });
    const { posts } = await installMocks(page);
    const dismissRequests = recordDismissPairRequests(page);
    await openReconciliation(page);

    // The suggestions did load (the bounce lines are in the panel), yet nothing pops.
    await selectBounceLineInPanel(page, REVIEW_BOUNCE.id, REVIEW_ORIGINAL.id);
    await expect(page.getByTestId('recon-bounce-panel')).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId('financial-account-automatch')).toHaveCount(0);

    // ETP-6359 — the dismissal is stored now, a write: disabled, and a forced click changes nothing.
    const dismiss = page.getByTestId('recon-bounce-panel').getByTestId('recon-bounce-dismiss');
    await expect(dismiss).toBeDisabled();
    await dismiss.click({ force: true });
    await expect(page.getByTestId(`recon-line-row-${REVIEW_BOUNCE.id}`)).toBeVisible();
    await expect(page.getByTestId(`recon-outflow-row-${REVIEW_ORIGINAL.id}`)).toBeVisible();
    await settle(page);
    expect(dismissRequests).toEqual([]);
    expect(posts.dismissPair).toEqual([]);
  });
});

// ── Frontend KPI events (Mixpanel) ────────────────────────────────────────────

const TELEMETRY_CONFIGURED = process.env.E2E_TELEMETRY === 'configured';

/**
 * Captures the events the app sends to Mixpanel and answers them locally (nothing leaves the
 * machine). Providers are configured at BUILD time, so these events only exist in a bundle built
 * with the fake Mixpanel configuration of the `configured` scenario of telemetry-egress
 * (docs/ops/app-shell-observability.md, "Verifying egress in a browser"); the default bundle has
 * no provider and sends nothing. Installed BEFORE `login()`, so the boot's `app_started` is seen
 * too: its keys are the baseline every event carries (context + SDK), which lets the bounce
 * events be checked for exactly the properties they declare.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<{ event: string, properties: object }>>}
 */
async function captureMixpanelEvents(page) {
  const events = [];
  await page.route((url) => /(^|\.)mixpanel\.com$/.test(url.hostname), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.startsWith('/track')) {
      const raw = new URLSearchParams(req.postData() ?? url.search.slice(1)).get('data');
      if (raw) {
        let decoded;
        try { decoded = JSON.parse(raw); } catch { decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
        for (const item of [].concat(decoded)) events.push({ event: item.event, properties: item.properties ?? {} });
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
  });
  return events;
}

const named = (events, name) => events.filter((e) => e.event === name).map((e) => e.properties);
const VIEWED = 'bounce_suggestions_viewed';
const DISMISSED = 'bounce_suggestions_dismissed';
/**
 * The event's own properties: what it carries beyond what every event of the page carries — the
 * context and SDK keys of `app_started`, plus `role_groups`, the common-context key set once the
 * role is known (ETP-6043), which may land after the boot event or before it.
 */
function ownProperties(events, properties) {
  const boots = named(events, 'app_started');
  const baseline = new Set([...Object.keys(boots[boots.length - 1] ?? {}), 'role_groups']);
  return Object.fromEntries(Object.entries(properties).filter(([k]) => !baseline.has(k)));
}

test.describe('Reconciliation — bounce suggestion events (Mixpanel, mocked)', () => {
  test.skip(!TELEMETRY_CONFIGURED, 'needs a bundle built with fake Mixpanel config (E2E_TELEMETRY=configured)');

  test('viewed per opening (auto vs Automatch button) and dismissed once per close, on Esc and on the backdrop', async ({ page }) => {
    const events = await captureMixpanelEvents(page);
    await login(page);
    await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await expect.poll(() => named(events, VIEWED)).toEqual([
      expect.objectContaining({ pairs_shown: 3, pairs_preselected: 1, auto_opened: true }),
    ]);

    // With rows checked every close asks first; the dismissal is reported once "Cerrar" confirms it.
    await closeThroughConfirmation(page, () => page.keyboard.press('Escape'));
    await expect.poll(() => named(events, DISMISSED)).toEqual([
      expect.objectContaining({ pairs_shown: 3, pairs_checked_at_close: 1, auto_opened: true }),
    ]);

    // Second opening, same suggestions, no reload: a new `viewed`, now from the button.
    await page.getByTestId('financial-account-automatch').click();
    await expect(modal(page)).toBeVisible();
    await pairCheck(page, 'bp-review').click();
    await expect.poll(() => named(events, VIEWED).length).toBe(2);
    expect(named(events, VIEWED)[1]).toMatchObject({ pairs_shown: 3, pairs_preselected: 1, auto_opened: false });

    // The backdrop (a click outside the dialog content).
    await closeThroughConfirmation(
      page, () => page.getByTestId('DialogOverlay__6a5928').last().click({ position: { x: 5, y: 5 } }));
    await expect.poll(() => named(events, DISMISSED).length).toBe(2);
    expect(named(events, DISMISSED)[1]).toMatchObject({ pairs_shown: 3, pairs_checked_at_close: 2, auto_opened: false });

    await settle(page);
    expect(named(events, VIEWED)).toHaveLength(2);
    expect(named(events, DISMISSED)).toHaveLength(2);
  });

  test('"Ir a conciliación manual" counts as dismissed (once "Cerrar" confirms it)', async ({ page }) => {
    const events = await captureMixpanelEvents(page);
    await login(page);
    await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await page.getByTestId('automatch-modal-open-reconciliation').click();
    await expect(closeConfirm(page)).toBeVisible();
    // Asking is not dismissing: nothing is reported until the user confirms.
    await settle(page);
    expect(named(events, DISMISSED)).toEqual([]);
    await confirmClose(page).click();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => named(events, DISMISSED)).toEqual([
      expect.objectContaining({ pairs_shown: 3, pairs_checked_at_close: 1, auto_opened: true }),
    ]);
  });

  test('an apply sends no dismissed', async ({ page }) => {
    const events = await captureMixpanelEvents(page);
    await login(page);
    await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await expect.poll(() => named(events, VIEWED).length).toBe(1);

    const post = requestsOf(page, 'applySuggestions');
    await applyButton(page).click();
    await post;
    await expect(modal(page)).toHaveCount(0);

    await settle(page);
    expect(named(events, DISMISSED)).toEqual([]);
    expect(named(events, VIEWED)).toHaveLength(1);
  });

  test('"Revisar en el panel" sends no dismissed', async ({ page }) => {
    const events = await captureMixpanelEvents(page);
    await login(page);
    await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await expect.poll(() => named(events, VIEWED).length).toBe(1);

    await page.getByTestId('automatch-bounce-review-bp-amb').click();
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId('recon-bounce-panel')).toBeVisible();

    await settle(page);
    expect(named(events, DISMISSED)).toEqual([]);
  });

  test('read-only tier: no bounce event at all', async ({ page }) => {
    const events = await captureMixpanelEvents(page);
    await login(page, { windowAccessOverrides: { [FINANCIAL_ACCOUNT_WINDOW_ID]: 'read-only' } });
    await installMocks(page);
    await openReconciliation(page);
    await selectBounceLineInPanel(page, REVIEW_BOUNCE.id, REVIEW_ORIGINAL.id);
    await expect(page.getByTestId('recon-bounce-panel').getByTestId('recon-bounce-dismiss')).toBeDisabled();

    // Control: telemetry does flow in this page, so the empty result below means something.
    await expect.poll(() => named(events, 'app_started').length).toBeGreaterThan(0);
    await settle(page);
    expect(named(events, VIEWED)).toEqual([]);
    expect(named(events, DISMISSED)).toEqual([]);
  });

  test('the events carry only the tenant, the counts and auto_opened: no id, amount or text', async ({ page }) => {
    const events = await captureMixpanelEvents(page);
    await login(page);
    await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await closeThroughConfirmation(page, () => modalX(page).click());
    await expect.poll(() => named(events, DISMISSED).length).toBe(1);
    await expect.poll(() => named(events, 'app_started').length).toBeGreaterThan(0);

    const viewed = named(events, VIEWED)[0];
    const dismissed = named(events, DISMISSED)[0];
    expect(Object.keys(ownProperties(events, viewed)).sort())
      .toEqual(['account_id', 'auto_opened', 'pairs_preselected', 'pairs_shown']);
    expect(Object.keys(ownProperties(events, dismissed)).sort())
      .toEqual(['account_id', 'auto_opened', 'pairs_checked_at_close', 'pairs_shown']);

    // Nothing from the suggestions travels anywhere in the payload: no line or group id,
    // description, reference or amount. The financial account is checked on the event's own
    // properties only (account_id is the tenant): the SDK's `$current_url`, which every event of
    // the page carries, holds the route path `/financial-account/<id>` — a page-wide matter, not
    // one of these events.
    const lines = [TX_LINE, HIGH_ORIGINAL, HIGH_BOUNCE, REVIEW_ORIGINAL, REVIEW_BOUNCE, AMB_CAND_1, AMB_CAND_2, AMB_BOUNCE];
    const forbiddenText = [
      ACCOUNT.name, ACCOUNT.iban,
      ...lines.flatMap((l) => [l.id, l.description, l.referenceNo].filter(Boolean)),
      ...[TX_GROUP, HIGH_PAIR, REVIEW_PAIR, AMB_PAIR].map((g) => g.groupKey),
    ];
    const forbiddenAmounts = new Set(lines.flatMap((l) => [l.amount, Math.abs(l.amount)]));
    for (const props of [viewed, dismissed]) {
      const own = ownProperties(events, props);
      expect(JSON.stringify(own)).not.toContain(ACCOUNT_ID);
      for (const value of Object.values(own)) {
        if (typeof value === 'number') expect(forbiddenAmounts.has(value)).toBe(false);
      }
      const serialized = JSON.stringify(props);
      for (const text of forbiddenText) expect(serialized).not.toContain(text);
    }
  });
});


// ── AI second layer (ETP-6359): bounceAiAssessments on the autoMatch answer ────
//
// The existing backend-only flag `bank-bounce-suggestions` decides whether the answer carries the AI layer; the SPA
// only reads it. The candidates keep the backend order (CAND_1, CAND_2); the SPA sorts for display.

const AI_85_10 = { [AMB_BOUNCE.id]: { probabilities: { [AMB_CAND_1.id]: 10, [AMB_CAND_2.id]: 85 }, none: 5, recommendedLineId: AMB_CAND_2.id } };
const AI_60_40 = { [AMB_BOUNCE.id]: { probabilities: { [AMB_CAND_1.id]: 40, [AMB_CAND_2.id]: 60 }, none: 0, recommendedLineId: null } };

// The left list is DATE ordered (oldest first), never sorted by the AI.
const DATE_ORDERED_OUTFLOWS = [HIGH_ORIGINAL, REVIEW_ORIGINAL, AMB_CAND_1, AMB_CAND_2].map((l) => `recon-outflow-row-${l.id}`);
const outflowOrder = (page) => page.locator('[data-testid^="recon-outflow-row-"]')
  .evaluateAll((els) => els.map((el) => el.dataset.testid));

/** Sends the ambiguous pair to the panel, as "Revisar en el panel" does. */
async function reviewAmbiguousInPanel(page) {
  return reviewPairInPanel(page, 'bp-amb');
}

test.describe('Reconciliation — AI suggestion on bank rejections (mocked)', () => {
  test('the modal row shows the AI-recommended outflow with its percentage, unchecked but tickable', async ({ page }) => {
    await login(page);
    await installMocks(page, { ai: AI_85_10 });
    await openReconciliation(page);

    await expect(modal(page)).toBeVisible();
    // ONE outflow, the recommended one (second in detector order), and ONE mark: its percentage.
    await expect(shownOutflow(page)).toContainText(AMB_CAND_2.description);
    await expect(shownOutflow(page)).not.toContainText(AMB_CAND_1.description);
    await expect(rowPct(page)).toHaveText('85 %');
    await expect(modal(page).locator('[data-testid^="automatch-bounce-ai-pct-"]')).toHaveCount(1);
    // The badge keeps "Revisar"; the reason keeps "2 salidas posibles" and no percentage.
    await expect(page.getByTestId('automatch-bounce-tag-review-bp-amb')).toHaveText('Revisar');
    await expect(page.getByTestId('automatch-bounce-reason-bp-amb')).toHaveText('2 salidas posibles');
    // A recommendation never checks the row: the checkbox is enabled, unchecked.
    await expect(pairInput(page, 'bp-amb')).toBeEnabled();
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('automatch-bounce-review-bp-amb')).toBeVisible();
    // Pairs the AI did not rate render as before; the default checks and the exclude count do not change.
    await expect(page.getByTestId('automatch-bounce-ai-pct-bp-review')).toHaveCount(0);
    await expect(pairInput(page, 'bp-high')).toHaveAttribute('aria-checked', 'true');
    await expect(pairInput(page, 'bp-review')).toHaveAttribute('aria-checked', 'false');
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (1)');
  });

  test('85/10: the panel sorts the options, pre-checks the recommended one with badge and notice, and discards with choiceSource "ai"', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { ai: AI_85_10 });
    await openReconciliation(page);
    const panel = await reviewAmbiguousInPanel(page);

    // The left list stays in date order (the AI sorts nothing); the percentage is on each candidate.
    expect(await outflowOrder(page)).toEqual(DATE_ORDERED_OUTFLOWS);
    await expect(panel.getByTestId(`recon-bounce-ai-pct-${AMB_CAND_2.id}`)).toHaveText('85 %');
    await expect(panel.getByTestId(`recon-bounce-ai-pct-${AMB_CAND_1.id}`)).toHaveText('10 %');
    // The recommended radio is pre-checked and flagged in text, the notice says so.
    await expect(panel.getByTestId(`recon-bounce-radio-${AMB_CAND_2.id}`)).toBeChecked();
    await expect(panel.getByTestId(`recon-bounce-radio-${AMB_CAND_1.id}`)).not.toBeChecked();
    // ONE discreet mark (sparkle + percentage): no "Sugerida por IA" badge anywhere.
    await expect(panel.locator('[data-testid^="recon-bounce-ai-badge-"]')).toHaveCount(0);
    await expect(panel).not.toContainText('Sugerida por IA');
    await expect(panel).not.toContainText('de ser la pareja');
    // Only the chosen outflow has the selected background.
    await expect(panel.getByTestId(`recon-outflow-row-${AMB_CAND_2.id}`).locator('td').first()).toHaveClass(/bg-\[hsl\(var\(--muted\)\)\]/);
    await expect(panel.getByTestId(`recon-outflow-row-${AMB_CAND_1.id}`).locator('td').first()).not.toHaveClass(/bg-\[hsl\(var\(--muted\)\)\]/);
    await expect(panel.getByTestId('recon-bounce-notice')).toContainText('La IA sugiere la salida marcada (85 %)');
    await expect(panel.getByTestId('recon-bounce-notice')).not.toContainText('Elige la salida original');
    await expect(panel.getByTestId('recon-bounce-discard')).toBeEnabled();

    const post = requestsOf(page, 'discardPair');
    await panel.getByTestId('recon-bounce-discard').click();
    await post;
    expect(posts.discardPair).toEqual([{
      financialAccountId: ACCOUNT_ID,
      statementLineId: AMB_CAND_2.id,
      counterpartLineId: AMB_BOUNCE.id,
      choiceSource: 'ai',
    }]);
  });

  test('"Deshacer" on the success toast of an AI-sourced discard POSTs restorePair', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { ai: AI_85_10 });
    await openReconciliation(page);
    const panel = await reviewAmbiguousInPanel(page);

    await panel.getByTestId('recon-bounce-discard').click();
    const undo = page.locator('[data-type="success"]').getByRole('button', { name: 'Deshacer' });
    await expect(undo).toBeVisible();
    const post = requestsOf(page, 'restorePair');
    await undo.click();
    await post;
    expect(posts.restorePair).toEqual([{ financialAccountId: ACCOUNT_ID, lineId: AMB_BOUNCE.id }]);
  });

  test('an explicit pick on an AI-rated pair wins over the suggestion and discards with choiceSource "user"', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { ai: AI_85_10 });
    await openReconciliation(page);
    const panel = await reviewAmbiguousInPanel(page);

    await panel.getByTestId(`recon-bounce-radio-${AMB_CAND_1.id}`).check();
    await expect(panel.getByTestId(`recon-bounce-radio-${AMB_CAND_1.id}`)).toBeChecked();
    await expect(panel.getByTestId(`recon-bounce-radio-${AMB_CAND_2.id}`)).not.toBeChecked();
    await expect(panel.getByTestId('recon-bounce-notice')).not.toContainText('La IA sugiere');

    const post = requestsOf(page, 'discardPair');
    await panel.getByTestId('recon-bounce-discard').click();
    await post;
    expect(posts.discardPair).toEqual([{
      financialAccountId: ACCOUNT_ID,
      statementLineId: AMB_CAND_1.id,
      counterpartLineId: AMB_BOUNCE.id,
      choiceSource: 'user',
    }]);
    // A user-sourced discard has no "Deshacer".
    await expect(page.locator('[data-type="success"]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deshacer' })).toHaveCount(0);
  });

  test('60/40: the modal shows the most probable outflow; the panel shows both percentages, opens on that outflow and discards it as "user"', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { ai: AI_60_40 });
    await openReconciliation(page);

    // No recommendation: the modal row shows the most probable candidate (60 %), unchecked but tickable.
    await expect(shownOutflow(page)).toContainText(AMB_CAND_2.description);
    await expect(rowPct(page)).toHaveText('60 %');
    await expect(pairInput(page, 'bp-amb')).toBeEnabled();
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'false');
    const panel = await reviewAmbiguousInPanel(page);
    expect(await outflowOrder(page)).toEqual(DATE_ORDERED_OUTFLOWS);
    await expect(panel.getByTestId(`recon-bounce-ai-pct-${AMB_CAND_2.id}`)).toHaveText('60 %');
    await expect(panel.getByTestId(`recon-bounce-ai-pct-${AMB_CAND_1.id}`)).toHaveText('40 %');
    // The modal row's outflow (60 %) is preselected: not an AI recommendation (no badge).
    await expectOpensOn(panel, AMB_CAND_2, AMB_CAND_1);
    await expect(panel.locator('[data-testid^="recon-bounce-ai-badge-"]')).toHaveCount(0);

    const post = requestsOf(page, 'discardPair');
    await panel.getByTestId('recon-bounce-discard').click();
    await post;
    // An AI-rated pair discarded with an outflow the AI did not recommend: a user choice.
    expect(posts.discardPair).toEqual([{
      financialAccountId: ACCOUNT_ID, statementLineId: AMB_CAND_2.id, counterpartLineId: AMB_BOUNCE.id, choiceSource: 'user',
    }]);
  });

  test('a 409 stale answer shows the translated toast and leaves the panel usable', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { ai: AI_85_10, discardPairStale: true });
    await openReconciliation(page);
    const panel = await reviewAmbiguousInPanel(page);

    await panel.getByTestId('recon-bounce-discard').click();
    await expect(page.locator('[data-type="error"]').first()).toContainText('La sugerencia de la IA está desactualizada');
    expect(posts.discardPair).toHaveLength(1);
    await expect(page.locator('[data-type="success"]')).toHaveCount(0);
    // Still usable: the panel is on screen and an explicit choice can be made.
    await expect(page.getByTestId('recon-bounce-panel')).toBeVisible();
    await page.getByTestId('recon-bounce-panel').getByTestId(`recon-bounce-radio-${AMB_CAND_1.id}`).check();
    await expect(page.getByTestId('recon-bounce-discard')).toBeEnabled();
  });

  test('"No es un rechazo" after the AI preselection reports no counterpart', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { ai: AI_85_10 });
    await openReconciliation(page);
    const panel = await reviewAmbiguousInPanel(page);
    await expect(panel.getByTestId(`recon-bounce-radio-${AMB_CAND_2.id}`)).toBeChecked();

    const post = requestsOf(page, 'dismissPair');
    await panel.getByTestId('recon-bounce-dismiss').click();
    await post;
    expect(posts.dismissPair).toEqual([{ financialAccountId: ACCOUNT_ID, statementLineId: AMB_BOUNCE.id }]);
  });

  test('without bounceAiAssessments: no percentage, the modal row\'s outflow pre-checked, and the user\'s pick posts choiceSource "user"', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page);
    await openReconciliation(page);

    await expect(modal(page)).toBeVisible();
    await expect(page.locator('[data-testid^="automatch-bounce-ai-pct-"]')).toHaveCount(0);
    const panel = await reviewAmbiguousInPanel(page);
    expect(await outflowOrder(page)).toEqual(DATE_ORDERED_OUTFLOWS);
    await expect(panel.locator('[data-testid^="recon-bounce-ai-pct-"]')).toHaveCount(0);
    await expectOpensOn(panel, AMB_CAND_1, AMB_CAND_2);

    await panel.getByTestId(`recon-bounce-radio-${AMB_CAND_2.id}`).check();
    const post = requestsOf(page, 'discardPair');
    await panel.getByTestId('recon-bounce-discard').click();
    await post;
    expect(posts.discardPair).toHaveLength(1);
    // Never "ai" without AI data; the explicit pick is a user choice (one rule with the modal).
    expect(posts.discardPair[0].choiceSource).toBe('user');
  });
  test('without bounceAiAssessments: "Revisar en el panel" opens on the modal row\'s outflow, lists only its rejection and discards it with no choiceSource', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page);
    await openReconciliation(page);
    // The modal row of the ambiguous pair shows the first candidate (detector order).
    await expect(shownOutflow(page)).toContainText(AMB_CAND_1.referenceNo);
    const panel = await reviewAmbiguousInPanel(page);

    await expectOpensOn(panel, AMB_CAND_1, AMB_CAND_2);
    await expect(panel.getByTestId('recon-bounce-total-net')).toContainText('+0,00');
    // The right list keeps only the rejections that outflow can take: the +80 one.
    await expect(page.getByTestId('recon-rejections-title')).toHaveText('Rechazos (1)');
    expect(await rejectionRows(page)).toEqual([`recon-line-row-${AMB_BOUNCE.id}`]);

    const post = requestsOf(page, 'discardPair');
    await panel.getByTestId('recon-bounce-discard').click();
    await post;
    // A preselection is not a pick and there is no AI data: the body carries no choiceSource.
    expect(posts.discardPair).toEqual([{
      financialAccountId: ACCOUNT_ID, statementLineId: AMB_CAND_1.id, counterpartLineId: AMB_BOUNCE.id,
    }]);
  });

  // The host re-reads the automatch after a refused discard (`onReconcileSuccess`), so what the
  // panel offers next is whatever that FRESH answer carries.
  test('a 409 stale answer reloads the panel: a fresh answer without AI brings "Elige la salida original" back, and the pick posts "user", never "ai"', async ({ page }) => {
    await login(page);
    const { posts, autoMatchRequests } = await installMocks(page, { ai: AI_85_10, discardPairStale: 1, aiAfterReload: null });
    await openReconciliation(page);
    const panel = await reviewAmbiguousInPanel(page);
    await expect(panel.getByTestId(`recon-bounce-radio-${AMB_CAND_2.id}`)).toBeChecked();

    await panel.getByTestId('recon-bounce-discard').click();
    await expect(page.locator('[data-type="error"]').first()).toContainText('La sugerencia de la IA está desactualizada');
    await expect.poll(() => autoMatchRequests.count).toBeGreaterThan(1);
    await expect(panel.getByTestId(`recon-bounce-radio-${AMB_CAND_2.id}`)).not.toBeChecked();
    await expect(panel.locator('[data-testid^="recon-bounce-ai-badge-"]')).toHaveCount(0);
    await expect(panel.locator('[data-testid^="recon-bounce-ai-pct-"]')).toHaveCount(0);
    await expect(panel.getByTestId('recon-bounce-notice')).toContainText('Elige la salida original');
    await expect(panel.getByTestId('recon-bounce-discard')).toBeDisabled();

    await panel.getByTestId(`recon-bounce-radio-${AMB_CAND_2.id}`).check();
    const post = requestsOf(page, 'discardPair');
    await panel.getByTestId('recon-bounce-discard').click();
    await post;
    expect(posts.discardPair).toHaveLength(2);
    expect(posts.discardPair[0].choiceSource).toBe('ai');
    expect(posts.discardPair[1]).toEqual({
      financialAccountId: ACCOUNT_ID, statementLineId: AMB_CAND_2.id, counterpartLineId: AMB_BOUNCE.id, choiceSource: 'user',
    });
    await expect(page.locator('[data-type="success"]').first()).toBeVisible();
  });

  test('a 409 stale answer reloads the panel: the fresh recommendation is offered, and following it posts choiceSource "ai" for that line', async ({ page }) => {
    await login(page);
    const fresh = { [AMB_BOUNCE.id]: { probabilities: { [AMB_CAND_1.id]: 80, [AMB_CAND_2.id]: 15 }, none: 5, recommendedLineId: AMB_CAND_1.id } };
    const { posts } = await installMocks(page, { ai: AI_85_10, discardPairStale: 1, aiAfterReload: fresh });
    await openReconciliation(page);
    const panel = await reviewAmbiguousInPanel(page);

    await panel.getByTestId('recon-bounce-discard').click();
    await expect(page.locator('[data-type="error"]').first()).toContainText('La sugerencia de la IA está desactualizada');
    await expect(panel.getByTestId(`recon-bounce-radio-${AMB_CAND_1.id}`)).toBeChecked();
    await expect(panel.getByTestId(`recon-bounce-ai-pct-${AMB_CAND_1.id}`)).toHaveText('80 %');
    await expect(panel.locator('[data-testid^="recon-bounce-ai-badge-"]')).toHaveCount(0);

    // The error toast sits over the bottom-right footer, exactly where the cursor just clicked, and
    // Sonner pauses its timer while the cursor is over the toast: it would never leave. The retry
    // is activated from the keyboard, so it neither depends on the toast nor on the pointer.
    const post = requestsOf(page, 'discardPair');
    await pressDiscard(page);
    await post;
    expect(posts.discardPair).toHaveLength(2);
    expect(posts.discardPair[1]).toEqual({
      financialAccountId: ACCOUNT_ID, statementLineId: AMB_CAND_1.id, counterpartLineId: AMB_BOUNCE.id, choiceSource: 'ai',
    });
  });
});

// ── UI robustness of the AI percentage: very long bank text, narrow viewport ───

test.describe('Reconciliation — AI percentage with long bank text on a narrow viewport (mocked)', () => {
  const NARROW = { width: 768, height: 900 };
  // The shared AI answer, but with the long-text candidate as the most probable one.
  const AI_LONG = { [AMB_BOUNCE.id]: { probabilities: { [AMB_CAND_1.id]: 5, [AMB_CAND_2.id]: 90 }, none: 3, recommendedLineId: AMB_CAND_2.id } };

  test('modal: the percentage stays visible and neither the page nor the modal body scroll sideways', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await login(page);
    await installMocks(page, { ai: AI_LONG, longDescriptions: true });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    const pct = rowPct(page);
    await expect(pct).toHaveText('90 %');
    await expect(pct).toBeVisible();
    await expect(shownOutflow(page)).toContainText('TRANSFERENCIA INMEDIATA');

    // The percentage sits inside the modal's box, not clipped off its edge.
    const box = await pct.boundingBox();
    const modalBox = await modal(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(modalBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(modalBox.x + modalBox.width + 1);

    const overflow = await modal(page).evaluate((dialog) => {
      const body = dialog.querySelector('.overflow-y-auto');
      return {
        bodyScroll: body.scrollWidth, bodyClient: body.clientWidth,
        dialogScroll: dialog.scrollWidth, dialogClient: dialog.clientWidth,
        pageScroll: document.documentElement.scrollWidth, pageClient: document.documentElement.clientWidth,
      };
    });
    expect(overflow.bodyScroll).toBeLessThanOrEqual(overflow.bodyClient);
    expect(overflow.dialogScroll).toBeLessThanOrEqual(overflow.dialogClient);
    expect(overflow.pageScroll).toBeLessThanOrEqual(overflow.pageClient);
  });

  test('panel: the row keeps its percentage mark with long bank text, inside the panel and without sideways page scroll', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await login(page);
    await installMocks(page, { ai: AI_LONG, longDescriptions: true });
    await openReconciliation(page);
    const panel = await reviewAmbiguousInPanel(page);

    const pct = panel.getByTestId(`recon-bounce-ai-pct-${AMB_CAND_2.id}`);
    await expect(pct).toHaveText('90 %');
    await expect(pct).toBeVisible();
    // The mark is one element: no "Sugerida por IA" badge next to it.
    await expect(panel.locator('[data-testid^="recon-bounce-ai-badge-"]')).toHaveCount(0);
    // It sits inside the panel's own box AND inside its own row: a cell that clips it hides it
    // from the user even though Playwright still reports the element as visible.
    const panelBox = await panel.boundingBox();
    const rowBox = await panel.getByTestId(`recon-outflow-row-${AMB_CAND_2.id}`).boundingBox();
    const box = await pct.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(panelBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
    // The right column (footer) is not pushed out of the panel either.
    const footerBox = await panel.getByTestId('recon-bounce-footer').boundingBox();
    expect(footerBox.x + footerBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
    const pageOverflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
    }));
    expect(pageOverflow.scroll).toBeLessThanOrEqual(pageOverflow.client);
  });
});

// ── The two-table "Posibles rechazos" view (ETP-6359) ──────────────────────────

/** Closes the auto-opened modal (rows are checked, so it asks first) and opens the pair view. */
async function openPairViewFromModal(page) {
  await expect(modal(page)).toBeVisible();
  await closeThroughConfirmation(page, () => modalX(page).click());
  await openPairView(page);
}

const rejectionRows = (page) => page.locator('[data-testid^="recon-line-row-"]')
  .evaluateAll((els) => els.map((el) => el.dataset.testid));
const SELECTED_BG = /bg-\[hsl\(var\(--muted\)\)\]/;

test.describe('Reconciliation — "Posibles rechazos" as two tables (mocked)', () => {
  test('nothing selected shows only the placeholder; clicking an outflow narrows the right list to the rejections it can be paired with', async ({ page }) => {
    await login(page);
    await installMocks(page);
    await openReconciliation(page);
    await openPairViewFromModal(page);

    // Left: every distinct outflow once, in date order, no sort headers, a radio on every row.
    const outflows = page.getByTestId('recon-outflows-table');
    await expect(outflows).toContainText('Salidas (4)');
    expect(await outflowOrder(page)).toEqual(DATE_ORDERED_OUTFLOWS);
    for (const o of [HIGH_ORIGINAL, REVIEW_ORIGINAL, AMB_CAND_1, AMB_CAND_2]) {
      const row = page.getByTestId(`recon-outflow-row-${o.id}`);
      await expect(row).toContainText('Posible salida original');
      await expect(row.getByRole('radio')).toBeEnabled();
      await expect(row.getByRole('radio')).not.toBeChecked();
    }
    await expect(outflows.locator('th button')).toHaveCount(0);
    // Right: ONLY the placeholder, no rejections table, toolbar, notice, footer or toggle.
    const empty = page.getByTestId('recon-right-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('Selecciona una salida');
    await expect(empty).toContainText('Elige una salida para ver los rechazos con los que se puede emparejar.');
    await expect(page.getByTestId('recon-rejections-table')).toHaveCount(0);
    await expect(page.getByTestId('recon-rejections-title')).toHaveCount(0);
    await expect(page.getByTestId('recon-bounce-footer')).toHaveCount(0);
    await expect(page.getByTestId('recon-bounce-notice')).toHaveCount(0);
    expect(await rejectionRows(page)).toEqual([]);

    // Clicking an outflow selects the rejection it can be paired with and narrows the list.
    await page.getByTestId(`recon-outflow-row-${REVIEW_ORIGINAL.id}`).click();
    await expect(empty).toHaveCount(0);
    await expect(page.getByTestId('recon-rejections-title')).toHaveText('Rechazos (1)');
    expect(await rejectionRows(page)).toEqual([`recon-line-row-${REVIEW_BOUNCE.id}`]);
    await expect(page.getByTestId(`recon-line-radio-${REVIEW_BOUNCE.id}`)).toBeChecked();
    await expect(page.getByTestId('recon-rejections-toggle')).toHaveCount(0);
    // The panel's wording for a doubtful pair is "Confianza baja" (the modal says "Revisar").
    await expect(page.getByTestId(`automatch-bounce-tag-review-${REVIEW_PAIR.groupKey}`)).toHaveText('Confianza baja');
    await expect(page.getByTestId('recon-bounce-notice')).toContainText('Posible rechazo · Confianza baja:');
    await expect(page.getByTestId('recon-bounce-notice')).not.toContainText('Revisar');
    // Only the chosen outflow has the selected background.
    await expect(page.getByTestId(`recon-outflow-row-${REVIEW_ORIGINAL.id}`).locator('td').first()).toHaveClass(SELECTED_BG);
    await expect(page.getByTestId(`recon-outflow-row-${HIGH_ORIGINAL.id}`).locator('td').first()).not.toHaveClass(SELECTED_BG);
  });

  test('the footer lives only in the right column; the left one ends with an empty bar', async ({ page }) => {
    await login(page);
    await installMocks(page);
    await openReconciliation(page);
    await openPairViewFromModal(page);
    await page.getByTestId(`recon-outflow-row-${HIGH_ORIGINAL.id}`).click();

    const footer = page.getByTestId('recon-bounce-footer');
    await expect(footer).toHaveCount(1);
    await expect(footer).toContainText('Rechazo seleccionado');
    await expect(footer).toContainText('Salida seleccionada');
    await expect(footer).toContainText('Efecto neto del par');
    await expect(footer.getByTestId('recon-bounce-dismiss')).toHaveText(/No es un rechazo/);
    await expect(footer.getByTestId('recon-bounce-discard')).toHaveText(/Descartar par/);
    await expect(page.getByTestId('recon-outflows-table').getByTestId('recon-bounce-footer')).toHaveCount(0);
    await expect(page.getByTestId('recon-outflows-footer')).toBeEmpty();
    const [footerBox, leftBox] = [await footer.boundingBox(), await page.getByTestId('recon-outflows-table').boundingBox()];
    expect(footerBox.x).toBeGreaterThanOrEqual(leftBox.x + leftBox.width - 1);
    // The left list has no total.
    await expect(page.getByTestId('recon-outflows-table')).not.toContainText('Total');
  });

  test('re-targeting: an outflow of another amount selects the rejection that can take it and discards with it', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page);
    await openReconciliation(page);
    await openPairViewFromModal(page);

    await page.getByTestId(`recon-outflow-row-${REVIEW_ORIGINAL.id}`).click();
    await expect(page.getByTestId(`recon-line-radio-${REVIEW_BOUNCE.id}`)).toBeChecked();
    // -80 cannot be paired with the +45 rejection: the selection moves to the +80 one (which
    // lists it as a candidate), the right list follows and the outflow is the pick there.
    await page.getByTestId(`recon-outflow-row-${AMB_CAND_2.id}`).click();
    await expect(page.getByTestId(`recon-line-radio-${AMB_BOUNCE.id}`)).toBeChecked();
    await expect(page.getByTestId('recon-rejections-title')).toHaveText('Rechazos (1)');
    expect(await rejectionRows(page)).toEqual([`recon-line-row-${AMB_BOUNCE.id}`]);
    await expect(page.getByTestId(`recon-bounce-radio-${AMB_CAND_2.id}`)).toBeChecked();
    // Another amount again (-120): back to the +120 rejection.
    await page.getByTestId(`recon-outflow-row-${HIGH_ORIGINAL.id}`).click();
    await expect(page.getByTestId(`recon-line-radio-${HIGH_BOUNCE.id}`)).toBeChecked();
    expect(await rejectionRows(page)).toEqual([`recon-line-row-${HIGH_BOUNCE.id}`]);

    await page.getByTestId(`recon-outflow-row-${AMB_CAND_1.id}`).click();
    await expect(page.getByTestId(`recon-bounce-radio-${AMB_CAND_1.id}`)).toBeChecked();
    const post = requestsOf(page, 'discardPair');
    await page.getByTestId('recon-bounce-discard').click();
    await post;
    expect(posts.discardPair).toEqual([{
      financialAccountId: ACCOUNT_ID, statementLineId: AMB_CAND_1.id, counterpartLineId: AMB_BOUNCE.id, choiceSource: 'user',
    }]);
  });

  test('a free pick: an outflow the detector did not offer for the rejection is an explicit user pick', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { ai: AI_85_10, extraPairs: ['free'] });
    await openReconciliation(page);
    const panel = await reviewAmbiguousInPanel(page);
    // The AI default is preselected; the free outflow is listed (5 outflows) with a radio but
    // no AI mark, since it is not a candidate.
    await expect(panel.getByTestId(`recon-bounce-radio-${AMB_CAND_2.id}`)).toBeChecked();
    await expect(panel.getByTestId('recon-outflows-table')).toContainText('Salidas (5)');
    await expect(panel.getByTestId(`recon-outflow-radio-${FREE_ORIGINAL.id}`)).toBeEnabled();
    await expect(panel.getByTestId(`recon-bounce-ai-pct-${FREE_ORIGINAL.id}`)).toHaveCount(0);
    await expect(panel.getByTestId('recon-bounce-notice')).toContainText('La IA sugiere la salida marcada (85 %). Revísala antes de descartar.');

    await panel.getByTestId(`recon-outflow-row-${FREE_ORIGINAL.id}`).click();
    await expect(panel.getByTestId(`recon-outflow-radio-${FREE_ORIGINAL.id}`)).toBeChecked();
    await expect(panel.getByTestId(`recon-line-radio-${AMB_BOUNCE.id}`)).toBeChecked();
    // The AI preselection and its sentence are gone: the user chose.
    await expect(panel.getByTestId('recon-bounce-notice')).not.toContainText('La IA sugiere');
    await expect(panel.getByTestId('recon-bounce-total-other')).toContainText('Salida seleccionada');
    // Only the chosen outflow keeps the selected background; the candidates keep their AI marks.
    await expect(panel.getByTestId(`recon-outflow-row-${FREE_ORIGINAL.id}`).locator('td').first()).toHaveClass(SELECTED_BG);
    await expect(panel.getByTestId(`recon-outflow-row-${AMB_CAND_2.id}`).locator('td').first()).not.toHaveClass(SELECTED_BG);
    await expect(panel.getByTestId(`recon-bounce-ai-pct-${AMB_CAND_2.id}`)).toHaveText('85 %');

    const post = requestsOf(page, 'discardPair');
    await panel.getByTestId('recon-bounce-discard').click();
    await post;
    expect(posts.discardPair).toEqual([{
      financialAccountId: ACCOUNT_ID, statementLineId: FREE_ORIGINAL.id, counterpartLineId: AMB_BOUNCE.id,
      choiceSource: 'user',
    }]);
  });

  test('an outflow no rejection can take keeps the selection and says why', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { extraPairs: ['orphan'] });
    await openReconciliation(page);
    await openPairViewFromModal(page);
    await page.getByTestId(`recon-outflow-row-${REVIEW_ORIGINAL.id}`).click();
    await expect(page.getByTestId(`recon-line-radio-${REVIEW_BOUNCE.id}`)).toBeChecked();

    // The reason is VISIBLE text on the row, tied to the (aria-disabled) radio; a pairable outflow has none.
    const orphan = page.getByTestId(`recon-outflow-row-${ORPHAN_ORIGINAL.id}`);
    const hint = page.getByTestId(`recon-outflow-nomatch-${ORPHAN_ORIGINAL.id}`);
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('Ningún rechazo puede emparejarse con esta salida (importe distinto o más de 60 días de diferencia)');
    const orphanRadio = page.getByTestId(`recon-outflow-radio-${ORPHAN_ORIGINAL.id}`);
    await expect(orphanRadio).toHaveAttribute('aria-disabled', 'true');
    await expect(orphanRadio).toHaveAttribute('aria-describedby', `recon-outflow-nomatch-${ORPHAN_ORIGINAL.id}`);
    await expect(orphan).not.toHaveAttribute('title', /.+/);
    await expect(page.getByTestId(`recon-outflow-nomatch-${HIGH_ORIGINAL.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`recon-bounce-radio-${REVIEW_ORIGINAL.id}`).or(
      page.getByTestId(`recon-outflow-radio-${REVIEW_ORIGINAL.id}`))).not.toHaveAttribute('aria-disabled', 'true');
    await orphan.click();
    // Nothing changed: same rejection selected, same right list, the pick is still the original.
    await expect(page.getByTestId(`recon-line-radio-${REVIEW_BOUNCE.id}`)).toBeChecked();
    await expect(page.getByTestId(`recon-outflow-radio-${ORPHAN_ORIGINAL.id}`)).not.toBeChecked();
    await expect(page.getByTestId(`recon-bounce-radio-${REVIEW_ORIGINAL.id}`).or(
      page.getByTestId(`recon-outflow-radio-${REVIEW_ORIGINAL.id}`))).toBeChecked();
    expect(await rejectionRows(page)).toEqual([`recon-line-row-${REVIEW_BOUNCE.id}`]);
    expect(posts.discardPair).toEqual([]);
  });
});

// ── One rule for the AI percentage: when "none" wins, no percentage anywhere ───

test.describe('Reconciliation — AI "none" outweighing the candidates (mocked)', () => {
  const none = (noneValue) => ({
    [AMB_BOUNCE.id]: { probabilities: { [AMB_CAND_1.id]: 30, [AMB_CAND_2.id]: 40 }, none: noneValue, recommendedLineId: null },
  });

  test('none strictly above the best candidate: no percentage in the modal nor in the panel', async ({ page }) => {
    await login(page);
    await installMocks(page, { ai: none(60) });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await expect(page.locator('[data-testid^="automatch-bounce-ai-pct-"]')).toHaveCount(0);
    // No percentage is shown, so the detector's order is kept: the first candidate is the one shown.
    await expect(shownOutflow(page)).toContainText(AMB_CAND_1.description);
    const panel = await reviewAmbiguousInPanel(page);
    await expect(panel.locator('[data-testid^="recon-bounce-ai-pct-"]')).toHaveCount(0);
    await expect(panel.getByTestId(`recon-bounce-radio-${AMB_CAND_2.id}`)).not.toHaveAttribute('aria-describedby', /.+/);
    // The panel opens on that same outflow, the one the modal row showed.
    await expectOpensOn(panel, AMB_CAND_1, AMB_CAND_2);
  });

  test('a tie with the best candidate still shows the percentage (modal and panel)', async ({ page }) => {
    await login(page);
    await installMocks(page, { ai: none(40) });
    await openReconciliation(page);
    // The modal row shows the most probable outflow and its percentage only.
    await expect(shownOutflow(page)).toContainText(AMB_CAND_2.description);
    await expect(rowPct(page)).toHaveText('40 %');
    await expect(modal(page).locator('[data-testid^="automatch-bounce-ai-pct-"]')).toHaveCount(1);
    const panel = await reviewAmbiguousInPanel(page);
    await expect(panel.getByTestId(`recon-bounce-ai-pct-${AMB_CAND_2.id}`)).toHaveText('40 %');
    await expect(panel.getByTestId(`recon-bounce-ai-pct-${AMB_CAND_1.id}`)).toHaveText('30 %');
  });

  test('conflict abstention (no assessment entry for the rejection): no mark at all', async ({ page }) => {
    await login(page);
    await installMocks(page, { ai: { 'some-other-bounce': { probabilities: { x: 90 }, none: 0, recommendedLineId: null } } });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await expect(page.locator('[data-testid^="automatch-bounce-ai-pct-"]')).toHaveCount(0);
    const panel = await reviewAmbiguousInPanel(page);
    await expect(panel.locator('[data-testid^="recon-bounce-ai-pct-"]')).toHaveCount(0);
  });
});

// ── The modal opens by itself when the run found only possible rejections ──────

test.describe('Reconciliation — auto-open with only possible rejections (mocked)', () => {
  test('a fresh load with only bouncePair groups (groupsFound 0) opens the modal with the yellow card and no green one', async ({ page }) => {
    await login(page);
    await installMocks(page, { onlyPairs: true });
    await openReconciliation(page);

    await expect(modal(page)).toBeVisible();
    await expect(modal(page).getByTestId('automatch-bounce-section')).toBeVisible();
    await expect(modal(page).getByTestId('automatch-bounce-count')).toHaveText('3');
    // The green card steps aside when the run found pairs and no transaction group.
    await expect(page.getByTestId('automatch-statements-section')).toHaveCount(0);
    await expect(page.getByTestId(`automatch-bounce-row-${HIGH_PAIR.groupKey}`)).toBeVisible();
  });

  test('flag on but nothing found (no group, no pair): the modal does not open', async ({ page }) => {
    await login(page);
    await installMocks(page, { onlyPairs: true, extraPairs: [] });
    await page.route(/\/sws\/neo\/bank-reconciliation\?.*action=autoMatch/, async (route) => {
      await json(route, { response: { data: { groups: [], kpis: { pendingLines: 0, groupsFound: 0, opsToLink: 0, willCreate: 0, bouncePairs: 0 } } } });
    });
    const answered = page.waitForResponse((r) => r.url().includes('action=autoMatch'));
    await openReconciliation(page);
    await answered;
    await expect(page.getByTestId('detail-tab-reconciliation')).toBeVisible();
    await settle(page);
    await expect(modal(page)).toHaveCount(0);
  });

  test('"Revisar en el panel" from a pairs-only modal selects the rejection directly, never the placeholder', async ({ page }) => {
    await login(page);
    await installMocks(page, { onlyPairs: true });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await page.getByTestId('automatch-bounce-review-bp-review').click();
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId('recon-right-empty')).toHaveCount(0);
    await expect(page.getByTestId(`recon-line-radio-${REVIEW_BOUNCE.id}`)).toBeChecked();
    await expect(page.getByTestId('recon-bounce-panel')).toBeVisible();
  });
});

// ── Free picks in the two-table view: after the discard, refusals, dismissals, a11y, read-only ──

const REFUSALS = [
  { code: 'HAS_PAYMENT', key: 'ETGO_BounceHasPayment', text: 'pago registrado en Etendo' },
  { code: 'AMOUNT_MISMATCH', key: 'ETGO_BounceAmountMismatch', text: 'exactamente el mismo importe' },
  { code: 'DISCARD_NOT_ALLOWED', key: 'ETGO_BounceDiscardNotAllowed', text: 'Este rechazo no se puede descartar' },
];

test.describe('Reconciliation — free picks in the two-table view (mocked)', () => {
  test('discarding with a free pick of another pair\'s outflow, then the reload: no half-pair, no ghost footer, the old pick is not reused', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { extraPairs: ['free'], reloadAfterDiscard: 'free' });
    await openReconciliation(page);
    await openPairViewFromModal(page);
    await page.getByTestId(`recon-outflow-row-${AMB_CAND_1.id}`).click();
    await expect(page.getByTestId(`recon-line-radio-${AMB_BOUNCE.id}`)).toBeChecked();
    // FREE_ORIGINAL belongs to ANOTHER pair; picking it is a free pick for AMB_BOUNCE.
    await page.getByTestId(`recon-outflow-row-${FREE_ORIGINAL.id}`).click();
    await expect(page.getByTestId(`recon-outflow-radio-${FREE_ORIGINAL.id}`)).toBeChecked();

    const post = requestsOf(page, 'discardPair');
    await page.getByTestId('recon-bounce-discard').click();
    await post;
    expect(posts.discardPair).toEqual([{
      financialAccountId: ACCOUNT_ID, statementLineId: FREE_ORIGINAL.id, counterpartLineId: AMB_BOUNCE.id, choiceSource: 'user',
    }]);
    await expect(page.locator('[data-type="success"]').first()).toBeVisible();

    // The selected rejection is gone: the placeholder returns, the footer and notice with it.
    await expect(page.getByTestId('recon-right-empty')).toBeVisible();
    await expect(page.getByTestId('recon-bounce-footer')).toHaveCount(0);
    await expect(page.getByTestId('recon-bounce-notice')).toHaveCount(0);
    await expect(page.getByTestId(`recon-outflow-row-${FREE_ORIGINAL.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`recon-line-row-${AMB_BOUNCE.id}`)).toHaveCount(0);
    expect(await outflowOrder(page)).toEqual([HIGH_ORIGINAL, REVIEW_ORIGINAL, AMB_CAND_1, AMB_CAND_2].map((l) => `recon-outflow-row-${l.id}`));
    await expect(page.getByTestId('recon-outflows-table')).toContainText('Salidas (4)');

    // The next pick starts clean: FREE_BOUNCE (re-detected over the freed candidates) is selected
    // with the clicked outflow as the pick; the footer never names the discarded FREE_ORIGINAL.
    await page.getByTestId(`recon-outflow-row-${AMB_CAND_2.id}`).click();
    await expect(page.getByTestId(`recon-line-radio-${FREE_BOUNCE.id}`)).toBeChecked();
    expect(await rejectionRows(page)).toEqual([`recon-line-row-${FREE_BOUNCE.id}`]);
    await expect(page.getByTestId(`recon-bounce-radio-${AMB_CAND_2.id}`)).toBeChecked();
    await expect(page.getByTestId('recon-bounce-total-other-meta')).toContainText(`Ref. ${AMB_CAND_2.referenceNo}`);
    await expect(page.getByTestId('recon-bounce-footer')).not.toContainText(FREE_ORIGINAL.referenceNo);
    const second = requestsOf(page, 'discardPair');
    await page.getByTestId('recon-bounce-discard').click();
    await second;
    expect(posts.discardPair[1]).toEqual({
      financialAccountId: ACCOUNT_ID, statementLineId: AMB_CAND_2.id, counterpartLineId: FREE_BOUNCE.id, choiceSource: 'user',
    });
  });

  for (const refusal of REFUSALS) {
    test(`a free pick refused by the server (409 ${refusal.code}): translated toast, no reload, the pick stays and a retry works, choiceSource "user"`, async ({ page }) => {
      await login(page);
      const { posts, autoMatchRequests, pendingQueries } = await installMocks(page, {
        ai: AI_85_10, extraPairs: ['free'], discardRefusals: [{ status: 409, code: refusal.code, key: refusal.key }],
      });
      await openReconciliation(page);
      const panel = await reviewAmbiguousInPanel(page);
      await panel.getByTestId(`recon-outflow-row-${FREE_ORIGINAL.id}`).click();
      await expect(panel.getByTestId(`recon-outflow-radio-${FREE_ORIGINAL.id}`)).toBeChecked();
      const reloadsBefore = { auto: autoMatchRequests.count, lines: pendingQueries.length };

      const first = requestsOf(page, 'discardPair');
      await panel.getByTestId('recon-bounce-discard').click();
      await first;
      const toastError = page.locator('[data-type="error"]').first();
      await expect(toastError).toContainText(refusal.text);
      await expect(toastError).not.toContainText('Refused');
      await expect(page.locator('[data-type="success"]')).toHaveCount(0);
      // No reload after a refusal, and the user's pick (and the right list) are untouched.
      await settle(page);
      expect({ auto: autoMatchRequests.count, lines: pendingQueries.length }).toEqual(reloadsBefore);
      await expect(panel.getByTestId(`recon-outflow-radio-${FREE_ORIGINAL.id}`)).toBeChecked();
      await expect(panel.getByTestId(`recon-line-radio-${AMB_BOUNCE.id}`)).toBeChecked();
      await expect(panel.getByTestId('recon-bounce-discard')).toBeEnabled();

      // Retry (from the keyboard: the toast covers the button): same body, accepted this time.
      const retry = requestsOf(page, 'discardPair');
      await pressDiscard(page);
      await retry;
      const body = {
        financialAccountId: ACCOUNT_ID, statementLineId: FREE_ORIGINAL.id, counterpartLineId: AMB_BOUNCE.id, choiceSource: 'user',
      };
      expect(posts.discardPair).toEqual([body, body]);
      await expect(page.locator('[data-type="success"]').first()).toBeVisible();
      expect(posts.discardPair.some((b) => b.choiceSource === 'ai')).toBe(false);
    });
  }

  test('"No es un rechazo" after a free pick of a FOREIGN outflow posts no counterpartLineId; after a pick of an own candidate it posts it', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { extraPairs: ['free'] });
    await openReconciliation(page);
    const panel = await reviewAmbiguousInPanel(page);

    // An own candidate: the counterpart travels.
    await panel.getByTestId(`recon-outflow-row-${AMB_CAND_1.id}`).click();
    await expect(panel.getByTestId(`recon-bounce-radio-${AMB_CAND_1.id}`)).toBeChecked();
    // Then the foreign one replaces it, and is what the dismissal is evaluated against.
    await panel.getByTestId(`recon-outflow-row-${FREE_ORIGINAL.id}`).click();
    await expect(panel.getByTestId(`recon-outflow-radio-${FREE_ORIGINAL.id}`)).toBeChecked();
    const post = requestsOf(page, 'dismissPair');
    await panel.getByTestId('recon-bounce-dismiss').click();
    await post;
    expect(posts.dismissPair).toHaveLength(1);
    expect(posts.dismissPair[0]).toEqual({ financialAccountId: ACCOUNT_ID, statementLineId: AMB_BOUNCE.id });
    expect(posts.dismissPair[0]).not.toHaveProperty('counterpartLineId');
  });

  test('"No es un rechazo" after a pick of an own candidate posts it as counterpartLineId', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { extraPairs: ['free'] });
    await openReconciliation(page);
    const panel = await reviewAmbiguousInPanel(page);
    await panel.getByTestId(`recon-outflow-row-${AMB_CAND_1.id}`).click();
    await expect(panel.getByTestId(`recon-bounce-radio-${AMB_CAND_1.id}`)).toBeChecked();
    const post = requestsOf(page, 'dismissPair');
    await panel.getByTestId('recon-bounce-dismiss').click();
    await post;
    expect(posts.dismissPair).toEqual([{
      financialAccountId: ACCOUNT_ID, statementLineId: AMB_BOUNCE.id, counterpartLineId: AMB_CAND_1.id,
    }]);
  });

  test('the rejection radios have distinct accessible names and the placeholder is a status region', async ({ page }) => {
    await login(page);
    await installMocks(page, { extraPairs: ['free'] });
    await openReconciliation(page);
    await openPairViewFromModal(page);
    await expect(page.getByTestId('recon-right-empty')).toHaveAttribute('role', 'status');
    // -80 can be paired with both +80 rejections: two rows, two radios.
    await page.getByTestId(`recon-outflow-row-${AMB_CAND_2.id}`).click();
    const radios = page.getByRole('radio', { name: /^Seleccionar el rechazo del / });
    await expect(radios).toHaveCount(2);
    const names = await radios.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(new Set(names).size).toBe(2);
    expect(names.some((n) => n.endsWith(`Ref. ${AMB_BOUNCE.referenceNo}`))).toBe(true);
    expect(names.some((n) => n.endsWith(`Ref. ${FREE_BOUNCE.referenceNo}`))).toBe(true);
    // Reachable by that name.
    await expect(page.getByRole('radio', { name: new RegExp(`Ref\\. ${FREE_BOUNCE.referenceNo}$`) })).toBeVisible();
  });

  test('read-only tier in the two-table view: "Descartar par" and "No es un rechazo" are disabled and nothing is POSTed', async ({ page }) => {
    await login(page, { windowAccessOverrides: { [FINANCIAL_ACCOUNT_WINDOW_ID]: 'read-only' } });
    const { posts } = await installMocks(page);
    await openReconciliation(page);
    await selectBounceLineInPanel(page, REVIEW_BOUNCE.id, REVIEW_ORIGINAL.id);
    const panel = page.getByTestId('recon-bounce-panel');
    await expect(panel.getByTestId('recon-bounce-discard')).toBeDisabled();
    await expect(panel.getByTestId('recon-bounce-dismiss')).toBeDisabled();
    await panel.getByTestId('recon-bounce-discard').click({ force: true });
    await panel.getByTestId('recon-bounce-discard').focus();
    await page.keyboard.press('Enter');
    await settle(page);
    expect(posts.discardPair).toEqual([]);
    await expect(page.locator('[data-type="success"]')).toHaveCount(0);
  });
});

// ── The ONE outflow of an AI-rated ambiguous pair in the modal (ETP-6359) ─────────────────────
//
// The modal has no outflow selector: an ambiguous pair the AI rated shows ONE outflow (the
// AI-recommended one, else the most probable visible one) and its checkbox excludes the pair with
// THAT outflow. "Revisar en el panel" is where another outflow is chosen.

/** Unchecks the high pair, which starts checked, so "Excluir (N)" counts the ambiguous pair only. */
async function uncheckHigh(page) {
  await pairCheck(page, 'bp-high').click();
  await expect(pairInput(page, 'bp-high')).toHaveAttribute('aria-checked', 'false');
}

/** Ticks the ambiguous pair (only), presses "Excluir" and answers the applySuggestions body. */
async function excludeOnlyAmbiguous(page, posts, key = 'bp-amb') {
  await uncheckHigh(page);
  await pairCheck(page, key).click();
  await expect(pairInput(page, key)).toHaveAttribute('aria-checked', 'true');
  await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (1)');
  const post = requestsOf(page, 'applySuggestions');
  await excludeButton(page).click();
  await post;
  return posts.applySuggestions.at(-1);
}

// The AI recommends the LESS probable candidate: the recommendation wins over the higher percentage.
const AI_REC_LOW = {
  [AMB_BOUNCE.id]: { probabilities: { [AMB_CAND_1.id]: 30, [AMB_CAND_2.id]: 60 }, none: 10, recommendedLineId: AMB_CAND_1.id },
};

test.describe('Reconciliation — modal: the one outflow of an AI-rated ambiguous pair (mocked)', () => {
  test('one row with the recommended outflow and "2 salidas posibles", no selector; enabled and unchecked', async ({ page }) => {
    await login(page);
    await installMocks(page, { ai: AI_85_10 });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    const row = page.getByTestId('automatch-bounce-row-bp-amb');
    await expect(row).toHaveCount(1);
    await expect(shownOutflow(page)).toContainText(AMB_CAND_2.description);
    await expect(row).not.toContainText(AMB_CAND_1.description);
    await expect(page.getByTestId('automatch-bounce-reason-bp-amb')).toHaveText('2 salidas posibles');
    await expect(row.getByRole('radio')).toHaveCount(0);
    await expect(row.getByRole('radiogroup')).toHaveCount(0);
    await expect(modal(page).locator('[data-testid^="automatch-bounce-pick-"]')).toHaveCount(0);

    await expect(pairInput(page, 'bp-amb')).toBeEnabled();
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('automatch-bounce-review-bp-amb')).toBeVisible();
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (1)');
  });

  test('ticking the row checks it directly and adds the pair to "Excluir"; unticking takes it out', async ({ page }) => {
    await login(page);
    await installMocks(page, { ai: AI_85_10 });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await pairCheck(page, 'bp-amb').click();
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'true');
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (2)');
    // Ticking never changes the outflow shown.
    await expect(shownOutflow(page)).toContainText(AMB_CAND_2.description);
    await pairCheck(page, 'bp-amb').click();
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'false');
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (1)');
  });

  test('"Excluir" carries choiceSource "ai" when the shown outflow is the AI-recommended one', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { ai: AI_85_10 });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    const body = await excludeOnlyAmbiguous(page, posts);
    expect(posts.applySuggestions).toHaveLength(1);
    expect(body).toEqual({
      financialAccountId: ACCOUNT_ID,
      groups: [{ kind: 'bouncePair', statementLineId: AMB_CAND_2.id, counterpartLineId: AMB_BOUNCE.id, choiceSource: 'ai' }],
    });
    await expect(page.getByTestId('automatch-bounce-row-bp-amb')).toHaveCount(0);
  });

  test('the recommendation wins over a higher percentage: the recommended outflow is shown and sent as "ai"', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { ai: AI_REC_LOW });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await expect(shownOutflow(page)).toContainText(AMB_CAND_1.description);
    await expect(rowPct(page)).toHaveText('30 %');
    const body = await excludeOnlyAmbiguous(page, posts);
    expect(body.groups).toEqual([
      { kind: 'bouncePair', statementLineId: AMB_CAND_1.id, counterpartLineId: AMB_BOUNCE.id, choiceSource: 'ai' },
    ]);
  });

  test('"Excluir" carries choiceSource "user" when the AI rated the pair but recommends none (the most probable is shown)', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { ai: AI_60_40 });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await expect(shownOutflow(page)).toContainText(AMB_CAND_2.description);

    const body = await excludeOnlyAmbiguous(page, posts);
    expect(body.groups).toEqual([
      { kind: 'bouncePair', statementLineId: AMB_CAND_2.id, counterpartLineId: AMB_BOUNCE.id, choiceSource: 'user' },
    ]);
  });

  test('a stale refusal keeps the pair on screen, unchecked, without its AI mark', async ({ page }) => {
    await login(page);
    const stale = {
      statementLineId: AMB_CAND_2.id, code: 'BOUNCE_AI_SUGGESTION_STALE', key: 'ETGO_BounceAiSuggestionStale', times: 1,
    };
    const { posts } = await installMocks(page, { ai: AI_85_10, refusePairs: [stale] });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    const first = await excludeOnlyAmbiguous(page, posts);
    expect(first.groups[0].choiceSource).toBe('ai');
    await expect(page.locator('[data-type="error"]').first()).toContainText('La sugerencia de la IA está desactualizada');
    await expect(page.getByTestId('automatch-bounce-row-bp-amb')).toBeVisible();
    await expect(rowPct(page)).toHaveCount(0);
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'false');
    await expect(excludeButton(page)).toBeDisabled();
  });

  test('nothing is preselected, and select-all includes the AI-rated ambiguous pair', async ({ page }) => {
    await login(page);
    await installMocks(page, { ai: AI_85_10 });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    // Even with an AI recommendation the ambiguous pair does not start checked.
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'false');
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (1)');

    await page.getByTestId('automatch-bounce-select-all').click();
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (3)');
    for (const key of ['bp-high', 'bp-review', 'bp-amb']) {
      await expect(pairInput(page, key)).toHaveAttribute('aria-checked', 'true');
    }
    await page.getByTestId('automatch-bounce-select-all').click();
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (0)');
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'false');
  });

  test('keyboard: Space on the AI-rated ambiguous pair\'s checkbox ticks it, like any pair', async ({ page }) => {
    await login(page);
    await installMocks(page, { ai: AI_85_10 });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await pairInput(page, 'bp-amb').focus();
    await page.keyboard.press('Space');
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'true');
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (2)');
  });

  /**
   * Measures the ambiguous pair's row: its own box and scroll width, the shown outflow's description
   * (how many characters are actually visible, from the clipped width against the width of the
   * whole text), the width of its amount column, and the AI mark's box, plus the scroll widths of
   * the modal body and the page.
   */
  async function measureRow(page) {
    return modal(page).evaluate((dialog) => {
      const row = dialog.querySelector('[data-testid="automatch-bounce-row-bp-amb"]');
      const rb = row.getBoundingClientRect();
      const side = dialog.querySelector('[data-testid="automatch-bounce-original-bp-amb"]');
      const desc = dialog.querySelector('[data-testid="automatch-bounce-original-bp-amb-desc"]');
      const text = desc.textContent.trim();
      const range = document.createRange();
      range.selectNodeContents(desc);
      const full = range.getBoundingClientRect().width;
      const pct = dialog.querySelector('[data-testid="automatch-bounce-ai-pct-bp-amb"]')?.getBoundingClientRect();
      const body = dialog.querySelector('.overflow-y-auto');
      return {
        row: { scroll: row.scrollWidth, client: row.clientWidth, left: rb.left, right: rb.right, top: rb.top, bottom: rb.bottom },
        length: text.length,
        visibleChars: full > 0 ? text.length * Math.min(1, desc.clientWidth / full) : 0,
        amountColumn: side.lastElementChild.getBoundingClientRect().width,
        pct: pct ? { left: pct.left, right: pct.right, top: pct.top, bottom: pct.bottom } : null,
        body: [body.scrollWidth, body.clientWidth],
        page: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
      };
    });
  }

  test('narrow width: at 768 px with long bank text the row does not overflow, the outflow stays readable and its mark inside; 1248 px keeps the wide layout', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await login(page);
    await installMocks(page, { ai: AI_85_10, longDescriptions: true });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await expect(rowPct(page)).toBeVisible();

    const narrow = await measureRow(page);
    // Neither the row nor the modal body nor the page scroll sideways.
    expect(narrow.row.scroll).toBeLessThanOrEqual(narrow.row.client);
    expect(narrow.body[0]).toBeLessThanOrEqual(narrow.body[1]);
    expect(narrow.page[0]).toBeLessThanOrEqual(narrow.page[1]);
    // The description is not collapsed to a few characters: the amount column shrinks to its content
    // below 1100 px instead of keeping the fixed 160 px.
    expect(narrow.length).toBeGreaterThan(40);
    expect(narrow.visibleChars).toBeGreaterThanOrEqual(20);
    expect(narrow.amountColumn).toBeLessThan(160);
    // The "✦ NN %" mark is fully inside the row.
    expect(narrow.pct).not.toBeNull();
    expect(narrow.pct.left).toBeGreaterThanOrEqual(narrow.row.left - 1);
    expect(narrow.pct.right).toBeLessThanOrEqual(narrow.row.right + 1);
    expect(narrow.pct.top).toBeGreaterThanOrEqual(narrow.row.top - 1);
    expect(narrow.pct.bottom).toBeLessThanOrEqual(narrow.row.bottom + 1);

    // The same modal at 1248 px keeps the wide layout: the 160 px amount column and more text.
    await page.setViewportSize({ width: 1248, height: 900 });
    await expect(modal(page)).toBeVisible();
    await expect.poll(async () => Math.round((await measureRow(page)).amountColumn)).toBe(160);
    const wide = await measureRow(page);
    expect(wide.row.scroll).toBeLessThanOrEqual(wide.row.client);
    expect(wide.body[0]).toBeLessThanOrEqual(wide.body[1]);
    expect(wide.page[0]).toBeLessThanOrEqual(wide.page[1]);
    expect(wide.visibleChars).toBeGreaterThan(narrow.visibleChars);
    expect(wide.pct.right).toBeLessThanOrEqual(wide.row.right + 1);
  });
});

// ── The modal: a no-AI ambiguous row, rejections sharing an outflow, stale suggestions (ETP-6359) ──

// Both ambiguous rejections (AMB over [CAND_1, CAND_2], AMB2 over [CAND_2, CAND_3]) recommend the
// outflow they share, CAND_2.
const AI_SHARED = {
  ...AI_85_10,
  [AMB2_BOUNCE.id]: { probabilities: { [AMB_CAND_2.id]: 80, [AMB_CAND_3.id]: 15 }, none: 5, recommendedLineId: AMB_CAND_2.id },
};

test.describe('Reconciliation — modal: shared outflows and rows that cannot be ticked (mocked)', () => {
  test('without AI data an ambiguous row cannot be ticked: disabled with its reason, skipped by select-all, its own outflow named', async ({ page }) => {
    await login(page);
    await installMocks(page);
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();

    await expect(pairInput(page, 'bp-amb')).toBeDisabled();
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'false');
    await expect(pairInput(page, 'bp-amb')).toHaveAccessibleName('Elige la salida original en el panel para excluir este par');
    // The meta names the one outflow the row shows: its own date and bank reference.
    await expect(page.getByTestId('automatch-bounce-original-meta-bp-amb')).toContainText(`Ref. ${AMB_CAND_1.referenceNo}`);
    await expect(page.getByTestId('automatch-bounce-review-bp-amb')).toBeVisible();

    await page.getByTestId('automatch-bounce-select-all').click();
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (2)');
    await expect(pairInput(page, 'bp-amb')).toHaveAttribute('aria-checked', 'false');
  });

  test('two AI-rated rejections sharing an outflow: ticking the first moves the second to its other candidate, and "Excluir" sends different outflows', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { ai: AI_SHARED, extraPairs: ['amb2'] });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await expect(shownOutflow(page)).toContainText(AMB_CAND_2.description);
    await expect(shownOutflow(page, 'bp-amb2')).toContainText(AMB_CAND_2.description);

    await uncheckHigh(page);
    await pairCheck(page, 'bp-amb').click();
    await expect(shownOutflow(page, 'bp-amb2')).toContainText(AMB_CAND_3.description);
    await expect(page.getByTestId('automatch-bounce-original-meta-bp-amb2')).toContainText(`Ref. ${AMB_CAND_3.referenceNo}`);
    await pairCheck(page, 'bp-amb2').click();
    await expect(excludeButton(page)).toHaveText('Excluir de la conciliación (2)');

    const post = requestsOf(page, 'applySuggestions');
    await excludeButton(page).click();
    await post;
    expect(posts.applySuggestions[0].groups).toEqual([
      { kind: 'bouncePair', statementLineId: AMB_CAND_2.id, counterpartLineId: AMB_BOUNCE.id, choiceSource: 'ai' },
      { kind: 'bouncePair', statementLineId: AMB_CAND_3.id, counterpartLineId: AMB2_BOUNCE.id, choiceSource: 'user' },
    ]);
    await expect(page.getByTestId('automatch-bounce-row-bp-amb')).toHaveCount(0);
    await expect(page.getByTestId('automatch-bounce-row-bp-amb2')).toHaveCount(0);
  });

  test('a LINE_NOT_PENDING refusal reloads the suggestions, even when nothing was excluded', async ({ page }) => {
    await login(page);
    const refusal = { statementLineId: REVIEW_ORIGINAL.id, code: 'LINE_NOT_PENDING', key: 'ETGO_BounceLineNotPending' };
    const { posts, autoMatchRequests } = await installMocks(page, { refusePairs: [refusal] });
    await openReconciliation(page);
    await expect(modal(page)).toBeVisible();
    await uncheckHigh(page);
    await pairCheck(page, 'bp-review').click();
    const before = autoMatchRequests.count;

    const post = requestsOf(page, 'applySuggestions');
    await excludeButton(page).click();
    await post;
    expect(posts.applySuggestions[0].groups).toEqual([
      { kind: 'bouncePair', statementLineId: REVIEW_ORIGINAL.id, counterpartLineId: REVIEW_BOUNCE.id },
    ]);
    await expect(page.locator('[data-type="error"]').first()).toContainText('ya no está pendiente de conciliar');
    await expect.poll(() => autoMatchRequests.count).toBeGreaterThan(before);
  });
});

// ── The panel: an outflow dated AFTER the rejection, and the 60-day window both ways ───────────

test.describe('Reconciliation — panel: pairable outflows by date (mocked)', () => {
  const HINT = 'Ningún rechazo puede emparejarse con esta salida (importe distinto o más de 60 días de diferencia)';
  const out = (key) => `bsl-${key}-out`;
  const rej = (key) => `bsl-${key}-in`;

  test('an outflow dated AFTER the rejection is pairable: a free pick keeps the rejection and discards with it', async ({ page }) => {
    await login(page);
    const { posts } = await installMocks(page, { extraPairs: ['after'] });
    await openReconciliation(page);
    const panel = await reviewAmbiguousInPanel(page);

    const afterOut = WINDOW_PAIRS.after.statementLine;
    await expect(panel.getByTestId(`recon-outflow-nomatch-${afterOut.id}`)).toHaveCount(0);
    await panel.getByTestId(`recon-outflow-row-${afterOut.id}`).click();
    // No re-target: the ambiguous rejection stays selected and the outflow is the pick.
    await expect(panel.getByTestId(`recon-line-radio-${AMB_BOUNCE.id}`)).toBeChecked();
    await expect(panel.getByTestId(`recon-outflow-radio-${afterOut.id}`)).toBeChecked();
    const post = requestsOf(page, 'discardPair');
    await panel.getByTestId('recon-bounce-discard').click();
    await post;
    expect(posts.discardPair).toEqual([{
      financialAccountId: ACCOUNT_ID, statementLineId: afterOut.id, counterpartLineId: AMB_BOUNCE.id, choiceSource: 'user',
    }]);
  });

  test('day 60 is pairable (outflow before or after its rejection), day 61 is disabled with the new hint', async ({ page }) => {
    await login(page);
    await installMocks(page, { extraPairs: ['d60', 'd61', 'd60b', 'd61b'] });
    await openReconciliation(page);
    await openPairViewFromModal(page);

    for (const key of ['d60', 'd60b']) {
      await expect(page.getByTestId(`recon-outflow-nomatch-${out(key)}`)).toHaveCount(0);
      await expect(page.getByTestId(`recon-outflow-radio-${out(key)}`)).not.toHaveAttribute('aria-disabled', 'true');
    }
    for (const key of ['d61', 'd61b']) {
      await expect(page.getByTestId(`recon-outflow-nomatch-${out(key)}`)).toHaveText(HINT);
      await expect(page.getByTestId(`recon-outflow-radio-${out(key)}`)).toHaveAttribute('aria-disabled', 'true');
    }
    // Day 60 selects its own rejection; day 61 changes nothing.
    await page.getByTestId(`recon-outflow-row-${out('d60b')}`).click();
    await expect(page.getByTestId(`recon-line-radio-${rej('d60b')}`)).toBeChecked();
    await page.getByTestId(`recon-outflow-row-${out('d61b')}`).click();
    await expect(page.getByTestId(`recon-line-radio-${rej('d60b')}`)).toBeChecked();
    await expect(page.getByTestId(`recon-line-radio-${rej('d61b')}`)).toHaveCount(0);
    await page.getByTestId(`recon-outflow-row-${out('d60')}`).click();
    await expect(page.getByTestId(`recon-line-radio-${rej('d60')}`)).toBeChecked();
  });
});
