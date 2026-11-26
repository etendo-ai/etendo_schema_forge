// @covers tools/app-shell/src/windows/custom/fiscal-monitor/FiscalMonitorPage.jsx
// Real-locale breadcrumb regression coverage (ETP-4945).
//
// FiscalMonitorPage.jsx used to build a 4-segment breadcrumb
// (`${ui('settings')} / ${ui('fiscal.monitor.nav')} / ${ui('fiscalMonitor.systemFiscal')} / ${PROFILE_LABELS[profile]}`)
// rooted under "Configuración" instead of "Finanzas". The fix collapsed it to
// `${ui('taxes')} / ${ui('fiscalMonitor.title')}` (ETP-6380 switched from the lowercase
// `fiscal.monitor.nav` key to `fiscalMonitor.title`, matching the menu's "Monitor Fiscal"). Since this is a template
// literal (not a pure exported helper), the sibling
// FiscalMonitorPage.vitest.jsx's identity `useUI` mock (`(key) => key`) can't
// catch a real-locale regression — this file renders with `useUI` backed by
// the real dictionary and captures the useSetPageMeta call, same pattern as
// windows/custom/financial-account/__tests__/index.vitest.jsx.
import { render, waitFor, screen } from '@testing-library/react';
import { loadLocaleDictionary, makeRealUI } from '../../shared/__tests__/testUtils/realLocaleUI.js';

const esES = loadLocaleDictionary('es_ES');
const enUS = loadLocaleDictionary('en_US');
const realUiEs = makeRealUI(esES);
const realUiEn = makeRealUI(enUS);

let activeUi = realUiEs;
let activeProfile = 'sii';
let activeLoading = false;
const SII_KPIS = { sii: { issued: 2, received: 1, issuedPrevious: 0, receivedPrevious: 0 } };
let activeKpis = SII_KPIS;

const stableApiFetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ response: { data: [] } }) }));

vi.mock('@/i18n', () => ({ useUI: () => activeUi }));
vi.mock('@/auth/AuthContext.jsx', () => ({
  useAuth: () => ({ selectedOrg: { id: 'org-1', name: 'TestOrg' } }),
  useWindowAccess: () => 'full',
  WindowAccessGuard: () => <div data-testid="window-access-guard" />,
}));
vi.mock('@/auth/useApiFetch.js', () => ({ useApiFetch: () => stableApiFetch }));
vi.mock('@/components/related-documents/helpers.js', async (importOriginal) => ({ ...(await importOriginal()), neoBase: (u) => u }));

