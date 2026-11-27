// @covers tools/app-shell/src/windows/custom/conversion-rates/CurrencyConversionRoute.jsx
// @covers tools/app-shell/src/windows/custom/conversion-rates/LegacyConversionRatesWindow.jsx
// @covers tools/app-shell/src/windows/custom/conversion-rates/index.jsx
// ETP-6365 — the `conversion-rates` route follows capabilities.currencyConversionV2 (the per-account
// currency-conversion-v2 flag, evaluated by the backend): on, the redesigned page; off (or not
// published), the generated window read-only under its old name; loading, a progress bar.
import { render, screen } from '@testing-library/react';

let mockCapabilities = {};
let mockAuth = {};
let mockLegacyProps = null;

vi.mock('@etendo-ai/app-shell-core/auth', () => ({ useAuthOptional: () => mockAuth }));
vi.mock('@/hooks/useCapabilitiesSafe.js', () => ({ useCapabilitiesSafe: () => mockCapabilities }));
vi.mock('@/components/contract-ui/ListProgressBar.jsx', () => ({
  ListProgressBar: ({ testId }) => <div data-testid={testId} />,
}));
vi.mock('../ConversionRatesPage.jsx', () => ({
  default: (props) => <div data-testid="redesigned-page" data-api={props.apiBaseUrl} />,
}));
vi.mock('@generated/conversion-rates/generated/web/conversion-rates/index.jsx', () => ({
  default: (props) => {
    mockLegacyProps = props;
    return <div data-testid="generated-window" />;
  },
}));

import App from '../index.jsx';
import { LEGACY_WINDOW } from '../LegacyConversionRatesWindow.jsx';

describe('conversion-rates route (currency-conversion-v2)', () => {
  beforeEach(() => {
    mockCapabilities = {};
    mockAuth = {};
    mockLegacyProps = null;
  });

  it('renders the redesigned page when the capability is on', () => {
    mockCapabilities = { currencyConversionV2: true };
    render(<App apiBaseUrl="/sws/neo/conversion-rates" />);
    expect(screen.getByTestId('redesigned-page')).toHaveAttribute('data-api', '/sws/neo/conversion-rates');
    expect(screen.queryByTestId('generated-window')).toBeNull();
  });

  it.each([
    ['off', { currencyConversionV2: false }],
    ['not published (older backend)', {}],
  ])('falls back to the generated read-only window when the capability is %s', (_label, capabilities) => {
    mockCapabilities = capabilities;
    render(<App apiBaseUrl="/sws/neo/conversion-rates" window={{ name: 'Currency Conversion' }} />);
    expect(screen.getByTestId('generated-window')).toBeInTheDocument();
    expect(screen.queryByTestId('redesigned-page')).toBeNull();
    expect(mockLegacyProps.window).toEqual(LEGACY_WINDOW);
    expect(mockLegacyProps.window.readOnly).toBe(true);
    expect(mockLegacyProps.entityLabel).toBe('Conversion Rates');
    expect(mockLegacyProps.breadcrumb).toBe('Finance / Conversion Rates');
    expect(mockLegacyProps.apiBaseUrl).toBe('/sws/neo/conversion-rates');
  });

  it('keeps the generated record label on the read-only detail', () => {
    render(<App recordId="rate-1" />);
    expect(mockLegacyProps.recordId).toBe('rate-1');
    expect(mockLegacyProps.entityLabel).toBeUndefined();
    expect(mockLegacyProps.window.readOnly).toBe(true);
  });

  it('shows a progress bar, not the fallback, while the access maps load', () => {
    mockAuth = { accessLoaded: false };
    mockCapabilities = { currencyConversionV2: true };
    render(<App />);
    expect(screen.getByTestId('conversion-rates-access-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('generated-window')).toBeNull();
    expect(screen.queryByTestId('redesigned-page')).toBeNull();
  });
});
