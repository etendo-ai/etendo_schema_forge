// @covers artifacts/remittance/custom/RemittanceReturnDialog.jsx
// @covers artifacts/remittance/custom/remittanceFileApi.js
//
// ETP-6247 returns: the «Devolver» dialog reads returnState + the lines, picks them (search, select
// all, a shared payment whole) and posts returnLines. Real ActionChoiceModal, InfoBanner,
// remittanceFileApi, formatCurrency / dateOnly; only useApiFetch and the toasts are mocked.
const mockApiFetch = vi.fn();
vi.mock('@/auth/useApiFetch.js', () => ({ useApiFetch: () => mockApiFetch }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
// The shared DateField has its own locale context and typed-input masking; stubbed to a plain input
// that commits an ISO day, which is what the dialog consumes (`onChange(iso)`).
vi.mock('@/components/ui/date-field', () => ({
  DateField: ({ value, onChange, disabled, id, 'data-testid': testId }) => (
    <input id={id} data-testid={testId} data-shared="date-field" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
const mockUi = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);
vi.mock('@/i18n', () => ({ useUI: () => mockUi, useLocaleSwitch: () => ({ locale: 'es-ES' }) }));

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { toast } from 'sonner';
import RemittanceReturnDialog, {
  groupReturnLines, returnGroupSummary, selectAllReturnable, toggleReturnSelection,
} from '@generated/remittance/custom/RemittanceReturnDialog.jsx';
import { normalizeReturnState, returnProblemsFromError } from '@generated/remittance/custom/remittanceFileApi.js';
import { todayCalendarISO } from '@/lib/dateOnly.js';

const LINES = [
  { id: 'l1', invoiceDocumentNo: 'F-1', 'businessPartner$_identifier': 'Acme', amount: 10, currency: 'EUR' },
  { id: 'l2', invoiceDocumentNo: 'F-2', 'businessPartner$_identifier': 'Acme', amount: 20, currency: 'EUR' },
  { id: 'l3', invoiceDocumentNo: 'F-3', 'businessPartner$_identifier': 'Beta', amount: 5, currency: 'EUR' },
  { id: 'l4', invoiceDocumentNo: 'F-4', 'businessPartner$_identifier': 'Beta', amount: 7, currency: 'EUR' },
  { id: 'l5', invoiceDocumentNo: 'F-5', 'businessPartner$_identifier': 'Gamma', amount: 9, currency: 'EUR' },
  { id: 'l6', invoiceDocumentNo: 'F-6', 'businessPartner$_identifier': 'Delta', amount: 3, currency: 'EUR' },
];
const STATE = {
  collection: true, hasReturns: true,
  lines: {
    l1: { state: 'SETTLED', returnable: true, paymentId: 'p1', paymentLineIds: ['l1', 'l2'] },
    l2: { state: 'SETTLED', returnable: true, paymentId: 'p1', paymentLineIds: ['l1', 'l2'] },
    l3: { state: 'RETURNED', returnable: false, reasonCode: 'ALREADY_RETURNED', returnDate: '2026-11-10', paymentLineIds: ['l3'] },
    l4: { state: 'SETTLED', returnable: false, reasonCode: 'RECONCILED', paymentLineIds: ['l4'] },
    l5: { state: 'PROCESSED', returnable: false, reasonCode: 'NOT_SETTLED', paymentLineIds: ['l5'] },
    l6: { state: 'SETTLED', returnable: true, paymentId: 'p6', paymentLineIds: ['l6'] },
  },
};
const json = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });
const data = (payload) => json({ response: { data: payload } });

function routes({ state = data(STATE), lines = data(LINES), ret = data({ status: 'CP', returned: ['l1', 'l2'] }) } = {}) {
  mockApiFetch.mockImplementation((url) => {
    if (url.endsWith('/action/returnState')) return Promise.resolve(state);
    if (url.endsWith('/action/returnLines')) return Promise.resolve(ret);
    if (url.startsWith('/lines?')) return Promise.resolve(lines);
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}
const returnCalls = () => mockApiFetch.mock.calls.filter(([url]) => url.endsWith('/action/returnLines'));
const submit = () => screen.getByTestId('action-confirm-modal');
// The shared Checkbox puts the testid on its <label>; the state lives on the hidden input inside.
const boxes = () => screen.getAllByTestId('remittance-return-check').map((label) => within(label).getByRole('checkbox'));
const checks = boxes;

async function renderDialog() {
  const onRefresh = vi.fn();
  const onClose = vi.fn();
  const utils = render(<RemittanceReturnDialog record={{ id: 'rem-1' }} apiBaseUrl="/api" onRefresh={onRefresh} onClose={onClose} />);
  await act(async () => {});
  return { ...utils, onRefresh, onClose };
}

beforeEach(() => { vi.clearAllMocks(); mockApiFetch.mockReset(); });

describe('helpers', () => {
  it('normalizeReturnState defaults the payment group to the line itself and reads the flags', () => {
    expect(normalizeReturnState({ collection: true, hasReturns: false, lines: { a: { state: 'SETTLED', returnable: true } } }))
      .toEqual({ collection: true, hasReturns: false, lines: { a: { state: 'SETTLED', returnable: true, reasonCode: null, returnDate: null, paymentId: null, paymentLineIds: ['a'] } } });
    expect(normalizeReturnState(null)).toEqual({ collection: false, hasReturns: false, lines: {} });
  });

  it('toggleReturnSelection selects and clears a whole payment group', () => {
    const state = normalizeReturnState(STATE);
    const on = toggleReturnSelection(new Set(), state, 'l1');
    expect([...on].sort()).toEqual(['l1', 'l2']);
    expect(toggleReturnSelection(on, state, 'l2').size).toBe(0);
    // A bank-instruction row hands all of its lines at once.
    expect([...toggleReturnSelection(new Set(), state, ['l1', 'l2', 'l6'])].sort()).toEqual(['l1', 'l2', 'l6']);
  });

  it('selectAllReturnable takes only returnable lines, with their payment siblings', () => {
    const state = normalizeReturnState(STATE);
    expect([...selectAllReturnable(state, ['l1', 'l3', 'l4', 'l6'])].sort()).toEqual(['l1', 'l2', 'l6']);
  });

  it('returnProblemsFromError reads error.problems, or nothing', () => {
    expect(returnProblemsFromError({ body: { error: { problems: [{ lineId: 'l1', reasonCode: 'POSTED', documentNo: 'F-1', message: 'm' }] } } }))
      .toEqual([{ lineId: 'l1', reasonCode: 'POSTED', documentNo: 'F-1', message: 'm' }]);
    expect(returnProblemsFromError(new Error('x'))).toEqual([]);
  });
});

describe('RemittanceReturnDialog', () => {
  it('lists one row per bank instruction: returnable ones enabled, the rest disabled with the translated reason, none hidden', async () => {
    routes();
    await renderDialog();
    // l1 + l2 share payment p1: one instruction, one row.
    expect(screen.getAllByTestId('remittance-return-line')).toHaveLength(5);
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-disabled'))).toEqual(['false', 'true', 'true', 'true', 'false']);
    expect(checks().map((c) => c.disabled)).toEqual([false, true, true, true, false]);
    const notes = screen.getAllByTestId('remittance-return-note').map((n) => n.textContent);
    expect(notes[0]).toContain('remittanceReturnReturnedOn');
    expect(notes).toContain('remittanceReturnReasonReconciled');
    expect(notes).toContain('remittanceReturnReasonNotSettled');
    expect(submit()).toBeDisabled();
  });

  it('a payment remittance shows the reason and offers no list', async () => {
    routes({ state: data({ ...STATE, collection: false }) });
    await renderDialog();
    expect(screen.getByTestId('remittance-return-not-collection')).toHaveTextContent('remittanceReturnReasonNotCollection');
    expect(screen.queryByTestId('remittance-return-lines')).toBeNull();
    expect(submit()).toBeDisabled();
  });

  it('a failed read keeps the primary disabled and says so', async () => {
    routes({ state: json({}, { ok: false, status: 500 }) });
    await renderDialog();
    expect(screen.getByTestId('remittance-return-load-error')).toHaveTextContent('remittanceReturnLoadError');
    expect(submit()).toBeDisabled();
  });

  it('ticking a shared payment selects both its lines, and the summary counts one instruction', async () => {
    routes();
    await renderDialog();
    fireEvent.click(checks()[0]);
    expect(checks()[0]).toBeChecked();
    expect(screen.getByTestId('remittance-return-count')).toHaveTextContent('1');
    expect(submit()).toBeEnabled();
  });

  it('select all takes every returnable line, and clears again', async () => {
    routes();
    await renderDialog();
    expect(screen.getByTestId('remittance-return-select-all')).toHaveTextContent('selectAll');
    fireEvent.click(screen.getByTestId('remittance-return-select-all'));
    expect(checks().filter((c) => c.checked)).toHaveLength(2);
    expect(screen.getByTestId('remittance-return-select-all')).toHaveTextContent('deselectAll');
    fireEvent.click(screen.getByTestId('remittance-return-select-all'));
    expect(checks().some((c) => c.checked)).toBe(false);
  });

  it('the search box filters by invoice or partner', async () => {
    routes();
    await renderDialog();
    fireEvent.change(screen.getByTestId('remittance-return-search'), { target: { value: 'beta' } });
    expect(screen.getAllByTestId('remittance-return-line')).toHaveLength(2);
    fireEvent.change(screen.getByTestId('remittance-return-search'), { target: { value: 'F-6' } });
    expect(screen.getAllByTestId('remittance-return-line')).toHaveLength(1);
  });

  it('posts the group with today by default, toasts, refreshes and closes', async () => {
    routes();
    const { onRefresh, onClose } = await renderDialog();
    expect(screen.getByTestId('remittance-return-date')).toHaveValue(todayCalendarISO());
    expect(screen.getByTestId('remittance-return-warning')).toHaveTextContent('remittanceReturnWarning');
    fireEvent.click(checks()[0]);
    await act(async () => { fireEvent.click(submit()); });
    expect(returnCalls()[0][0]).toBe('/remittance/rem-1/action/returnLines');
    expect(JSON.parse(returnCalls()[0][1].body)).toEqual({ fieldValues: { lineIds: ['l1', 'l2'], returnDate: todayCalendarISO() } });
    expect(toast.success).toHaveBeenCalledWith('remittanceReturnSuccess:{"count":1}');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the shared controls: DateField, no choice card, no question', async () => {
    routes();
    await renderDialog();
    expect(screen.getByTestId('remittance-return-date')).toHaveAttribute('data-shared', 'date-field');
    expect(screen.queryByTestId('remittance-return-option')).toBeNull();
    expect(screen.queryByText('remittanceReturnQuestion')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('clicking a returnable row toggles it; a disabled row does nothing', async () => {
    routes();
    await renderDialog();
    const rows = screen.getAllByRole('option');
    fireEvent.click(rows[0]);
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(rows[2]);
    expect(rows[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('a future date disables the primary button', async () => {
    routes();
    await renderDialog();
    fireEvent.click(checks()[0]);
    fireEvent.change(screen.getByTestId('remittance-return-date'), { target: { value: '2999-01-01' } });
    expect(submit()).toBeDisabled();
    expect(screen.getByTestId('remittance-return-date-error')).toHaveTextContent('remittanceReturnDateFuture');
  });

  it('a 422 ETGO_RemittanceReturnNotAllowed lists error.problems and keeps the dialog open', async () => {
    routes({ ret: json({ error: { message: 'No se puede devolver.', messageKeys: ['ETGO_RemittanceReturnNotAllowed'],
      problems: [{ lineId: 'l1', reasonCode: 'POSTED', documentNo: 'F-1', message: 'F-1 está contabilizada' }] } }, { ok: false, status: 422 }) });
    const { onRefresh, onClose } = await renderDialog();
    fireEvent.click(checks()[0]);
    await act(async () => { fireEvent.click(submit()); });
    expect(screen.getByTestId('remittance-return-problems')).toHaveTextContent('F-1 está contabilizada');
    expect(toast.error).toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('remittance-return-dialog')).toBeInTheDocument();
  });
  it('words a returned line «Devuelta el {date}» with its day in the locale, or plain «Devuelta» without a date', async () => {
    routes({ state: data({ ...STATE, lines: { ...STATE.lines, l4: { state: 'RETURNED', returnable: false, reasonCode: 'ALREADY_RETURNED', paymentLineIds: ['l4'] } } }) });
    await renderDialog();
    const rows = screen.getAllByTestId('remittance-return-line');
    expect(within(rows[1]).getByTestId('remittance-return-note')).toHaveTextContent('remittanceReturnReturnedOn:{"date":"10/11/2026"}');
    expect(within(rows[2]).getByTestId('remittance-return-note').textContent).toBe('remittanceReturnReturned');
  });

  it('maps every reason code to its own translated note, and an unknown code to «not collected yet»', async () => {
    const mk = (id, reasonCode) => [id, { state: 'SETTLED', returnable: false, reasonCode, paymentLineIds: [id] }];
    routes({ state: data({ collection: true, hasReturns: false, lines: Object.fromEntries([
      mk('l1', 'NOT_PROCESSED'), mk('l2', 'NOT_SETTLED'), mk('l3', 'NOT_A_COLLECTION'), mk('l4', 'POSTED'), mk('l5', 'RECONCILED'), mk('l6', 'SOMETHING_NEW'),
    ]) }) });
    await renderDialog();
    expect(screen.getAllByTestId('remittance-return-note').map((n) => n.textContent)).toEqual([
      'remittanceReturnReasonNotProcessed', 'remittanceReturnReasonNotSettled', 'remittanceReturnReasonNotCollection',
      'remittanceReturnReasonPosted', 'remittanceReturnReasonReconciled', 'remittanceReturnReasonNotSettled',
    ]);
    expect(screen.getAllByTestId('remittance-return-line').map((r) => r.dataset.code)).toContain('SOMETHING_NEW');
  });

  it('a line the state does not know is listed disabled, not hidden', async () => {
    routes({ state: data({ collection: true, hasReturns: false, lines: { l1: STATE.lines.l1, l2: STATE.lines.l2 } }) });
    await renderDialog();
    expect(screen.getAllByTestId('remittance-return-line')).toHaveLength(5);
    expect(checks().map((c) => c.disabled)).toEqual([false, true, true, true, true]);
  });

  it('a search with no match lists nothing and disables select all', async () => {
    routes();
    await renderDialog();
    fireEvent.change(screen.getByTestId('remittance-return-search'), { target: { value: 'zzz' } });
    expect(screen.queryAllByTestId('remittance-return-line')).toHaveLength(0);
    expect(screen.getByTestId('remittance-return-select-all')).toBeDisabled();
  });

  it('select all while searching takes only the visible returnable lines (and their payment siblings)', async () => {
    routes();
    await renderDialog();
    fireEvent.change(screen.getByTestId('remittance-return-search'), { target: { value: 'F-6' } });
    fireEvent.click(screen.getByTestId('remittance-return-select-all'));
    expect(screen.getByTestId('remittance-return-count')).toHaveTextContent('1');
    fireEvent.change(screen.getByTestId('remittance-return-search'), { target: { value: '' } });
    expect(checks().filter((c) => c.checked)).toHaveLength(1);
  });

  it('keeps the selection when a search hides it, and still returns it', async () => {
    routes();
    await renderDialog();
    fireEvent.click(checks()[0]);
    fireEvent.change(screen.getByTestId('remittance-return-search'), { target: { value: 'beta' } });
    expect(screen.getByTestId('remittance-return-count')).toHaveTextContent('1');
    expect(submit()).toBeEnabled();
  });

  it('shows the selected total with the currency of the lines', async () => {
    routes();
    await renderDialog();
    fireEvent.click(checks()[0]);
    expect(screen.getByTestId('remittance-return-total').textContent).toMatch(/30,00/);
  });

  it('with more than 50 lines the list stays one scrollable box, search narrows it and select all takes every returnable one', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, invoiceDocumentNo: `INV-${i}`, 'businessPartner$_identifier': i % 2 ? 'Odd SL' : 'Even SL', amount: 1, currency: 'EUR' }));
    const manyState = { collection: true, hasReturns: false, lines: Object.fromEntries(many.map((l) => [l.id, { state: 'SETTLED', returnable: true, paymentLineIds: [l.id] }])) };
    routes({ state: data(manyState), lines: data(many) });
    await renderDialog();
    expect(screen.getAllByTestId('remittance-return-line')).toHaveLength(120);
    expect(screen.getByTestId('remittance-return-lines').className).toMatch(/max-h-56/);
    expect(screen.getByTestId('remittance-return-lines').className).toMatch(/overflow-y-auto/);
    fireEvent.change(screen.getByTestId('remittance-return-search'), { target: { value: 'odd sl' } });
    expect(screen.getAllByTestId('remittance-return-line')).toHaveLength(60);
    fireEvent.change(screen.getByTestId('remittance-return-search'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('remittance-return-select-all'));
    expect(screen.getByTestId('remittance-return-count')).toHaveTextContent('120');
    await act(async () => { fireEvent.click(submit()); });
    expect(JSON.parse(returnCalls()[0][1].body).fieldValues.lineIds).toHaveLength(120);
  });

  it('an impossible or empty date also disables the primary button', async () => {
    routes();
    await renderDialog();
    fireEvent.click(checks()[0]);
    fireEvent.change(screen.getByTestId('remittance-return-date'), { target: { value: '' } });
    expect(submit()).toBeDisabled();
    expect(screen.getByTestId('remittance-return-date-error')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('remittance-return-date'), { target: { value: '2026-11-01' } });
    expect(submit()).toBeEnabled();
    expect(screen.queryByTestId('remittance-return-date-error')).toBeNull();
  });

  it('posts the date the user picked', async () => {
    routes();
    await renderDialog();
    fireEvent.click(checks()[0]);
    fireEvent.change(screen.getByTestId('remittance-return-date'), { target: { value: '2026-11-01' } });
    await act(async () => { fireEvent.click(submit()); });
    expect(JSON.parse(returnCalls()[0][1].body).fieldValues.returnDate).toBe('2026-11-01');
  });

  it('Cancelar closes without any return request', async () => {
    routes();
    const { onClose, onRefresh } = await renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(returnCalls()).toHaveLength(0);
  });

  it('Esc closes without any return request', async () => {
    routes();
    const { onClose } = await renderDialog();
    fireEvent.keyDown(screen.getByTestId('remittance-return-dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(returnCalls()).toHaveLength(0);
  });

  it('Esc does not close while the return is in flight', async () => {
    let release;
    mockApiFetch.mockImplementation((url) => {
      if (url.endsWith('/action/returnState')) return Promise.resolve(data(STATE));
      if (url.startsWith('/lines?')) return Promise.resolve(data(LINES));
      return new Promise((resolve) => { release = () => resolve(data({ status: 'CP', returned: [] })); });
    });
    const { onClose } = await renderDialog();
    fireEvent.click(checks()[0]);
    await act(async () => { fireEvent.click(submit()); });
    fireEvent.keyDown(screen.getByTestId('remittance-return-dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { release(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['ETGO_RemittanceReturnLineNotFound', 'La línea X no es de esta remesa.'],
    ['ETGO_RemittanceReturnDateInvalid', 'La fecha de devolución no es válida.'],
    ['ETGO_RemittanceReturnFailed', 'La devolución falló: causa.'],
  ])('%s toasts the backend sentence, lists no problems and leaves the dialog usable to retry', async (key, message) => {
    routes({ ret: json({ error: { message, messageKeys: [key] } }, { ok: false, status: 422 }) });
    const { onRefresh, onClose } = await renderDialog();
    fireEvent.click(checks()[0]);
    await act(async () => { fireEvent.click(submit()); });
    expect(toast.error).toHaveBeenCalledWith(message);
    expect(screen.queryByTestId('remittance-return-problems')).toBeNull();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(submit()).toBeEnabled();
    expect(checks()[0]).toBeChecked();
    await act(async () => { fireEvent.click(submit()); });
    expect(returnCalls()).toHaveLength(2);
  });

  it('a refusal without text toasts the generic «could not be registered» message', async () => {
    routes({ ret: json({}, { ok: false, status: 500 }) });
    await renderDialog();
    fireEvent.click(checks()[0]);
    await act(async () => { fireEvent.click(submit()); });
    expect(toast.error).toHaveBeenCalledWith('remittanceReturnError');
  });

  it('a payment remittance posts nothing: no list, the note, and no return can be sent', async () => {
    routes({ state: data({ ...STATE, collection: false }) });
    await renderDialog();
    expect(screen.queryByTestId('remittance-return-search')).toBeNull();
    expect(screen.queryByTestId('remittance-return-select-all')).toBeNull();
    await act(async () => { fireEvent.click(submit()); });
    expect(returnCalls()).toHaveLength(0);
  });

  it('a 422 problems list is replaced by the next refusal', async () => {
    const withProblems = json({ error: { message: 'n', problems: [{ lineId: 'l1', message: 'primero' }] } }, { ok: false, status: 422 });
    const without = json({ error: { message: 'x', messageKeys: ['ETGO_RemittanceReturnFailed'] } }, { ok: false, status: 422 });
    let n = 0;
    mockApiFetch.mockImplementation((url) => {
      if (url.endsWith('/action/returnState')) return Promise.resolve(data(STATE));
      if (url.startsWith('/lines?')) return Promise.resolve(data(LINES));
      n += 1;
      return Promise.resolve(n === 1 ? withProblems : without);
    });
    await renderDialog();
    fireEvent.click(checks()[0]);
    await act(async () => { fireEvent.click(submit()); });
    expect(screen.getByTestId('remittance-return-problems')).toHaveTextContent('primero');
    await act(async () => { fireEvent.click(submit()); });
    expect(screen.queryByTestId('remittance-return-problems')).toBeNull();
  });
});

// ETP-6247 — with a grouping (GGP / GGPD) several invoices share ONE payment, one instruction to the bank, and a return
// takes it whole: the dialog lists instructions, not lines.
describe('RemittanceReturnDialog — one row per bank instruction', () => {
  const GROUPED_LINES = [
    { id: 'g1', invoiceDocumentNo: 'FV1', 'businessPartner$_identifier': 'Acme', amount: 10, currency: 'EUR' },
    { id: 'g2', invoiceDocumentNo: 'FV2', 'businessPartner$_identifier': 'Acme', amount: 20.5, currency: 'EUR' },
    { id: 'g3', invoiceDocumentNo: 'FV3', 'businessPartner$_identifier': 'Acme', amount: 4, currency: 'EUR' },
    { id: 's1', invoiceDocumentNo: 'FV9', 'businessPartner$_identifier': 'Beta', amount: 7, currency: 'EUR' },
  ];
  const settled = (paymentId, paymentLineIds) => ({ state: 'SETTLED', returnable: true, paymentId, paymentLineIds });
  const GROUPED_STATE = {
    collection: true, hasReturns: false,
    lines: { g1: settled('pg', ['g1', 'g2', 'g3']), g2: settled('pg', ['g1', 'g2', 'g3']), g3: settled('pg', ['g1', 'g2', 'g3']), s1: settled('ps', ['s1']) },
  };

  it('groupReturnLines makes one group per payment, and a line without payment its own', () => {
    const groups = groupReturnLines([...GROUPED_LINES, { id: 'x' }], normalizeReturnState({ ...GROUPED_STATE, lines: { ...GROUPED_STATE.lines, x: { state: 'PROCESSED', returnable: false, reasonCode: 'NOT_SETTLED' } } }));
    expect(groups.map((g) => g.lineIds)).toEqual([['g1', 'g2', 'g3'], ['s1'], ['x']]);
    expect(groups.map((g) => g.returnable)).toEqual([true, true, false]);
    expect(groups[2].info.reasonCode).toBe('NOT_SETTLED');
  });

  it('returnGroupSummary adds the amounts and says «several» when the partners differ', () => {
    const [group] = groupReturnLines(GROUPED_LINES, normalizeReturnState(GROUPED_STATE));
    expect(returnGroupSummary(group)).toEqual({ documentNos: ['FV1', 'FV2', 'FV3'], partner: 'Acme', amount: 34.5, currency: 'EUR', single: false });
    const mixed = { ...group, lines: [GROUPED_LINES[0], GROUPED_LINES[3]] };
    expect(returnGroupSummary(mixed).partner).toBeNull();
  });

  it('three lines of one payment are one row with the partner, «3 facturas» and the invoices', async () => {
    routes({ state: data(GROUPED_STATE), lines: data(GROUPED_LINES) });
    await renderDialog();
    const rows = screen.getAllByTestId('remittance-return-line');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-lines', '3');
    expect(within(rows[0]).getByTestId('remittance-return-group')).toHaveTextContent('Acme');
    expect(within(rows[0]).getByTestId('remittance-return-group')).toHaveTextContent('remittanceReturnInvoiceCount:{"count":3}');
    const invoices = within(rows[0]).getByTestId('remittance-return-group-invoices');
    expect(invoices).toHaveTextContent('FV1, FV2, FV3');
    expect(invoices).toHaveAttribute('title', 'FV1, FV2, FV3');
    expect(rows[0].textContent).toMatch(/34,50/);
    // A payment with one line reads as before.
    expect(within(rows[1]).queryByTestId('remittance-return-group')).toBeNull();
    expect(rows[1]).toHaveTextContent('FV9 · Beta');
  });

  it('one check selects the three lines; the summary counts one instruction, totals their sum, and the POST sends all three ids', async () => {
    routes({ state: data(GROUPED_STATE), lines: data(GROUPED_LINES), ret: data({ status: 'CP', returned: ['g1', 'g2', 'g3'] }) });
    await renderDialog();
    fireEvent.click(checks()[0]);
    expect(screen.getByTestId('remittance-return-count')).toHaveTextContent('1');
    expect(screen.getByTestId('remittance-return-total').textContent).toMatch(/34,50/);
    await act(async () => { fireEvent.click(submit()); });
    expect(JSON.parse(returnCalls()[0][1].body).fieldValues.lineIds.sort()).toEqual(['g1', 'g2', 'g3']);
    expect(toast.success).toHaveBeenCalledWith('remittanceReturnSuccess:{"count":1}');
  });

  it('the search finds the row by the invoice of any of its lines', async () => {
    routes({ state: data(GROUPED_STATE), lines: data(GROUPED_LINES) });
    await renderDialog();
    fireEvent.change(screen.getByTestId('remittance-return-search'), { target: { value: 'fv2' } });
    const rows = screen.getAllByTestId('remittance-return-line');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-lines', '3');
  });

  it('a payment of several customers reads «Varios clientes»', async () => {
    const lines = [GROUPED_LINES[0], { ...GROUPED_LINES[1], 'businessPartner$_identifier': 'Gamma' }];
    const state = { collection: true, hasReturns: false, lines: { g1: settled('pg', ['g1', 'g2']), g2: settled('pg', ['g1', 'g2']) } };
    routes({ state: data(state), lines: data(lines) });
    await renderDialog();
    expect(screen.getByTestId('remittance-return-group')).toHaveTextContent('remittanceReturnSeveralPartners');
  });

  it('select all takes every line of every returnable instruction', async () => {
    routes({ state: data(GROUPED_STATE), lines: data(GROUPED_LINES) });
    await renderDialog();
    fireEvent.click(screen.getByTestId('remittance-return-select-all'));
    expect(screen.getByTestId('remittance-return-count')).toHaveTextContent('2');
    await act(async () => { fireEvent.click(submit()); });
    expect(JSON.parse(returnCalls()[0][1].body).fieldValues.lineIds.sort()).toEqual(['g1', 'g2', 'g3', 's1']);
  });
});
