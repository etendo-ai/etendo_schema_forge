// @covers tools/app-shell/src/components/contract-ui/ReconciliationSplitPanel.jsx
// @covers tools/app-shell/src/components/contract-ui/BouncePairPanel.jsx
// @covers tools/app-shell/src/components/contract-ui/useBouncePairReview.jsx
// @covers tools/app-shell/src/components/contract-ui/bouncePairs.js
/**
 * Bounce pairs and discarded lines in the reconciliation split panel (flag `bank-bounce-suggestions`).
 * The backend sends `counts.bounce`, `counts.discarded` and the discarded rows only with the flag
 * on; with it off the panel gets none of them.
 *
 * The SPA never evaluates the flag. It renders the `bounce` line state, `counts.bounce` and the
 * `bouncePair` annotation when the backend answers them; a selected bounce or discarded line gets
 * the bounce-pair panel instead of the candidate operations.
 *
 * `usePendingStatementLines` is replaced by a small fake that behaves like the real resource hook:
 * a change of filters (date range, `status`) reloads — `loading` turns true, then the answer for
 * the new filters arrives on the next tick. The answer is chosen per test by `pending.answer`.
 */

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

// The key, plus its params as JSON; a `backendError.*` key reads as translated (`T(<key>)`).
function fakeUi(key, params) {
  if (key.startsWith('backendError.')) return `T(${key})`;
  if (params && typeof params === 'object' && Object.keys(params).length > 0) {
    return `${key}:${JSON.stringify(params)}`;
  }
  return key;
}

