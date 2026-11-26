// @covers tools/app-shell/src/windows/custom/conversion-rates/ManualRateDialog.jsx

vi.mock('@/i18n', () => ({
  useLabel: () => (key) => key,
  useMenuLabel: () => (key) => key,
  useUI: () => (key) => key,
  useLocale: () => ({ genericLabels: {}, statuses: {} }),
  useLocaleSwitch: () => ({ locale: 'es_ES', setLocale: vi.fn() }),
}));

// The date-time field has its own suite; here it is a plain input bound to the same props.
vi.mock('@/components/ui/date-time-field', () => ({
  DateTimeField: ({ value, onChange, onBlur, readOnly, suffix, 'data-testid': testId }) => (
    <>
      <input
        data-testid={testId}
        value={value ?? ''}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={onBlur} />
      {suffix ? <span data-testid={`${testId}-suffix`}>{suffix}</span> : null}
    </>
  ),
}));

vi.mock('@/components/contract-ui/CreatableSearchSelect.jsx', () => ({
  CreatableSearchSelect: ({ staticOptions, onChange }) => (
    <div>
      {staticOptions.map((o) => (
        <button key={o.id} type="button" data-testid={`stub-dest-${o.id}`} onClick={() => onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  ),
}));

const api = vi.hoisted(() => ({
  fetchServerClock: vi.fn(),
  fetchManualCurrencyOptions: vi.fn(),
  previewManualRate: vi.fn(),
  createManualCurrency: vi.fn(),
  createManualRate: vi.fn(),
  updateManualRate: vi.fn(),
}));
vi.mock('../conversionRatesApi.js', () => api);

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManualRateDialog, DIALOG_MODES, isEnterSubmitKey } from '../ManualRateDialog.jsx';
import { createZoneView } from '../conversionRatesModel.js';

const SERVER_NOW = '2026-11-20T10:00:00';
const USD = { currencyId: 'usd-id', isoCode: 'USD', name: 'US Dollar', rate: 1.1, validFrom: '2026-11-01T00:00:00' };
const ROW = {
  id: 'rate-1',
  multipleRateBy: 1.1,
  divideRateBy: 0.909091,
  validFromDate: '2026-11-01T00:00:00',
  validToDate: '9999-12-31T00:00:00',
  sMFCRSynced: false,
};
const OK = { res: { ok: true, status: 200 }, data: {} };
const PROPOSAL = {
  res: { ok: true, status: 200 },
  data: { proposal: { forward: { old: 1.1, new: 1.3 }, inverse: { old: 0.909091, new: 0.769231 } } },
};

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/** Calls made by a user action; the debounced live proposal passes an AbortSignal as 3rd argument. */
function submitCalls(mock) {
  return mock.mock.calls.filter((call) => call[2] === undefined);
}

function renderDialog(mode, extra = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const apiFetch = vi.fn();
  render(
    <ManualRateDialog
      open
      mode={mode}
      orgIso="EUR"
      orgName="Euro"
      currency={mode === DIALOG_MODES.NEW_CURRENCY ? undefined : USD}
      row={mode === DIALOG_MODES.EDIT ? ROW : undefined}
      apiFetch={apiFetch}
      onClose={onClose}
      onSaved={onSaved}
      ui={(key) => key}
      {...extra} />,
  );
  return { onSaved, onClose };
}

async function typeRate(user, text) {
  const input = screen.getByTestId('convrate-dialog-rate');
  await user.clear(input);
  await user.type(input, text);
  return input;
}

/** Fills the dialog so it can be submitted (the edit mode changes the rate 1,1 → 1,3). */
async function fillValid(user, mode) {
  if (mode === DIALOG_MODES.NEW_CURRENCY) {
    await user.click(await screen.findByTestId('stub-dest-gbp-id'));
  }
  // The server clock answer replaces "Válido desde"; wait for it so it cannot land mid-test.
  if (mode !== DIALOG_MODES.EDIT) {
    await waitFor(() => expect(screen.getByTestId('convrate-dialog-valid-from-input')).toHaveValue(SERVER_NOW));
  }
  await typeRate(user, '1,3');
  await waitFor(() => expect(screen.getByTestId('convrate-dialog-submit')).toBeEnabled());
}

/** Two clicks inside one act: the second lands before React re-renders the disabled button. */
function fastDoubleClick(element) {
  act(() => {
    element.click();
    element.click();
  });
}

const WRITE_BY_MODE = {
  [DIALOG_MODES.NEW_CURRENCY]: () => api.createManualCurrency,
  [DIALOG_MODES.NEW_RATE]: () => api.createManualRate,
  [DIALOG_MODES.EDIT]: () => api.updateManualRate,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchServerClock.mockResolvedValue({ now: SERVER_NOW, timeZone: null });
  api.fetchManualCurrencyOptions.mockResolvedValue([{ id: 'gbp-id', isoCode: 'GBP', name: 'Pound' }]);
  api.previewManualRate.mockResolvedValue({ creates: [] });
  api.createManualCurrency.mockResolvedValue(OK);
  api.createManualRate.mockResolvedValue(OK);
  api.updateManualRate.mockResolvedValue(PROPOSAL);
});

describe('isEnterSubmitKey', () => {
  function setup() {
    const form = document.createElement('form');
    const input = document.createElement('input');
    const button = document.createElement('button');
    form.append(input, button);
    const outside = document.createElement('input');
    return { form, input, button, outside };
  }

  it.each([
    ['plain Enter on an input of the form', {}, 'input', true],
    ['a key other than Enter', { key: 'a' }, 'input', false],
    ['Shift+Enter', { shiftKey: true }, 'input', false],
    ['Alt+Enter', { altKey: true }, 'input', false],
    ['Ctrl+Enter', { ctrlKey: true }, 'input', false],
    ['Meta+Enter', { metaKey: true }, 'input', false],
    ['Enter while an IME composition is open', { nativeEvent: { isComposing: true } }, 'input', false],
    ['Enter on a button', {}, 'button', false],
    ['Enter on an input outside the form', {}, 'outside', false],
  ])('%s → %s', (_label, overrides, targetName, expected) => {
    const nodes = setup();
    const event = { key: 'Enter', target: nodes[targetName], nativeEvent: {}, ...overrides };
    expect(isEnterSubmitKey(event, nodes.form)).toBe(expected);
  });

  it('does not submit while the input has its option list open', () => {
    const { form, input } = setup();
    input.setAttribute('aria-expanded', 'true');
    expect(isEnterSubmitKey({ key: 'Enter', target: input, nativeEvent: {} }, form)).toBe(false);
    input.setAttribute('aria-expanded', 'false');
    expect(isEnterSubmitKey({ key: 'Enter', target: input, nativeEvent: {} }, form)).toBe(true);
  });

  it('is false without a form', () => {
    const { input } = setup();
    expect(isEnterSubmitKey({ key: 'Enter', target: input, nativeEvent: {} }, null)).toBe(false);
  });
});

describe.each([
  ['Nueva divisa', DIALOG_MODES.NEW_CURRENCY, 'convRateCreateCurrency'],
  ['Nueva tasa', DIALOG_MODES.NEW_RATE, 'convRateCreateRate'],
  ['Modificar tasa', DIALOG_MODES.EDIT, 'convRateSaveChanges'],
])('ManualRateDialog — %s', (_name, mode, submitLabel) => {
  it('Enter in the rate field submits once when the form is valid', async () => {
    const user = userEvent.setup();
    renderDialog(mode);
    await fillValid(user, mode);

    fireEvent.keyDown(screen.getByTestId('convrate-dialog-rate'), { key: 'Enter' });

    const write = WRITE_BY_MODE[mode]();
    await waitFor(() => expect(submitCalls(write)).toHaveLength(1));
    expect(submitCalls(write)[0][1]).toMatchObject({ multipleRateBy: 1.3 });
  });

  it('Enter with an empty rate only marks the rate as touched', async () => {
    const user = userEvent.setup();
    renderDialog(mode);
    if (mode === DIALOG_MODES.NEW_CURRENCY) await user.click(await screen.findByTestId('stub-dest-gbp-id'));
    const input = await typeRate(user, '1');
    await user.clear(input);
    expect(screen.queryByTestId('convrate-dialog-rate-error')).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByTestId('convrate-dialog-rate-error')).toHaveTextContent('convRateRateRequired');
    expect(submitCalls(WRITE_BY_MODE[mode]())).toHaveLength(0);
  });

  it(`a fast double click on ${submitLabel} sends one request`, async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const write = WRITE_BY_MODE[mode]();
    write.mockImplementation((_fetch, _body, signal) => (signal ? Promise.resolve(PROPOSAL) : pending.promise));
    renderDialog(mode);
    await fillValid(user, mode);

    fastDoubleClick(screen.getByTestId('convrate-dialog-submit'));

    await waitFor(() => expect(submitCalls(write)).toHaveLength(1));
    expect(screen.getByTestId('convrate-dialog-submit')).toBeDisabled();
    await act(async () => { pending.resolve(mode === DIALOG_MODES.EDIT ? PROPOSAL : OK); });
    expect(submitCalls(write)).toHaveLength(1);
  });
});