// Spy on every published meta, but keep the real hook underneath: with no PageMetaProvider it is
// a no-op, and inside one (renderWithMeta below) it publishes exactly what the TopBar would read,
// including when it does NOT re-publish.
const setMetaMock = vi.fn();
vi.mock('@/components/layout/PageMetaContext', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    useSetPageMeta: (meta, deps) => {
      setMetaMock(meta);
      return real.useSetPageMeta(meta, deps);
    },
  };
});

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../fiscal-config/useCertExpiry.js', () => ({
  useCertExpiry: () => ({ daysLeft: null }),
}));
vi.mock('../../fiscal-config/CertExpiryBanner.jsx', () => ({
  default: () => null,
}));
vi.mock('../useFiscalMonitor.js', () => ({
  useFiscalMonitor: () => ({
    loading: activeLoading,
    error: null,
    profile: activeProfile,
    kpis: activeKpis,
    siiParentId: 'parent-1',
    tbaiValidationResults: [],
    refetch: vi.fn(),
  }),
  SII_SPEC: 'sii-monitor',
  SII_EMITIDAS_ENTITY: 'a',
  SII_RECIBIDAS_ENTITY: 'b',
  SII_EMITIDAS_ANT_ENTITY: 'c',
  SII_RECIBIDAS_ANT_ENTITY: 'd',
  VF_SPEC: 'vf',
  VF_ACEPTADAS_ENTITY: 'e',
  VF_PARCIAL_ENTITY: 'f',
  VF_RECHAZADAS_ENTITY: 'g',
  VF_INVALIDAS_ENTITY: 'h',
  TBAI_SPEC: 'tbai',
  TBAI_ENTITY: 'i',
}));
vi.mock('../useDebugMode.js', () => ({
  useDebugMode: () => false,
}));
vi.mock('../fiscalMonitor.utils.js', () => ({
  computeKpis: () => ({}),
}));
vi.mock('../fiscalMonitorMockData.js', () => ({
  MOCK_MONITOR_DATA: {},
  MOCK_SII_ROWS: [],
  MOCK_TBAI_ROWS: [],
  MOCK_VF_ROWS: [],
  MOCK_TBAI_VALIDATION_RESULTS: [],
}));
vi.mock('../SiiMonitorSection.jsx', () => ({
  default: (props) => <div data-testid="sii-section" data-parent={props.parentId} />,
}));
vi.mock('../TbaiMonitorSection.jsx', () => ({
  default: () => <div data-testid="tbai-section" />,
}));
vi.mock('../VerifactuMonitorSection.jsx', () => ({
  default: () => <div data-testid="verifactu-section" />,
}));
vi.mock('../FiscalMonitorDebugPanel.jsx', () => ({
  default: () => <div data-testid="debug-panel" />,
}));
vi.mock('../../shared/InvoicePreviewModal.jsx', () => ({
  default: () => <div data-testid="invoice-preview" />,
}));
vi.mock('../../shared/PdfViewer.jsx', () => ({
  default: () => <div data-testid="pdf-viewer" />,
}));
vi.mock('react-pdf', () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock('../ContactDetailModal.jsx', () => ({
  default: () => <div data-testid="contact-detail" />,
}));
vi.mock('../fiscal-monitor.css', () => ({}));

import FiscalMonitorPage from '../FiscalMonitorPage.jsx';
import { PageMetaProvider } from '@/components/layout/PageMetaContext';
import { lastMeta, MetaProbe, renderWithMeta } from '../../fiscal-models/__tests__/testUtils/topBarMetaTestUtils.jsx';

const baseProps = {
  token: 'test-token',
  apiBaseUrl: '/sws/neo/fiscal-monitor',
};

beforeEach(() => {
  setMetaMock.mockClear();
  activeProfile = 'sii';
  activeLoading = false;
  activeKpis = SII_KPIS;
});

describe('FiscalMonitorPage — breadcrumb against the real locale dictionary (ETP-4945)', () => {
  it('resolves the es_ES breadcrumb to the 2-segment "Impuestos / Monitor Fiscal" (not the stale 4-level "Configuración / Monitor de facturas / Sistema fiscal activo / SII")', async () => {
    activeUi = realUiEs;
    render(<FiscalMonitorPage {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('sii-section')).toBeInTheDocument();
    });

    const lastCall = setMetaMock.mock.calls.at(-1)[0];
    expect(lastCall.breadcrumb).toBe('Impuestos / Monitor Fiscal');
    expect(lastCall.breadcrumb.split(' / ')).toHaveLength(2);
  });

  it('resolves the en_US breadcrumb to "Taxes / Fiscal Monitor"', async () => {
    activeUi = realUiEn;
    render(<FiscalMonitorPage {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('sii-section')).toBeInTheDocument();
    });

    const lastCall = setMetaMock.mock.calls.at(-1)[0];
    expect(lastCall.breadcrumb).toBe('Taxes / Fiscal Monitor');
  });

  // ETP-6380 — the title is always the plain window name, as in the menu. CP-3: with no fiscal
  // system the title used to be '' and TopBar (which renders title AND breadcrumb only for a
  // non-empty title) dropped the whole "Impuestos / Monitor Fiscal" header. Later QA round: with a
  // configured system the title was the profile label ("SII", "SII + TBAI", ...); the system is
  // shown in the page body instead.
  it.each([
    ['unconfigured', realUiEs, 'Monitor Fiscal', 'Impuestos / Monitor Fiscal', 'No hay sistema fiscal configurado para esta organización.', /Configúralo en Impuestos → Configuración Fiscal para/],
    [null, realUiEs, 'Monitor Fiscal', 'Impuestos / Monitor Fiscal', 'No hay sistema fiscal configurado para esta organización.', /Configúralo en Impuestos → Configuración Fiscal para/],
    ['unconfigured', realUiEn, 'Fiscal Monitor', 'Taxes / Fiscal Monitor', 'No fiscal system configured for this organization.', /Configure it in Taxes → Fiscal Configuration to/],
  ])('keeps a title and breadcrumb when the profile is %s', async (profile, ui, title, breadcrumb, emptyText, setupHint) => {
    activeProfile = profile;
    activeUi = ui;
    render(<FiscalMonitorPage {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByText(emptyText)).toBeInTheDocument();
    });

    const lastCall = setMetaMock.mock.calls.at(-1)[0];
    expect(lastCall.title).toBe(title);
    expect(lastCall.breadcrumb).toBe(breadcrumb);
    // ETP-6380 CP-12 — the setup hint names the menu section, not just the window.
    expect(screen.getByText(setupHint)).toBeInTheDocument();
  });

  it.each([
    ['sii', realUiEs, 'Monitor Fiscal'],
    ['sii', realUiEn, 'Fiscal Monitor'],
  ])('uses the window name, not the system label, as the title when the profile is %s', async (profile, ui, title) => {
    activeProfile = profile;
    activeUi = ui;
    render(<FiscalMonitorPage {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('sii-section')).toBeInTheDocument();
    });
    expect(setMetaMock.mock.calls.at(-1)[0].title).toBe(title);
  });
});

// ETP-6380 — the TopBar record-count badge next to "Monitor Fiscal" showed 0 while the system
// tabs showed their counts (live: VERI*FACTU "Correctas 10" / "Con problemas 4"). The count is
// only known once the KPIs load, but useSetPageMeta re-publishes on title/breadcrumb (plus its
// explicit deps) only, and the title no longer changes when loading ends — so the 0 published
// during loading stuck. Rendered through the real PageMetaProvider, loading first, then loaded.
describe('FiscalMonitorPage — TopBar record count follows the loaded KPIs (ETP-6380)', () => {
  const VF_KPIS = { verifactu: { accepted: 10, partiallyAccepted: 1, rejected: 2, invalid: 1 } };
  const TBAI_KPIS = { tbai: { total: 5, received: 3, rejected: 1, error: 1, pending: 0 } };

  it.each([
    ['verifactu', VF_KPIS, 14],
    ['sii', SII_KPIS, 3],
    ['sii-navarra', SII_KPIS, 3],
    ['tbai', TBAI_KPIS, 5],
    ['sii+tbai', { ...SII_KPIS, ...TBAI_KPIS }, 8],
  ])('publishes the %s total once the KPIs arrive', async (profile, kpis, expected) => {
    activeUi = realUiEs;
    activeProfile = profile;
    activeLoading = true;
    activeKpis = {};
    const { rerender } = renderWithMeta(<FiscalMonitorPage {...baseProps} />);
    expect(lastMeta.recordCount).toBe(0);

    activeLoading = false;
    activeKpis = kpis;
    rerender(<PageMetaProvider><FiscalMonitorPage {...baseProps} /><MetaProbe /></PageMetaProvider>);

    await waitFor(() => expect(lastMeta.recordCount).toBe(expected));
    expect(lastMeta.title).toBe('Monitor Fiscal');
  });
});