vi.mock('@/i18n', () => ({
  useUI: () => fakeUi,
  useLocaleSwitch: () => ({ locale: 'es_ES' }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

const pending = {
  answer: () => ({ lines: [], counts: {} }),
  calls: [],
  reload: vi.fn(),
};
const candidateLineIds = [];

vi.mock('@/hooks/useReconciliation', async () => {
  const React = await import('react');
  return {
    usePendingStatementLines: (accountId, filters = {}) => {
      pending.calls.push({ accountId, ...filters });
      const key = JSON.stringify(filters);
      const [state, setState] = React.useState({ key: null, data: null });
      React.useEffect(() => {
        let alive = true;
        const t = setTimeout(() => {
          if (alive) setState({ key, data: pending.answer(filters) });
        }, 0);
        return () => { alive = false; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [key]);
      const data = state.data ?? { lines: [], counts: {} };
      return {
        lines: data.lines,
        total: data.lines.length,
        counts: data.counts,
        loading: state.key !== key,
        reload: pending.reload,
        draftReconciliationCount: 0,
      };
    },
    useCandidateOperations: (accountId, lineId) => {
      candidateLineIds.push(lineId);
      return { candidates: [], counts: {}, loading: false };
    },
    useReconcileGroup: () => ({ reconcile: vi.fn(), loading: false }),
    useRemoveOperation: () => ({ removeOperation: vi.fn(), loading: false }),
    useReconcileDifference: () => ({ reconcileDifference: vi.fn(), loading: false }),
  };
});

const discardPairMock = vi.fn();
const restorePairMock = vi.fn();
const dismissPairMock = vi.fn();
// Read on every render, so a test can put a discard or a restore in flight (the panel's `busy`).
const pairActions = { discarding: false, restoring: false };
const pendingLineCountsMock = vi.fn();
vi.mock('@/hooks/useBouncePairActions.js', () => ({
  useDiscardPair: () => ({ discardPair: discardPairMock, loading: pairActions.discarding, error: null }),
  useRestorePair: () => ({ restorePair: restorePairMock, loading: pairActions.restoring, error: null }),
  useDismissPair: () => ({ dismissPair: dismissPairMock, loading: false, error: null }),
  usePendingLineCounts: () => pendingLineCountsMock,
}));

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { ReconciliationSplitPanel } from '@/components/contract-ui/ReconciliationSplitPanel.jsx';
import { formatDate, formatSigned } from '@/lib/formatSigned';
import { AiPercentText, BounceNotice, BounceFooter } from '@/components/contract-ui/BouncePairPanel.jsx';
import { bouncePanelModel } from '@/components/contract-ui/bouncePairs.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const PLAIN = { id: 'P1', state: 'pending', status: 'pending', amount: -10, date: '2026-10-01', description: 'Plain line' };

const O1_SHORT = { id: 'O1', amount: -120, date: '2026-10-02', description: 'Pago proveedor' };
const B1_SHORT = { id: 'B1', amount: 120, date: '2026-10-02', description: 'DEVOLUCION' };
const HIGH_PAIR = {
  groupKey: 'g-high', ambiguous: false, confidence: 'high', signal: 'pis_link', signals: ['pis_link'],
};
const O1 = {
  ...O1_SHORT, state: 'bounce', status: 'pending',
  bouncePair: { ...HIGH_PAIR, role: 'original', counterpartLine: B1_SHORT },
};
const B1 = {
  ...B1_SHORT, state: 'bounce', status: 'pending',
  bouncePair: { ...HIGH_PAIR, role: 'bounce', counterpartLine: O1_SHORT },
};

const C1_SHORT = { id: 'C1', amount: -80, date: '2026-10-01', description: 'Pago ACME 1' };
const C2_SHORT = { id: 'C2', amount: -80, date: '2026-10-03', description: 'Pago ACME 2' };
const B3_SHORT = { id: 'B3', amount: 80, date: '2026-10-05', description: 'Abono ACME' };
const AMB_PAIR = {
  groupKey: 'g-amb', ambiguous: true, confidence: 'review', signal: 'counterparty', signals: ['counterparty'],
};
const B3 = {
  ...B3_SHORT, state: 'bounce', status: 'pending',
  bouncePair: { ...AMB_PAIR, role: 'bounce', candidates: [{ line: C1_SHORT }, { line: C2_SHORT }] },
};
const C1 = { ...C1_SHORT, state: 'bounce', status: 'pending', bouncePair: { ...AMB_PAIR, role: 'candidate', counterpartLine: B3_SHORT } };
const C2 = { ...C2_SHORT, state: 'bounce', status: 'pending', bouncePair: { ...AMB_PAIR, role: 'candidate', counterpartLine: B3_SHORT } };

const BOUNCE_LINES = [PLAIN, O1, B1, C1, C2, B3];
const BOUNCE_COUNTS = {
  all: 6, pending: 1, suggested: 0, byRule: 0, difference: 0, reconciled: 0, bounce: 5, discarded: 3,
};

const DISCARDED_AT = '2026-09-10T10:00:00Z';
const D1 = {
  id: 'D1', state: 'discarded', status: 'discarded', discarded: true, amount: -50, date: '2026-09-01', description: 'Cuota gimnasio',
  bounceLink: { counterpartLineId: 'D2', discardedAt: DISCARDED_AT, signal: 'return_text', confidence: 'high' },
};
const D2 = {
  id: 'D2', state: 'discarded', status: 'discarded', discarded: true, amount: 50, date: '2026-09-03', description: 'Cuota devuelta',
  bounceLink: { counterpartLineId: 'D1', discardedAt: DISCARDED_AT, signal: 'return_text', confidence: 'high' },
};
const D3 = {
  id: 'D3', state: 'discarded', status: 'discarded', discarded: true, amount: -7, date: '2026-08-20', description: 'Comision', bounceLink: null,
};

/** The flag-on answer, and the `status=discarded` one when that filter is active. */
function bounceAnswer(filters) {
  if (filters.status === 'discarded') return { lines: [D1, D2, D3], counts: { discarded: 3 } };
  return { lines: BOUNCE_LINES, counts: BOUNCE_COUNTS };
}

function renderPanel(props = {}) {
  const onReconcileSuccess = vi.fn();
  const utils = render(
    <ReconciliationSplitPanel
      accountId="ACC-1"
      currency="EUR"
      amountTolerance={5}
      onReconcileSuccess={onReconcileSuccess}
      {...props}
    />,
  );
  return { ...utils, onReconcileSuccess };
}

const row = (id) => screen.getByTestId(`recon-line-row-${id}`);
const lastCall = () => pending.calls.at(-1);

/** Opens the status dropdown (its trigger shows the active label) and returns the option labels. */
function openStatus(activeLabelKey) {
  fireEvent.click(screen.getByText(new RegExp(`^${activeLabelKey} \\(`)));
}

function selectStatus(activeLabelKey, nextLabelKey) {
  openStatus(activeLabelKey);
  fireEvent.click(screen.getByText(new RegExp(`^${nextLabelKey} \\(`)));
}

async function selectLineRow(id) {
  fireEvent.click(await screen.findByTestId(`recon-line-radio-${id}`));
}

beforeEach(() => {
  pending.answer = bounceAnswer;
  pairActions.discarding = false;
  pairActions.restoring = false;
  pending.calls = [];
  pending.reload = vi.fn();
  candidateLineIds.length = 0;
  discardPairMock.mockReset().mockResolvedValue({ discarded: true });
  restorePairMock.mockReset().mockResolvedValue({ restored: ['D1', 'D2'] });
  dismissPairMock.mockReset().mockResolvedValue({});
  pendingLineCountsMock.mockReset().mockResolvedValue(null);
  toast.success.mockClear();
  toast.error.mockClear();
  Element.prototype.scrollIntoView.mockClear();
});

// ── Left panel ─────────────────────────────────────────────────────────────────

describe('ReconciliationSplitPanel — bounce lines in the left panel', () => {
  it('flag off: no bounce or discarded filter entry, no status param', async () => {
    pending.answer = () => ({ lines: [PLAIN], counts: { all: 1, pending: 1, reconciled: 0 } });
    renderPanel();
    await screen.findByTestId('recon-line-row-P1');
    expect(lastCall().status).toBeUndefined();
    openStatus('financeReconcileFilterStatusPending');
    expect(screen.queryByText(/^financeReconcileFilterStatusBounce/)).toBeNull();
    expect(screen.queryByText(/^financeReconcileFilterStatusDiscarded/)).toBeNull();
    expect(screen.getByText(/^financeReconcileFilterStatusReconciled \(0\)/)).toBeInTheDocument();
  });

  // The backend only sends counts.discarded with the flag on, and then always with counts.bounce:
  // an account whose pairs were all discarded answers `bounce: 0` next to `discarded: N`.
  it('flag on with no pair left but discarded lines: offers Posibles rechazos (0) and Descartadas', async () => {
    pending.answer = () => ({ lines: [PLAIN], counts: { all: 1, pending: 1, bounce: 0, discarded: 2 } });
    renderPanel();
    await screen.findByTestId('recon-line-row-P1');
    expect(lastCall().status).toBeUndefined();
    openStatus('financeReconcileFilterStatusPending');
    expect(screen.getByText(/^financeReconcileFilterStatusBounce \(0\)/)).toBeInTheDocument();
    expect(screen.getByText(/^financeReconcileFilterStatusDiscarded \(2\)/)).toBeInTheDocument();
  });

  it('shows the "Posible rechazo" badge, the bounce entry and counts bounce lines as Pendientes', async () => {
    renderPanel();
    await screen.findByTestId('recon-line-row-B3');
    expect(within(row('B3')).getByText('financeReconcileBadgeBounce')).toBeInTheDocument();
    expect(within(row('P1')).getByText('financeReconcileBadgePending')).toBeInTheDocument();
    // Pendientes = 1 pending + 5 bounce: every bounce line is on screen under the default filter.
    expect(screen.getByText(/^financeReconcileFilterStatusPending \(6\)/)).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^recon-line-row-/)).toHaveLength(6);
    openStatus('financeReconcileFilterStatusPending');
    // Posibles rechazos counts PAIRS (g-high, g-amb), not the 5 lines of the backend's count.
    expect(screen.getByText(/^financeReconcileFilterStatusBounce \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/^financeReconcileFilterStatusDiscarded \(3\)/)).toBeInTheDocument();
  });

  it('the Posibles rechazos filter shows one row per pair, still without a status param', async () => {
    renderPanel();
    await screen.findByTestId('recon-line-row-B3');
    selectStatus('financeReconcileFilterStatusPending', 'financeReconcileFilterStatusBounce');
    expect(screen.queryByTestId('recon-line-row-P1')).toBeNull();
    // Nothing selected: the right side is the empty-state placeholder (no rejections table, no
    // title) while the left table lists every outflow. Clicking an outflow brings the narrowed
    // list of rejections it can be paired with (g-high -> B1 for O1).
    expect(screen.getByTestId('recon-right-empty')).toHaveTextContent('financeReconcileBounceRightEmptyTitle');
    expect(screen.queryAllByTestId(/^recon-line-row-/)).toHaveLength(0);
    expect(screen.queryByTestId('recon-rejections-title')).toBeNull();
    expect(screen.queryAllByTestId(/^recon-outflow-row-/)).toHaveLength(3);
    fireEvent.click(screen.getByTestId('recon-outflow-row-O1'));
    expect(screen.queryByTestId('recon-right-empty')).toBeNull();
    expect(screen.queryAllByTestId(/^recon-line-row-/).map((el) => el.dataset.testid))
      .toEqual(['recon-line-row-B1']);
    expect(lastCall().status).toBeUndefined();
  });
});

// ── Right panel: lines of a detected pair ──────────────────────────────────────

describe('ReconciliationSplitPanel — the bounce-pair panel', () => {
  it('replaces the candidate operations: useCandidateOperations gets a null line id', async () => {
    renderPanel();
    await selectLineRow('O1');
    expect(screen.getByTestId('recon-bounce-panel')).toBeInTheDocument();
    expect(candidateLineIds.at(-1)).toBeNull();
    // A plain line still gets its candidates.
    fireEvent.click(screen.getByTestId('recon-line-radio-P1'));
    expect(screen.queryByTestId('recon-bounce-panel')).toBeNull();
    expect(candidateLineIds.at(-1)).toBe('P1');
  });

  it('original of a high pair: lists the bounce, high notice, net effect and an enabled discard', async () => {
    renderPanel();
    await selectLineRow('O1');
    expect(screen.getByTestId('recon-bounce-source')).toHaveTextContent('financeReconcileBounceSourceBounces:{"count":1}');
    expect(screen.getByTestId('recon-bounce-row-B1')).toBeInTheDocument();
    expect(screen.getByTestId('recon-bounce-badge-B1')).toHaveTextContent('financeReconcileBadgeBounce');
    expect(screen.getByTestId('recon-bounce-notice')).toHaveTextContent(/^financeReconcileBounceNoticeHigh:.*financeReconcileBounceSignalPisLink/);
    expect(screen.getByTestId('recon-bounce-total-net')).toBeInTheDocument();
    expect(screen.getByTestId('recon-bounce-discard')).toBeEnabled();
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(discardPairMock).toHaveBeenCalledWith({
      financialAccountId: 'ACC-1', statementLineId: 'O1', counterpartLineId: 'B1',
    }));
  });

  it('bounce of an ambiguous pair: radios, nothing preselected, discard disabled until chosen', async () => {
    renderPanel();
    await selectLineRow('B3');
    expect(screen.getByTestId('recon-bounce-source')).toHaveTextContent('financeReconcileBounceSourceOriginals:{"count":2}');
    expect(screen.getByTestId('recon-bounce-radio-C1')).not.toBeChecked();
    expect(screen.getByTestId('recon-bounce-radio-C2')).not.toBeChecked();
    expect(screen.getByTestId('recon-bounce-badge-C1')).toHaveTextContent('financeReconcileBadgeBounceOriginal');
    expect(screen.getByTestId('recon-bounce-notice')).toHaveTextContent('financeReconcileBounceNoticeChoose');
    expect(screen.getByTestId('recon-bounce-discard')).toBeDisabled();
  });

  it('choosing the original of an ambiguous pair sends discardPair, then toasts, reloads and notifies', async () => {
    const { onReconcileSuccess } = renderPanel();
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-radio-C2'));
    expect(screen.getByTestId('recon-bounce-radio-C2')).toBeChecked();
    expect(screen.getByTestId('recon-bounce-notice')).not.toHaveTextContent('financeReconcileBounceNoticeChoose');
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('financeReconcileBounceToastDiscarded'));
    expect(discardPairMock).toHaveBeenCalledTimes(1);
    expect(discardPairMock).toHaveBeenCalledWith({
      financialAccountId: 'ACC-1', statementLineId: 'C2', counterpartLineId: 'B3',
    });
    expect(pending.reload).toHaveBeenCalled();
    expect(onReconcileSuccess).toHaveBeenCalled();
  });

  it('Posibles rechazos, two tables: the outflows are listed once, a rejection highlights its candidates, clicking one picks it', async () => {
    renderPanel();
    await screen.findByTestId('recon-line-row-B3');
    selectStatus('financeReconcileFilterStatusPending', 'financeReconcileFilterStatusBounce');
    // Outflows (left): O1 (original of g-high), C1 and C2 (candidates of g-amb); rejections (right): B1, B3.
    expect(screen.queryAllByTestId(/^recon-outflow-row-/).map((el) => el.dataset.testid))
      .toEqual(['recon-outflow-row-C1', 'recon-outflow-row-O1', 'recon-outflow-row-C2']);
    expect(screen.queryByTestId('recon-bounce-radio-C1')).toBeNull();
    // Clicking C1 selects B3 (the first rejection that lists it); C1 is the pick there.
    fireEvent.click(screen.getByTestId('recon-outflow-row-C1'));
    expect(screen.getByTestId('recon-line-radio-B3')).toBeChecked();
    expect(screen.getByTestId('recon-bounce-radio-C1')).toBeChecked();
    expect(screen.queryByTestId('recon-bounce-radio-O1')).toBeNull();
    fireEvent.click(screen.getByTestId('recon-outflow-row-C2'));
    expect(screen.getByTestId('recon-bounce-radio-C2')).toBeChecked();
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(discardPairMock).toHaveBeenCalledWith({
      financialAccountId: 'ACC-1', statementLineId: 'C2', counterpartLineId: 'B3',
    }));
  });

  it('Posibles rechazos: any outflow can be clicked (re-targeting), only the chosen one is selected, the right list follows it, no show-all toggle', async () => {
    const X1_SHORT = { id: 'X1', amount: -80, date: '2026-10-02', description: 'Otra salida' };
    const B4_SHORT = { id: 'B4', amount: 80, date: '2026-10-06', description: 'Abono otro' };
    const X_PAIR = { groupKey: 'g-x', ambiguous: false, confidence: 'review', signal: 'counterparty', signals: ['counterparty'] };
    const X1 = { ...X1_SHORT, state: 'bounce', status: 'pending', bouncePair: { ...X_PAIR, role: 'original', counterpartLine: B4_SHORT } };
    const B4 = { ...B4_SHORT, state: 'bounce', status: 'pending', bouncePair: { ...X_PAIR, role: 'bounce', counterpartLine: X1_SHORT } };
    pending.answer = () => ({ lines: [PLAIN, O1, B1, C1, C2, B3, X1, B4], counts: { ...BOUNCE_COUNTS, all: 8, bounce: 7 } });
    renderPanel();
    await screen.findByTestId('recon-line-row-B3');
    selectStatus('financeReconcileFilterStatusPending', 'financeReconcileFilterStatusBounce');
    // The detector's own outflows of the selected rejection keep `recon-bounce-radio-`.
    const outflowRadio = (id) => screen.queryByTestId(`recon-bounce-radio-${id}`) ?? screen.getByTestId(`recon-outflow-radio-${id}`);
    const rejections = () => screen.queryAllByTestId(/^recon-line-row-/).map((el) => el.dataset.testid);
    // No rejection selected: every radio is enabled, the right list is whole. Clicking X1 selects
    // the first rejection it can be paired with (B4) and X1 is the pick there.
    expect(outflowRadio('X1')).toBeEnabled();
    expect(screen.getByTestId('recon-right-empty')).toBeInTheDocument();
    expect(rejections()).toEqual([]);
    fireEvent.click(screen.getByTestId('recon-outflow-row-X1'));
    expect(screen.getByTestId('recon-line-radio-B4')).toBeChecked();
    expect(outflowRadio('X1')).toBeChecked();
    // The right list now holds only the rejections X1 can be paired with, and says so.
    expect(rejections()).toEqual(['recon-line-row-B3', 'recon-line-row-B4']);
    expect(screen.getByTestId('recon-rejections-title')).toHaveTextContent('financeReconcileBounceViewRejections:{"count":2}');
    // There is no "show all" control: the list always follows the chosen outflow.
    expect(screen.queryByTestId('recon-rejections-toggle')).toBeNull();
    // Select B3 (X1 stays pairable): X1 is the original of ANOTHER pair, picked as an explicit
    // pick, and it alone has the selected background (the candidate C1 has none).
    fireEvent.click(row('B3'));
    fireEvent.click(screen.getByTestId('recon-outflow-row-X1'));
    expect(outflowRadio('X1')).toBeChecked();
    expect(screen.getByTestId('recon-outflow-row-C1').className).not.toMatch(/bg-\[hsl\(var\(--muted\)\)\]/);
    expect(screen.getByTestId('recon-outflow-row-X1').querySelector('td').className).toMatch(/bg-\[hsl\(var\(--muted\)\)\]/);
    // O1 (-120) cannot be paired with B3: the click re-targets to B1, the rejection that can.
    fireEvent.click(screen.getByTestId('recon-outflow-row-O1'));
    expect(screen.getByTestId('recon-line-radio-B1')).toBeChecked();
    expect(outflowRadio('O1')).toBeChecked();
    // The right list now holds only B1 (the rejection O1 can be paired with); another amount is
    // reached by clicking an outflow: C1 re-targets to B3 (it lists it), then X1 is the explicit
    // pick there and discard sends it with the rejection.
    expect(rejections()).toEqual(['recon-line-row-B1']);
    fireEvent.click(screen.getByTestId('recon-outflow-row-C1'));
    expect(screen.getByTestId('recon-line-radio-B3')).toBeChecked();
    fireEvent.click(screen.getByTestId('recon-outflow-row-X1'));
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(discardPairMock).toHaveBeenCalledWith({
      financialAccountId: 'ACC-1', statementLineId: 'X1', counterpartLineId: 'B3',
    }));
    await waitFor(() => expect(pending.reload).toHaveBeenCalled());
  });

  it('clicking a row of an ambiguous pair also chooses it', async () => {
    renderPanel();
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-row-C1'));
    expect(screen.getByTestId('recon-bounce-radio-C1')).toBeChecked();
    expect(screen.getByTestId('recon-bounce-discard')).toBeEnabled();
  });

  it('shows the coded refusal translated, and does not reload', async () => {
    const err = Object.assign(new Error('One of the lines is the bank movement of a payment'), {
      status: 409,
      code: 'HAS_PAYMENT',
      body: {
        code: 'HAS_PAYMENT',
        error: { message: 'One of the lines is the bank movement of a payment', messageKeys: ['ETGO_BounceHasPayment'] },
      },
    });
    discardPairMock.mockRejectedValue(err);
    const { onReconcileSuccess } = renderPanel();
    await selectLineRow('O1');
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('T(backendError.bounceHasPayment)'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(pending.reload).not.toHaveBeenCalled();
    expect(onReconcileSuccess).not.toHaveBeenCalled();
  });

  it('falls back to the action message when the refusal carries no body', async () => {
    discardPairMock.mockRejectedValue(new Error('boom'));
    renderPanel();
    await selectLineRow('O1');
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('financeReconcileBounceToastDiscardError'));
  });
});

