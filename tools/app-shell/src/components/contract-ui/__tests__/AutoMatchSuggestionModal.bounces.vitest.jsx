// @covers tools/app-shell/src/components/contract-ui/AutoMatchSuggestionModal.jsx
// @covers tools/app-shell/src/components/contract-ui/AutoMatchBounceSection.jsx
// @covers tools/app-shell/src/components/contract-ui/bouncePairs.js
// @covers tools/app-shell/src/hooks/useAutoMatchReview.js
/**
 * The "Rechazos bancarios" section of the automatch modal (bounce pairs, flag `bank-bounce-suggestions`).
 *
 * The SPA never evaluates the flag: with it off the backend sends groups without `kind` and no
 * `kpis.bouncePairs`, and the modal must be exactly what it was. With it on, the bounce-pair groups
 * render below the reconciliation groups and travel in the SAME applySuggestions call.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';

// --- Mocks ----------------------------------------------------------------

// The key, plus its params as JSON so the variants can be told apart. A `backendError.*` key reads
// as translated (`T(<key>)`), so the coded refusals can be asserted through translateBackendErrorBody.
function fakeUi(key, params) {
  if (key.startsWith('backendError.')) return `T(${key})`;
  if (params && typeof params === 'object' && Object.keys(params).length > 0) {
    return `${key}:${JSON.stringify(params)}`;
  }
  return key;
}

vi.mock('@/i18n', () => ({
  useUI: () => fakeUi,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// `dialog-dismiss` stands for every close the Dialog itself reports (X, Esc, backdrop).
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }) => (open ? (
    <div data-testid="dialog">
      <button type="button" data-testid="dialog-dismiss" onClick={() => onOpenChange?.(false)}>x</button>
      {children}
    </div>
  ) : null),
  DialogContent: ({ children, ...rest }) => <div {...rest}>{children}</div>,
  DialogTitle: ({ children, ...rest }) => <h2 {...rest}>{children}</h2>,
  // The close-confirmation dialog (ETP-6359) is built on these.
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogDescription: ({ children }) => <p>{children}</p>,
  DialogFooter: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/money-amount', () => ({
  MoneyAmount: ({ value, className }) => <span className={className}>{String(value)}</span>,
}));

const applyMock = vi.fn();
// `loading` is read on every render, so a test can put the apply in flight.
const applyState = { loading: false };
vi.mock('@/hooks/useReconciliation', () => ({
  useApplySuggestions: () => ({ apply: applyMock, loading: applyState.loading, error: null }),
}));

const trackViewed = vi.fn();
const trackDismissed = vi.fn();
vi.mock('@/lib/bounceSuggestionsTelemetry.js', () => ({
  trackBounceSuggestionsViewed: (...args) => trackViewed(...args),
  trackBounceSuggestionsDismissed: (...args) => trackDismissed(...args),
}));

// --- Import under test (after mocks) ----------------------------------------

import { AutoMatchSuggestionModal } from '../AutoMatchSuggestionModal.jsx';
import { useEffect } from 'react';
import { useAutoMatchReview } from '@/hooks/useAutoMatchReview.js';
import { toast } from 'sonner';

// --- Fixtures ---------------------------------------------------------------

/** A transaction group exactly as the flag-off backend sends it: no `kind`. */
const TX = {
  groupKey: 'line-1-txn-1',
  statementLine: { id: 'line-1', description: 'Transf. recibida ACME', amount: -500, date: '2026-05-06' },
  operations: [{ id: 'txn-1', documentNo: 'F2660006', partnerName: 'ACME', amount: -500, isNew: false }],
  origin: 'standard',
  isNew: false,
  difference: 0,
};

const HIGH = {
  kind: 'bouncePair',
  groupKey: 'bp-high',
  origin: 'bounce',
  confidence: 'high',
  signal: 'pis_link',
  signals: ['pis_link'],
  ambiguous: false,
  statementLine: { id: 'O1', description: 'Pago proveedor', amount: -120, date: '2026-05-02' },
  counterpartLine: { id: 'B1', description: 'DEVOLUCION', amount: 120, date: '2026-05-02' },
  operations: [],
  isNew: false,
  difference: 0,
};

const REVIEW = {
  kind: 'bouncePair',
  groupKey: 'bp-review',
  origin: 'bounce',
  confidence: 'review',
  signal: 'return_text',
  signals: ['return_text'],
  ambiguous: false,
  statementLine: { id: 'O2', description: 'Recibo luz', amount: -60, date: '2026-05-01' },
  counterpartLine: { id: 'B2', description: 'RECIBO DEVUELTO', amount: 60, date: '2026-05-04' },
  operations: [],
  isNew: false,
  difference: 0,
};

const AMBIGUOUS = {
  kind: 'bouncePair',
  groupKey: 'bp-amb',
  origin: 'bounce',
  confidence: 'review',
  signal: 'counterparty',
  signals: ['counterparty'],
  ambiguous: true,
  statementLine: null,
  counterpartLine: { id: 'B3', description: 'Abono ACME', amount: 80, date: '2026-05-05' },
  candidates: [
    { line: { id: 'C1', description: 'Pago ACME 1', amount: -80, date: '2026-05-01' } },
    { line: { id: 'C2', description: 'Pago ACME 2', amount: -80, date: '2026-05-03' } },
  ],
  operations: [],
  isNew: false,
  difference: 0,
};

// ETP-6359 — without AI data an ambiguous pair cannot be ticked in the modal; this assessment makes
// it tickable while keeping C1 (detector order) the outflow it shows.
const AMB_AI_C1 = { B3: { probabilities: { C1: 85, C2: 10 }, none: 5, recommendedLineId: 'C1' } };

const KPIS_OFF = { pendingLines: 8, groupsFound: 1, opsToLink: 1, willCreate: 0 };
const KPIS_ON = { ...KPIS_OFF, bouncePairs: 3 };

function renderModal(overrides = {}) {
  const props = {
    accountId: 'acc-1',
    accountName: 'Banco Santander',
    groups: [TX, HIGH, REVIEW, AMBIGUOUS],
    kpis: KPIS_ON,
    currency: 'EUR',
    open: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    onChanged: vi.fn(),
    ...overrides,
  };
  return { ...render(<AutoMatchSuggestionModal {...props} />), props };
}

const applyButton = () => screen.getByTestId('automatch-modal-apply');
const excludeButton = () => screen.getByTestId('automatch-bounce-exclude');
const kpiValue = (label) => screen.getByText(label).nextSibling.textContent;
const check = (key) => screen.getByTestId(`automatch-bounce-check-${key}`);
// The shared Checkbox puts the test id on its <label>; the state lives on the input inside it.
const box = (testId) => within(screen.getByTestId(testId)).getByRole('checkbox');
const checkInput = (key) => box(`automatch-bounce-check-${key}`);

async function clickApply() {
  fireEvent.click(applyButton());
  await vi.waitFor(() => expect(applyMock).toHaveBeenCalled());
}

beforeEach(() => {
  applyState.loading = false;
  applyMock.mockReset().mockResolvedValue({ results: [] });
  toast.success.mockReset();
  toast.error.mockReset();
  toast.warning.mockReset();
  trackViewed.mockReset();
  trackDismissed.mockReset();
});

// ---------------------------------------------------------------------------

describe('AutoMatchSuggestionModal — flag off (no kind, no kpis.bouncePairs)', () => {
  it('renders no bounce section and no bounce KPI', () => {
    renderModal({ groups: [TX], kpis: KPIS_OFF });
    expect(screen.queryByTestId('automatch-bounce-section')).toBeNull();
    expect(screen.queryByText('financeReconcileAutomatchKpiBouncePairs')).toBeNull();
    expect(screen.getByTestId('automatch-select-all')).toBeInTheDocument();
  });

  it('keeps the original payload, with nothing added to the group', async () => {
    applyMock.mockResolvedValue({ results: [{ groupKey: TX.groupKey }] });
    const { props } = renderModal({ groups: [TX], kpis: KPIS_OFF });
    expect(applyButton()).toHaveTextContent('financeReconcileAutomatchActionReconcile:{"count":1}');

    await clickApply();
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock).toHaveBeenCalledWith({
      financialAccountId: 'acc-1',
      groups: [{ statementLineId: 'line-1', operationIds: ['txn-1'] }],
    });
    await vi.waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('financeReconcileAutomatchToastSuccess:{"count":1}');
  });

  it('disables the button of the green card when nothing is checked', () => {
    renderModal({ groups: [TX], kpis: KPIS_OFF });
    fireEvent.click(screen.getByTestId('automatch-select-all'));
    expect(applyButton()).toHaveTextContent('financeReconcileAutomatchActionReconcile:{"count":0}');
    expect(applyButton()).toBeDisabled();
  });
});