describe('ManualRateDialog — Modificar tasa confirmation', () => {
  async function openConfirmation(user) {
    const handlers = renderDialog(DIALOG_MODES.EDIT);
    await fillValid(user, DIALOG_MODES.EDIT);
    await user.click(screen.getByTestId('convrate-dialog-submit'));
    await screen.findByTestId('convrate-confirm-dialog');
    return handlers;
  }

  const confirmCalls = () => api.updateManualRate.mock.calls.filter((call) => call[1]?.confirm === true);

  it('a fast double click on Confirmar cambio sends one confirmed update', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const { onSaved } = await openConfirmation(user);
    api.updateManualRate.mockImplementation((_fetch, body) => (body.confirm ? pending.promise : Promise.resolve(PROPOSAL)));

    fastDoubleClick(screen.getByTestId('convrate-confirm-submit'));

    expect(confirmCalls()).toHaveLength(1);
    expect(confirmCalls()[0][1]).toMatchObject({ id: 'rate-1', multipleRateBy: 1.3 });
    await act(async () => { pending.resolve({ res: { ok: true, status: 200 }, data: { saved: true } }); });
    expect(confirmCalls()).toHaveLength(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('Volver closes the confirmation and saves nothing', async () => {
    const user = userEvent.setup();
    const { onSaved } = await openConfirmation(user);

    await user.click(screen.getByTestId('convrate-confirm-back'));

    await waitFor(() => expect(screen.queryByTestId('convrate-confirm-dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('convrate-dialog')).toBeInTheDocument();
    expect(confirmCalls()).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('ManualRateDialog — times in the viewer zone', () => {
  // Server in UTC, browser in Buenos Aires (GMT-3): the server's 10:00 is the viewer's 07:00.
  const zone = createZoneView('UTC', 'America/Argentina/Buenos_Aires');

  it('starts at the server minute shown in the viewer zone and sends it back as server wall clock', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderDialog(DIALOG_MODES.NEW_RATE, { zone });
    const start = screen.getByTestId('convrate-dialog-valid-from-input');
    await waitFor(() => expect(start).toHaveValue('2026-11-20T07:00:00'));
    // The zone sits inside the field, not in its label (which must fit one line).
    expect(screen.getByTestId('convrate-dialog-valid-from-input-suffix')).toHaveTextContent('GMT-3');
    expect(screen.getByText(/^convRateValidFromDateTime/, { selector: 'label' })).not.toHaveTextContent('GMT');
    await typeRate(user, '1,3');
    // The debounced preview asks the server with its own wall clock.
    await waitFor(() => expect(api.previewManualRate).toHaveBeenCalled());
    expect(api.previewManualRate.mock.calls.at(-1)[1]).toMatchObject({ validFromDate: '2026-11-20T10:00:00' });

    await user.click(screen.getByTestId('convrate-dialog-submit'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.createManualRate.mock.calls[0][1]).toMatchObject({ validFromDate: '2026-11-20T10:00:00' });
  });

  it('the preview line shows the time in the viewer zone without the zone label', async () => {
    const user = userEvent.setup();
    api.previewManualRate.mockResolvedValue({
      creates: [{ fromIso: 'EUR', toIso: 'USD', rate: 1.3, validFrom: '2026-11-20T10:00:00', validTo: null }],
      closes: [],
    });
    renderDialog(DIALOG_MODES.NEW_RATE, { zone, ui: (key, params) => (params ? `${key}${JSON.stringify(params)}` : key) });
    await waitFor(() => expect(screen.getByTestId('convrate-dialog-valid-from-input')).toHaveValue('2026-11-20T07:00:00'));
    await typeRate(user, '1,3');

    const summary = await screen.findByTestId('convrate-dialog-summary');
    expect(summary).toHaveTextContent('20/11/2026 07:00');
    expect(summary).not.toHaveTextContent('convRateWithZone');
  });

  it('a start after the server minute in the viewer zone is refused, though earlier than its server wall clock', async () => {
    const user = userEvent.setup();
    renderDialog(DIALOG_MODES.NEW_RATE, { zone });
    const start = screen.getByTestId('convrate-dialog-valid-from-input');
    await waitFor(() => expect(start).toHaveValue('2026-11-20T07:00:00'));
    await typeRate(user, '1,3');

    fireEvent.change(start, { target: { value: '2026-11-20T08:00:00' } });

    expect(await screen.findByTestId('convrate-dialog-date-error')).toHaveTextContent('convRateValidFromFuture');
    expect(screen.getByTestId('convrate-dialog-submit')).toBeDisabled();
  });
});

describe('ManualRateDialog — Modificar tasa shows only the modified rate', () => {
  it('the summary and the confirmation list EUR → USD only', async () => {
    const user = userEvent.setup();
    renderDialog(DIALOG_MODES.EDIT);
    await fillValid(user, DIALOG_MODES.EDIT);
    const summary = screen.getByTestId('convrate-dialog-summary');
    expect(summary).toHaveTextContent('EUR → USD');
    expect(summary).not.toHaveTextContent('USD → EUR');

    await user.click(screen.getByTestId('convrate-dialog-submit'));

    const confirm = await screen.findByTestId('convrate-confirm-summary');
    expect(confirm).toHaveTextContent('EUR → USD');
    expect(confirm).not.toHaveTextContent('USD → EUR');
  });
});