// ── Dismissal ("No es un rechazo") ──────────────────────────────────────────────

describe('ReconciliationSplitPanel — "No es un rechazo"', () => {
  it('without a bounceReview prop: the pair turns back into pending lines, locally', async () => {
    renderPanel();
    await selectLineRow('O1');
    fireEvent.click(screen.getByTestId('recon-bounce-dismiss'));
    expect(toast.success).toHaveBeenCalledWith('financeReconcileBounceToastDismissed');
    expect(screen.queryByTestId('recon-bounce-panel')).toBeNull();
    expect(within(row('O1')).getByText('financeReconcileBadgePending')).toBeInTheDocument();
    expect(within(row('B1')).getByText('financeReconcileBadgePending')).toBeInTheDocument();
    expect(within(row('B3')).getByText('financeReconcileBadgeBounce')).toBeInTheDocument();
    expect(discardPairMock).not.toHaveBeenCalled();
    // The two lines move from Posibles rechazos to plain pending; Pendientes is unchanged.
    expect(screen.getByText(/^financeReconcileFilterStatusPending \(6\)/)).toBeInTheDocument();
    openStatus('financeReconcileFilterStatusPending');
    expect(screen.getByText(/^financeReconcileFilterStatusBounce \(1\)/)).toBeInTheDocument();
  });

  it('with a bounceReview prop: delegates to onDismiss with the pair key and reads its dismissed keys', async () => {
    const onDismiss = vi.fn();
    const review = { focus: null, onFocusConsumed: vi.fn(), dismissedKeys: new Set(), onDismiss };
    const { rerender } = renderPanel({ bounceReview: review });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-dismiss'));
    expect(onDismiss).toHaveBeenCalledWith('g-amb');
    expect(toast.success).toHaveBeenCalledWith('financeReconcileBounceToastDismissed');

    rerender(
      <ReconciliationSplitPanel
        accountId="ACC-1" currency="EUR" amountTolerance={5}
        bounceReview={{ ...review, dismissedKeys: new Set(['g-amb']) }} />,
    );
    expect(within(row('B3')).getByText('financeReconcileBadgePending')).toBeInTheDocument();
    expect(within(row('C1')).getByText('financeReconcileBadgePending')).toBeInTheDocument();
    expect(screen.queryByTestId('recon-bounce-panel')).toBeNull();
  });

  // ETP-5581 KPI: the dismissal is also reported to the backend (dismissPair), fire-and-forget.

  it('reports it with dismissPair: the selected line and the other line of the pair', async () => {
    renderPanel();
    await selectLineRow('O1');
    fireEvent.click(screen.getByTestId('recon-bounce-dismiss'));
    expect(dismissPairMock).toHaveBeenCalledTimes(1);
    expect(dismissPairMock).toHaveBeenCalledWith({
      financialAccountId: 'ACC-1', statementLineId: 'O1', counterpartLineId: 'B1',
    });
  });

  it('an ambiguous pair with an original chosen sends it as the counterpart', async () => {
    renderPanel();
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-radio-C2'));
    fireEvent.click(screen.getByTestId('recon-bounce-dismiss'));
    expect(dismissPairMock).toHaveBeenCalledWith({
      financialAccountId: 'ACC-1', statementLineId: 'B3', counterpartLineId: 'C2',
    });
  });

  it('an ambiguous pair with no original chosen omits the counterpart', async () => {
    renderPanel();
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-dismiss'));
    expect(dismissPairMock).toHaveBeenCalledWith({ financialAccountId: 'ACC-1', statementLineId: 'B3' });
  });

  it('a failed report is silent: the pair is still hidden, only the dismissal toast shows', async () => {
    dismissPairMock.mockRejectedValue(new Error('HTTP 500'));
    renderPanel();
    await selectLineRow('O1');
    fireEvent.click(screen.getByTestId('recon-bounce-dismiss'));
    await waitFor(() => expect(dismissPairMock).toHaveBeenCalled());
    await Promise.resolve();
    expect(toast.success).toHaveBeenCalledWith('financeReconcileBounceToastDismissed');
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByTestId('recon-bounce-panel')).toBeNull();
    expect(within(row('O1')).getByText('financeReconcileBadgePending')).toBeInTheDocument();
  });

  it('a report that throws synchronously does not break the dismissal either', async () => {
    dismissPairMock.mockImplementation(() => { throw new Error('boom'); });
    renderPanel();
    await selectLineRow('O1');
    fireEvent.click(screen.getByTestId('recon-bounce-dismiss'));
    expect(toast.success).toHaveBeenCalledWith('financeReconcileBounceToastDismissed');
    expect(screen.queryByTestId('recon-bounce-panel')).toBeNull();
  });
});

// ── Discarded lines ────────────────────────────────────────────────────────────