describe('AutoMatchSuggestionModal — the Rechazos bancarios section', () => {
  it('renders the pairs below the groups, with their count and the KPI', () => {
    renderModal();
    const section = screen.getByTestId('automatch-bounce-section');
    expect(within(section).getByText('financeReconcileAutomatchBounceTitle')).toBeInTheDocument();
    expect(within(section).getByText('financeReconcileAutomatchBounceHint')).toBeInTheDocument();
    expect(screen.getByTestId('automatch-bounce-count')).toHaveTextContent('3');
    expect(kpiValue('financeReconcileAutomatchKpiBouncePairs')).toBe('3');
    expect(screen.getByTestId('automatch-bounce-row-bp-high')).toBeInTheDocument();
    expect(screen.getByTestId('automatch-bounce-row-bp-review')).toBeInTheDocument();
    expect(screen.getByTestId('automatch-bounce-row-bp-amb')).toBeInTheDocument();
    // The group block stays: a pair never replaces a transaction group.
    expect(screen.getByText('Transf. recibida ACME')).toBeInTheDocument();
  });

  it('shows the original on the left and the bounce on the right', () => {
    renderModal();
    expect(screen.getByTestId('automatch-bounce-original-bp-review')).toHaveTextContent('Recibo luz');
    expect(screen.getByTestId('automatch-bounce-line-bp-review')).toHaveTextContent('RECIBO DEVUELTO');
    // An ambiguous pair shows ONE candidate, with that line's own date (ETP-6359).
    const amb = screen.getByTestId('automatch-bounce-original-bp-amb');
    expect(amb).toHaveTextContent('Pago ACME 1');
    expect(meta('original', 'bp-amb').textContent).toBe('01/05/2026');
  });

  it('tags a high pair "Confianza alta" and a review pair with its short reason', () => {
    renderModal();
    expect(screen.getByTestId('automatch-bounce-tag-high-bp-high')).toHaveTextContent('financeReconcileBounceTagHigh');
    expect(screen.queryByTestId('automatch-bounce-tag-review-bp-high')).toBeNull();
    // ETP-6359: the badge ("Revisar") and the reason are separate elements.
    expect(screen.getByTestId('automatch-bounce-tag-review-bp-review'))
      .toHaveTextContent(/^financeReconcileBounceTagReviewPlain$/);
    expect(screen.getByTestId('automatch-bounce-reason-bp-review'))
      .toHaveTextContent(/^financeReconcileBounceReasonLateShort.*days.*3/);
    expect(screen.getByTestId('automatch-bounce-tag-review-bp-amb'))
      .toHaveTextContent(/^financeReconcileBounceTagReviewPlain$/);
    expect(screen.getByTestId('automatch-bounce-reason-bp-amb'))
      .toHaveTextContent(/^financeReconcileBounceReasonAmbiguousShort.*count.*2/);
  });

  it('starts with high checked, review and ambiguous unchecked (the ambiguous one can be ticked)', () => {
    renderModal({ bounceAiAssessments: AMB_AI_C1 });
    expect(checkInput('bp-high')).toHaveAttribute('aria-checked', 'true');
    expect(checkInput('bp-review')).toHaveAttribute('aria-checked', 'false');
    expect(check('bp-review')).toHaveAttribute('aria-label', 'financeReconcileAutomatchBounceCheck');
    const amb = check('bp-amb');
    expect(checkInput('bp-amb')).not.toBeDisabled();
    expect(checkInput('bp-amb')).toHaveAttribute('aria-checked', 'false');
    expect(amb).toHaveAttribute('aria-label', 'financeReconcileAutomatchBounceCheck');
    // Never auto-checked, but ticking it includes the pair.
    fireEvent.click(amb);
    expect(checkInput('bp-amb')).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles a pair', () => {
    renderModal();
    fireEvent.click(check('bp-review'));
    expect(checkInput('bp-review')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(check('bp-high'));
    expect(checkInput('bp-high')).toHaveAttribute('aria-checked', 'false');
  });

  it('offers "Revisar en el panel" only with onReviewPair, and only on pairs to review', () => {
    const onReviewPair = vi.fn();
    const { unmount } = renderModal();
    expect(screen.queryByTestId('automatch-bounce-review-bp-review')).toBeNull();
    expect(screen.queryByTestId('automatch-bounce-review-bp-amb')).toBeNull();
    unmount();

    renderModal({ onReviewPair });
    expect(screen.queryByTestId('automatch-bounce-review-bp-high')).toBeNull();
    expect(screen.getByTestId('automatch-bounce-review-bp-review')).toHaveTextContent('financeReconcileAutomatchBounceReview');
    fireEvent.click(screen.getByTestId('automatch-bounce-review-bp-amb'));
    expect(onReviewPair).toHaveBeenCalledWith(AMBIGUOUS);
  });

  it('"Revisar en el panel" is the shared outline Button as a pill, never the primary one', () => {
    renderModal({ onReviewPair: vi.fn() });
    const reviewBtn = screen.getByTestId('automatch-bounce-review-bp-review');
    expect(reviewBtn.tagName).toBe('BUTTON');
    expect(reviewBtn).toHaveAttribute('type', 'button');
    expect(reviewBtn.className).toContain('rounded-full');
    expect(reviewBtn.className).toContain('border');
    expect(reviewBtn.className).not.toContain('bg-primary');
  });

  it('select-all of pairs checks every pair (the ambiguous one included), then unchecks them', () => {
    renderModal({ bounceAiAssessments: AMB_AI_C1 });
    const all = screen.getByTestId('automatch-bounce-select-all');
    expect(box('automatch-bounce-select-all')).toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(all);
    expect(checkInput('bp-high')).toHaveAttribute('aria-checked', 'true');
    expect(checkInput('bp-review')).toHaveAttribute('aria-checked', 'true');
    expect(checkInput('bp-amb')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(all);
    expect(checkInput('bp-high')).toHaveAttribute('aria-checked', 'false');
    expect(checkInput('bp-review')).toHaveAttribute('aria-checked', 'false');
    expect(checkInput('bp-amb')).toHaveAttribute('aria-checked', 'false');
    expect(box('automatch-bounce-select-all')).toHaveAttribute('aria-checked', 'false');
    // The transaction group is not touched by the pairs' select-all.
    expect(applyButton()).toHaveTextContent('financeReconcileAutomatchActionReconcile:{"count":1}');
  });

  it('the pairs select-all is enabled when only ambiguous pairs are offered', () => {
    renderModal({ groups: [TX, AMBIGUOUS], bounceAiAssessments: AMB_AI_C1 });
    expect(box('automatch-bounce-select-all')).not.toBeDisabled();
  });

  it('hides the pairs the user dismissed (dismissedPairKeys) from rows, count and KPI', () => {
    renderModal({ dismissedPairKeys: new Set(['bp-review']) });
    expect(screen.queryByTestId('automatch-bounce-row-bp-review')).toBeNull();
    expect(screen.getByTestId('automatch-bounce-count')).toHaveTextContent('2');
    expect(kpiValue('financeReconcileAutomatchKpiBouncePairs')).toBe('2');
  });

  it('hides the whole section when every pair is dismissed', () => {
    renderModal({ groups: [TX, REVIEW], dismissedPairKeys: new Set(['bp-review']) });
    expect(screen.queryByTestId('automatch-bounce-section')).toBeNull();
  });

  it('pairs only: the transaction block (select-all and empty state) steps aside', () => {
    renderModal({ groups: [HIGH, REVIEW], kpis: { ...KPIS_ON, groupsFound: 0 } });
    expect(screen.queryByTestId('automatch-select-all')).toBeNull();
    expect(screen.queryByText('financeReconcileAutomatchEmpty')).toBeNull();
    expect(screen.queryByText('financeReconcileAutomatchColStatement')).toBeNull();
    expect(screen.getByTestId('automatch-bounce-section')).toBeInTheDocument();
  });

  it('nothing at all: the empty state is still shown', () => {
    renderModal({ groups: [], kpis: KPIS_OFF });
    expect(screen.getByText('financeReconcileAutomatchEmpty')).toBeInTheDocument();
  });
});

describe('AutoMatchSuggestionModal — the two card buttons', () => {
  it('green card counts the checked groups; yellow card counts the checked pairs', () => {
    renderModal();
    expect(applyButton()).toHaveTextContent('financeReconcileAutomatchActionReconcile:{"count":1}');
    expect(excludeButton()).toHaveTextContent('financeReconcileAutomatchBounceExclude:{"count":1}');
  });

  it('the counts follow the checks, each card on its own', () => {
    renderModal();
    fireEvent.click(check('bp-review'));
    expect(excludeButton()).toHaveTextContent('financeReconcileAutomatchBounceExclude:{"count":2}');
    fireEvent.click(screen.getByTestId('automatch-select-all'));
    expect(applyButton()).toHaveTextContent('financeReconcileAutomatchActionReconcile:{"count":0}');
    expect(excludeButton()).toHaveTextContent('financeReconcileAutomatchBounceExclude:{"count":2}');
  });

  it('"Excluir" is disabled with no pair checked and never calls apply', () => {
    renderModal();
    fireEvent.click(check('bp-high'));
    expect(excludeButton()).toBeDisabled();
    fireEvent.click(excludeButton());
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('there is no global "Confirmar" footer: the cards own their info sentence and action', () => {
    renderModal();
    expect(screen.getByTestId('automatch-bounce-section')).toContainElement(excludeButton());
    expect(screen.getByTestId('automatch-statements-section')).toContainElement(applyButton());
    expect(screen.getAllByTestId('Info__automatch-card')).toHaveLength(2);
  });

  it('puts the possible rejections card above the statement lines card', () => {
    renderModal();
    const bounce = screen.getByTestId('automatch-bounce-section');
    const statements = screen.getByTestId('automatch-statements-section');
    expect(bounce.compareDocumentPosition(statements) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('AutoMatchSuggestionModal — "Conciliar seleccionadas" (transaction groups only)', () => {
  it('sends ONLY the checked transaction groups, plus the bounceDecisions of every pair on screen', async () => {
    // The backend order puts a pair first: the payload carries groups only, never a pair.
    renderModal({ groups: [HIGH, TX, REVIEW, AMBIGUOUS] });
    fireEvent.click(check('bp-review'));
    await clickApply();
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0][0]).toEqual({
      financialAccountId: 'acc-1',
      groups: [{ statementLineId: 'line-1', operationIds: ['txn-1'] }],
      // Nothing is excluded by this call, so every pair still shown is reported as not applied,
      // checked or not.
      bounceDecisions: [
        { groupKey: 'bp-high', decision: 'unchecked' },
        { groupKey: 'bp-review', decision: 'unchecked' },
        { groupKey: 'bp-amb', decision: 'unchecked' },
      ],
    });
  });

  it('success: the plain toast of the groups, then the host reload and the close', async () => {
    applyMock.mockResolvedValue({ results: [{ groupKey: TX.groupKey }] });
    const { props } = renderModal();
    await clickApply();
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('financeReconcileAutomatchToastSuccess:{"count":1}');
    expect(props.onSuccess).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('keeps the partial toast when some groups failed', async () => {
    applyMock.mockResolvedValue({ results: [{ groupKey: 'a' }, { groupKey: 'b', error: { message: 'x' } }] });
    renderModal({ groups: [TX, REVIEW] });
    await clickApply();
    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.warning).toHaveBeenCalledWith('financeReconcileAutomatchToastPartial:{"success":1,"failed":1}');
  });

  it('is not offered when only pairs exist (the green card steps aside)', () => {
    renderModal({ groups: [HIGH] });
    expect(screen.queryByTestId('automatch-modal-apply')).toBeNull();
    expect(screen.queryByTestId('automatch-statements-section')).toBeNull();
  });
});

describe('AutoMatchSuggestionModal — "Excluir de la conciliación" (pairs only, at once)', () => {
  const clickExclude = async () => {
    fireEvent.click(excludeButton());
    await vi.waitFor(() => expect(applyMock).toHaveBeenCalled());
  };

  it('sends ONLY the checked pairs — no transaction group, no bounceDecisions', async () => {
    applyMock.mockResolvedValue({
      results: [{ kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1', discarded: true }],
    });
    renderModal({ groups: [HIGH, TX, REVIEW, AMBIGUOUS] });
    await clickExclude();
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0][0]).toEqual({
      financialAccountId: 'acc-1',
      groups: [{ kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1' }],
    });
  });

  it('the excluded row leaves at once, the KPI and the count drop, and the modal stays open', async () => {
    applyMock.mockResolvedValue({
      results: [{ kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1', discarded: true }],
    });
    const { props } = renderModal();
    expect(kpiValue('financeReconcileAutomatchKpiBouncePairs')).toBe('3');
    await clickExclude();
    await vi.waitFor(() => expect(screen.queryByTestId('automatch-bounce-row-bp-high')).toBeNull());
    expect(screen.getByTestId('automatch-bounce-row-bp-review')).toBeInTheDocument();
    expect(kpiValue('financeReconcileAutomatchKpiBouncePairs')).toBe('2');
    expect(screen.getByTestId('automatch-bounce-count')).toHaveTextContent('2');
    expect(excludeButton()).toBeDisabled();
    expect(toast.success).toHaveBeenCalledWith('financeReconcileAutomatchBounceToastExcluded:{"count":1}');
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(props.onSuccess).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    // The transaction group stays, still checked.
    expect(applyButton()).toHaveTextContent('financeReconcileAutomatchActionReconcile:{"count":1}');
  });

  it('removes the whole yellow card when its last pairs are excluded', async () => {
    applyMock.mockResolvedValue({
      results: [{ kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1', discarded: true }],
    });
    renderModal({ groups: [TX, HIGH] });
    await clickExclude();
    await vi.waitFor(() => expect(screen.queryByTestId('automatch-bounce-section')).toBeNull());
  });

  it('the green button then reports only the pairs that stayed', async () => {
    applyMock.mockResolvedValueOnce({
      results: [{ kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1', discarded: true }],
    });
    renderModal();
    await clickExclude();
    await vi.waitFor(() => expect(screen.queryByTestId('automatch-bounce-row-bp-high')).toBeNull());
    applyMock.mockResolvedValueOnce({ results: [{ groupKey: TX.groupKey }] });
    fireEvent.click(applyButton());
    await vi.waitFor(() => expect(applyMock).toHaveBeenCalledTimes(2));
    expect(applyMock.mock.calls[1][0]).toEqual({
      financialAccountId: 'acc-1',
      groups: [{ statementLineId: 'line-1', operationIds: ['txn-1'] }],
      bounceDecisions: [
        { groupKey: 'bp-review', decision: 'unchecked' },
        { groupKey: 'bp-amb', decision: 'unchecked' },
      ],
    });
  });

  it('partial: the refused pair stays, a warning carries the translated coded refusal', async () => {
    applyMock.mockResolvedValue({
      results: [
        { kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1', discarded: true },
        {
          kind: 'bouncePair', statementLineId: 'O2', counterpartLineId: 'B2',
          code: 'HAS_PAYMENT', message: 'One of the lines is the bank movement of a payment',
          error: {
            message: 'One of the lines is the bank movement of a payment', status: 409,
            code: 'HAS_PAYMENT', messageKeys: ['ETGO_BounceHasPayment'],
          },
        },
      ],
    });
    const { props } = renderModal();
    fireEvent.click(check('bp-review'));
    await clickExclude();
    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.warning).toHaveBeenCalledWith(
      'financeReconcileAutomatchBounceToastExcluded:{"count":1} financeReconcileAutomatchBounceToastSomeFailed:{"count":1}',
      { description: 'T(backendError.bounceHasPayment)' },
    );
    expect(screen.queryByTestId('automatch-bounce-row-bp-high')).toBeNull();
    expect(screen.getByTestId('automatch-bounce-row-bp-review')).toBeInTheDocument();
    expect(props.onChanged).toHaveBeenCalledTimes(1);
  });

  it('all refused: an error toast with the translated refusal, nothing leaves, no refresh', async () => {
    applyMock.mockResolvedValue({
      results: [{
        kind: 'bouncePair', code: 'BOUNCE_SUGGESTIONS_OFF',
        error: { message: 'Bounce suggestions are not enabled for this account.', status: 403, messageKeys: ['ETGO_BounceSuggestionsOff'] },
      }],
    });
    const { props } = renderModal({ groups: [HIGH] });
    await clickExclude();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('T(backendError.bounceSuggestionsOff)');
    expect(toast.warning).not.toHaveBeenCalled();
    expect(screen.getByTestId('automatch-bounce-row-bp-high')).toBeInTheDocument();
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it('all refused with an unkeyed refusal: the backend message is shown', async () => {
    applyMock.mockResolvedValue({ results: [{ kind: 'bouncePair', error: { message: 'Line not found' } }] });
    renderModal({ groups: [HIGH] });
    await clickExclude();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('Line not found');
  });

  it('a failed request keeps every row and shows an error toast', async () => {
    applyMock.mockRejectedValue(new Error('network down'));
    const { props } = renderModal({ groups: [HIGH] });
    await clickExclude();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByTestId('automatch-bounce-row-bp-high')).toBeInTheDocument();
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it('an ambiguous pair is not sent until it is ticked; then it goes with the outflow its row shows', async () => {
    applyMock.mockResolvedValue({ results: [{ kind: 'bouncePair', statementLineId: 'C1', counterpartLineId: 'B3', discarded: true }] });
    renderModal({ groups: [AMBIGUOUS], bounceAiAssessments: AMB_AI_C1 });
    expect(checkInput('bp-amb')).not.toBeDisabled();
    expect(excludeButton()).toBeDisabled();
    fireEvent.click(check('bp-amb'));
    fireEvent.click(excludeButton());
    await vi.waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));
    // The AI-recommended candidate the row shows, sent as an AI choice.
    expect(applyMock.mock.calls[0][0].groups).toEqual([
      { kind: 'bouncePair', statementLineId: 'C1', counterpartLineId: 'B3', choiceSource: 'ai' },
    ]);
  });

  it('suggestions reloaded by the host bring the pairs back from the server, not from the local hiding', async () => {
    applyMock.mockResolvedValue({
      results: [{ kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1', discarded: true }],
    });
    const { rerender, props } = renderModal();
    await clickExclude();
    await vi.waitFor(() => expect(screen.queryByTestId('automatch-bounce-row-bp-high')).toBeNull());
    rerender(<AutoMatchSuggestionModal {...props} groups={[TX, HIGH, REVIEW, AMBIGUOUS]} />);
    expect(screen.getByTestId('automatch-bounce-row-bp-high')).toBeInTheDocument();
  });
});

describe('AutoMatchSuggestionModal — host-owned selection', () => {
  it('reads and writes the checks through the selection prop', async () => {
    const selection = {
      isChecked: vi.fn((g) => g.groupKey === 'bp-review'),
      toggle: vi.fn(),
      setMany: vi.fn(),
    };
    renderModal({ selection });
    expect(checkInput('bp-review')).toHaveAttribute('aria-checked', 'true');
    expect(checkInput('bp-high')).toHaveAttribute('aria-checked', 'false');
    expect(excludeButton()).toHaveTextContent('financeReconcileAutomatchBounceExclude:{"count":1}');

    fireEvent.click(check('bp-high'));
    expect(selection.toggle).toHaveBeenCalledWith(HIGH);
    fireEvent.click(screen.getByTestId('automatch-bounce-select-all'));
    expect(selection.setMany).toHaveBeenCalledWith([HIGH, REVIEW, AMBIGUOUS], true);

    applyMock.mockResolvedValue({
      results: [{ kind: 'bouncePair', statementLineId: 'O2', counterpartLineId: 'B2', discarded: true }],
    });
    fireEvent.click(excludeButton());
    await vi.waitFor(() => expect(applyMock).toHaveBeenCalled());
    expect(applyMock.mock.calls[0][0].groups).toEqual([
      { kind: 'bouncePair', statementLineId: 'O2', counterpartLineId: 'B2' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The shared controls: Checkbox (@/components/ui/checkbox) and Button (@/components/ui/button)
// ---------------------------------------------------------------------------

describe('AutoMatchSuggestionModal — the shared Checkbox of the pairs', () => {
  it('puts the test id on the <label> and the state on the checkbox input inside it', () => {
    renderModal();
    const label = check('bp-high');
    expect(label.tagName).toBe('LABEL');
    const input = checkInput('bp-high');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('type', 'checkbox');
    expect(input).toBeChecked();
  });

  it('names each inner checkbox from the aria-label of its row', () => {
    renderModal();
    const review = screen.getByTestId('automatch-bounce-row-bp-review');
    expect(within(review).getByRole('checkbox', { name: 'financeReconcileAutomatchBounceCheck' }))
      .toBe(checkInput('bp-review'));
    // Without AI data the ambiguous pair's (disabled) check says to choose in the panel (ETP-6359).
    const amb = screen.getByTestId('automatch-bounce-row-bp-amb');
    expect(within(amb).getByRole('checkbox', { name: 'financeReconcileAutomatchBounceAmbiguousCheck' }))
      .toBe(checkInput('bp-amb'));
    expect(screen.getByRole('checkbox', { name: 'financeReconcileAutomatchBounceSelectAll' }))
      .toBe(box('automatch-bounce-select-all'));
    // A transaction group's checkbox is named after its statement line, so two groups differ.
    expect(screen.getByRole('checkbox', {
      name: `financeReconcileAutomatchGroupCheck:${JSON.stringify({ line: 'Transf. recibida ACME' })}`,
    })).toBe(box(`automatch-group-check-${TX.groupKey}`));
  });

  it('keeps the header "mixed" while any pair is checked, and unchecked once none is', () => {
    renderModal();
    const header = () => box('automatch-bounce-select-all');
    // high checked by default
    expect(header()).toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(check('bp-review'));
    fireEvent.click(check('bp-high'));
    // only review checked now: still mixed
    expect(checkInput('bp-review')).toHaveAttribute('aria-checked', 'true');
    expect(header()).toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(check('bp-review'));
    expect(header()).toHaveAttribute('aria-checked', 'false');
  });

  it('clicking the label of an ambiguous pair toggles it like any other pair', () => {
    const selection = {
      isChecked: vi.fn((g) => g.groupKey === 'bp-high' || g.groupKey === TX.groupKey),
      toggle: vi.fn(),
      setMany: vi.fn(),
    };
    renderModal({ selection });
    const before = applyButton().textContent;
    fireEvent.click(check('bp-amb'));
    expect(selection.toggle).toHaveBeenCalledWith(AMBIGUOUS);
    // The pairs never touch the transaction groups' button.
    expect(applyButton().textContent).toBe(before);
  });
});

describe('AutoMatchSuggestionModal — the Apply button', () => {
  it('is the shared primary Button (bg-primary)', () => {
    renderModal();
    expect(applyButton().tagName).toBe('BUTTON');
    expect(applyButton().className).toContain('bg-primary');
    expect(applyButton()).toBeEnabled();
  });

  it('is disabled with nothing selected and never calls apply', () => {
    renderModal({ groups: [TX, HIGH] });
    fireEvent.click(screen.getByTestId('automatch-select-all'));
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('is disabled and reads "loading" while the apply is in flight', () => {
    applyState.loading = true;
    renderModal();
    expect(applyButton()).toBeDisabled();
    expect(applyButton()).toHaveTextContent('loading');
    expect(applyButton()).not.toHaveTextContent('financeReconcileAutomatchActionReconcile');
  });
});

// ---------------------------------------------------------------------------
// The bank reference and the descriptions of a pair row
// ---------------------------------------------------------------------------

const REF_PAIR = {
  ...REVIEW,
  groupKey: 'bp-ref',
  statementLine: { ...REVIEW.statementLine, id: 'O5', referenceNo: 'R-OUT-5' },
  counterpartLine: { ...REVIEW.counterpartLine, id: 'B5', referenceNo: ' R-IN-5 ' },
};
const BLANK_REF_PAIR = {
  ...HIGH,
  groupKey: 'bp-blank',
  statementLine: { ...HIGH.statementLine, id: 'O6', referenceNo: '   ' },
  counterpartLine: { ...HIGH.counterpartLine, id: 'B6', referenceNo: '' },
};
const AMB_REF = {
  ...AMBIGUOUS,
  groupKey: 'bp-amb-ref',
  counterpartLine: { ...AMBIGUOUS.counterpartLine, id: 'B7', referenceNo: 'R-IN-7' },
  candidates: [
    { line: { ...AMBIGUOUS.candidates[0].line, id: 'C7', referenceNo: 'R-C7' } },
    { line: { ...AMBIGUOUS.candidates[1].line, id: 'C8', referenceNo: 'R-C8' } },
  ],
};
const refText = (ref) => `financeReconcileBounceRef:${JSON.stringify({ ref })}`;
const meta = (side, key) => screen.getByTestId(`automatch-bounce-${side}-meta-${key}`);

describe('AutoMatchSuggestionModal — the bank reference of a pair', () => {
  it('shows "date · Ref. X" on both sides of a pair whose lines carry a reference (trimmed)', () => {
    renderModal({ groups: [REF_PAIR] });
    expect(meta('original', 'bp-ref')).toHaveTextContent(`01/05/2026 · ${refText('R-OUT-5')}`);
    expect(meta('line', 'bp-ref')).toHaveTextContent(`04/05/2026 · ${refText('R-IN-5')}`);
  });

  it('shows only the date for a blank, whitespace or missing reference', () => {
    renderModal({ groups: [BLANK_REF_PAIR, REVIEW] });
    expect(meta('original', 'bp-blank').textContent).toBe('02/05/2026');
    expect(meta('line', 'bp-blank').textContent).toBe('02/05/2026');
    expect(meta('original', 'bp-review').textContent).toBe('01/05/2026');
    expect(meta('line', 'bp-review').textContent).toBe('04/05/2026');
    expect(screen.queryByText(/financeReconcileBounceRef/)).toBeNull();
  });

  it('an ambiguous pair: the original side shows the date and reference of the outflow it shows', () => {
    renderModal({ groups: [AMB_REF] });
    expect(meta('original', 'bp-amb-ref').textContent).toBe(`01/05/2026 · ${refText('R-C7')}`);
    // The bounce is one line, so its own reference is shown.
    expect(meta('line', 'bp-amb-ref')).toHaveTextContent(`05/05/2026 · ${refText('R-IN-7')}`);
  });
});

describe('AutoMatchSuggestionModal — pair descriptions (TruncatedText)', () => {
  const LONG = 'TRANSFERENCIA A FAVOR DE PROVEEDORES UNIDOS CONCEPTO 10000268 100-1';
  const LONG_PAIR = {
    ...REVIEW,
    groupKey: 'bp-long',
    statementLine: { ...REVIEW.statementLine, description: LONG },
  };
  const setMetrics = (el, scrollWidth, clientWidth) => {
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  };

  it('renders each side description in its -desc element', () => {
    renderModal({ groups: [LONG_PAIR] });
    expect(screen.getByTestId('automatch-bounce-original-bp-long-desc')).toHaveTextContent(LONG);
    expect(screen.getByTestId('automatch-bounce-line-bp-long-desc')).toHaveTextContent('RECIBO DEVUELTO');
  });

  it('reveals the full description in a tooltip when it is clipped', () => {
    renderModal({ groups: [LONG_PAIR] });
    const desc = screen.getByTestId('automatch-bounce-original-bp-long-desc');
    setMetrics(desc, 640, 200);
    fireEvent.focus(desc);
    expect(screen.getByTestId('automatch-bounce-original-bp-long-desc-tooltip')).toHaveTextContent(LONG);
  });

  it('falls back to the reference when a line has no description', () => {
    const noDesc = {
      ...REF_PAIR,
      groupKey: 'bp-nodesc',
      counterpartLine: { ...REF_PAIR.counterpartLine, description: '' },
    };
    renderModal({ groups: [noDesc] });
    expect(screen.getByTestId('automatch-bounce-line-bp-nodesc-desc')).toHaveTextContent('R-IN-5');
  });
});

// ---------------------------------------------------------------------------
// Ambiguous pairs: two candidates, and two pairs sharing a candidate
// ---------------------------------------------------------------------------

describe('AutoMatchSuggestionModal — ambiguous pairs', () => {
  // The "Revisar: 2 salidas posibles" tag of a 2-candidate pair is asserted in "tags a high pair…".
  // Same statement, same day: bounce B9 over [C1, C2] and bounce B10 over [C2, C9]; they share C2.
  // The backend offers both (neo-headless.md §4.12.1.1, "Two such pairs may share a neighbour").
  const SHARED_A = AMBIGUOUS;
  const SHARED_B = {
    ...AMBIGUOUS,
    groupKey: 'bp-amb-2',
    counterpartLine: { id: 'B10', description: 'Abono ACME 2', amount: 80, date: '2026-05-06' },
    candidates: [
      AMBIGUOUS.candidates[1],
      { line: { id: 'C9', description: 'Pago ACME 3', amount: -80, date: '2026-05-04' } },
    ],
  };

  it('renders both pairs that share a candidate, each with its own candidates', () => {
    const ai = { ...AMB_AI_C1, B10: { probabilities: { C2: 85, C9: 10 }, none: 5, recommendedLineId: 'C2' } };
    renderModal({ groups: [TX, SHARED_A, SHARED_B], kpis: { ...KPIS_ON, bouncePairs: 2 }, bounceAiAssessments: ai });
    expect(screen.getByTestId('automatch-bounce-count')).toHaveTextContent('2');
    expect(kpiValue('financeReconcileAutomatchKpiBouncePairs')).toBe('2');
    for (const key of ['bp-amb', 'bp-amb-2']) {
      expect(screen.getByTestId(`automatch-bounce-row-${key}`)).toBeInTheDocument();
      expect(checkInput(key)).not.toBeDisabled();
      expect(screen.getByTestId(`automatch-bounce-reason-${key}`))
        .toHaveTextContent('financeReconcileBounceReasonAmbiguousShort');
    }
    expect(meta('original', 'bp-amb').textContent).toBe('01/05/2026');
    expect(meta('original', 'bp-amb-2').textContent).toBe('03/05/2026');
    // The shared candidate is the first one shown for the second pair.
    expect(screen.getByTestId('automatch-bounce-original-bp-amb-2')).toHaveTextContent('Pago ACME 2');
    // Both can be ticked, so the pairs' select-all is enabled.
    expect(box('automatch-bounce-select-all')).not.toBeDisabled();
  });

  it('offers "Revisar en el panel" on both, each for its own pair', () => {
    const onReviewPair = vi.fn();
    renderModal({ groups: [SHARED_A, SHARED_B], onReviewPair });
    fireEvent.click(screen.getByTestId('automatch-bounce-review-bp-amb-2'));
    expect(onReviewPair).toHaveBeenCalledWith(SHARED_B);
    fireEvent.click(screen.getByTestId('automatch-bounce-review-bp-amb'));
    expect(onReviewPair).toHaveBeenLastCalledWith(SHARED_A);
  });
});

// ---------------------------------------------------------------------------
// KPI events (ETP-5581): bounceDecisions in the apply, and the frontend Mixpanel events
// ---------------------------------------------------------------------------

describe('AutoMatchSuggestionModal — bounceDecisions in the applySuggestions body', () => {
  // ETP-6359: "Conciliar seleccionadas" never excludes a pair, so every pair still on screen is
  // reported as not applied — checked or not — and no pair travels in `groups`.
  it('reports every pair still shown as unchecked, and sends no pair in groups', async () => {
    renderModal();
    await clickApply();
    const body = applyMock.mock.calls[0][0];
    expect(body.groups.some((g) => g.kind === 'bouncePair')).toBe(false);
    expect(body.bounceDecisions).toEqual([
      { groupKey: 'bp-high', decision: 'unchecked' },
      { groupKey: 'bp-review', decision: 'unchecked' },
      { groupKey: 'bp-amb', decision: 'unchecked' },
    ]);
  });

  it('a preselected pair the user unchecked is reported as unchecked', async () => {
    renderModal();
    fireEvent.click(check('bp-high'));
    await clickApply();
    expect(applyMock.mock.calls[0][0].bounceDecisions).toContainEqual({ groupKey: 'bp-high', decision: 'unchecked' });
  });

  it('a pair sent to the panel and left unchecked is reported as sent_to_panel', async () => {
    renderModal({ sentToPanelKeys: new Set(['bp-amb', 'bp-review']) });
    await clickApply();
    expect(applyMock.mock.calls[0][0].bounceDecisions).toEqual([
      { groupKey: 'bp-high', decision: 'unchecked' },
      { groupKey: 'bp-review', decision: 'sent_to_panel' },
      { groupKey: 'bp-amb', decision: 'sent_to_panel' },
    ]);
  });

  it('a pair checked but not excluded is still reported: this call does not exclude it', async () => {
    renderModal();
    fireEvent.click(check('bp-review'));
    await clickApply();
    const body = applyMock.mock.calls[0][0];
    expect(body.groups.some((g) => g.kind === 'bouncePair')).toBe(false);
    expect(body.bounceDecisions).toContainEqual({ groupKey: 'bp-review', decision: 'unchecked' });
  });

  it('pairs dismissed with "No es un rechazo" are not shown, so not reported', async () => {
    renderModal({ dismissedPairKeys: new Set(['bp-review', 'bp-amb']) });
    await clickApply();
    expect(applyMock.mock.calls[0][0].bounceDecisions).toEqual([{ groupKey: 'bp-high', decision: 'unchecked' }]);
  });

  it('sends no bounceDecisions when the modal shows no pair', async () => {
    renderModal({ groups: [TX], kpis: KPIS_OFF });
    await clickApply();
    expect(applyMock.mock.calls[0][0]).not.toHaveProperty('bounceDecisions');
  });
});

describe('AutoMatchSuggestionModal — bounce_suggestions_viewed', () => {
  it('is emitted once per opening with the shown and preselected pair counts', () => {
    const { rerender, props } = renderModal({ autoOpened: true });
    expect(trackViewed).toHaveBeenCalledTimes(1);
    expect(trackViewed).toHaveBeenCalledWith({ pairsShown: 3, pairsPreselected: 1, autoOpened: true });

    // Re-renders of the same opening (a toggle) emit nothing more.
    fireEvent.click(check('bp-review'));
    rerender(<AutoMatchSuggestionModal {...props} kpis={{ ...KPIS_ON }} />);
    expect(trackViewed).toHaveBeenCalledTimes(1);
  });

  it('is emitted again on a new opening, with how it opened', () => {
    const { rerender, props } = renderModal({ autoOpened: true });
    rerender(<AutoMatchSuggestionModal {...props} open={false} />);
    rerender(<AutoMatchSuggestionModal {...props} open autoOpened={false} />);
    expect(trackViewed).toHaveBeenCalledTimes(2);
    expect(trackViewed).toHaveBeenLastCalledWith({ pairsShown: 3, pairsPreselected: 1, autoOpened: false });
  });

  it('is emitted when the pairs land after the modal opened', () => {
    const { rerender, props } = renderModal({ groups: [] });
    expect(trackViewed).not.toHaveBeenCalled();
    rerender(<AutoMatchSuggestionModal {...props} groups={[TX, HIGH]} />);
    expect(trackViewed).toHaveBeenCalledWith({ pairsShown: 1, pairsPreselected: 1, autoOpened: false });
  });

  it('counts only the pairs still shown (dismissed ones left out)', () => {
    renderModal({ dismissedPairKeys: new Set(['bp-high']) });
    expect(trackViewed).toHaveBeenCalledWith({ pairsShown: 2, pairsPreselected: 0, autoOpened: false });
  });

  it('is not emitted without bounce pairs, nor while closed', () => {
    renderModal({ groups: [TX], kpis: KPIS_OFF });
    renderModal({ open: false });
    expect(trackViewed).not.toHaveBeenCalled();
  });
});

describe('AutoMatchSuggestionModal — bounce_suggestions_dismissed', () => {
  // ETP-6359: with rows selected every close asks first; "Cerrar" confirms it.
  it.each([
    ['Ir a conciliación manual', 'automatch-modal-open-reconciliation'],
    ['X / Esc / backdrop', 'dialog-dismiss'],
  ])('%s asks first, then closes and reports the dismissal with the pairs checked at close', (_label, testId) => {
    const { props } = renderModal({ autoOpened: true });
    fireEvent.click(check('bp-review'));
    fireEvent.click(screen.getByTestId(testId));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(trackDismissed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('automatch-close-confirm-action'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(trackDismissed).toHaveBeenCalledTimes(1);
    expect(trackDismissed).toHaveBeenCalledWith({ pairsShown: 3, pairsCheckedAtClose: 2, autoOpened: true });
  });

  it('"Seguir trabajando" keeps the modal, the selection and reports nothing', () => {
    const { props } = renderModal();
    fireEvent.click(check('bp-review'));
    fireEvent.click(screen.getByTestId('dialog-dismiss'));
    fireEvent.click(screen.getByTestId('automatch-close-keep'));
    expect(screen.queryByTestId('automatch-close-confirm')).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(trackDismissed).not.toHaveBeenCalled();
    expect(checkInput('bp-review')).toHaveAttribute('aria-checked', 'true');
  });

  it('closes without asking when nothing is selected', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByTestId('automatch-select-all'));
    fireEvent.click(check('bp-high'));
    fireEvent.click(screen.getByTestId('dialog-dismiss'));
    expect(screen.queryByTestId('automatch-close-confirm')).toBeNull();
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(trackDismissed).toHaveBeenCalledWith({ pairsShown: 3, pairsCheckedAtClose: 0, autoOpened: false });
  });

  it('is not reported on an apply', async () => {
    const { props } = renderModal();
    await clickApply();
    await vi.waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(trackDismissed).not.toHaveBeenCalled();
  });

  it('is not reported on "Revisar en el panel" (the host closes the modal)', () => {
    const onReviewPair = vi.fn();
    const { rerender, props } = renderModal({ onReviewPair });
    fireEvent.click(screen.getByTestId('automatch-bounce-review-bp-review'));
    rerender(<AutoMatchSuggestionModal {...props} onReviewPair={onReviewPair} open={false} />);
    expect(onReviewPair).toHaveBeenCalledWith(REVIEW);
    expect(trackDismissed).not.toHaveBeenCalled();
  });

  it('is not reported when the modal had no bounce pair', () => {
    const { props } = renderModal({ groups: [TX], kpis: KPIS_OFF });
    fireEvent.click(screen.getByTestId('automatch-select-all'));
    fireEvent.click(screen.getByTestId('automatch-modal-open-reconciliation'));
    expect(props.onClose).toHaveBeenCalled();
    expect(trackDismissed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Redesign coverage gaps (ETP-6359): the card buttons never leak into each other, and the close
// confirmation never outlives the modal.
// ---------------------------------------------------------------------------

describe('AutoMatchSuggestionModal — the two actions never leak into each other', () => {
  it('"Excluir" after select-all of the pairs sends every pair, the ambiguous one with its shown outflow', async () => {
    applyMock.mockResolvedValue({
      results: [
        { kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1', discarded: true },
        { kind: 'bouncePair', statementLineId: 'O2', counterpartLineId: 'B2', discarded: true },
        { kind: 'bouncePair', statementLineId: 'C1', counterpartLineId: 'B3', discarded: true },
      ],
    });
    renderModal({ groups: [TX, HIGH, REVIEW, AMBIGUOUS], bounceAiAssessments: AMB_AI_C1 });
    fireEvent.click(screen.getByTestId('automatch-bounce-select-all'));
    expect(excludeButton()).toHaveTextContent('financeReconcileAutomatchBounceExclude:{"count":3}');
    fireEvent.click(excludeButton());
    await vi.waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));
    const sent = applyMock.mock.calls[0][0];
    expect(sent.groups).toEqual([
      { kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1' },
      { kind: 'bouncePair', statementLineId: 'O2', counterpartLineId: 'B2' },
      { kind: 'bouncePair', statementLineId: 'C1', counterpartLineId: 'B3', choiceSource: 'ai' },
    ]);
    expect(sent).not.toHaveProperty('bounceDecisions');
    // Every pair sent and discarded leaves the screen, the ambiguous one included.
    await vi.waitFor(() => expect(screen.queryByTestId('automatch-bounce-row-bp-review')).toBeNull());
    expect(screen.queryByTestId('automatch-bounce-row-bp-amb')).toBeNull();
  });

  it('"Excluir" asks the backend once and never reloads: the modal only hides the rows by groupKey', async () => {
    applyMock.mockResolvedValue({
      results: [{ kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1', discarded: true }],
    });
    const { props } = renderModal();
    fireEvent.click(excludeButton());
    await vi.waitFor(() => expect(screen.queryByTestId('automatch-bounce-row-bp-high')).toBeNull());
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(props.onSuccess).not.toHaveBeenCalled();
    // The pair that was not excluded stays on screen, unchecked as it started.
    expect(screen.getByTestId('automatch-bounce-row-bp-review')).toBeInTheDocument();
    expect(checkInput('bp-review')).toHaveAttribute('aria-checked', 'false');
    expect(applyButton()).toHaveTextContent('financeReconcileAutomatchActionReconcile:{"count":1}');
  });

  it('"Conciliar seleccionadas" with EVERY pair checked still sends only transaction groups', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('automatch-bounce-select-all'));
    await clickApply();
    const sent = applyMock.mock.calls[0][0];
    expect(sent.groups).toEqual([{ statementLineId: 'line-1', operationIds: ['txn-1'] }]);
    expect(JSON.stringify(sent.groups)).not.toContain('bouncePair');
  });
});

describe('AutoMatchSuggestionModal — the close confirmation and the modal lifecycle', () => {
  it('"Cerrar" closes exactly once and the confirmation is gone', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByTestId('automatch-modal-open-reconciliation'));
    expect(screen.getByTestId('automatch-close-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('automatch-close-confirm-action'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('automatch-close-confirm')).toBeNull();
  });

  it('a selected transaction group alone (no pair checked) also asks before closing', () => {
    const { props } = renderModal({ groups: [TX], kpis: KPIS_OFF });
    fireEvent.click(screen.getByTestId('dialog-dismiss'));
    expect(screen.getByTestId('automatch-close-confirm')).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('"Ir a conciliación manual" closes without asking when nothing is selected', () => {
    const { props } = renderModal({ groups: [TX], kpis: KPIS_OFF });
    fireEvent.click(screen.getByTestId('automatch-select-all'));
    fireEvent.click(screen.getByTestId('automatch-modal-open-reconciliation'));
    expect(screen.queryByTestId('automatch-close-confirm')).toBeNull();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('never leaves the confirmation open behind a modal the host closed', () => {
    const { rerender, props } = renderModal();
    fireEvent.click(screen.getByTestId('dialog-dismiss'));
    expect(screen.getByTestId('automatch-close-confirm')).toBeInTheDocument();
    rerender(<AutoMatchSuggestionModal {...props} open={false} />);
    expect(screen.queryByTestId('automatch-close-confirm')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AI second layer: `bounceAiAssessments` of the autoMatch answer. DISPLAY only — the checks, the
// payloads and the order of the pairs never read it.

const aiPctText = (pct) => `financeReconcileBounceAiProbability:${JSON.stringify({ pct: String(pct) })}`;
const AI_AMB = { B3: { probabilities: { C1: 10, C2: 85 }, none: 5, recommendedLineId: 'C2' } };
const AI_REVIEW = { B2: { probabilities: { O2: 72 }, none: 28, recommendedLineId: 'O2' } };

describe('AutoMatchSuggestionModal — the AI percentage of a pair (display only)', () => {
  it('an ambiguous pair shows the recommended candidate and its percentage, and can be ticked', () => {
    const { props } = renderModal({ bounceAiAssessments: AI_AMB, onReviewPair: vi.fn() });
    const original = screen.getByTestId('automatch-bounce-original-bp-amb');
    expect(original).toHaveTextContent('Pago ACME 2');
    expect(original).not.toHaveTextContent('Pago ACME 1');
    expect(screen.getByTestId('automatch-bounce-ai-pct-bp-amb')).toHaveTextContent(aiPctText(85));
    // Never auto-checked, even with a recommendation: the user ticks it.
    expect(checkInput('bp-amb')).not.toBeDisabled();
    expect(checkInput('bp-amb')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('automatch-bounce-review-bp-amb')).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('hides the percentage when "none of these" outweighs the best candidate (none 55 > best 40)', () => {
    renderModal({ bounceAiAssessments: { B3: { probabilities: { C1: 40, C2: 30 }, none: 55, recommendedLineId: null } } });
    expect(screen.queryByTestId('automatch-bounce-ai-pct-bp-amb')).toBeNull();
    // Detector order is kept: the first candidate is the one shown.
    expect(screen.getByTestId('automatch-bounce-original-bp-amb')).toHaveTextContent('Pago ACME 1');
    expect(checkInput('bp-amb')).not.toBeDisabled();
  });

  it('shows the percentage when "none" is lower than the best candidate (none 5, best 85)', () => {
    renderModal({ bounceAiAssessments: AI_AMB });
    expect(screen.getByTestId('automatch-bounce-ai-pct-bp-amb')).toHaveTextContent(aiPctText(85));
  });

  it('shows the percentage when "none" equals the best candidate (not strictly higher)', () => {
    renderModal({ bounceAiAssessments: { B3: { probabilities: { C1: 10, C2: 40 }, none: 40, recommendedLineId: null } } });
    expect(screen.getByTestId('automatch-bounce-ai-pct-bp-amb')).toHaveTextContent(aiPctText(40));
  });

  it('an assessment without "none" shows the percentage as before', () => {
    renderModal({ bounceAiAssessments: { B3: { probabilities: { C1: 10, C2: 85 }, recommendedLineId: 'C2' } } });
    expect(screen.getByTestId('automatch-bounce-ai-pct-bp-amb')).toHaveTextContent(aiPctText(85));
  });

  it('shows the most probable candidate with its own date, not every candidate date', () => {
    renderModal({ bounceAiAssessments: AI_AMB });
    expect(screen.getByTestId('automatch-bounce-original-bp-amb')).toHaveTextContent('Pago ACME 2');
    expect(meta('original', 'bp-amb').textContent).toBe('03/05/2026');
  });

  it('a single-candidate review pair loses its percentage when "none" wins, and keeps being unchecked', () => {
    renderModal({ bounceAiAssessments: { B2: { probabilities: { O2: 30 }, none: 70, recommendedLineId: null } } });
    expect(screen.queryByTestId('automatch-bounce-ai-pct-bp-review')).toBeNull();
    expect(screen.getByTestId('automatch-bounce-reason-bp-review')).toBeInTheDocument();
    expect(checkInput('bp-review')).toHaveAttribute('aria-checked', 'false');
  });

  it('puts the percentage in its own span next to the badge, not inside it nor inside the reason', () => {
    renderModal({ bounceAiAssessments: AI_AMB });
    const pct = screen.getByTestId('automatch-bounce-ai-pct-bp-amb');
    const badge = screen.getByTestId('automatch-bounce-tag-review-bp-amb');
    const reason = screen.getByTestId('automatch-bounce-reason-bp-amb');
    expect(badge).toHaveTextContent(/^financeReconcileBounceTagReviewPlain$/);
    expect(reason).toHaveTextContent(/^financeReconcileBounceReasonAmbiguousShort/);
    expect(reason).not.toHaveTextContent('financeReconcileBounceAiProbability');
    expect(pct.contains(badge)).toBe(false);
    expect(pct.contains(reason)).toBe(false);
    expect(badge.contains(pct)).toBe(false);
    expect(pct.parentElement).toBe(reason.parentElement);
  });

  it('a single-candidate pair to review shows only the percentage and stays unchecked', () => {
    renderModal({ bounceAiAssessments: AI_REVIEW });
    expect(screen.getByTestId('automatch-bounce-ai-pct-bp-review')).toHaveTextContent(aiPctText(72));
    expect(screen.getByTestId('automatch-bounce-original-bp-review')).toHaveTextContent('Recibo luz');
    expect(checkInput('bp-review')).toHaveAttribute('aria-checked', 'false');
    expect(checkInput('bp-review')).not.toBeDisabled();
  });

  it('rows without an assessment render exactly as before', () => {
    renderModal({ bounceAiAssessments: AI_AMB });
    expect(screen.queryByTestId('automatch-bounce-ai-pct-bp-review')).toBeNull();
    expect(screen.queryByTestId('automatch-bounce-ai-pct-bp-high')).toBeNull();
    expect(screen.getByTestId('automatch-bounce-reason-bp-review'))
      .toHaveTextContent(/^financeReconcileBounceReasonLateShort.*days.*3/);
  });

  it('without any bounceAiAssessments no percentage is rendered and the candidates keep their order', () => {
    renderModal();
    expect(screen.queryAllByTestId(/^automatch-bounce-ai-pct-/)).toHaveLength(0);
    expect(screen.getByTestId('automatch-bounce-original-bp-amb')).toHaveTextContent('Pago ACME 1');
    expect(meta('original', 'bp-amb').textContent).toBe('01/05/2026');
  });

  it('does not change the initial checks: high checked, review and ambiguous unchecked', () => {
    renderModal({ bounceAiAssessments: { ...AI_AMB, ...AI_REVIEW } });
    expect(checkInput('bp-high')).toHaveAttribute('aria-checked', 'true');
    expect(checkInput('bp-review')).toHaveAttribute('aria-checked', 'false');
    expect(checkInput('bp-amb')).toHaveAttribute('aria-checked', 'false');
  });

  it('"Excluir" sends the same body with and without the AI data', async () => {
    applyMock.mockResolvedValue({
      results: [{ kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1', discarded: true }],
    });
    renderModal({ groups: [HIGH, TX, REVIEW, AMBIGUOUS], bounceAiAssessments: { ...AI_AMB, ...AI_REVIEW } });
    fireEvent.click(excludeButton());
    await vi.waitFor(() => expect(applyMock).toHaveBeenCalled());
    expect(applyMock.mock.calls[0][0]).toEqual({
      financialAccountId: 'acc-1',
      groups: [{ kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1' }],
    });
  });

  const excludeAmbiguous = async (props = {}) => {
    renderModal({ groups: [AMBIGUOUS], ...props });
    fireEvent.click(check('bp-amb'));
    fireEvent.click(excludeButton());
    await vi.waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));
    return applyMock.mock.calls[0][0].groups[0];
  };
  const OK = { results: [{ kind: 'bouncePair', statementLineId: 'C2', counterpartLineId: 'B3', discarded: true }] };

  it('Excluir carries choiceSource "ai" when the shown outflow is the AI-recommended one', async () => {
    applyMock.mockResolvedValue(OK);
    expect(await excludeAmbiguous({ bounceAiAssessments: AI_AMB })).toEqual({
      kind: 'bouncePair', statementLineId: 'C2', counterpartLineId: 'B3', choiceSource: 'ai',
    });
  });

  it('Excluir carries choiceSource "user" when the AI rated the pair but the shown outflow is not the recommended one', async () => {
    applyMock.mockResolvedValue(OK);
    // The AI recommends nothing: the most probable candidate (C2) is shown and sent as "user".
    const group = await excludeAmbiguous({
      bounceAiAssessments: { B3: { probabilities: { C1: 40, C2: 60 }, none: 0, recommendedLineId: null } },
    });
    expect(group).toEqual({ kind: 'bouncePair', statementLineId: 'C2', counterpartLineId: 'B3', choiceSource: 'user' });
  });

  it('without AI data the ambiguous pair cannot be ticked, so Excluir never sends it', () => {
    renderModal({ groups: [AMBIGUOUS] });
    expect(checkInput('bp-amb')).toBeDisabled();
    fireEvent.click(check('bp-amb'));
    expect(excludeButton()).toBeDisabled();
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('a stale refusal keeps the pair, drops its AI data (no mark, detector order, unchecked); then it needs the panel', async () => {
    const stale = {
      kind: 'bouncePair', statementLineId: 'C2', counterpartLineId: 'B3', code: 'BOUNCE_AI_SUGGESTION_STALE',
      error: { status: 409, code: 'BOUNCE_AI_SUGGESTION_STALE', message: 'stale', messageKeys: ['ETGO_BounceAiSuggestionStale'] },
    };
    applyMock.mockResolvedValueOnce({ results: [stale] });
    renderModal({ groups: [AMBIGUOUS], bounceAiAssessments: AI_AMB });
    fireEvent.click(check('bp-amb'));
    fireEvent.click(excludeButton());
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByTestId('automatch-bounce-row-bp-amb')).toBeInTheDocument();
    expect(screen.queryByTestId('automatch-bounce-ai-pct-bp-amb')).toBeNull();
    expect(screen.getByTestId('automatch-bounce-original-bp-amb')).toHaveTextContent('Pago ACME 1');
    expect(checkInput('bp-amb')).toHaveAttribute('aria-checked', 'false');
    // No AI data left: the row cannot be ticked again until its outflow is picked in the panel.
    expect(checkInput('bp-amb')).toBeDisabled();
    expect(applyMock).toHaveBeenCalledTimes(1);
  });

  it('"Conciliar seleccionadas" reports the same bounceDecisions with the AI data present', async () => {
    renderModal({ bounceAiAssessments: { ...AI_AMB, ...AI_REVIEW } });
    await clickApply();
    const body = applyMock.mock.calls[0][0];
    expect(body.groups.every((g) => g.kind !== 'bouncePair')).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/choiceSource|bounceAiAssessments|probabilit/);
  });
});

// ---------------------------------------------------------------------------
// ETP-6359 — outflows shared between rows, panel picks and the LINE_NOT_PENDING reload, with the
// selection the financial-account host really owns (useAutoMatchReview), not a stub.
// ---------------------------------------------------------------------------

const SO1 = { id: 'SO1', description: 'Salida compartida 1', amount: -50, date: '2026-05-01', referenceNo: 'R-SO1' };
const SO2 = { id: 'SO2', description: 'Salida compartida 2', amount: -50, date: '2026-05-02', referenceNo: 'R-SO2' };
const sharedPair = (key, bounceId) => ({
  kind: 'bouncePair', groupKey: key, origin: 'bounce', confidence: 'review', signal: 'counterparty',
  signals: ['counterparty'], ambiguous: true, statementLine: null,
  counterpartLine: { id: bounceId, description: `Abono ${bounceId}`, amount: 50, date: '2026-05-06' },
  candidates: [{ line: SO1 }, { line: SO2 }], operations: [], isNew: false, difference: 0,
});
const SA = sharedPair('bp-sa', 'SB-A');
const SB = sharedPair('bp-sb', 'SB-B');
const SC = sharedPair('bp-sc', 'SB-C');
const recommendSO1 = (bounceId) => ({ [bounceId]: { probabilities: { SO1: 70, SO2: 20 }, none: 10, recommendedLineId: 'SO1' } });
const SHARED_AI = { ...recommendSO1('SB-A'), ...recommendSO1('SB-B'), ...recommendSO1('SB-C') };
const shownDesc = (key) => screen.getByTestId(`automatch-bounce-original-${key}-desc`).textContent;
const okPair = (statementLineId, counterpartLineId) => ({ kind: 'bouncePair', statementLineId, counterpartLineId, discarded: true });
const lineNotPending = (statementLineId, counterpartLineId) => ({
  kind: 'bouncePair', statementLineId, counterpartLineId, code: 'LINE_NOT_PENDING', message: 'Refused',
  error: { status: 409, code: 'LINE_NOT_PENDING', message: 'Refused', messageKeys: ['ETGO_BounceLineNotPending'] },
});

/** The modal under the host's own review state; `picks` are panel picks made before it opens. */
function ReviewHost({ groups, ai = null, picks = [], ...rest }) {
  const review = useAutoMatchReview(groups, { bounceAiAssessments: ai });
  const { pickOutflow } = review;
  useEffect(() => {
    for (const [bounceId, line] of picks) pickOutflow(bounceId, line);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AutoMatchSuggestionModal
      accountId="acc-1" accountName="Banco Santander" groups={groups} kpis={KPIS_ON} currency="EUR" open
      selection={review.selection} dismissedPairKeys={review.dismissedKeys} bounceAiAssessments={ai}
      {...rest} />
  );
}
function renderHost(props) {
  const callbacks = { onClose: vi.fn(), onSuccess: vi.fn(), onChanged: vi.fn() };
  return { ...render(<ReviewHost {...callbacks} {...props} />), props: callbacks };
}
async function exclude() {
  fireEvent.click(excludeButton());
  await vi.waitFor(() => expect(applyMock).toHaveBeenCalled());
  return applyMock.mock.calls.at(-1)[0].groups;
}

describe('AutoMatchSuggestionModal — rows sharing an outflow (host selection)', () => {
  it('ticking a row moves the other row to the free outflow, and "Excluir" sends different outflows', async () => {
    applyMock.mockResolvedValue({ results: [okPair('SO1', 'SB-A'), okPair('SO2', 'SB-B')] });
    renderHost({ groups: [SA, SB], ai: SHARED_AI });
    expect(shownDesc('bp-sa')).toBe('Salida compartida 1');
    expect(shownDesc('bp-sb')).toBe('Salida compartida 1');

    fireEvent.click(check('bp-sa'));
    expect(shownDesc('bp-sb')).toBe('Salida compartida 2');
    // The moved row's meta names the outflow it now shows.
    expect(meta('original', 'bp-sb')).toHaveTextContent(refText('R-SO2'));
    fireEvent.click(check('bp-sb'));
    expect(excludeButton()).toHaveTextContent('financeReconcileAutomatchBounceExclude:{"count":2}');

    expect(await exclude()).toEqual([
      { kind: 'bouncePair', statementLineId: 'SO1', counterpartLineId: 'SB-A', choiceSource: 'ai' },
      { kind: 'bouncePair', statementLineId: 'SO2', counterpartLineId: 'SB-B', choiceSource: 'user' },
    ]);
  });

  it('a row left with no free outflow is disabled with its reason; unticking a holder restores it', () => {
    renderHost({ groups: [SA, SB, SC], ai: SHARED_AI });
    fireEvent.click(check('bp-sa'));
    fireEvent.click(check('bp-sb'));
    expect(checkInput('bp-sc')).toBeDisabled();
    expect(checkInput('bp-sc')).toHaveAccessibleName('financeReconcileAutomatchBounceOutflowTaken');
    // Names no outflow: every one it could take is held by a checked row (ETP-6359 N2).
    expect(shownDesc('bp-sc')).toBe('—');
    fireEvent.click(check('bp-sc'));
    expect(checkInput('bp-sc')).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(check('bp-sb'));
    expect(checkInput('bp-sc')).not.toBeDisabled();
    expect(checkInput('bp-sc')).toHaveAccessibleName('financeReconcileAutomatchBounceCheck');
    expect(shownDesc('bp-sc')).toBe('Salida compartida 2');
  });

  it('select-all checks the rows that fit and leaves the one without an outflow unchecked and disabled', async () => {
    applyMock.mockResolvedValue({ results: [okPair('SO1', 'SB-A'), okPair('SO2', 'SB-B')] });
    renderHost({ groups: [SA, SB, SC], ai: SHARED_AI });
    fireEvent.click(screen.getByTestId('automatch-bounce-select-all'));
    expect(excludeButton()).toHaveTextContent('financeReconcileAutomatchBounceExclude:{"count":2}');
    expect(checkInput('bp-sa')).toHaveAttribute('aria-checked', 'true');
    expect(checkInput('bp-sb')).toHaveAttribute('aria-checked', 'true');
    expect(checkInput('bp-sc')).toHaveAttribute('aria-checked', 'false');
    expect(checkInput('bp-sc')).toBeDisabled();
    expect((await exclude()).map((g) => g.statementLineId)).toEqual(['SO1', 'SO2']);
  });

  it('an excluded pair keeps its outflow: the row that stays does not move back onto it', async () => {
    applyMock.mockResolvedValueOnce({ results: [okPair('SO1', 'SB-A')] });
    renderHost({ groups: [SA, SB], ai: SHARED_AI });
    fireEvent.click(check('bp-sa'));
    await exclude();
    await vi.waitFor(() => expect(screen.queryByTestId('automatch-bounce-row-bp-sa')).toBeNull());
    expect(shownDesc('bp-sb')).toBe('Salida compartida 2');

    applyMock.mockResolvedValueOnce({ results: [okPair('SO2', 'SB-B')] });
    fireEvent.click(check('bp-sb'));
    expect(await exclude()).toEqual([
      { kind: 'bouncePair', statementLineId: 'SO2', counterpartLineId: 'SB-B', choiceSource: 'user' },
    ]);
  });
});

describe('AutoMatchSuggestionModal — the outflow picked in the panel (host selection)', () => {
  it('a pick of another candidate is shown and sent with "user"', async () => {
    applyMock.mockResolvedValue({ results: [okPair('SO2', 'SB-A')] });
    renderHost({ groups: [SA], ai: SHARED_AI, picks: [['SB-A', SO2]] });
    expect(shownDesc('bp-sa')).toBe('Salida compartida 2');
    fireEvent.click(check('bp-sa'));
    expect(await exclude()).toEqual([
      { kind: 'bouncePair', statementLineId: 'SO2', counterpartLineId: 'SB-A', choiceSource: 'user' },
    ]);
  });

  it('a pick another checked row already holds gives way: the row shows and sends the next free outflow', async () => {
    applyMock.mockResolvedValue({ results: [okPair('SO1', 'SB-A'), okPair('SO2', 'SB-B')] });
    renderHost({ groups: [SA, SB], ai: SHARED_AI, picks: [['SB-B', SO1]] });
    fireEvent.click(check('bp-sa'));
    expect(shownDesc('bp-sb')).toBe('Salida compartida 2');
    fireEvent.click(check('bp-sb'));
    expect(await exclude()).toEqual([
      { kind: 'bouncePair', statementLineId: 'SO1', counterpartLineId: 'SB-A', choiceSource: 'ai' },
      { kind: 'bouncePair', statementLineId: 'SO2', counterpartLineId: 'SB-B', choiceSource: 'user' },
    ]);
  });

  it('a no-AI ambiguous pair is disabled until its outflow is picked; then it is ticked and sent with "user"', async () => {
    const { unmount } = renderHost({ groups: [AMBIGUOUS] });
    expect(checkInput('bp-amb')).toBeDisabled();
    expect(checkInput('bp-amb')).toHaveAccessibleName('financeReconcileAutomatchBounceAmbiguousCheck');
    expect(box('automatch-bounce-select-all')).toBeDisabled();
    unmount();

    applyMock.mockResolvedValue({ results: [okPair('C2', 'B3')] });
    renderHost({ groups: [AMBIGUOUS], picks: [['B3', AMBIGUOUS.candidates[1].line]] });
    expect(checkInput('bp-amb')).not.toBeDisabled();
    expect(checkInput('bp-amb')).toHaveAccessibleName('financeReconcileAutomatchBounceCheck');
    expect(shownDesc('bp-amb')).toBe('Pago ACME 2');
    fireEvent.click(check('bp-amb'));
    expect(await exclude()).toEqual([
      { kind: 'bouncePair', statementLineId: 'C2', counterpartLineId: 'B3', choiceSource: 'user' },
    ]);
  });

  it('a single-original pair re-paired in the panel is shown and sent with the picked outflow', async () => {
    const other = { id: 'OX', description: 'Otra salida', amount: -60, date: '2026-04-28' };
    applyMock.mockResolvedValue({ results: [okPair('OX', 'B2')] });
    renderHost({ groups: [REVIEW], picks: [['B2', other]] });
    expect(shownDesc('bp-review')).toBe('Otra salida');
    fireEvent.click(check('bp-review'));
    expect(await exclude()).toEqual([
      { kind: 'bouncePair', statementLineId: 'OX', counterpartLineId: 'B2', choiceSource: 'user' },
    ]);
  });
});

describe('AutoMatchSuggestionModal — a LINE_NOT_PENDING refusal asks the host to reload the suggestions', () => {
  it('a partial exclusion with one LINE_NOT_PENDING calls onChanged({ reloadSuggestions: true }) once', async () => {
    applyMock.mockResolvedValue({ results: [okPair('SO1', 'SB-A'), lineNotPending('SO2', 'SB-B')] });
    const { props } = renderHost({ groups: [SA, SB], ai: SHARED_AI });
    fireEvent.click(check('bp-sa'));
    fireEvent.click(check('bp-sb'));
    await exclude();
    await vi.waitFor(() => expect(props.onChanged).toHaveBeenCalled());
    // Exactly one call, the reload one: no second plain onChanged() for the pair that was excluded.
    expect(props.onChanged.mock.calls).toEqual([[{ reloadSuggestions: true }]]);
    expect(screen.queryByTestId('automatch-bounce-row-bp-sa')).toBeNull();
  });

  it('also when nothing was excluded (every pair refused as not pending)', async () => {
    applyMock.mockResolvedValue({ results: [lineNotPending('O2', 'B2')] });
    const { props } = renderModal({ groups: [REVIEW] });
    fireEvent.click(check('bp-review'));
    await exclude();
    await vi.waitFor(() => expect(props.onChanged).toHaveBeenCalledWith({ reloadSuggestions: true }));
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('automatch-bounce-row-bp-review')).toBeInTheDocument();
  });

  it('another refusal (HAS_PAYMENT) with nothing excluded does not ask for a reload', async () => {
    applyMock.mockResolvedValue({
      results: [{
        kind: 'bouncePair', statementLineId: 'O2', counterpartLineId: 'B2', code: 'HAS_PAYMENT', message: 'Refused',
        error: { status: 409, code: 'HAS_PAYMENT', message: 'Refused', messageKeys: ['ETGO_BounceHasPayment'] },
      }],
    });
    const { props } = renderModal({ groups: [REVIEW] });
    fireEvent.click(check('bp-review'));
    await exclude();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(props.onChanged).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ETP-6359 (final rule): ticks pin their outflow, a panel pick releases what it contradicts, a
// no-AI pick held by another row shows no outflow, and a panel pick is always "user".
// ---------------------------------------------------------------------------

describe('AutoMatchSuggestionModal — pinned ticks and panel picks (host selection)', () => {
  it('tick a, tick b, untick a: b keeps its outflow and "Excluir" sends it', async () => {
    applyMock.mockResolvedValue({ results: [okPair('SO2', 'SB-B')] });
    renderHost({ groups: [SA, SB], ai: SHARED_AI });
    fireEvent.click(check('bp-sa'));
    fireEvent.click(check('bp-sb'));
    fireEvent.click(check('bp-sa'));
    expect(checkInput('bp-sb')).toHaveAttribute('aria-checked', 'true');
    expect(shownDesc('bp-sb')).toBe('Salida compartida 2');
    expect(shownDesc('bp-sa')).toBe('Salida compartida 1');
    expect(await exclude()).toEqual([
      { kind: 'bouncePair', statementLineId: 'SO2', counterpartLineId: 'SB-B', choiceSource: 'user' },
    ]);
  });

  it('select-all in reverse modal order still never gives two rows the same outflow', async () => {
    applyMock.mockResolvedValue({ results: [okPair('SO1', 'SB-C'), okPair('SO2', 'SB-B')] });
    renderHost({ groups: [SC, SB, SA], ai: SHARED_AI });
    fireEvent.click(screen.getByTestId('automatch-bounce-select-all'));
    expect(checkInput('bp-sc')).toHaveAttribute('aria-checked', 'true');
    expect(checkInput('bp-sb')).toHaveAttribute('aria-checked', 'true');
    expect(checkInput('bp-sa')).toBeDisabled();
    const sent = await exclude();
    expect(sent.map((g) => [g.counterpartLineId, g.statementLineId])).toEqual([['SB-C', 'SO1'], ['SB-B', 'SO2']]);
  });

  it('a panel pick equal to the AI recommendation is sent as "user"', async () => {
    applyMock.mockResolvedValue({ results: [okPair('SO1', 'SB-A')] });
    renderHost({ groups: [SA], ai: SHARED_AI, picks: [['SB-A', SO1]] });
    fireEvent.click(check('bp-sa'));
    expect(await exclude()).toEqual([
      { kind: 'bouncePair', statementLineId: 'SO1', counterpartLineId: 'SB-A', choiceSource: 'user' },
    ]);
  });

  it('a default-checked pair re-picked in the panel comes back unchecked, showing the pick', () => {
    const other = { id: 'OX', description: 'Otra salida', amount: -120, date: '2026-04-28' };
    renderHost({ groups: [HIGH, REVIEW], picks: [['B1', other]] });
    expect(checkInput('bp-high')).toHaveAttribute('aria-checked', 'false');
    expect(shownDesc('bp-high')).toBe('Otra salida');
    expect(excludeButton()).toBeDisabled();
  });

  it('a pick equal to a default-checked pair\'s own original keeps it checked, sent with no source', async () => {
    applyMock.mockResolvedValue({ results: [okPair('O1', 'B1')] });
    renderHost({ groups: [HIGH], picks: [['B1', HIGH.statementLine]] });
    expect(checkInput('bp-high')).toHaveAttribute('aria-checked', 'true');
    expect(await exclude()).toEqual([{ kind: 'bouncePair', statementLineId: 'O1', counterpartLineId: 'B1' }]);
  });

  it('a no-AI row whose panel pick another checked row holds shows "—" and the amount, disabled as OutflowTaken', () => {
    renderHost({ groups: [SA, SB], picks: [['SB-A', SO1], ['SB-B', SO1]] });
    // The later pick (SB-B → SO1) released nothing yet: neither row was checked.
    fireEvent.click(check('bp-sa'));
    expect(checkInput('bp-sa')).toHaveAttribute('aria-checked', 'true');
    expect(checkInput('bp-sb')).toBeDisabled();
    expect(checkInput('bp-sb')).toHaveAccessibleName('financeReconcileAutomatchBounceOutflowTaken');
    const side = screen.getByTestId('automatch-bounce-original-bp-sb');
    expect(shownDesc('bp-sb')).toBe('—');
    expect(side).toHaveTextContent('-50');
    expect(side).not.toHaveTextContent('Salida compartida');
  });

  it('the AI data turning null: a row with a panel pick keeps its check, the others are disabled', () => {
    // The same groups array: a new one is a reload, which resets every check.
    const trio = [SA, SB, SC];
    const { rerender } = render(
      <ReviewHost groups={trio} ai={SHARED_AI} picks={[['SB-B', SO2]]} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    fireEvent.click(check('bp-sa'));
    fireEvent.click(check('bp-sb'));
    rerender(<ReviewHost groups={trio} ai={null} picks={[['SB-B', SO2]]} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(checkInput('bp-sb')).toHaveAttribute('aria-checked', 'true');
    expect(checkInput('bp-sa')).toHaveAttribute('aria-checked', 'false');
    expect(checkInput('bp-sa')).toBeDisabled();
    expect(checkInput('bp-sa')).toHaveAccessibleName('financeReconcileAutomatchBounceAmbiguousCheck');
    expect(checkInput('bp-sc')).toBeDisabled();
    expect(excludeButton()).toHaveTextContent('financeReconcileAutomatchBounceExclude:{"count":1}');
  });
});

describe('AutoMatchSuggestionModal — the label of a no-AI ambiguous row that cannot be ticked', () => {
  // Two single-original pairs whose originals are the two outflows the ambiguous rejections list.
  const single = (key, line, bounceId) => ({
    kind: 'bouncePair', groupKey: key, origin: 'bounce', confidence: 'review', signal: 'return_text',
    signals: ['return_text'], ambiguous: false, statementLine: line,
    counterpartLine: { id: bounceId, description: `RECHAZO ${bounceId}`, amount: 50, date: '2026-05-06' },
    operations: [], isNew: false, difference: 0,
  });
  const P1 = single('bp-p1', SO1, 'X1');
  const P2 = single('bp-p2', SO2, 'X2');

  it('no AI, no pick, every candidate held by a checked row: it still says to choose in the panel', () => {
    renderHost({ groups: [P1, P2, SC] });
    fireEvent.click(check('bp-p1'));
    fireEvent.click(check('bp-p2'));
    expect(checkInput('bp-sc')).toBeDisabled();
    expect(checkInput('bp-sc')).toHaveAccessibleName('financeReconcileAutomatchBounceAmbiguousCheck');
  });

  it('no AI, with a panel pick another checked row holds: it says the outflow is taken', () => {
    renderHost({ groups: [P1, SC], picks: [['SB-C', SO1]] });
    fireEvent.click(check('bp-p1'));
    expect(checkInput('bp-sc')).toBeDisabled();
    expect(checkInput('bp-sc')).toHaveAccessibleName('financeReconcileAutomatchBounceOutflowTaken');
  });
});
