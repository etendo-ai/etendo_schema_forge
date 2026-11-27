// @covers tools/app-shell/src/windows/custom/conversion-rates/CurrencyConversionRoute.jsx
// @covers tools/app-shell/src/windows/custom/conversion-rates/LegacyConversionRatesWindow.jsx
// @covers tools/app-shell/src/windows/custom/conversion-rates/legacy/ConversionRatePage.jsx
// @covers tools/app-shell/src/windows/custom/conversion-rates/legacy/ConversionRateTable.jsx
// @covers tools/app-shell/src/windows/custom/conversion-rates/index.jsx
// ETP-6365 — the `conversion-rates` route follows capabilities.currencyConversionV2 (the per-account
// currency-conversion-v2 flag, evaluated by the backend): on, the redesigned page; off (or not
// published), the FROZEN pre-ETP-6365 generated window (`legacy/`), read-only under its old name;
// loading, a progress bar.
import { render, screen } from '@testing-library/react';

let mockCapabilities = {};
let mockAuth = {};
let mockListProps = null;
let mockDetailProps = null;

vi.mock('@etendo-ai/app-shell-core/auth', () => ({ useAuthOptional: () => mockAuth }));
vi.mock('@/hooks/useCapabilitiesSafe.js', () => ({ useCapabilitiesSafe: () => mockCapabilities }));
vi.mock('@/auth/AuthContext.jsx', () => ({ useWindowAccess: () => 'full', WindowAccessGuard: () => null }));
vi.mock('@/components/contract-ui/ListProgressBar.jsx', () => ({
  ListProgressBar: ({ testId }) => <div data-testid={testId} />,
}));
vi.mock('@/components/contract-ui/ListView.jsx', () => ({
  ListView: (props) => {
    mockListProps = props;
    return <div data-testid="legacy-list" />;
  },
}));
vi.mock('@/components/contract-ui/DetailView.jsx', () => ({
  DetailView: (props) => {
    mockDetailProps = props;
    return <div data-testid="legacy-detail" />;
  },
}));
vi.mock('@/components/contract-ui', () => ({ DataTable: () => null, InlineLinesPanel: () => null, EntityForm: () => null }));
vi.mock('@/components/attachments', () => ({ AttachmentsTab: () => null }));
vi.mock('../ConversionRatesPage.jsx', () => ({
  default: (props) => <div data-testid="redesigned-page" data-api={props.apiBaseUrl} />,
}));

import App from '../index.jsx';
import { LEGACY_WINDOW } from '../LegacyConversionRatesWindow.jsx';
import { columns as legacyColumns } from '../legacy/ConversionRateTable.jsx';

describe('conversion-rates route (currency-conversion-v2)', () => {
  beforeEach(() => {
    mockCapabilities = {};
    mockAuth = {};
    mockListProps = null;
    mockDetailProps = null;
  });

  it('renders the redesigned page when the capability is on', () => {
    mockCapabilities = { currencyConversionV2: true };
    render(<App apiBaseUrl="/sws/neo/conversion-rates" />);
    expect(screen.getByTestId('redesigned-page')).toHaveAttribute('data-api', '/sws/neo/conversion-rates');
    expect(screen.queryByTestId('legacy-list')).toBeNull();
  });

  it.each([
    ['off', { currencyConversionV2: false }],
    ['not published (older backend)', {}],
  ])('falls back to the frozen pre-task window, read-only, when the capability is %s', (_label, capabilities) => {
    mockCapabilities = capabilities;
    render(<App apiBaseUrl="/sws/neo/conversion-rates" window={{ name: 'Currency Conversion' }} />);
    expect(screen.getByTestId('legacy-list')).toBeInTheDocument();
    expect(screen.queryByTestId('redesigned-page')).toBeNull();
    expect(mockListProps.window).toEqual(LEGACY_WINDOW);
    expect(mockListProps.api.window.readOnly).toBe(true);
    expect(mockListProps.api.crud.conversionRate.delete).toBe(false);
    expect(mockListProps.hideCreate).toBe(true);
    expect(mockListProps.entityLabel).toBe('Conversion Rates');
    expect(mockListProps.breadcrumb).toBe('Finance / Conversion Rates');
    expect(mockListProps.apiBaseUrl).toBe('/sws/neo/conversion-rates');
  });

  it('the legacy table has the pre-task columns: no Status, validity as dates without time', () => {
    expect(legacyColumns.map((c) => c.key)).toEqual([
      'currency', 'toCurrency', 'validFromDate', 'validToDate', 'multipleRateBy', 'divideRateBy', 'sMFCRSynced',
    ]);
    expect(legacyColumns.some((c) => c.key === 'etgoRateStatus' || c.type === 'status')).toBe(false);
    for (const key of ['validFromDate', 'validToDate']) {
      expect(legacyColumns.find((c) => c.key === key).type).toBe('date');
    }
  });

  it('the read-only detail keeps its record label and the attachments tab', () => {
    render(<App recordId="rate-1" />);
    expect(mockDetailProps.recordId).toBe('rate-1');
    expect(mockDetailProps.entityLabel).toBe('Conversion Rate');
    expect(mockDetailProps.window.readOnly).toBe(true);
    expect(mockDetailProps.customTabs.map((t) => t.key)).toEqual(['attachments']);
  });

  it('shows a progress bar, not the fallback, while the access maps load', () => {
    mockAuth = { accessLoaded: false };
    mockCapabilities = { currencyConversionV2: true };
    render(<App />);
    expect(screen.getByTestId('conversion-rates-access-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-list')).toBeNull();
    expect(screen.queryByTestId('redesigned-page')).toBeNull();
  });
});