describe('ReconciliationSplitPanel — the Descartadas filter', () => {
  async function openDiscarded() {
    renderPanel();
    await screen.findByTestId('recon-line-row-B3');
    selectStatus('financeReconcileFilterStatusPending', 'financeReconcileFilterStatusDiscarded');
    await screen.findByTestId('recon-line-row-D1');
  }

  it('asks for status=discarded and keeps the counts of the default answer for the other entries', async () => {
    await openDiscarded();
    expect(lastCall().status).toBe('discarded');
    expect(screen.queryAllByTestId(/^recon-line-row-/).map((el) => el.dataset.testid))
      .toEqual(['recon-line-row-D1', 'recon-line-row-D2', 'recon-line-row-D3']);
    expect(within(row('D1')).getByText('financeReconcileBadgeDiscarded')).toBeInTheDocument();
    openStatus('financeReconcileFilterStatusDiscarded');
    expect(screen.getAllByText(/^financeReconcileFilterStatusDiscarded \(3\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/^financeReconcileFilterStatusPending \(6\)/)).toBeInTheDocument();
    expect(screen.getByText(/^financeReconcileFilterStatusBounce \(2\)/)).toBeInTheDocument();
  });

  it('going back to Pendientes drops the status param', async () => {
    await openDiscarded();
    selectStatus('financeReconcileFilterStatusDiscarded', 'financeReconcileFilterStatusPending');
    await screen.findByTestId('recon-line-row-B3');
    expect(lastCall().status).toBeUndefined();
  });

  it('a paired discarded line shows its counterpart and the discard date', async () => {
    await openDiscarded();
    fireEvent.click(screen.getByTestId('recon-line-radio-D1'));
    expect(candidateLineIds.at(-1)).toBeNull();
    expect(screen.getByTestId('recon-bounce-row-D2')).toBeInTheDocument();
    expect(screen.getByTestId('recon-bounce-badge-D2')).toHaveTextContent('financeReconcileBadgeDiscarded');
    expect(screen.getByTestId('recon-bounce-source')).toHaveTextContent('financeReconcileBounceSourceDiscarded:{"count":1}');
    expect(screen.getByTestId('recon-bounce-notice')).toHaveTextContent(
      `financeReconcileBounceDiscardedNotice:${JSON.stringify({ date: formatDate(DISCARDED_AT, 'es-ES') })}`,
    );
    expect(screen.queryByTestId('recon-bounce-dismiss')).toBeNull();
    expect(screen.queryByTestId('recon-bounce-discard')).toBeNull();
    expect(screen.getByTestId('recon-bounce-restore')).toHaveTextContent('financeReconcileBounceRestore');
  });

  it('restoring a pair (2 lines restored) toasts "Par restaurado", reloads and notifies', async () => {
    const onReconcileSuccess = vi.fn();
    render(<ReconciliationSplitPanel accountId="ACC-1" currency="EUR" amountTolerance={5} onReconcileSuccess={onReconcileSuccess} />);
    await screen.findByTestId('recon-line-row-B3');
    selectStatus('financeReconcileFilterStatusPending', 'financeReconcileFilterStatusDiscarded');
    fireEvent.click(await screen.findByTestId('recon-line-radio-D1'));
    fireEvent.click(screen.getByTestId('recon-bounce-restore'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('financeReconcileBounceToastRestored'));
    expect(restorePairMock).toHaveBeenCalledWith({ financialAccountId: 'ACC-1', lineId: 'D1' });
    expect(pending.reload).toHaveBeenCalled();
    expect(onReconcileSuccess).toHaveBeenCalled();
  });

  it('a line discarded alone shows no row, the alone notice and "Restaurar línea"; 1 restored line toasts so', async () => {
    restorePairMock.mockResolvedValue({ restored: ['D3'], lineId: 'D3', counterpartLineId: null });
    await openDiscarded();
    fireEvent.click(screen.getByTestId('recon-line-radio-D3'));
    expect(screen.queryAllByTestId(/^recon-bounce-row-/)).toHaveLength(0);
    expect(screen.getByTestId('recon-bounce-notice')).toHaveTextContent('financeReconcileBounceDiscardedAloneNotice');
    expect(screen.getByTestId('recon-bounce-restore')).toHaveTextContent('financeReconcileBounceRestoreLine');
    expect(screen.queryByTestId('recon-bounce-total-net')).toBeNull();
    fireEvent.click(screen.getByTestId('recon-bounce-restore'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('financeReconcileBounceToastRestoredLine'));
    expect(restorePairMock).toHaveBeenCalledWith({ financialAccountId: 'ACC-1', lineId: 'D3' });
  });

  it('after a restore on Descartadas, re-reads the default counts so the other filters are current', async () => {
    pendingLineCountsMock.mockResolvedValue({
      all: 8, pending: 3, suggested: 0, byRule: 0, difference: 0, reconciled: 0, bounce: 5, discarded: 3,
    });
    await openDiscarded();
    const discardedFilters = lastCall();
    fireEvent.click(screen.getByTestId('recon-line-radio-D1'));
    fireEvent.click(screen.getByTestId('recon-bounce-restore'));
    await waitFor(() => expect(pendingLineCountsMock).toHaveBeenCalledWith({
      financialAccountId: 'ACC-1', dateFrom: discardedFilters.dateFrom, dateTo: discardedFilters.dateTo,
    }));
    openStatus('financeReconcileFilterStatusDiscarded');
    await waitFor(() => expect(screen.getByText(/^financeReconcileFilterStatusPending \(8\)/)).toBeInTheDocument());
    // The discarded count still comes from the discarded answer.
    expect(screen.getAllByText(/^financeReconcileFilterStatusDiscarded \(3\)/).length).toBeGreaterThan(0);
  });

  it('a failed re-read of the counts keeps the last ones and shows no error', async () => {
    pendingLineCountsMock.mockRejectedValue(new Error('offline'));
    await openDiscarded();
    fireEvent.click(screen.getByTestId('recon-line-radio-D1'));
    fireEvent.click(screen.getByTestId('recon-bounce-restore'));
    await waitFor(() => expect(pendingLineCountsMock).toHaveBeenCalled());
    openStatus('financeReconcileFilterStatusDiscarded');
    expect(screen.getByText(/^financeReconcileFilterStatusPending \(6\)/)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a failed restore of a line discarded alone uses the single-line message', async () => {
    restorePairMock.mockRejectedValue(new Error('x'));
    await openDiscarded();
    fireEvent.click(screen.getByTestId('recon-line-radio-D3'));
    fireEvent.click(screen.getByTestId('recon-bounce-restore'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('financeReconcileBounceToastRestoreLineError'));
  });

  it('a failed restore of a pair keeps the pair message', async () => {
    restorePairMock.mockRejectedValue(new Error('x'));
    await openDiscarded();
    fireEvent.click(screen.getByTestId('recon-line-radio-D1'));
    fireEvent.click(screen.getByTestId('recon-bounce-restore'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('financeReconcileBounceToastRestoreError'));
  });

  it('a failed restore shows the translated refusal', async () => {
    restorePairMock.mockRejectedValue(Object.assign(new Error('x'), {
      body: { error: { message: 'x', messageKeys: ['ETGO_BounceLineNotPending'] } },
    }));
    await openDiscarded();
    fireEvent.click(screen.getByTestId('recon-line-radio-D1'));
    fireEvent.click(screen.getByTestId('recon-bounce-restore'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('T(backendError.bounceLineNotPending)'));
  });
});

// ── Read-only tier ─────────────────────────────────────────────────────────────

describe('ReconciliationSplitPanel — bounce panel under the read-only tier', () => {
  it('disables Descartar par but keeps "No es un rechazo" available', async () => {
    renderPanel({ windowReadOnly: true });
    await selectLineRow('O1');
    expect(screen.getByTestId('recon-bounce-discard')).toBeDisabled();
    expect(screen.getByTestId('recon-bounce-dismiss')).toBeEnabled();
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await Promise.resolve();
    expect(discardPairMock).not.toHaveBeenCalled();
  });

  it('"No es un rechazo" still hides the pair, but reports nothing to the backend', async () => {
    renderPanel({ windowReadOnly: true });
    await selectLineRow('O1');
    fireEvent.click(screen.getByTestId('recon-bounce-dismiss'));
    expect(toast.success).toHaveBeenCalledWith('financeReconcileBounceToastDismissed');
    expect(screen.queryByTestId('recon-bounce-panel')).toBeNull();
    await Promise.resolve();
    expect(dismissPairMock).not.toHaveBeenCalled();
  });

  it('with an AI assessment the percentages show, but Descartar par is disabled and nothing is POSTed', async () => {
    renderPanel({ windowReadOnly: true, bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    expect(screen.getByTestId('recon-bounce-ai-pct-C2')).toHaveTextContent(pctText(85));
    expect(screen.getByTestId('recon-bounce-discard')).toBeDisabled();
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await Promise.resolve();
    await Promise.resolve();
    expect(discardPairMock).not.toHaveBeenCalled();
    expect(restorePairMock).not.toHaveBeenCalled();
  });

  it('disables Restaurar par', async () => {
    renderPanel({ windowReadOnly: true });
    await screen.findByTestId('recon-line-row-B3');
    selectStatus('financeReconcileFilterStatusPending', 'financeReconcileFilterStatusDiscarded');
    fireEvent.click(await screen.findByTestId('recon-line-radio-D1'));
    expect(screen.getByTestId('recon-bounce-restore')).toBeDisabled();
    fireEvent.click(screen.getByTestId('recon-bounce-restore'));
    await Promise.resolve();
    expect(restorePairMock).not.toHaveBeenCalled();
  });
});

// ── "Revisar en el panel": the focus request ───────────────────────────────────

describe('ReconciliationSplitPanel — the "Revisar en el panel" focus request', () => {
  function review(focus, extra = {}) {
    return {
      focus, onFocusConsumed: vi.fn(), dismissedKeys: new Set(), onDismiss: vi.fn(), ...extra,
    };
  }

  it('switches to Posibles rechazos, clears the search, selects and scrolls to the line, then consumes', async () => {
    const r = review(null);
    const { rerender } = renderPanel({ bounceReview: r });
    await screen.findByTestId('recon-line-row-B3');
    fireEvent.change(screen.getByTestId('recon-left-search'), { target: { value: 'zzz' } });
    expect(screen.queryByTestId('recon-line-row-B3')).toBeNull();

    const withFocus = { ...r, focus: { lineId: 'B3', seq: 1 } };
    rerender(<ReconciliationSplitPanel accountId="ACC-1" currency="EUR" amountTolerance={5} bounceReview={withFocus} />);

    await waitFor(() => expect(r.onFocusConsumed).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('recon-left-search')).toHaveValue('');
    expect(screen.getByText(/^financeReconcileFilterStatusBounce \(2\)/)).toBeInTheDocument();
    expect(screen.queryByTestId('recon-line-row-P1')).toBeNull();
    expect(screen.getByTestId('recon-line-radio-B3')).toBeChecked();
    expect(screen.getByTestId('recon-bounce-panel')).toBeInTheDocument();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(Element.prototype.scrollIntoView.mock.contexts.at(-1)).toBe(row('B3'));
  });

  it('widens the date range to any date once when the line is outside it', async () => {
    // Its own pair (own groupKey): the list has one row per pair, anchored on this bounce row.
    const FAR = { ...B3, id: 'BFAR', date: '2024-01-15', bouncePair: { ...B3.bouncePair, groupKey: 'g-far' } };
    pending.answer = (filters) => (filters.dateFrom
      ? { lines: BOUNCE_LINES, counts: BOUNCE_COUNTS }
      : { lines: [...BOUNCE_LINES, FAR], counts: { ...BOUNCE_COUNTS, all: 7, bounce: 6 } });
    const r = review({ lineId: 'BFAR', seq: 1 });
    renderPanel({ bounceReview: r });

    await waitFor(() => expect(r.onFocusConsumed).toHaveBeenCalledTimes(1));
    expect(pending.calls[0].dateFrom).toBeTruthy();
    expect(lastCall().dateFrom).toBeUndefined();
    expect(lastCall().dateTo).toBeUndefined();
    expect(screen.getByTestId('recon-line-radio-BFAR')).toBeChecked();
  });

  it('gives up (consumes, selects nothing) when the line is not there even at any date', async () => {
    const r = review({ lineId: 'GONE', seq: 1 });
    renderPanel({ bounceReview: r });
    await waitFor(() => expect(r.onFocusConsumed).toHaveBeenCalledTimes(1));
    expect(lastCall().dateFrom).toBeUndefined();
    expect(screen.queryByTestId('recon-bounce-panel')).toBeNull();
    // The request is consumed once: later reloads do not replay it.
    await new Promise((res) => setTimeout(res, 10));
    expect(r.onFocusConsumed).toHaveBeenCalledTimes(1);
  });

  it('a second request with the lines loaded and the filter already on Posibles rechazos selects the line', async () => {
    const r = review({ lineId: 'B3', seq: 1 });
    const { rerender } = renderPanel({ bounceReview: r });
    await waitFor(() => expect(r.onFocusConsumed).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('recon-line-radio-B3')).toBeChecked();
    // The user moves on to another line; nothing reloads, the filter stays on Posibles rechazos.
    fireEvent.click(screen.getByTestId('recon-line-radio-B1'));
    expect(screen.getByTestId('recon-line-radio-B1')).toBeChecked();
    const callsBefore = pending.calls.length;
    const filtersBefore = lastCall();

    // "Revisar en el panel" again on the same pair: only `focus` changes.
    rerender(<ReconciliationSplitPanel accountId="ACC-1" currency="EUR" amountTolerance={5}
      bounceReview={{ ...r, focus: { lineId: 'B3', seq: 2 } }} />);

    await waitFor(() => expect(r.onFocusConsumed).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('recon-line-radio-B3')).toBeChecked();
    // Served from the lines on screen: no request with other filters.
    expect(pending.calls.slice(callsBefore)
      .every((c) => c.status === undefined && c.dateFrom === filtersBefore.dateFrom)).toBe(true);
  });

  it('while Descartadas is active at any date, waits for the reload before looking for the line', async () => {
    // A first request for a line that is not there widens the range to any date and gives up.
    const r = review({ lineId: 'GONE', seq: 1 });
    const { rerender } = renderPanel({ bounceReview: r });
    await waitFor(() => expect(r.onFocusConsumed).toHaveBeenCalledTimes(1));
    expect(lastCall().dateFrom).toBeUndefined();
    selectStatus('financeReconcileFilterStatusBounce', 'financeReconcileFilterStatusDiscarded');
    await screen.findByTestId('recon-line-row-D1');
    expect(lastCall().status).toBe('discarded');

    // "Revisar en el panel": the lines on screen are the discarded ones, which do not hold B3.
    rerender(<ReconciliationSplitPanel accountId="ACC-1" currency="EUR" amountTolerance={5}
      bounceReview={{ ...r, focus: { lineId: 'B3', seq: 2 } }} />);

    await waitFor(() => expect(r.onFocusConsumed).toHaveBeenCalledTimes(2));
    expect(lastCall().status).toBeUndefined();
    expect(screen.getByTestId('recon-line-radio-B3')).toBeChecked();
    expect(screen.getByTestId('recon-bounce-panel')).toBeInTheDocument();
  });
});

// ── Two ambiguous pairs sharing a candidate, with bank references ─────────────

// One statement, one day, in this order (neo-headless.md §4.12.1.1, the adjacency example):
// -0,61 (R-C1) · +0,61 (R-B1) · -0,61 (R-C2) · +0,61 (R-B2) · -0,61 (R-C3). Two ambiguous pairs,
// R-B1 over [R-C1, R-C2] and R-B2 over [R-C2, R-C3]: both offered although they share R-C2, which
// is annotated once, by the first pair.
const SAME_DAY = '2026-08-24';
const LONG_DESC = 'TRANSFERENCIA INMEDIATA A FAVOR DE PROVEEDORES UNIDOS CONCEPTO 10000268 100-1';
const R_C1_SHORT = { id: 'R-C1', amount: -0.61, date: SAME_DAY, description: LONG_DESC, referenceNo: 'REF-120' };
const R_C2_SHORT = { id: 'R-C2', amount: -0.61, date: SAME_DAY, description: 'TRANSFERENCIA 100-2', referenceNo: 'REF-140' };
const R_C3_SHORT = { id: 'R-C3', amount: -0.61, date: SAME_DAY, description: 'TRANSFERENCIA 100-3', referenceNo: '   ' };
const R_B1_SHORT = { id: 'R-B1', amount: 0.61, date: SAME_DAY, description: 'RETROCESION', referenceNo: 'REF-130' };
const R_B2_SHORT = { id: 'R-B2', amount: 0.61, date: SAME_DAY, description: 'RETROCESION', referenceNo: '' };
const SHARED_A = {
  groupKey: 'g-shared-a', ambiguous: true, adjacent: true, confidence: 'review', signal: 'return_text', signals: ['return_text'],
};
const SHARED_B = { ...SHARED_A, groupKey: 'g-shared-b' };
const bounceRow = (short, bouncePair) => ({ ...short, state: 'bounce', status: 'pending', bouncePair });
const R_B1 = bounceRow(R_B1_SHORT, { ...SHARED_A, role: 'bounce', candidates: [{ line: R_C1_SHORT }, { line: R_C2_SHORT }] });
const R_B2 = bounceRow(R_B2_SHORT, { ...SHARED_B, role: 'bounce', candidates: [{ line: R_C2_SHORT }, { line: R_C3_SHORT }] });
const R_C1 = bounceRow(R_C1_SHORT, { ...SHARED_A, role: 'candidate', counterpartLine: R_B1_SHORT });
const R_C2 = bounceRow(R_C2_SHORT, { ...SHARED_A, role: 'candidate', counterpartLine: R_B1_SHORT });
const R_C3 = bounceRow(R_C3_SHORT, { ...SHARED_B, role: 'candidate', counterpartLine: R_B2_SHORT });

function sharedAnswer(filters) {
  if (filters.status === 'discarded') return { lines: [D1, D2, D3], counts: { discarded: 3 } };
  return {
    lines: [PLAIN, R_C1, R_B1, R_C2, R_B2, R_C3, O1, B1],
    counts: { all: 8, pending: 1, suggested: 0, byRule: 0, difference: 0, reconciled: 0, bounce: 7, discarded: 3 },
  };
}

const sameDay = () => formatDate(SAME_DAY, 'es-ES');
const refText = (ref) => `financeReconcileBounceRef:${JSON.stringify({ ref })}`;
const total = (which) => screen.getByTestId(`recon-bounce-total-${which}`);
// The amount is the row's last cell; compared exactly, since the formatted value carries an NBSP.
const totalValue = (which) => total(which).lastElementChild.textContent;

describe('ReconciliationSplitPanel — ambiguous pairs sharing a candidate', () => {
  beforeEach(() => { pending.answer = sharedAnswer; });

  it('the Posibles rechazos filter lists both pairs, the shared candidate once', async () => {
    renderPanel();
    await screen.findByTestId('recon-line-row-R-B2');
    selectStatus('financeReconcileFilterStatusPending', 'financeReconcileFilterStatusBounce');
    expect(screen.queryByTestId('recon-line-row-P1')).toBeNull();
    // The shared candidate R-C2 is listed once on the left; the right side is the placeholder until
    // an outflow is clicked, then it lists one row per pair, anchored on each bounce.
    expect(screen.queryAllByTestId(/^recon-outflow-row-R-/).map((el) => el.dataset.testid)).toEqual([
      'recon-outflow-row-R-C1', 'recon-outflow-row-R-C2', 'recon-outflow-row-R-C3',
    ]);
    expect(screen.getByTestId('recon-right-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('recon-outflow-row-R-C2'));
    expect(screen.queryAllByTestId(/^recon-line-row-R-/).map((el) => el.dataset.testid)).toEqual([
      'recon-line-row-R-B1', 'recon-line-row-R-B2',
    ]);
    for (const key of ['g-shared-a', 'g-shared-b']) {
      expect(screen.getByTestId(`automatch-bounce-tag-review-${key}`)).toBeInTheDocument();
    }
  });

  it('each bounce lists its own two candidates, with "2 salidas posibles" as the reason', async () => {
    renderPanel();
    await selectLineRow('R-B1');
    expect(screen.getByTestId('recon-bounce-source')).toHaveTextContent('financeReconcileBounceSourceOriginals:{"count":2}');
    expect(screen.queryAllByTestId(/^recon-bounce-row-/).map((el) => el.dataset.testid))
      .toEqual(['recon-bounce-row-R-C1', 'recon-bounce-row-R-C2']);
    expect(screen.getByTestId('recon-bounce-notice').textContent)
      .toMatch(/^financeReconcileBounceNoticeLowConfidence:.*financeReconcileBounceReasonAmbiguous:.*count.*2/);

    fireEvent.click(screen.getByTestId('recon-line-radio-R-B2'));
    expect(screen.queryAllByTestId(/^recon-bounce-row-/).map((el) => el.dataset.testid))
      .toEqual(['recon-bounce-row-R-C2', 'recon-bounce-row-R-C3']);
    expect(screen.getByTestId('recon-bounce-radio-R-C2')).not.toBeChecked();
  });

  it('the choice on one pair does not carry over to the other pair sharing the candidate', async () => {
    renderPanel();
    await selectLineRow('R-B1');
    fireEvent.click(screen.getByTestId('recon-bounce-radio-R-C2'));
    expect(screen.getByTestId('recon-bounce-discard')).toBeEnabled();
    fireEvent.click(screen.getByTestId('recon-line-radio-R-B2'));
    expect(screen.getByTestId('recon-bounce-radio-R-C2')).not.toBeChecked();
    expect(screen.getByTestId('recon-bounce-discard')).toBeDisabled();
  });
});

describe('ReconciliationSplitPanel — the bank reference and the description of a pair row', () => {
  beforeEach(() => { pending.answer = sharedAnswer; });

  it('shows "Ref. X" under a row that carries a reference', async () => {
    renderPanel();
    await selectLineRow('R-B1');
    expect(screen.getByTestId('recon-bounce-ref-R-C1')).toHaveTextContent(refText('REF-120'));
    expect(screen.getByTestId('recon-bounce-ref-R-C2')).toHaveTextContent(refText('REF-140'));
  });

  it('shows nothing for a whitespace, empty or missing reference', async () => {
    renderPanel();
    await selectLineRow('R-B2');
    // whitespace
    expect(screen.getByTestId('recon-bounce-row-R-C3')).toBeInTheDocument();
    expect(screen.queryByTestId('recon-bounce-ref-R-C3')).toBeNull();
    // empty: R-C3's counterpart is R-B2
    fireEvent.click(screen.getByTestId('recon-line-radio-R-C3'));
    expect(screen.getByTestId('recon-bounce-row-R-B2')).toBeInTheDocument();
    expect(screen.queryByTestId('recon-bounce-ref-R-B2')).toBeNull();
    // missing: B1 has no referenceNo at all
    fireEvent.click(screen.getByTestId('recon-line-radio-O1'));
    expect(screen.getByTestId('recon-bounce-row-B1')).toBeInTheDocument();
    expect(screen.queryByTestId('recon-bounce-ref-B1')).toBeNull();
  });

  it('renders the description through TruncatedText, with the full text on hover when clipped', async () => {
    renderPanel();
    await selectLineRow('R-B1');
    const desc = screen.getByTestId('recon-bounce-desc-R-C1');
    expect(desc).toHaveTextContent(LONG_DESC);
    Object.defineProperty(desc, 'scrollWidth', { configurable: true, value: 640 });
    Object.defineProperty(desc, 'clientWidth', { configurable: true, value: 200 });
    fireEvent.focus(desc);
    expect(screen.getByTestId('recon-bounce-desc-R-C1-tooltip')).toHaveTextContent(LONG_DESC);
  });
});

describe('ReconciliationSplitPanel — the footer of the bounce panel', () => {
  beforeEach(() => { pending.answer = sharedAnswer; });

  it('a bounce line: "Rechazo seleccionado" with its amount and "date · Ref. X"', async () => {
    renderPanel();
    await selectLineRow('R-B1');
    expect(within(total('selected')).getByText('financeReconcileBounceSelectedBounce')).toBeInTheDocument();
    expect(totalValue('selected')).toBe(formatSigned(0.61, 'EUR'));
    expect(screen.getByTestId('recon-bounce-total-selected-meta').textContent)
      .toBe(`${sameDay()} · ${refText('REF-130')}`);
  });

  it('the counterpart meta follows the chosen radio, and is absent before a choice', async () => {
    renderPanel();
    await selectLineRow('R-B1');
    expect(within(total('other')).getByText('financeReconcileBounceTotalOriginal')).toBeInTheDocument();
    expect(totalValue('other')).toBe('—');
    expect(screen.queryByTestId('recon-bounce-total-other-meta')).toBeNull();

    fireEvent.click(screen.getByTestId('recon-bounce-radio-R-C2'));
    expect(screen.getByTestId('recon-bounce-total-other-meta').textContent).toBe(`${sameDay()} · ${refText('REF-140')}`);
    expect(totalValue('other')).toBe(formatSigned(-0.61, 'EUR'));

    fireEvent.click(screen.getByTestId('recon-bounce-radio-R-C1'));
    expect(screen.getByTestId('recon-bounce-total-other-meta').textContent).toBe(`${sameDay()} · ${refText('REF-120')}`);
  });

  it('a line without a reference: the meta is the date alone', async () => {
    renderPanel();
    await selectLineRow('R-B2');
    expect(screen.getByTestId('recon-bounce-total-selected-meta').textContent).toBe(sameDay());
  });

  it('a candidate line: "Salida seleccionada", the bounce as the counterpart', async () => {
    renderPanel();
    await selectLineRow('R-C1');
    expect(within(total('selected')).getByText('financeReconcileBounceTotalOriginal')).toBeInTheDocument();
    expect(totalValue('selected')).toBe(formatSigned(-0.61, 'EUR'));
    expect(screen.getByTestId('recon-bounce-total-selected-meta').textContent).toBe(`${sameDay()} · ${refText('REF-120')}`);
    expect(within(total('other')).getByText('financeReconcileBounceTotalBounce')).toBeInTheDocument();
    expect(screen.getByTestId('recon-bounce-total-other-meta').textContent).toBe(`${sameDay()} · ${refText('REF-130')}`);
  });

  it('an original line: "Salida seleccionada" with its amount and date', async () => {
    renderPanel();
    await selectLineRow('O1');
    expect(within(total('selected')).getByText('financeReconcileBounceTotalOriginal')).toBeInTheDocument();
    expect(totalValue('selected')).toBe(formatSigned(-120, 'EUR'));
    expect(screen.getByTestId('recon-bounce-total-selected-meta').textContent).toBe(formatDate('2026-10-02', 'es-ES'));
    expect(within(total('other')).getByText('financeReconcileBounceTotalBounce')).toBeInTheDocument();
  });

  it('a discarded line: "Línea seleccionada" with its amount', async () => {
    renderPanel();
    await screen.findByTestId('recon-line-row-R-B1');
    selectStatus('financeReconcileFilterStatusPending', 'financeReconcileFilterStatusDiscarded');
    fireEvent.click(await screen.findByTestId('recon-line-radio-D1'));
    expect(within(total('selected')).getByText('financeReconcileBounceSelectedLine')).toBeInTheDocument();
    expect(totalValue('selected')).toBe(formatSigned(-50, 'EUR'));
    expect(screen.getByTestId('recon-bounce-total-selected-meta').textContent).toBe(formatDate('2026-09-01', 'es-ES'));
    expect(screen.queryByTestId('recon-bounce-total-other')).toBeNull();
  });
});

// ── The shared controls of the bounce panel ───────────────────────────────────

describe('ReconciliationSplitPanel — buttons and radios of the bounce panel', () => {
  it('"Descartar par" is the blue primary Button, "No es un rechazo" the outline one', async () => {
    renderPanel();
    await selectLineRow('O1');
    const discard = screen.getByTestId('recon-bounce-discard');
    expect(discard.tagName).toBe('BUTTON');
    expect(discard.className).toContain('bg-primary');
    const dismiss = screen.getByTestId('recon-bounce-dismiss');
    expect(dismiss.className).toContain('border');
    expect(dismiss.className).not.toContain('bg-primary');
  });

  it('"Descartar par" is disabled while a discard or a restore is in flight', async () => {
    pairActions.discarding = true;
    renderPanel();
    await selectLineRow('O1');
    expect(screen.getByTestId('recon-bounce-discard')).toBeDisabled();
    expect(screen.getByTestId('recon-bounce-dismiss')).toBeEnabled();
  });

  it('"Restaurar par" is the blue primary Button, enabled when idle', async () => {
    renderPanel();
    await screen.findByTestId('recon-line-row-B3');
    selectStatus('financeReconcileFilterStatusPending', 'financeReconcileFilterStatusDiscarded');
    fireEvent.click(await screen.findByTestId('recon-line-radio-D1'));
    const restore = screen.getByTestId('recon-bounce-restore');
    expect(restore.className).toContain('bg-primary');
    expect(restore).toBeEnabled();
  });

  it('"Restaurar par" is disabled while a restore is in flight', async () => {
    pairActions.restoring = true;
    renderPanel();
    await screen.findByTestId('recon-line-row-B3');
    selectStatus('financeReconcileFilterStatusPending', 'financeReconcileFilterStatusDiscarded');
    fireEvent.click(await screen.findByTestId('recon-line-radio-D1'));
    expect(screen.getByTestId('recon-bounce-restore')).toBeDisabled();
    fireEvent.click(screen.getByTestId('recon-bounce-restore'));
    await Promise.resolve();
    expect(restorePairMock).not.toHaveBeenCalled();
  });

  it('names each candidate radio by its date, amount and bank reference, so they can be told apart', async () => {
    pending.answer = sharedAnswer;
    renderPanel();
    await selectLineRow('R-B1');
    const amount = formatSigned(-0.61, 'EUR');
    expect(screen.getByTestId('recon-bounce-radio-R-C1')).toHaveAttribute('aria-label',
      `financeReconcileBounceChooseOriginalLineRef:${JSON.stringify({ date: sameDay(), amount, ref: 'REF-120' })}`);
    expect(screen.getByTestId('recon-bounce-radio-R-C2')).toHaveAttribute('aria-label',
      `financeReconcileBounceChooseOriginalLineRef:${JSON.stringify({ date: sameDay(), amount, ref: 'REF-140' })}`);
  });

  it('a candidate without a reference is named by its date and amount only', async () => {
    pending.answer = sharedAnswer;
    renderPanel();
    await selectLineRow('R-B2');
    expect(screen.getByTestId('recon-bounce-radio-R-C3')).toHaveAttribute('aria-label',
      `financeReconcileBounceChooseOriginalLine:${JSON.stringify({ date: sameDay(), amount: formatSigned(-0.61, 'EUR') })}`);
  });

  it('the left-panel and the pair radios use accent-primary', async () => {
    renderPanel();
    await selectLineRow('B3');
    expect(screen.getByTestId('recon-line-radio-P1')).toHaveClass('accent-primary');
    expect(screen.getByTestId('recon-line-radio-B3')).toHaveClass('accent-primary');
    expect(screen.getByTestId('recon-bounce-radio-C1')).toHaveClass('accent-primary');
  });
});

// ── AI second layer: the bounceAiAssessments of the autoMatch answer ──────────

const pctText = (pct) => `financeReconcileBounceAiProbability:${JSON.stringify({ pct: String(pct) })}`;
const noticeAiText = (pct) => `financeReconcileBounceNoticeAi:${JSON.stringify({ pct: String(pct) })}`;

/** The host's review bundle (`useAutoMatchReview().panel`) carrying the AI layer. */
function aiReview(aiAssessments) {
  return {
    focus: null, onFocusConsumed: vi.fn(), dismissedKeys: new Set(), onDismiss: vi.fn(), aiAssessments,
  };
}

// B3 is the ambiguous bounce over [C1, C2] (backend order).
const AI_85_10 = { B3: { probabilities: { C1: 10, C2: 85 }, none: 5, recommendedLineId: 'C2' } };
const AI_60_40 = { B3: { probabilities: { C1: 40, C2: 60 }, none: 0, recommendedLineId: null } };

const orderedOptionRows = () => screen.queryAllByTestId(/^recon-bounce-row-/).map((el) => el.dataset.testid);

describe('ReconciliationSplitPanel — AI suggestion on an ambiguous pair', () => {
  it('85/10: sorts the options, shows the percentages, pre-checks the recommended with badge and notice', async () => {
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    expect(orderedOptionRows()).toEqual(['recon-bounce-row-C2', 'recon-bounce-row-C1']);
    expect(screen.getByTestId('recon-bounce-ai-pct-C2')).toHaveTextContent(pctText(85));
    expect(screen.getByTestId('recon-bounce-ai-pct-C1')).toHaveTextContent(pctText(10));
    expect(screen.getByTestId('recon-bounce-radio-C2')).toBeChecked();
    expect(screen.getByTestId('recon-bounce-radio-C1')).not.toBeChecked();
    const notice = screen.getByTestId('recon-bounce-notice');
    expect(notice).toHaveTextContent(noticeAiText(85));
    expect(notice).not.toHaveTextContent('financeReconcileBounceNoticeChoose');
    expect(screen.getByTestId('recon-bounce-discard')).toBeEnabled();
  });

  it('"none" outweighing every candidate hides ALL percentages (the modal rule); a tie shows them', async () => {
    const NONE_WINS = { B3: { probabilities: { C1: 49, C2: 10 }, none: 50, recommendedLineId: null } };
    renderPanel({ bounceReview: aiReview(NONE_WINS) });
    await selectLineRow('B3');
    expect(screen.queryByTestId('recon-bounce-ai-pct-C1')).toBeNull();
    expect(screen.queryByTestId('recon-bounce-ai-pct-C2')).toBeNull();
    expect(screen.getByTestId('recon-bounce-radio-C1')).not.toHaveAttribute('aria-describedby');
  });

  it('"none" tying the best candidate still shows the percentages', async () => {
    const TIE = { B3: { probabilities: { C1: 49, C2: 10 }, none: 49, recommendedLineId: null } };
    renderPanel({ bounceReview: aiReview(TIE) });
    await selectLineRow('B3');
    expect(screen.getByTestId('recon-bounce-ai-pct-C1')).toBeInTheDocument();
  });

  it('60/40 without a recommendation: percentages shown, nothing checked, discard disabled, "choose" notice', async () => {
    renderPanel({ bounceReview: aiReview(AI_60_40) });
    await selectLineRow('B3');
    expect(orderedOptionRows()).toEqual(['recon-bounce-row-C2', 'recon-bounce-row-C1']);
    expect(screen.getByTestId('recon-bounce-ai-pct-C2')).toHaveTextContent(pctText(60));
    expect(screen.getByTestId('recon-bounce-ai-pct-C1')).toHaveTextContent(pctText(40));
    expect(screen.getByTestId('recon-bounce-radio-C1')).not.toBeChecked();
    expect(screen.getByTestId('recon-bounce-radio-C2')).not.toBeChecked();
    expect(screen.getByTestId('recon-bounce-notice')).toHaveTextContent('financeReconcileBounceNoticeChoose');
    expect(screen.getByTestId('recon-bounce-discard')).toBeDisabled();
  });

  it('a recommended id that is not among the rendered rows preselects nothing', async () => {
    renderPanel({ bounceReview: aiReview({
      B3: { probabilities: { C1: 10, C2: 85 }, none: 5, recommendedLineId: 'NOT-SHOWN' } } ) });
    await selectLineRow('B3');
    expect(screen.getByTestId('recon-bounce-radio-C1')).not.toBeChecked();
    expect(screen.getByTestId('recon-bounce-radio-C2')).not.toBeChecked();
    expect(screen.getByTestId('recon-bounce-discard')).toBeDisabled();
  });

  it('no assessment at all: same as before (no percentages, no badge, no AI notice)', async () => {
    renderPanel({ bounceReview: aiReview(null) });
    await selectLineRow('B3');
    expect(orderedOptionRows()).toEqual(['recon-bounce-row-C1', 'recon-bounce-row-C2']);
    expect(screen.queryByTestId('recon-bounce-ai-pct-C1')).toBeNull();
    expect(screen.getByTestId('recon-bounce-radio-C2')).not.toBeChecked();
    expect(screen.getByTestId('recon-bounce-notice')).toHaveTextContent('financeReconcileBounceNoticeChoose');
  });

  it('two rejections sharing an outflow: only the pair whose recommendation names it preselects it', async () => {
    pending.answer = sharedAnswer;
    renderPanel({ bounceReview: aiReview({
      'R-B1': { probabilities: { 'R-C1': 5, 'R-C2': 90 }, none: 5, recommendedLineId: 'R-C2' },
      'R-B2': { probabilities: { 'R-C2': 50, 'R-C3': 50 }, none: 0, recommendedLineId: null },
    }) });
    await selectLineRow('R-B1');
    expect(screen.getByTestId('recon-bounce-radio-R-C2')).toBeChecked();
    fireEvent.click(screen.getByTestId('recon-line-radio-R-B2'));
    expect(screen.getByTestId('recon-bounce-radio-R-C2')).not.toBeChecked();
    expect(screen.getByTestId('recon-bounce-radio-R-C3')).not.toBeChecked();
    expect(screen.getByTestId('recon-bounce-discard')).toBeDisabled();
  });

  it('an explicit radio pick wins over the AI default and loses the AI badge on the notice', async () => {
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-radio-C1'));
    expect(screen.getByTestId('recon-bounce-radio-C1')).toBeChecked();
    expect(screen.getByTestId('recon-bounce-radio-C2')).not.toBeChecked();
    expect(screen.getByTestId('recon-bounce-notice')).not.toHaveTextContent('financeReconcileBounceNoticeAi');
  });

  it('keeps the accessible name of the radio and adds the percentage through aria-describedby', async () => {
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    const radio = screen.getByTestId('recon-bounce-radio-C2');
    const amount = formatSigned(-80, 'EUR');
    expect(radio).toHaveAttribute('aria-label',
      `financeReconcileBounceChooseOriginalLine:${JSON.stringify({ date: formatDate('2026-10-03', 'es-ES'), amount })}`);
    const describedBy = radio.getAttribute('aria-describedby');
    expect(describedBy).toBe('recon-bounce-ai-pct-C2');
    expect(document.getElementById(describedBy)).toHaveTextContent(pctText(85));
  });

  it('without an assessment the radio has no aria-describedby', async () => {
    renderPanel();
    await selectLineRow('B3');
    expect(screen.getByTestId('recon-bounce-radio-C2')).not.toHaveAttribute('aria-describedby');
  });
});

describe('ReconciliationSplitPanel — discarding with the AI suggestion', () => {
  it('following the AI default POSTs discardPair with choiceSource "ai"', async () => {
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(discardPairMock).toHaveBeenCalledWith({
      financialAccountId: 'ACC-1', statementLineId: 'C2', counterpartLineId: 'B3', choiceSource: 'ai',
    }));
  });

  it('an explicit pick on an AI-rated pair sends choiceSource "user"', async () => {
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-radio-C1'));
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(discardPairMock).toHaveBeenCalledWith({
      financialAccountId: 'ACC-1', statementLineId: 'C1', counterpartLineId: 'B3', choiceSource: 'user',
    }));
  });

  it('clicking the row of the recommended original counts as an explicit user choice', async () => {
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-row-C2'));
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(discardPairMock).toHaveBeenCalledWith({
      financialAccountId: 'ACC-1', statementLineId: 'C2', counterpartLineId: 'B3', choiceSource: 'user',
    }));
  });

  it('a pair the AI did not rate POSTs the body exactly as before, with no choiceSource key', async () => {
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('O1');
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(discardPairMock).toHaveBeenCalledTimes(1));
    expect(Object.keys(discardPairMock.mock.calls[0][0]).sort())
      .toEqual(['counterpartLineId', 'financialAccountId', 'statementLineId']);
  });

  it('no assessment on an ambiguous pair: explicit pick POSTs without choiceSource', async () => {
    renderPanel({ bounceReview: aiReview(null) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-radio-C2'));
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(discardPairMock).toHaveBeenCalledTimes(1));
    expect('choiceSource' in discardPairMock.mock.calls[0][0]).toBe(false);
  });

  it('a successful AI-sourced discard offers "Deshacer", which restores the pair', async () => {
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      'financeReconcileBounceToastDiscarded',
      expect.objectContaining({ action: expect.objectContaining({ label: 'financeReconcileBounceAiUndo' }) }),
    ));
    const { action } = toast.success.mock.calls[0][1];
    toast.success.mockClear();
    pending.reload.mockClear();
    action.onClick();
    await waitFor(() => expect(restorePairMock).toHaveBeenCalledWith({
      financialAccountId: 'ACC-1', lineId: 'B3',
    }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('financeReconcileBounceToastRestored'));
    expect(pending.reload).toHaveBeenCalled();
  });

  it('after "Deshacer" the pair is back, the AI preselects it again and nothing is discarded twice', async () => {
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    toast.success.mock.calls[0][1].action.onClick();
    await waitFor(() => expect(restorePairMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('financeReconcileBounceToastRestored'));
    await selectLineRow('B3');
    expect(screen.getByTestId('recon-bounce-radio-C2')).toBeChecked();
    expect(discardPairMock).toHaveBeenCalledTimes(1);
  });

  it('a "Deshacer" the backend refuses shows the translated refusal and does not discard again', async () => {
    restorePairMock.mockRejectedValue(Object.assign(new Error('expired'), {
      status: 409, body: { error: { messageKeys: ['ETGO_BounceAiSuggestionStale'] } },
    }));
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    toast.success.mock.calls[0][1].action.onClick();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0][0]).toMatch(/bounceAiSuggestionStale|RestoreError/);
    expect(discardPairMock).toHaveBeenCalledTimes(1);
  });

  it('a failed "Deshacer" shows the translated refusal', async () => {
    restorePairMock.mockRejectedValue(new Error('boom'));
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    toast.success.mock.calls[0][1].action.onClick();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('financeReconcileBounceToastRestoreError'));
  });

  it('an explicit (user) discard shows the plain success toast, with no "Deshacer"', async () => {
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-radio-C1'));
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('financeReconcileBounceToastDiscarded'));
    expect(toast.success.mock.calls[0]).toHaveLength(1);
  });

  it('a 409 stale answer shows the translated stale toast and reloads the panel', async () => {
    discardPairMock.mockRejectedValue(Object.assign(new Error('stale'), {
      status: 409,
      code: 'BOUNCE_AI_SUGGESTION_STALE',
      body: { code: 'BOUNCE_AI_SUGGESTION_STALE', error: { messageKeys: ['ETGO_BounceAiSuggestionStale'] } },
    }));
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('T(backendError.bounceAiSuggestionStale)'));
    expect(pending.reload).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    // The panel stays usable: the discard button is still there.
    expect(screen.getByTestId('recon-bounce-panel')).toBeInTheDocument();
    // The stale AI default is dropped for this rejection: no preselection, badge or AI notice.
    await waitFor(() => expect(screen.getByTestId('recon-bounce-radio-C2')).not.toBeChecked());
    expect(screen.getByTestId('recon-bounce-notice')).toHaveTextContent('financeReconcileBounceNoticeChoose');
    expect(screen.getByTestId('recon-bounce-notice')).not.toHaveTextContent(noticeAiText(85));
    expect(screen.getByTestId('recon-bounce-discard')).toBeDisabled();
    // The percentages stay.
    expect(screen.getByTestId('recon-bounce-ai-pct-C2')).toHaveTextContent(pctText(85));
  });

  describe('after a 409 stale answer', () => {
    const stale = () => Object.assign(new Error('stale'), {
      status: 409,
      code: 'BOUNCE_AI_SUGGESTION_STALE',
      body: { code: 'BOUNCE_AI_SUGGESTION_STALE', error: { messageKeys: ['ETGO_BounceAiSuggestionStale'] } },
    });

    async function discardStale(props) {
      discardPairMock.mockRejectedValueOnce(stale());
      const utils = renderPanel(props);
      await selectLineRow('B3');
      fireEvent.click(screen.getByTestId('recon-bounce-discard'));
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByTestId('recon-bounce-radio-C2')).not.toBeChecked());
      return utils;
    }

    it('the next discard after an explicit pick sends choiceSource "user", never "ai"', async () => {
      await discardStale({ bounceReview: aiReview(AI_85_10) });
      fireEvent.click(screen.getByTestId('recon-bounce-radio-C2'));
      expect(screen.getByTestId('recon-bounce-discard')).toBeEnabled();
      fireEvent.click(screen.getByTestId('recon-bounce-discard'));
      await waitFor(() => expect(discardPairMock).toHaveBeenCalledTimes(2));
      expect(discardPairMock.mock.calls[1][0]).toEqual({
        financialAccountId: 'ACC-1', statementLineId: 'C2', counterpartLineId: 'B3', choiceSource: 'user',
      });
      expect(discardPairMock.mock.calls.every(([b], i) => i === 0 || b.choiceSource !== 'ai')).toBe(true);
    });

    it('a fresh automatch (new assessments identity) brings the AI default back', async () => {
      const { rerender } = await discardStale({ bounceReview: aiReview(AI_85_10) });
      rerender(
        <ReconciliationSplitPanel
          accountId="ACC-1"
          currency="EUR"
          amountTolerance={5}
          onReconcileSuccess={vi.fn()}
          bounceReview={aiReview({ B3: { ...AI_85_10.B3 } })} />,
      );
      await waitFor(() => expect(screen.getByTestId('recon-bounce-radio-C2')).toBeChecked());
      expect(screen.getByTestId('recon-bounce-discard')).toBeEnabled();
    });
  });

  it('a stale code without translatable text falls back to the i18n stale message', async () => {
    discardPairMock.mockRejectedValue(Object.assign(new Error('stale'), {
      status: 409, code: 'BOUNCE_AI_SUGGESTION_STALE', body: { code: 'BOUNCE_AI_SUGGESTION_STALE' },
    }));
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0][0]).toMatch(/BounceAiStale|bounceAiSuggestionStale/);
    expect(pending.reload).toHaveBeenCalled();
  });

  it('"No es un rechazo" after an AI preselection reports no counterpartLineId', async () => {
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    expect(screen.getByTestId('recon-bounce-radio-C2')).toBeChecked();
    fireEvent.click(screen.getByTestId('recon-bounce-dismiss'));
    expect(dismissPairMock).toHaveBeenCalledWith({ financialAccountId: 'ACC-1', statementLineId: 'B3' });
  });

  it('"No es un rechazo" after an explicit pick still reports it', async () => {
    renderPanel({ bounceReview: aiReview(AI_85_10) });
    await selectLineRow('B3');
    fireEvent.click(screen.getByTestId('recon-bounce-radio-C1'));
    fireEvent.click(screen.getByTestId('recon-bounce-dismiss'));
    expect(dismissPairMock).toHaveBeenCalledWith({
      financialAccountId: 'ACC-1', statementLineId: 'B3', counterpartLineId: 'C1',
    });
  });
});

