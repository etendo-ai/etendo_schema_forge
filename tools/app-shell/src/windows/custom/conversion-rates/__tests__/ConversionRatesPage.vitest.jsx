// @covers tools/app-shell/src/windows/custom/conversion-rates/ConversionRatesPage.jsx

vi.mock('@/i18n', () => ({
  useLabel: () => (key) => key,
  useMenuLabel: () => (key) => key,
  useUI: () => (key) => key,
  useLocale: () => ({ genericLabels: {}, statuses: {} }),
  useLocaleSwitch: () => ({ locale: 'es_ES', setLocale: vi.fn() }),
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

// Stable across renders, as the real hook: a new function each render would re-run every load effect.
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/auth/useApiFetch.js', () => ({ useApiFetch: () => apiFetch }));
vi.mock('@/hooks/useCurrency.jsx', () => ({ useCurrency: () => 'EUR', useCurrencyId: () => 'eur-id' }));
vi.mock('@/hooks/useCopyLinkAction.js', () => ({ useCopyPageLink: () => vi.fn() }));
vi.mock('@/components/layout/PageMetaContext', () => ({ useSetPageMeta: () => {} }));

// Toolbar and drawers are out of scope: stubs that render nothing.
vi.mock('@etendo-ai/app-shell-core/components/ui/distinct-values-filter.jsx', () => ({ DistinctValuesFilter: () => null }));
vi.mock('@/components/ui/date-field', () => ({ DateField: () => null }));
vi.mock('@/components/contract-ui/RefreshButton.jsx', () => ({ RefreshButton: () => null }));
vi.mock('@/components/contract-ui/ListSortPopover.jsx', () => ({ ListSortPopover: () => null }));
vi.mock('@/components/contract-ui/ReportDrawer.jsx', () => ({ default: () => null }));
vi.mock('../ManualRateDialog.jsx', () => ({ ManualRateDialog: () => null, DIALOG_MODES: {} }));

const DELETE_ROW = vi.hoisted(() => ({
  id: 'rate-1', toCurrency: 'usd-id', validFromDate: '2026-11-01T00:00:00', sMFCRSynced: false,
}));

// The list exposes its delete action and the name of each listed currency; the confirm dialog
// exposes its confirm button.
vi.mock('../CurrencyRatesList.jsx', () => ({
  CurrencyRatesList: ({ onDelete, entries }) => (
    <>
      <button type="button" data-testid="stub-row-delete" onClick={() => onDelete(DELETE_ROW)}>delete</button>
      {entries.map((e) => <span key={e.currencyId} data-testid={`stub-name-${e.isoCode}`}>{e.name}</span>)}
    </>
  ),
}));
vi.mock('@/components/contract-ui/DeleteConfirmDialog.jsx', () => ({
  DeleteConfirmDialog: ({ open, onConfirm }) => (open
    ? <button type="button" data-testid="stub-delete-confirm" onClick={onConfirm}>confirm</button>
    : null),
}));

const api = vi.hoisted(() => ({
  fetchCurrentRates: vi.fn(),
  fetchHistory: vi.fn(),
  deleteManualRate: vi.fn(),
  fetchServerClock: vi.fn(),
  fetchManualCurrencyOptions: vi.fn(),
}));
vi.mock('../conversionRatesApi.js', () => api);

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversionRatesPage from '../ConversionRatesPage.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchCurrentRates.mockResolvedValue([]);
  api.fetchHistory.mockResolvedValue([]);
  api.fetchServerClock.mockResolvedValue({ now: '2026-11-20T10:00:00', timeZone: 'UTC' });
  api.fetchManualCurrencyOptions.mockResolvedValue([]);
});

describe('ConversionRatesPage — currency names', () => {
  it('a currency with no rate in force shows the server name, not the Intl one', async () => {
    api.fetchHistory.mockResolvedValue([
      { id: 'r-jpy', toCurrency: 'jpy-id', 'toCurrency$_identifier': 'JPY', validFromDate: '2026-11-01T00:00:00' },
    ]);
    api.fetchManualCurrencyOptions.mockResolvedValue([{ id: 'jpy-id', isoCode: 'JPY', name: 'Yen Japonés', symbol: '¥' }]);
    render(<ConversionRatesPage apiBaseUrl="/sws/neo/conversion-rates" />);

    await waitFor(() => expect(screen.getByTestId('stub-name-JPY')).toHaveTextContent('Yen Japonés'));
    expect(api.fetchManualCurrencyOptions.mock.calls[0][2]).toEqual({ withoutRates: false });
  });
});

describe('ConversionRatesPage — delete confirmation', () => {
  it('a fast double click on Eliminar sends one delete', async () => {
    const user = userEvent.setup();
    let resolveDelete;
    api.deleteManualRate.mockImplementation(() => new Promise((r) => { resolveDelete = r; }));
    render(<ConversionRatesPage apiBaseUrl="/sws/neo/conversion-rates" />);

    await user.click(screen.getByTestId('stub-row-delete'));
    const confirm = await screen.findByTestId('stub-delete-confirm');
    act(() => {
      confirm.click();
      confirm.click();
    });

    expect(api.deleteManualRate).toHaveBeenCalledTimes(1);
    expect(api.deleteManualRate.mock.calls[0][1]).toBe('rate-1');
    await act(async () => { resolveDelete({ ok: true, status: 200 }); });
    await waitFor(() => expect(screen.queryByTestId('stub-delete-confirm')).not.toBeInTheDocument());
    expect(api.deleteManualRate).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('convRateDeleted');
  });
});