// ── The pair view's wording, placeholder, hint and footer placement (ETP-6359) ──

function openPairView() {
  selectStatus('financeReconcileFilterStatusPending', 'financeReconcileFilterStatusBounce');
}

describe('ReconciliationSplitPanel — "Posibles rechazos" two-table view details', () => {
  it('a doubtful pair is tagged "Confianza baja" in the panel (never the modal\'s "Revisar") and the notice says so', async () => {
    renderPanel();
    await screen.findByTestId('recon-line-row-B3');
    openPairView();
    fireEvent.click(screen.getByTestId('recon-outflow-row-C1'));
    const tag = screen.getByTestId('automatch-bounce-tag-review-g-amb');
    expect(tag).toHaveTextContent(/^financeReconcileBounceTagLowConfidence$/);
    expect(tag).not.toHaveTextContent('financeReconcileBounceTagReviewPlain');
    expect(screen.getByTestId('recon-bounce-notice')).toHaveTextContent('financeReconcileBounceNoticeLowConfidence');
  });

  it('with nothing selected only the placeholder shows on the right: no notice, footer or rejections table', async () => {
    renderPanel();
    await screen.findByTestId('recon-line-row-B3');
    openPairView();
    const empty = screen.getByTestId('recon-right-empty');
    expect(empty).toHaveTextContent('financeReconcileBounceRightEmptyTitle');
    expect(empty).toHaveTextContent('financeReconcileBounceRightEmptyHint');
    expect(screen.queryByTestId('recon-rejections-table')).toBeNull();
    expect(screen.queryByTestId('recon-bounce-footer')).toBeNull();
    expect(screen.queryByTestId('recon-bounce-notice')).toBeNull();
    // The left table title counts the outflows listed (O1, C1, C2).
    expect(screen.getByTestId('recon-outflows-table')).toHaveTextContent('financeReconcileBounceViewOutflows:{"count":3}');
  });

  it('the outflows are not sorted: they come in date order (oldest first)', async () => {
    renderPanel();
    await screen.findByTestId('recon-line-row-B3');
    openPairView();
    expect(screen.queryAllByTestId(/^recon-outflow-row-/).map((el) => el.dataset.testid))
      .toEqual(['recon-outflow-row-C1', 'recon-outflow-row-O1', 'recon-outflow-row-C2']);
    expect(within(screen.getByTestId('recon-outflows-table')).queryAllByRole('button')).toHaveLength(0);
  });

  it('an outflow no rejection can take shows the "does not match" hint and a click changes nothing', async () => {
    // O9's rejection came 100 days later: no rejection can take it, so it is not re-targetable.
    const O9_SHORT = { id: 'O9', amount: -33, date: '2026-06-01', description: 'Cuota anual' };
    const B9_SHORT = { id: 'B9', amount: 33, date: '2026-09-09', description: 'CUOTA DEVUELTA' };
    const P9 = { groupKey: 'g-o9', ambiguous: false, confidence: 'review', signal: 'counterparty', signals: ['counterparty'] };
    const O9 = { ...O9_SHORT, state: 'bounce', status: 'pending', bouncePair: { ...P9, role: 'original', counterpartLine: B9_SHORT } };
    const B9 = { ...B9_SHORT, state: 'bounce', status: 'pending', bouncePair: { ...P9, role: 'bounce', counterpartLine: O9_SHORT } };
    pending.answer = () => ({ lines: [PLAIN, O1, B1, O9, B9], counts: { ...BOUNCE_COUNTS, bounce: 4 } });
    renderPanel();
    await screen.findByTestId('recon-line-row-B1');
    openPairView();
    fireEvent.click(screen.getByTestId('recon-outflow-row-O1'));
    expect(screen.getByTestId('recon-line-radio-B1')).toBeChecked();
    expect(screen.getByTestId('recon-outflow-row-O9')).toHaveAttribute('title', 'financeReconcileBounceOutflowNoMatch');
    expect(screen.getByTestId('recon-outflow-row-O1')).not.toHaveAttribute('title');
    fireEvent.click(screen.getByTestId('recon-outflow-row-O9'));
    expect(screen.getByTestId('recon-line-radio-B1')).toBeChecked();
    expect(screen.queryAllByTestId(/^recon-line-row-/).map((el) => el.dataset.testid)).toEqual(['recon-line-row-B1']);
    expect(discardPairMock).not.toHaveBeenCalled();
  });

  it('the footer exists once, outside the outflows table, which ends with an empty bar', async () => {
    renderPanel();
    await screen.findByTestId('recon-line-row-B3');
    openPairView();
    fireEvent.click(screen.getByTestId('recon-outflow-row-O1'));
    expect(screen.getAllByTestId('recon-bounce-footer')).toHaveLength(1);
    expect(within(screen.getByTestId('recon-outflows-table')).queryByTestId('recon-bounce-footer')).toBeNull();
    expect(screen.getByTestId('recon-outflows-footer')).toBeEmptyDOMElement();
    expect(screen.getByTestId('recon-bounce-total-selected')).toHaveTextContent('financeReconcileBounceSelectedBounce');
    expect(screen.getByTestId('recon-bounce-total-other')).toHaveTextContent('financeReconcileBounceTotalOriginal');
    expect(screen.getByTestId('recon-bounce-total-net')).toHaveTextContent('financeReconcileBounceTotalNet');
  });

  it('the normal view keeps the default placeholder texts', async () => {
    renderPanel();
    await screen.findByTestId('recon-line-row-P1');
    expect(screen.getByTestId('recon-right-empty')).toHaveTextContent('financeReconcileRightEmptyTitle');
  });
});

describe('BouncePairPanel building blocks — AiPercentText, BounceNotice, BounceFooter', () => {
  it('AiPercentText renders a sparkle plus the percentage, with the panel test id and an id for aria-describedby', () => {
    const { container } = render(<AiPercentText rowId="L1" pct={96} />);
    const el = screen.getByTestId('recon-bounce-ai-pct-L1');
    expect(el).toHaveTextContent('financeReconcileBounceAiProbability:{"pct":"96"}');
    expect(el).toHaveAttribute('id', 'recon-bounce-ai-pct-L1');
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(el).not.toHaveTextContent('IA');
  });

  it('AiPercentText renders nothing without a percentage and honours a testId override (no panel id)', () => {
    const { container, rerender } = render(<AiPercentText rowId="L1" pct={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AiPercentText rowId="L1" pct={60} testId="automatch-bounce-ai-pct-g1" />);
    const el = screen.getByTestId('automatch-bounce-ai-pct-g1');
    expect(el).not.toHaveAttribute('id');
    expect(screen.queryByTestId('recon-bounce-ai-pct-L1')).toBeNull();
  });

  it('BounceNotice for a doubtful pair uses the "Confianza baja" notice and, with the AI default, the AI sentence', () => {
    const line = { ...B3, bouncePair: { ...B3.bouncePair, ambiguous: true } };
    const aiAssessments = { B3: { probabilities: { C1: 10, C2: 85 }, none: 5, recommendedLineId: 'C2' } };
    const model = bouncePanelModel(line, { aiAssessments });
    render(<BounceNotice model={model} bcpLocale="es-ES" />);
    const notice = screen.getByTestId('recon-bounce-notice');
    expect(notice).toHaveTextContent('financeReconcileBounceNoticeLowConfidence');
    expect(notice).toHaveTextContent('financeReconcileBounceNoticeAi:{"pct":"85"}');
    expect(notice).not.toHaveTextContent('financeReconcileBounceNoticeChoose');
  });

  it('BounceFooter shows the selected line, its counterpart and the net, and wires dismiss / discard', () => {
    const model = bouncePanelModel(B1);
    const onDismiss = vi.fn();
    const onDiscard = vi.fn();
    render(
      <BounceFooter model={model} line={B1} currency="EUR" bcpLocale="es-ES" onDismiss={onDismiss} onDiscard={onDiscard} onRestore={vi.fn()} />,
    );
    expect(screen.getByTestId('recon-bounce-total-selected')).toHaveTextContent('financeReconcileBounceSelectedBounce');
    expect(screen.getByTestId('recon-bounce-total-other')).toHaveTextContent('financeReconcileBounceTotalOriginal');
    fireEvent.click(screen.getByTestId('recon-bounce-dismiss'));
    fireEvent.click(screen.getByTestId('recon-bounce-discard'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('BounceFooter disables the discard while busy and under the read-only tier, but keeps "No es un rechazo" enabled', () => {
    const model = bouncePanelModel(B1);
    const { rerender } = render(
      <BounceFooter model={model} line={B1} currency="EUR" bcpLocale="es-ES" onDismiss={vi.fn()} onDiscard={vi.fn()} onRestore={vi.fn()} busy />,
    );
    expect(screen.getByTestId('recon-bounce-discard')).toBeDisabled();
    rerender(
      <BounceFooter model={model} line={B1} currency="EUR" bcpLocale="es-ES" onDismiss={vi.fn()} onDiscard={vi.fn()} onRestore={vi.fn()} windowReadOnly />,
    );
    expect(screen.getByTestId('recon-bounce-discard')).toBeDisabled();
    expect(screen.getByTestId('recon-bounce-dismiss')).toBeEnabled();
  });
});
