// @covers tools/app-shell/src/pages/PortalPage.jsx
// @covers tools/app-shell/src/pages/portal/PortalShell.jsx
// @covers tools/app-shell/src/pages/portal/PortalHomeView.jsx
// @covers tools/app-shell/src/pages/portal/PortalDocumentListView.jsx
// @covers tools/app-shell/src/pages/portal/PortalListDesktop.jsx
// @covers tools/app-shell/src/pages/portal/PortalListMobile.jsx
// @covers tools/app-shell/src/pages/portal/PortalListFilters.jsx
// @covers tools/app-shell/src/pages/portal/PortalDocumentDetailView.jsx
// @covers tools/app-shell/src/pages/portal/PortalDetailPanel.jsx
// @covers tools/app-shell/src/pages/portal/PortalBits.jsx
// @covers tools/app-shell/src/components/layout/SearchBar.jsx
// @covers tools/app-shell/src/lib/portal/usePortalApiFetch.js
// @covers tools/app-shell/src/lib/portal/portalLinkSession.js
// Mocks BEFORE imports.
const apiFetchMock = vi.fn();

// The page's only door to the network. Mocked at the hook rather than at `fetch` so the
// request OPTIONS are observable — that is what the plan's §5.4 assertion below reads.
// `real` lets the cold-open test drive the page through the REAL client over a stubbed `fetch`,
// to see what the session scope does to the answers.
const hookMode = { real: false };
vi.mock('@/lib/portal/usePortalApiFetch.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { usePortalApiFetch: (base) => (hookMode.real ? actual.usePortalApiFetch(base) : apiFetchMock) };
});

// The download plumbing lives in its own module so a test can see what would be saved.
vi.mock('@/lib/portal/portalDownload.js', () => ({ saveBlobAsFile: vi.fn() }));

// The mobile card's options end on a toast when they fail; the toast is what the customer reads.
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal()),
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// react-pdf cannot render in jsdom: the viewer is the boundary. The stub shows which URL it got.
vi.mock('@/windows/custom/shared/PdfViewer.jsx', () => ({
  default: ({ url }) => <div data-testid="pdf-viewer" data-url={url} />,
  usePdfZoom: () => ({
    scale: 1, zoomIn: () => {}, zoomOut: () => {}, canZoomIn: true, canZoomOut: true,
  }),
}));
vi.mock('@/windows/custom/shared/FileLightbox.jsx', () => ({
  default: ({ open, file }) => (open ? <div data-testid="pdf-lightbox" data-url={file.objectUrl} /> : null),
}));

// Radix menus open on pointer events jsdom does not drive reliably. This stand-in keeps the
// contract the portal relies on: the content exists only once its trigger has been clicked.
vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await vi.importActual('react');
  const Ctx = React.createContext(null);
  return {
    DropdownMenu: ({ children }) => {
      const [open, setOpen] = React.useState(false);
      return React.createElement(Ctx.Provider, { value: { open, setOpen } }, children);
    },
    DropdownMenuTrigger: ({ children }) => {
      const { open, setOpen } = React.useContext(Ctx);
      return React.cloneElement(children, { onClick: () => setOpen(!open), 'aria-expanded': open });
    },
    DropdownMenuContent: ({ children }) => {
      const { open, setOpen } = React.useContext(Ctx);
      return open ? React.createElement('div', { role: 'menu', onClick: () => setOpen(false) }, children) : null;
    },
    DropdownMenuItem: ({ children, onSelect, ...props }) => React.createElement(
      'button', { type: 'button', role: 'menuitem', onClick: onSelect, ...props }, children,
    ),
  };
});

/**
 * The mocked translation: the key, plus its variables when there are any, so an assertion can see
 * WHICH values reached the copy (the tenant name, the overdue amount) and not just the key.
 * A function declaration, so it is initialized before the hoisted `vi.mock` factories run.
 */
function t(key, vars) {
  return vars ? `${key} ${JSON.stringify(vars)}` : key;
}

/** Mutable per test: the language switch reads and writes it. */
const localeState = { locale: 'es_ES', setLocale: vi.fn() };
const dictionary = { genericLabels: {}, statuses: {} };

vi.mock('@/i18n', () => ({
  useUI: () => t,
  useLocaleSwitch: () => localeState,
  useLocale: () => dictionary,
}));

import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { registerApiSession, resetApiSessionForTests } from '@etendo-ai/app-shell-core/auth';
import PortalPage from '../PortalPage.jsx';
import { PortalCreatedWithHeaderLink, PortalTag } from '../portal/PortalBits.jsx';
import { PortalListTable } from '../portal/PortalListDesktop.jsx';
import { PortalRelatedList } from '../portal/PortalDetailPanel.jsx';
import { saveBlobAsFile } from '@/lib/portal/portalDownload.js';
import { toast } from 'sonner';
import { PORTAL_LINK_STORAGE_KEY, rememberPortalLink } from '@/lib/portal/portalLinkSession.js';

/**
 * Business Partner self-service portal page (ETP-5267, ETP-6209).
 *
 * The load-bearing test in this file is `sends the token in the X-Portal-Token header on every
 * call` — plan §5.4. The rest guards the link states (dead, expired, unavailable), the shell and
 * its URL-held view, and the three views: home, one kind's list, one document.
 */

const TOKEN = 'tok-abcdef0123456789';
/** The tenant (AD_Client_ID) a CP-43 link names before its token. */
const CLIENT = '0123456789ABCDEF0123456789ABCDEF';
const OTHER_CLIENT = 'FEDCBA9876543210FEDCBA9876543210';

/** A euro amount exactly as the canonical formatter produces it (non-breaking space). */
const eur = (digits) => `${digits} €`;

const IDENTITY = { businessPartnerName: 'Cliente Uno', email: 'cliente@uno.es', tenantName: 'Acme SA' };
const WITH_ENTRY = { ...IDENTITY, entryDocument: { kind: 'INVOICE', id: 'inv-1' } };

const HOME = {
  balances: [
    {
      currency: 'EUR', outstanding: 1210.5, pendingCount: 3, overdue: 210.5, overdueCount: 1,
      overdueSince: '2026-08-15',
    },
    { currency: 'USD', outstanding: 100, pendingCount: 1, overdue: 0, overdueCount: 0 },
  ],
  tiles: {
    QUOTATION: { count: 4, highlight: { code: 'awaitingAnswer', count: 2 } },
    ORDER: { count: 7 },
    SHIPMENT: { count: 0 },
    INVOICE: { count: 12, highlight: { code: 'overdue', count: 1 } },
  },
  recent: [
    { kind: 'ORDER', id: 'ord-1', documentNo: 'PV/0001', date: '2026-08-01', documentStatus: 'CO', currency: 'EUR', grandTotal: 500 },
    {
      // The server says it is overdue: the home badge follows it (no instalments here).
      kind: 'INVOICE', id: 'inv-2', documentNo: 'FV/0002', date: '2026-08-02', documentStatus: 'CO',
      currency: 'EUR', grandTotal: 500, outstandingAmount: 500, overdue: true,
    },
  ],
};

/**
 * Invoices whose payment and due-date states do not depend on the day the suite runs: due dates
 * far in the past, and paid / credit decided before the date is consulted.
 */
const INVOICES = [
  {
    kind: 'INVOICE', id: 'inv-1', documentNo: 'FV/0001', date: '2026-08-01', dueDate: '2020-01-10',
    documentStatus: 'CO', currency: 'EUR', taxBase: 826.45, grandTotal: 1000, outstandingAmount: 0,
  },
  {
    kind: 'INVOICE', id: 'inv-2', documentNo: 'FV/0002', date: '2026-08-02', dueDate: '2020-01-10',
    documentStatus: 'CO', currency: 'EUR', taxBase: 413.22, grandTotal: 500, outstandingAmount: 500, overdue: true,
  },
  {
    kind: 'INVOICE', id: 'inv-3', documentNo: 'AB/0001', date: '2026-08-03', isCreditNote: true,
    documentStatus: 'CO', currency: 'EUR', taxBase: -82.64, grandTotal: -100, outstandingAmount: -100,
  },
];

const order = (n) => ({
  kind: 'ORDER', id: `ord-${n}`, documentNo: `PV/000${n}`, date: '2026-08-01', documentStatus: 'CO',
  currency: 'EUR', taxBase: 100, grandTotal: 121,
});

const LISTS = {
  invoice: { documents: INVOICES, totalCount: 3, statuses: ['CO', 'CL'] },
  shipment: {
    documents: [{ kind: 'SHIPMENT', id: 'shp-1', documentNo: 'AL/0001', date: '2026-08-01', documentStatus: 'CO' }],
    totalCount: 1,
    statuses: ['CO'],
  },
};

const DETAILS = {
  'invoice/inv-1': {
    kind: 'INVOICE', id: 'inv-1', documentNo: 'FV/0001', date: '2026-08-01', dueDate: '2026-08-31',
    documentStatus: 'CO', currency: 'EUR', taxBase: 826.45, grandTotal: 1000, outstandingAmount: 0,
    customer: { name: 'Cliente Uno' },
    lines: [
      { product: 'Tornillo', productCode: 'TOR-1', quantity: 2, unitPrice: 400, tax: 'IVA 21%', amount: 800 },
      { product: 'Arandela', quantity: 1.5, unitPrice: 17.63, tax: 'IVA 21%', amount: 26.45 },
    ],
    taxes: [{ tax: 'IVA 21%', taxableAmount: 826.45, taxAmount: 173.55 }],
    related: [{ kind: 'ORDER', id: 'ord-1', documentNo: 'PV/0001', documentStatus: 'CO' }],
    hasPdf: true,
  },
  'invoice/inv-2': {
    kind: 'INVOICE', id: 'inv-2', documentNo: 'FV/0002', date: '2026-08-02', dueDate: '2020-01-10',
    documentStatus: 'CO', currency: 'EUR', grandTotal: 500, outstandingAmount: 500,
    installments: [{ dueDate: '2020-01-10', amount: 500, paidAmount: 0, outstandingAmount: 500 }],
    lines: [], related: [], hasPdf: false,
  },
  'order/ord-1': {
    kind: 'ORDER', id: 'ord-1', documentNo: 'PV/0001', documentStatus: 'CO', currency: 'EUR',
    grandTotal: 500, lines: [], related: [], hasPdf: false,
  },
};

/**
 * A `fetch`-shaped response. `clone` and `headers` are present because a real `Response` has
 * them and the shared helper reads both — a fake without them fails in a confusing place.
 */
function jsonResponse(body, { status = 200 } = {}) {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    clone: () => jsonResponse(body, { status }),
    json: async () => body,
    blob: async () => null,
  };
}

function blobResponse(blob, { status = 200 } = {}) {
  return { ...jsonResponse({}, { status }), blob: async () => blob };
}

/** Marker for a request that never completes — transient, and never a dead link. */
const NETWORK_FAILURE = Symbol('network failure');

/** Answers in order, repeating the last one: what `/me` says on the first load, then on a re-check. */
function sequence(...answers) {
  let next = 0;
  return () => answers[Math.min(next++, answers.length - 1)];
}

/** What each endpoint answers; a test reassigns a field before rendering. */
let responses;

/**
 * Shows the router's search string, so a test can read the view the URL holds, and the history
 * entry's state (what a reload or a back navigation would read again).
 */
function LocationProbe() {
  const location = useLocation();
  return (
    <output
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-state={JSON.stringify(location.state ?? null)}
    >
      {location.search}
    </output>
  );
}

/**
 * The portal routes exactly as `runtime-routes.jsx` declares them. The default path is a CP-43
 * email link the boot scrub never saw (an in-app navigation): the page itself must move the token
 * out of the URL, to `/portal/{CLIENT}`, and keep reading it from this tab's sessionStorage.
 */
function renderPortal(path = `/portal/${CLIENT}/${TOKEN}`, { strict = false } = {}) {
  const page = <><PortalPage /><LocationProbe /></>;
  const tree = (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="portal/:segment" element={page} />
        <Route path="portal/:clientId/:token" element={page} />
        <Route path="portal" element={page} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** The recorded `apiFetch` calls to one portal route, query string ignored. */
const callsTo = (route) => apiFetchMock.mock.calls
  .filter(([path]) => path.split('?')[0].endsWith(route));

/** The query of every list request made so far. */
const listQueries = () => callsTo('/documents')
  .map(([path]) => new URL(path, 'http://portal').searchParams);

/** The view the URL holds, as an object. */
const urlView = () => Object.fromEntries(new URLSearchParams(screen.getByTestId('location-probe').textContent));

/** The kind of the list on screen (its toolbar carries it). */
const listKind = () => screen.getByTestId('portal-document-list').querySelector('[data-kind]')?.getAttribute('data-kind');

/**
 * Marketing's URLs with their UTM, verbatim (approved 2026-11-24/25). Written out here rather than
 * read from `ETENDO_LINK_BASES`, so an edit of the constants cannot pass unnoticed. Inside the
 * portal each one carries `&portal_ref=<AD_Client_ID>` (marketing's UTM document, 2026-11-25) —
 * never the token.
 */
const ETENDO_MARKETING_URL = 'https://etendo.ai/?utm_source=portal_clientes&utm_medium=in_app&utm_campaign=portal_clientes&utm_content=boton_conoce_mas';
const ETENDO_START_FREE_URL = 'https://etendo.ai/precios/?utm_source=portal_clientes&utm_medium=in_app&utm_campaign=portal_clientes&utm_content=banner_empieza_gratis';
const withPortalRef = (url) => `${url}&portal_ref=${CLIENT}`;

/** Every "Creado con Etendo" link: marketing's page, in a new tab, with no opener, named by its label. */
function expectEtendoLink(link, href = withPortalRef(ETENDO_MARKETING_URL)) {
  expect(link).toHaveAttribute('href', href);
  expect(link.getAttribute('href')).not.toContain(TOKEN);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(link).toHaveAccessibleName('portalCreatedWithLinkLabel');
}

const ETENDO_LINK_TEST_IDS = ['portal-created-with', 'portal-created-with-compact', 'portal-created-with-mobile'];

/** Renders below `md`, where the page opens a document as a full page with its own headers. */
function withViewportWidth(width, body) {
  const original = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  return Promise.resolve(body()).finally(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: original });
  });
}

/** Exact options of every GET the page makes; `/renew` adds `method: 'POST'`. */
const PORTAL_GET_OPTIONS = { token: TOKEN, headers: { 'X-Portal-Token': TOKEN }, on401: 'ignore' };

const shellReady = () => waitFor(
  () => expect(screen.getByTestId('portal-shell')).toBeInTheDocument(),
);
const listReady = () => waitFor(
  () => expect(screen.getAllByTestId('portal-document-row').length).toBeGreaterThan(0),
);
const detailReady = () => waitFor(
  () => expect(screen.getByTestId('portal-document-detail')).toBeInTheDocument(),
);
/** The printable has arrived: its download button is enabled. */
const pdfReady = () => waitFor(
  () => expect(screen.getByTestId('portal-download-pdf')).toBeEnabled(),
);

beforeEach(() => {
  vi.clearAllMocks();
  // The link a previous test left in this tab must not open the next one.
  sessionStorage.clear();
  localeState.locale = 'es_ES';
  // jsdom has no object URLs; the logo and the printable both need one.
  URL.createObjectURL = vi.fn(() => 'blob:portal-object');
  URL.revokeObjectURL = vi.fn();
  // The preview sizes the page from its pane; the setup's ResizeObserver stub observes nothing.
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }

    observe() { this.callback([{ contentRect: { width: 840 } }]); }

    unobserve() {}

    disconnect() {}
  };
  responses = {
    me: jsonResponse(IDENTITY),
    home: jsonResponse(HOME),
    search: jsonResponse({ documents: [INVOICES[1]] }),
    documents: (params) => jsonResponse(
      LISTS[params.get('type')] ?? { documents: [], totalCount: 0, statuses: [] },
    ),
    document: (kind, id) => (DETAILS[`${kind}/${id}`]
      ? jsonResponse(DETAILS[`${kind}/${id}`]) : jsonResponse({}, { status: 404 })),
    pdf: blobResponse(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
    // 404 by default: requested only when `/me` reports `hasLogo`.
    logo: jsonResponse({}, { status: 404 }),
    renew: jsonResponse({ state: 'renewed', renewal: 'sent' }),
  };
  apiFetchMock.mockImplementation(async (path) => {
    const [route, query = ''] = path.split('?');
    const documentMatch = route.match(/\/documents\/([^/]+)\/([^/]+?)(\/pdf)?$/);
    let answer;
    if (route.endsWith('/me')) answer = typeof responses.me === 'function' ? responses.me() : responses.me;
    else if (route.endsWith('/home')) answer = responses.home;
    else if (route.endsWith('/search')) answer = responses.search;
    else if (route.endsWith('/renew')) answer = responses.renew;
    else if (route.endsWith('/logo')) answer = responses.logo;
    else if (route.endsWith('/documents')) answer = responses.documents(new URLSearchParams(query));
    else if (documentMatch?.[3]) answer = responses.pdf;
    else if (documentMatch) answer = responses.document(documentMatch[1], decodeURIComponent(documentMatch[2]));
    else throw new Error(`unexpected portal path: ${path}`);

    if (answer === NETWORK_FAILURE) throw new TypeError('Failed to fetch');
    return answer;
  });
});

afterEach(() => {
  vi.useRealTimers();
  // The rail remembers its collapsed state per browser; no test may leak it into the next.
  localStorage.clear();
});

describe('PortalPage — token handling (plan §5.4)', () => {
  it('sends the token in the X-Portal-Token header on every call, and never in a URL', async () => {
    const user = userEvent.setup();
    responses.me = jsonResponse({ ...WITH_ENTRY, hasLogo: true });
    responses.logo = blobResponse(new Blob(['png'], { type: 'image/png' }));
    renderPortal();
    await detailReady();
    await pdfReady();

    await user.click(screen.getByTestId('portal-download-pdf'));
    await user.click(screen.getByTestId('portal-panel-close'));
    await listReady();
    await user.click(screen.getByTestId('portal-nav-home'));
    await shellReady();
    await user.type(screen.getByTestId('portal-global-search'), 'FV');
    await waitFor(() => expect(callsTo('/search')).toHaveLength(1));

    // Every GET the page can make: identity, home, logo, a document, its printable, a list, the
    // search. `/renew` is asserted in the link-states block.
    const routes = new Set(apiFetchMock.mock.calls.map(([path]) => path.split('?')[0]));
    expect([...routes].sort()).toEqual([
      '/sws/portal/documents',
      '/sws/portal/documents/invoice/inv-1',
      '/sws/portal/documents/invoice/inv-1/pdf',
      '/sws/portal/home',
      '/sws/portal/logo',
      '/sws/portal/me',
      '/sws/portal/search',
    ]);
    for (const [path, options] of apiFetchMock.mock.calls) {
      expect(path).not.toContain(TOKEN);
      // Strict: `toEqual` would also accept a stray `method: undefined` or a dropped header key.
      expect(options).toStrictEqual(PORTAL_GET_OPTIONS);
    }
  });

  it('never calls the backend when the tab holds no link for the URL tenant', async () => {
    // A link of ANOTHER tenant is held by this tab (sessionStorage, and the module's in-memory
    // fallback): a fresh `/portal/{tenant}` without its own email link has no token.
    rememberPortalLink({ clientId: CLIENT, token: TOKEN });
    sessionStorage.clear();
    renderPortal(`/portal/${OTHER_CLIENT}`);

    await waitFor(() => expect(screen.getByTestId('portal-invalid-link')).toBeInTheDocument());
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

// QA CP-43 — the token is a password that third-party tags would read from `location`.
describe('PortalPage — the token out of the address bar', () => {
  const pathname = () => screen.getByTestId('location-probe').getAttribute('data-pathname');
  const storedLink = () => JSON.parse(sessionStorage.getItem(PORTAL_LINK_STORAGE_KEY));

  it('moves a token still in the URL to sessionStorage and rewrites the URL, keeping the view', async () => {
    renderPortal(`/portal/${CLIENT}/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();

    await waitFor(() => expect(pathname()).toBe(`/portal/${CLIENT}`));
    expect(urlView()).toEqual({ view: 'list', kind: 'INVOICE' });
    expect(storedLink()).toEqual({ clientId: CLIENT, token: TOKEN });
    for (const [, options] of apiFetchMock.mock.calls) expect(options.headers['X-Portal-Token']).toBe(TOKEN);
  });

  it('reads the token from sessionStorage on a scrubbed URL (a reload of /portal/{tenant})', async () => {
    sessionStorage.setItem(PORTAL_LINK_STORAGE_KEY, JSON.stringify({ clientId: CLIENT, token: TOKEN }));
    renderPortal(`/portal/${CLIENT}`);
    await shellReady();

    expect(pathname()).toBe(`/portal/${CLIENT}`);
    expect(callsTo('/me')[0][1].headers['X-Portal-Token']).toBe(TOKEN);
  });

  it('completes a pre-CP-43 /portal/{token} link with the tenant /me reports', async () => {
    responses.me = jsonResponse({ ...IDENTITY, clientId: CLIENT });
    renderPortal(`/portal/${TOKEN}`);
    await shellReady();

    await waitFor(() => expect(pathname()).toBe(`/portal/${CLIENT}`));
    expect(storedLink()).toEqual({ clientId: CLIENT, token: TOKEN });
  });

  it('leaves a pre-CP-43 link on the token-free /portal while /me names no tenant', async () => {
    renderPortal(`/portal/${TOKEN}`);
    await shellReady();

    await waitFor(() => expect(pathname()).toBe('/portal'));
    expect(storedLink()).toEqual({ clientId: null, token: TOKEN });
  });
});

describe('PortalPage — a cold open from the email', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    hookMode.real = false;
    globalThis.fetch = realFetch;
    resetApiSessionForTests();
  });

  it('shows the portal when the app session identity settles while its first requests are in flight', async () => {
    // The customer has no app session: the auth bootstrap resolves the identity (unknown, then
    // anonymous) in parallel with /me and /home. Their answers must not be discarded as belonging
    // to a superseded session, which would put a valid link on the load-error screen.
    let identityReplaced = false;
    registerApiSession({
      getToken: () => null,
      onUnauthorized: vi.fn(),
      scope: {
        capture: () => ({}),
        isSameIdentity: () => !identityReplaced,
        isCurrent: () => !identityReplaced,
      },
    });
    globalThis.fetch = vi.fn(async (url) => {
      identityReplaced = true;
      return new Response(JSON.stringify(String(url).endsWith('/sws/portal/me') ? IDENTITY : HOME), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    hookMode.real = true;

    renderPortal();
    await shellReady();

    expect(screen.getByTestId('portal-home')).toBeInTheDocument();
    expect(screen.getByTestId('portal-customer-name').textContent).toBe('Cliente Uno');
    expect(screen.queryByTestId('portal-load-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-invalid-link')).not.toBeInTheDocument();
  });
});

describe('PortalPage — dead link (plan §5.2)', () => {
  it('shows the generic invalid-link notice, with no retry to loop on', async () => {
    responses.me = jsonResponse({}, { status: 401 });
    renderPortal();

    await waitFor(() => expect(screen.getByTestId('portal-invalid-link')).toBeInTheDocument());
    expect(screen.getByTestId('portal-invalid-link')).toHaveTextContent('portalInvalidLinkTitle');
    expect(screen.getByTestId('portal-invalid-link-description'))
      .toHaveTextContent('portalInvalidLinkDescription');
    expect(screen.queryByTestId('portal-retry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-load-error')).not.toBeInTheDocument();
  });

  it('renders 401, 403 and 404 as one indistinguishable screen', async () => {
    // Not "each of them is an error" — byte-identical output, so nothing rendered can be used
    // to tell an unknown token from a revoked one or from another BP's document.
    const screens = [];
    for (const status of [401, 403, 404]) {
      responses.me = jsonResponse({}, { status });
      const { container, unmount } = renderPortal();
      // eslint-disable-next-line no-await-in-loop -- one render per status, deliberately serial
      await waitFor(() => expect(screen.getByTestId('portal-invalid-link')).toBeInTheDocument());
      screens.push(container.innerHTML);
      unmount();
    }

    expect(screens[1]).toBe(screens[0]);
    expect(screens[2]).toBe(screens[0]);
  });
});

describe('PortalPage — transient failure', () => {
  it('offers a retry that recovers, on a screen distinct from the dead-link one', async () => {
    const user = userEvent.setup();
    responses.home = NETWORK_FAILURE;
    renderPortal();

    await waitFor(() => expect(screen.getByTestId('portal-load-error')).toBeInTheDocument());
    expect(screen.getByTestId('portal-load-error')).toHaveTextContent('portalLoadErrorTitle');
    expect(screen.queryByTestId('portal-invalid-link')).not.toBeInTheDocument();

    responses.home = jsonResponse(HOME);
    await user.click(screen.getByTestId('portal-retry'));

    await shellReady();
    expect(screen.getByTestId('portal-home')).toBeInTheDocument();
    expect(screen.queryByTestId('portal-load-error')).not.toBeInTheDocument();
  });
});

describe('PortalPage — view in the URL', () => {
  it('opens the entry document when the URL names no view', async () => {
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal();
    await detailReady();

    expect(callsTo('/documents/invoice/inv-1')).toHaveLength(1);
    expect(screen.getByTestId('portal-panel-title').textContent).toBe('portalKindInvoice FV/0001');
    expect(screen.getByTestId('location-probe').textContent).toBe('');
  });

  it('opens home when there is neither a view nor an entry document', async () => {
    renderPortal();
    await shellReady();

    expect(screen.getByTestId('portal-home')).toBeInTheDocument();
    expect(callsTo('/home')).toHaveLength(1);
  });

  // A backend newer than the bundle may name a kind this page does not know; indexing the kind
  // table with it would crash the page instead of showing anything.
  for (const [label, entryDocument] of [
    ['an unknown kind', { kind: 'PAYMENT', id: 'pay-1' }],
    ['no id', { kind: 'INVOICE', id: '' }],
  ]) {
    it(`falls back to home when the entry document has ${label}`, async () => {
      responses.me = jsonResponse({ ...IDENTITY, entryDocument });
      renderPortal();
      await shellReady();

      expect(screen.getByTestId('portal-home')).toBeInTheDocument();
      expect(apiFetchMock.mock.calls.some(([path]) => path.includes('/documents/'))).toBe(false);
    });
  }

  it('opens the list of the entry kind, with a notice, when the entry document is gone', async () => {
    responses.me = jsonResponse({ ...IDENTITY, entryKind: 'ORDER' });
    renderPortal();

    await waitFor(() => expect(listKind()).toBe('ORDER'));
    const notice = screen.getByTestId('portal-entry-unavailable');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice.textContent).toBe('portalEntryDocumentUnavailable');
  });

  it('opens home, with the notice, when the gone entry document is of an unknown kind', async () => {
    responses.me = jsonResponse({ ...IDENTITY, entryKind: 'PAYMENT' });
    renderPortal();
    await shellReady();

    expect(screen.getByTestId('portal-home')).toBeInTheDocument();
    expect(screen.getByTestId('portal-entry-unavailable')).toBeInTheDocument();
    expect(callsTo('/documents')).toHaveLength(0);
  });

  it('opens home without the notice when /me names neither an entry document nor an entry kind', async () => {
    renderPortal();
    await shellReady();

    expect(screen.getByTestId('portal-home')).toBeInTheDocument();
    expect(screen.queryByTestId('portal-entry-unavailable')).not.toBeInTheDocument();
  });

  it('lets a view in the URL win over the entry document', async () => {
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();

    expect(listKind()).toBe('INVOICE');
    expect(callsTo('/documents/invoice/inv-1')).toHaveLength(0);
  });

  it('writes the view to the search string on navigation, never the token', async () => {
    const user = userEvent.setup();
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal();
    await detailReady();

    await user.click(screen.getByTestId('portal-panel-close'));
    await listReady();

    expect(urlView()).toEqual({ view: 'list', kind: 'INVOICE' });
    expect(screen.getByTestId('location-probe').textContent).not.toContain(TOKEN);
  });
});

describe('PortalPage — shell', () => {
  // Mobile redesign (2026-11-25): the header lost its user button; the customer (name, email and
  // the language) lives in the bottom bar's "Más" sheet (PO decision: the language must stay).
  it('shows the customer the link belongs to, as the sidebar row and in the mobile "Más" sheet', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();

    expect(screen.getByTestId('portal-customer-name').textContent).toBe('Cliente Uno');
    expect(screen.queryByTestId('portal-customer-avatar')).not.toBeInTheDocument();
    const bottomNav = screen.getByTestId('portal-bottom-nav');
    await user.click(within(bottomNav).getByTestId('portal-bottom-nav-more'));
    const more = within(within(bottomNav).getByTestId('portal-more-user'));
    expect(more.getByTestId('portal-user-menu-header')).toHaveTextContent('Cliente Uno');
    expect(more.getByTestId('portal-user-menu-email').textContent).toBe('cliente@uno.es');
    expect(more.getByTestId('portal-language-es')).toBeInTheDocument();
    expect(more.getByTestId('portal-language-en')).toBeInTheDocument();
  });

  it('shows no customer row and no avatar when /me names no customer', async () => {
    responses.me = jsonResponse({ tenantName: 'Acme SA' });
    renderPortal();
    await shellReady();

    expect(screen.queryByTestId('portal-customer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-customer-avatar')).not.toBeInTheDocument();
  });

  // The "Más" sheet is the only place the mobile language lives: it must not depend on a name.
  it('keeps the language in the mobile "Más" sheet when /me names no customer', async () => {
    const user = userEvent.setup();
    responses.me = jsonResponse({ tenantName: 'Acme SA' });
    renderPortal();
    await shellReady();

    await user.click(screen.getByTestId('portal-bottom-nav-more'));
    const more = within(screen.getByTestId('portal-more-user'));
    expect(more.queryByTestId('portal-user-menu-header')).not.toBeInTheDocument();
    await user.click(more.getByTestId('portal-language-en'));
    expect(localeState.setLocale).toHaveBeenCalledWith('en_US');
  });

  it('draws the header "Creado con etendo.ai" pill from lg and the compact tile below it, never both', () => {
    render(<PortalCreatedWithHeaderLink />);

    const pill = screen.getByTestId('portal-created-with');
    const compact = screen.getByTestId('portal-created-with-compact');
    // jsdom has no layout: what splits the two at the breakpoint is their wrappers' classes.
    expect(pill.parentElement).toHaveClass('hidden', 'lg:flex');
    expect(pill.parentElement).not.toHaveClass('lg:hidden');
    expect(compact.parentElement).toHaveClass('lg:hidden');
    expect(compact.parentElement).not.toHaveClass('hidden');
    // The pill (redesign 2026-11-25): "Creado con", the etendo.ai horizontal logo and the arrow; no
    // "Conoce más" any more. The compact tile is only the mark, named and titled by the label.
    expect(pill).toHaveTextContent('portalCreatedWithShort');
    // Exactly "Creado con" + the wordmark: no second line ("Conoce más") is left.
    expect(pill.textContent).toBe('portalCreatedWithShortetendo.ai');
    expect(within(pill).getByTestId('portal-etendo-wordmark')).toHaveTextContent('etendo.ai');
    expect(pill).toHaveClass('h-10', 'bg-[#1B1A1F]', 'rounded-[200px]');
    expect(compact.textContent).toBe('');
    expect(compact).toHaveAttribute('title', 'portalCreatedWithLinkLabel');
    // Rendered outside a portal (no tenant id known): the base URL, without portal_ref.
    for (const link of [pill, compact]) expectEtendoLink(link, ETENDO_MARKETING_URL);
  });

  // Each view draws its own headers: the link must be in every one of them, and the rail (where
  // the old etendo.ai brand lived) must not carry it.
  for (const { view, path, width, ready, desktopHeader, mobileHeader, mobileLogo = false } of [
    {
      view: 'home',
      path: `/portal/${CLIENT}/${TOKEN}`,
      ready: shellReady,
      desktopHeader: () => screen.getByTestId('portal-view-header'),
      // The mobile redesign's dark summary carries Inicio's header (logo, name, Etendo, search).
      mobileHeader: () => screen.getByTestId('portal-pending-hero'),
    },
    {
      view: 'list',
      path: `/portal/${CLIENT}/${TOKEN}?view=list&kind=INVOICE`,
      ready: listReady,
      desktopHeader: () => screen.getByTestId('portal-view-header'),
      // The list's mobile header has no test id of its own; the only tile on this view is in it.
      mobileHeader: () => screen.getByTestId('portal-created-with-mobile').closest('header'),
      mobileLogo: true,
    },
    {
      // Below md a document is a full page with both headers (desktop opens it as a drawer).
      view: 'document page',
      path: `/portal/${CLIENT}/${TOKEN}?view=doc&kind=ORDER&id=ord-1`,
      width: 500,
      ready: detailReady,
      desktopHeader: () => screen.getByTestId('portal-back').closest('header'),
      mobileHeader: () => screen.getByTestId('portal-back-mobile').closest('header'),
      mobileLogo: true,
    },
  ]) {
    it(`puts the Etendo link in the ${view} desktop and mobile headers, and never in the rail`, async () => {
      await withViewportWidth(width ?? window.innerWidth, async () => {
        renderPortal(path);
        await ready();
      });

      const desktop = within(desktopHeader());
      const mobile = mobileHeader();
      expect(mobile).toHaveClass('md:hidden');
      for (const link of [
        desktop.getByTestId('portal-created-with'),
        desktop.getByTestId('portal-created-with-compact'),
        within(mobile).getByTestId('portal-created-with-mobile'),
      ]) expectEtendoLink(link);
      const rail = within(screen.getByTestId('portal-sidebar'));
      for (const testId of ETENDO_LINK_TEST_IDS) expect(rail.queryByTestId(testId)).not.toBeInTheDocument();
      // QA CP-46: on list and document the issuing company's logo leads the mobile header, before
      // its title; Etendo's tile stays as the secondary link.
      if (mobileLogo) {
        const logo = within(mobile).getByTestId('portal-logo-tile');
        const heading = within(mobile).getByRole('heading', { level: 1 });
        expect(logo.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(logo).toHaveTextContent('AS');
      }
    });
  }

  it('marks the open view in the sidebar and counts what needs the customer', async () => {
    renderPortal();
    await shellReady();

    expect(screen.getByTestId('portal-nav-home')).toHaveAttribute('aria-current', 'page');
    // "Ayuda y soporte" was removed from the rail (PO answer).
    expect(screen.queryByTestId('portal-help')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('portal-nav-quotation')).getByTestId('portal-nav-count').textContent).toBe('2');
    expect(within(screen.getByTestId('portal-nav-invoice')).getByTestId('portal-nav-count').textContent).toBe('1');
    expect(within(screen.getByTestId('portal-nav-order')).queryByTestId('portal-nav-count')).not.toBeInTheDocument();
  });
});

describe('PortalPage — rail', () => {
  it('shows the promo card only while the rail is expanded, and remembers the choice', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();

    const rail = screen.getByTestId('portal-sidebar');
    expect(rail).toHaveAttribute('data-collapsed', 'false');
    // "Empieza gratis" opens marketing's pricing page, with the portal's tenant as portal_ref.
    const cta = within(rail).getByTestId('portal-promo-cta');
    expect(cta).toHaveAttribute('href', withPortalRef(ETENDO_START_FREE_URL));
    expect(cta).toHaveAttribute('target', '_blank');
    expect(cta).toHaveAttribute('rel', 'noopener noreferrer');

    await user.click(screen.getByTestId('portal-rail-toggle'));

    expect(rail).toHaveAttribute('data-collapsed', 'true');
    expect(screen.queryByTestId('portal-promo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-nav-quotation')).not.toBeInTheDocument();
    // Collapsed, "Mis documentos" carries the total of the kinds' counts (2 quotations + 1 invoice).
    expect(screen.getByTestId('portal-nav-documents-count').textContent).toBe('3');
    expect(localStorage.getItem('etendo.portal.railCollapsed')).toBe('true');

    // "Mis documentos" expands the rail again, to choose a kind.
    await user.click(screen.getByTestId('portal-nav-documents'));
    expect(rail).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getByTestId('portal-promo')).toBeInTheDocument();
  });

  // The header is the only place the company appears in the rail. Scoped to `portal-rail-company`:
  // the mobile top bar writes the tenant name too.
  for (const { state, collapse, alt, title } of [
    // Expanded, the name is written beside the logo, so the image stays silent.
    { state: 'expanded', collapse: false, alt: '', title: null },
    // Collapsed, the logo stands alone: it says the company, and its tooltip names it.
    { state: 'collapsed', collapse: true, alt: 'Acme SA', title: 'Acme SA' },
  ]) {
    it(`heads the ${state} rail with the company's round logo`, async () => {
      const user = userEvent.setup();
      responses.me = jsonResponse({ ...IDENTITY, hasLogo: true });
      responses.logo = blobResponse(new Blob(['logo'], { type: 'image/png' }));
      renderPortal();
      await shellReady();
      if (collapse) await user.click(screen.getByTestId('portal-rail-toggle'));

      const company = screen.getByTestId('portal-rail-company');
      const logo = await waitFor(() => within(company).getByTestId('portal-logo'));
      expect(logo).toHaveAttribute('src', 'blob:portal-object');
      expect(logo).toHaveAttribute('alt', alt);
      expect(within(company).getByTestId('portal-logo-tile')).toHaveClass('rounded-full');
      expect(company.getAttribute('title')).toBe(title);
      const names = within(company).queryAllByTestId('portal-tenant-name');
      expect(names.map((name) => name.textContent)).toEqual(collapse ? [] : ['Acme SA']);
    });
  }

  it('shows the company\'s initials without a logo, and no company item in either rail state', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();

    const company = () => screen.getByTestId('portal-rail-company');
    expect(within(company()).queryByTestId('portal-logo')).not.toBeInTheDocument();
    expect(within(company()).getByTestId('portal-logo-tile').textContent).toBe('AS');
    expect(screen.queryByTestId('portal-company')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('portal-rail-toggle'));

    expect(within(company()).getByTestId('portal-logo-tile').textContent).toBe('AS');
    expect(screen.queryByTestId('portal-company')).not.toBeInTheDocument();
    // Collapsed, the menu below the header is only expand, Inicio and "Mis documentos".
    const menu = screen.getByTestId('portal-nav-home').parentElement;
    expect([...menu.children].map((item) => item.dataset.testid))
      .toEqual(['portal-rail-toggle', 'portal-nav-home', 'portal-nav-documents']);
  });
});

describe('PortalPage — language', () => {
  it('offers the language only in the user menu, opened from the customer, and switches to English', async () => {
    const user = userEvent.setup();
    localeState.locale = undefined;
    renderPortal();
    await shellReady();

    // As in the app (PO answer): no standalone language switch; the user (the rail's customer row
    // or the mobile avatar) opens a menu with the language section.
    expect(screen.queryByTestId('portal-language-switch')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-language-en')).not.toBeInTheDocument();
    await user.click(within(screen.getByTestId('portal-sidebar')).getByTestId('portal-customer'));
    // The app's user popup look: the customer's name and email, then the language.
    const header = screen.getByTestId('portal-user-menu-header');
    expect(header).toHaveTextContent('Cliente Uno');
    expect(within(header).getByTestId('portal-user-menu-email').textContent).toBe('cliente@uno.es');

    await user.click(screen.getByTestId('portal-language-en'));
    expect(localeState.setLocale).toHaveBeenCalledWith('en_US');
  });

  for (const [locale, active] of [['es_ES', 'es'], ['en_US', 'en']]) {
    it(`marks ${locale} as the active language`, async () => {
      const user = userEvent.setup();
      localeState.locale = locale;
      renderPortal();
      await shellReady();

      // Mobile: the language is in the bottom bar's "Más" sheet.
      await user.click(screen.getByTestId('portal-bottom-nav-more'));

      for (const short of ['es', 'en']) {
        const { className } = screen.getByTestId(`portal-language-${short}`);
        if (short === active) expect(className).toMatch(/font-semibold/);
        else expect(className).not.toMatch(/font-semibold/);
      }
    });
  }
});

describe('PortalPage — home', () => {
  it('shows the pending balance per currency, and the overdue line on the mobile card', async () => {
    renderPortal();
    await shellReady();

    const pending = screen.getAllByTestId('portal-balance-outstanding');
    expect(pending).toHaveLength(2);
    expect(pending[0].textContent).toBe(eur('1.210,50'));
    // The overdue detail belongs to the mobile summary, once, for the currency that has it (the
    // redesign's badge and "Desde el …"); without a converted figure each currency keeps its total.
    const hero = screen.getByTestId('portal-pending-hero');
    expect(within(hero).getAllByTestId('portal-pending-hero-total')).toHaveLength(2);
    expect(within(hero).getAllByTestId('portal-pending-hero-overdue')).toHaveLength(1);
    // textContent, not toHaveTextContent: the matcher turns the amount's non-breaking space into a
    // plain one, so the formatted amount would never match.
    expect(within(hero).getByTestId('portal-pending-hero-overdue').textContent)
      .toBe(t('portalOverdueAmount', { amount: eur('210,50') }));
    expect(within(hero).getByTestId('portal-pending-hero-since').textContent)
      .toBe(t('portalSinceDate', { date: '15/08/2026' }));
  });

  it('says nothing is pending when there are no balances', async () => {
    responses.home = jsonResponse({ ...HOME, balances: [] });
    renderPortal();
    await shellReady();

    expect(screen.getByTestId('portal-balance-empty').textContent).toBe('—');
    expect(screen.getByTestId('portal-pending-hero')).toHaveTextContent('portalNothingPending');
    expect(screen.queryByTestId('portal-view-pending-invoices')).not.toBeInTheDocument();
  });

  it('shows one tile per kind, with the figure the kind calls out', async () => {
    renderPortal();
    await shellReady();

    for (const [kind, count, label] of [
      ['quotation', '2', 'portalHighlightAwaitingAnswer'],
      ['order', '7', 'portalTileTotal'],
      ['shipment', '0', 'portalTileTotal'],
      ['invoice', '1', 'portalHighlightOverdue'],
    ]) {
      const tile = screen.getByTestId(`portal-tile-${kind}`);
      expect(within(tile).getByTestId('portal-tile-count').textContent).toBe(count);
      expect(tile).toHaveTextContent(label);
    }
  });

  it('opens the tab a tile counts, on all time, since what it counts may be older than a month', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();

    await user.click(screen.getByTestId('portal-tile-invoice'));

    await listReady();
    expect(urlView()).toEqual({ view: 'list', kind: 'INVOICE', group: 'overdue' });
    for (const query of listQueries()) {
      expect([query.get('type'), query.get('group'), query.get('dateFrom')]).toEqual(['invoice', 'overdue', null]);
    }
  });

  it('opens a plain list from a tile with nothing to call out', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();

    await user.click(screen.getByTestId('portal-tile-order'));

    await waitFor(() => expect(listKind()).toBe('ORDER'));
    expect(urlView()).toEqual({ view: 'list', kind: 'ORDER' });
  });

  it('lists the recent documents, the overdue one as overdue, and opens one', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();

    const recent = screen.getAllByTestId('portal-recent-document');
    expect(recent).toHaveLength(2);
    expect(recent[0]).toHaveTextContent('portalKindOrder');
    expect(recent[0]).toHaveTextContent('PV/0001');
    // No instalments on the home: the server's overdue flag decides the badge.
    expect(within(recent[1]).getByTestId('portal-payment-status')).toHaveAttribute('data-state', 'overdue');

    await user.click(recent[0]);

    await detailReady();
    expect(callsTo('/documents/order/ord-1')).toHaveLength(1);
    expect(screen.getByTestId('portal-panel-title').textContent).toBe('portalKindOrder PV/0001');
  });

  it('switches the chart between vertical and horizontal bars, with the month and amount on hover', async () => {
    const user = userEvent.setup();
    responses.home = jsonResponse({
      ...HOME,
      chart: { months: 3, currency: 'EUR', bars: [{ month: '2026-09', amount: 500 }, { month: '2026-10', amount: 1000 }] },
    });
    renderPortal();
    await shellReady();

    const chart = screen.getByTestId('portal-chart-body');
    expect(chart).toHaveAttribute('data-orientation', 'vertical');
    expect(screen.getByTestId('portal-chart-orientation-vertical')).toHaveAttribute('aria-pressed', 'true');
    const tallest = screen.getAllByTestId('portal-chart-bar')[1];
    expect(tallest.style.height).toBe('100%');

    await user.click(screen.getByTestId('portal-chart-orientation-horizontal'));

    expect(chart).toHaveAttribute('data-orientation', 'horizontal');
    expect(screen.getByTestId('portal-chart-orientation-horizontal')).toHaveAttribute('aria-pressed', 'true');
    const [half, full] = screen.getAllByTestId('portal-chart-bar');
    expect([half.style.width, full.style.width]).toEqual(['50%', '100%']);

    await user.hover(full);
    // The canonical formatter puts a no-break space before the symbol.
    expect(screen.getByTestId('portal-chart-tooltip')).toHaveTextContent(/1\.000,00\s€/);
  });

  it('shows one balance badge per currency, side by side in a wrapping row', async () => {
    responses.home = jsonResponse({
      ...HOME,
      balances: [
        { currency: 'EUR', outstanding: 1234567.89, pendingCount: 3 },
        { currency: 'USD', outstanding: 98765.43, pendingCount: 1 },
      ],
      paidThisYear: [{ currency: 'EUR', paid: 10, count: 1 }, { currency: 'USD', paid: 20, count: 2 }],
    });
    renderPortal();
    await shellReady();

    const pending = screen.getAllByTestId('portal-balance-outstanding');
    expect(pending).toHaveLength(2);
    expect(pending[0].parentElement).toBe(pending[1].parentElement);
    expect(pending[0].parentElement).toHaveClass('flex-wrap');
    expect(screen.getByTestId('portal-balance-pending-count').textContent).toBe('4');
    const paid = screen.getAllByTestId('portal-balance-paid-amount');
    expect(paid).toHaveLength(2);
    expect(paid[0].parentElement).toHaveClass('flex-wrap');
  });

  it('refetches only the home aggregates for another chart period', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();
    expect(new URL(callsTo('/home')[0][0], 'http://portal').searchParams.get('months')).toBe('12');

    await user.click(screen.getByTestId('portal-period'));
    await user.click(screen.getByTestId('portal-period-3'));

    await waitFor(() => expect(callsTo('/home')).toHaveLength(2));
    expect(new URL(callsTo('/home')[1][0], 'http://portal').searchParams.get('months')).toBe('3');
    expect(callsTo('/me')).toHaveLength(1);
  });

  it('searches every kind from the header and opens a match', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();

    // The app's own search bar (shared with the top bar), not a portal copy; it never reaches the
    // app's global search: the query goes to the portal's /search only.
    const input = screen.getByTestId('portal-global-search');
    expect(input.closest('.bg-search-bg')).not.toBeNull();
    expect(screen.queryByTestId('global-search-trigger')).not.toBeInTheDocument();
    await user.type(input, 'FV');

    await waitFor(() => expect(screen.getAllByTestId('portal-search-result')).toHaveLength(1));
    expect(new URL(callsTo('/search')[0][0], 'http://portal').searchParams.get('q')).toBe('FV');
    await user.click(screen.getByTestId('portal-search-result'));
    await detailReady();
    expect(urlView()).toEqual({ view: 'doc', kind: 'INVOICE', id: 'inv-2' });
  });

  // ETP-6209: the dropdown is the app's global-search look, one group per kind (heading = the
  // kind's plural), and "Ver todos en <kind>" opens that list on the same search, all time.
  it('groups the matches by kind from the server groups, with their counts', async () => {
    const user = userEvent.setup();
    responses.search = jsonResponse({
      documents: [INVOICES[1], order(1)],
      groups: [
        { kind: 'ORDER', count: 7, documents: [order(1)] },
        { kind: 'INVOICE', count: 1, documents: [INVOICES[1]] },
      ],
    });
    renderPortal();
    await shellReady();
    await user.type(screen.getByTestId('portal-global-search'), 'P');

    const orders = await screen.findByTestId('portal-search-group-order');
    expect(within(orders).getByRole('heading')).toHaveTextContent('portalKindOrderPlural');
    expect(within(orders).getAllByTestId('portal-search-result')).toHaveLength(1);
    expect(within(orders).getByTestId('portal-search-see-all-order')).toHaveTextContent('portalSearchSeeAllIn');
    expect(within(orders).getByTestId('portal-search-group-count')).toHaveTextContent('7');
    // The server's order is kept: orders before invoices here.
    expect(screen.getAllByTestId(/^portal-search-group-(?!count)/).map((el) => el.dataset.testid))
      .toEqual(['portal-search-group-order', 'portal-search-group-invoice']);
  });

  it('groups a flat answer by kind and opens the kind list on the search with "see all"', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();
    await user.type(screen.getByTestId('portal-global-search'), ' FV ');

    const invoices = await screen.findByTestId('portal-search-group-invoice');
    expect(within(invoices).queryByTestId('portal-search-group-count')).not.toBeInTheDocument();
    await user.click(within(invoices).getByTestId('portal-search-see-all-invoice'));

    await listReady();
    expect(urlView()).toEqual({ view: 'list', kind: 'INVOICE', q: 'FV' });
    // Seeded into the list's own search and sent, over all time (the search is not a period).
    expect(screen.getByTestId('portal-search')).toHaveValue('FV');
    const query = listQueries().at(-1);
    expect(query.get('q')).toBe('FV');
    expect(query.has('dateFrom')).toBe(false);
  });

  it('keeps the list search when a document opened from it is closed', async () => {
    const user = userEvent.setup();
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE&q=FV`);
    await listReady();
    expect(screen.getByTestId('portal-search')).toHaveValue('FV');

    await user.click(screen.getAllByTestId('portal-document-open')[0]);
    await detailReady();

    expect(screen.getByTestId('portal-search')).toHaveValue('FV');
  });
});

describe('PortalPage — document list', () => {
  const listPath = (kind, group) => `/portal/${TOKEN}?view=list&kind=${kind}${group ? `&group=${group}` : ''}`;

  it('asks for the rolling last month by default', async () => {
    // Only `Date` is faked, so the debounce and the waits keep their real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 2, 31, 10, 0));
    renderPortal(listPath('INVOICE'));
    await listReady();

    // 31 March → 28 February: the day is clamped to the shorter month.
    expect(listQueries().length).toBeGreaterThan(0);
    for (const query of listQueries()) {
      expect([query.get('dateFrom'), query.get('dateTo')]).toEqual(['2026-02-28', '2026-03-31']);
    }
  });

  it('offers no bulk download and no row checkboxes (PO: out for now)', async () => {
    renderPortal(listPath('INVOICE'));
    await listReady();

    expect(screen.queryByTestId('portal-download-selected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-select-all')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-select-row')).not.toBeInTheDocument();
  });

  it('sums the shown rows per currency', async () => {
    LISTS.invoice = {
      ...LISTS.invoice,
      documents: [...INVOICES, { ...INVOICES[0], id: 'inv-usd', documentNo: 'US/0001', currency: 'USD', taxBase: 10, grandTotal: 12 }],
    };
    try {
      renderPortal(listPath('INVOICE'));
      await listReady();

      const totals = screen.getAllByTestId('portal-document-totals');
      expect(totals).toHaveLength(2);
      expect(totals[0]).toHaveTextContent(/1\.400,00\s€/);
      expect(totals[1]).toHaveTextContent(/12,00/);
    } finally {
      LISTS.invoice = { documents: INVOICES, totalCount: 3, statuses: ['CO', 'CL'] };
    }
  });

  it('offers "all" plus the kind\'s status groups, and a tab sends its group, never a status', async () => {
    const user = userEvent.setup();
    renderPortal(listPath('INVOICE'));
    await listReady();

    const desktopTabs = screen.getAllByRole('tab').map((tab) => tab.getAttribute('data-testid'))
      .filter((id) => !id.endsWith('-mobile'));
    expect(desktopTabs).toEqual([
      'portal-status-tab-all', 'portal-status-tab-pending', 'portal-status-tab-overdue', 'portal-status-tab-paid',
    ]);
    expect(listQueries().every((query) => !query.has('group') && !query.has('status'))).toBe(true);

    await user.click(screen.getByTestId('portal-status-tab-paid'));

    await waitFor(() => expect(listQueries().some((query) => query.get('group') === 'paid')).toBe(true));
    expect(screen.getByTestId('portal-status-tab-paid')).toHaveAttribute('aria-selected', 'true');
    expect(urlView()).toEqual({ view: 'list', kind: 'INVOICE', group: 'paid' });
    expect(listQueries().some((query) => query.has('status'))).toBe(false);
  });

  it('debounces the search and sends it as q', async () => {
    const user = userEvent.setup();
    renderPortal(listPath('INVOICE'));
    await listReady();

    await user.type(screen.getByTestId('portal-search'), 'FV');

    await waitFor(() => expect(listQueries().some((query) => query.get('q') === 'FV')).toBe(true));
    // Typed faster than the debounce: no request went out for the half-typed term.
    expect(listQueries().some((query) => query.get('q') === 'F')).toBe(false);
  });

  it('loads the next page on demand and appends it', async () => {
    const user = userEvent.setup();
    responses.documents = (params) => jsonResponse(params.get('offset') === '2'
      ? { documents: [order(3)], totalCount: 3 }
      : { documents: [order(1), order(2)], totalCount: 3 });
    renderPortal(listPath('ORDER'));
    await listReady();
    expect(screen.getAllByTestId('portal-document-row')).toHaveLength(2);

    await user.click(screen.getByTestId('portal-load-more'));

    await waitFor(() => expect(screen.getAllByTestId('portal-document-row')).toHaveLength(3));
    expect(listQueries().some((query) => query.get('offset') === '2')).toBe(true);
    expect(screen.queryByTestId('portal-load-more')).not.toBeInTheDocument();
  });

  it('shows each invoice\'s type, payment badge and due-date dot', async () => {
    renderPortal(listPath('INVOICE'));
    await listReady();

    const rows = screen.getAllByTestId('portal-document-row');
    const states = rows.map((row) => [
      within(row).getByTestId('portal-document-open').textContent,
      within(row).getByTestId('portal-invoice-type').getAttribute('data-credit-note'),
      within(row).getByTestId('portal-payment-status').getAttribute('data-state'),
      within(row).queryByTestId('portal-due-date')?.getAttribute('data-state') ?? null,
    ]);
    expect(states).toEqual([
      ['FV/0001', 'false', 'paid', 'paid'],
      // The row's server `overdue` flag reaches the badge too (QA CP-18): list, home and detail
      // agree, also inside the "Vencido" tab.
      ['FV/0002', 'false', 'overdue', 'overdue'],
      // A credit note lives among the invoices, as a rectificative.
      ['AB/0001', 'true', 'credit-available', null],
    ]);
    expect(within(rows[2]).getByTestId('portal-invoice-type').textContent).toBe('rectificativeInvoicesTab');
  });

  // QA 24/11 f — "87" beside a list of 140 read as a contradiction: the header counts the set
  // shown (the query's totalCount: 3), never the kind's all-time figure of the home tile (12).
  it('counts in the header the documents of the query, not the home tile figure', async () => {
    renderPortal(listPath('INVOICE'));
    await listReady();

    expect(HOME.tiles.INVOICE.count).not.toBe(LISTS.invoice.totalCount);
    expect(within(screen.getByTestId('portal-view-header')).getByTestId('portal-view-count').textContent)
      .toBe(String(LISTS.invoice.totalCount));
  });

  // QA CP-16 — a tab that stands for one status reads exactly as the app names it (the AD list
  // translation the badges use); the others keep their portal key.
  it.each([
    ['QUOTATION', { awaiting: 'Bajo evaluación', accepted: 'Aceptado', rejected: 'Rechazado' }],
    ['ORDER', { inprogress: 'statusInProcess', completed: 'Completado', voided: 'Anulada' }],
  ])('names the %s tabs with the app status labels', async (kind, expected) => {
    const saved = dictionary.statuses;
    dictionary.statuses = {
      UE: { label: 'Bajo evaluación' }, ETGO_AC: { label: 'Aceptado' }, CJ: { label: 'Rechazado' },
      CO: { label: 'Completado' }, VO: { label: 'Anulada' },
    };
    responses.documents = () => jsonResponse({ documents: [{ ...order(1), kind }], totalCount: 1 });
    try {
      renderPortal(listPath(kind));
      await listReady();

      const toolbar = within(screen.getByTestId('portal-list-toolbar'));
      for (const [code, label] of Object.entries(expected)) {
        expect(toolbar.getByTestId(`portal-status-tab-${code}`)).toHaveTextContent(label);
      }
    } finally {
      dictionary.statuses = saved;
    }
  });

  // ETP-6209: the quick filters are the app list toolbar's own controls (ListFilterBar's buttons,
  // DistinctValuesList options, active border), fed with the portal's fixed groups and types.
  it('filters invoices by document type from the toolbar selector, sent as the subtype parameter', async () => {
    const user = userEvent.setup();
    renderPortal(listPath('INVOICE'));
    await listReady();
    expect(listQueries().some((query) => query.has('subtype'))).toBe(false);
    expect(screen.getByTestId('portal-filter-type')).toHaveTextContent('allTypes');
    expect(screen.getByTestId('portal-filter-type').className).not.toContain('border-primary/40');

    await user.click(screen.getByTestId('portal-filter-type'));
    await user.click(await screen.findByTestId('portal-list-subtype-creditnote'));
    await waitFor(() => expect(listQueries().at(-1).get('subtype')).toBe('creditNote'));
    expect(screen.getByTestId('portal-filter-type').className).toContain('border-primary/40');

    await user.click(screen.getByTestId('portal-filter-type'));
    expect((await screen.findByTestId('portal-list-subtype-creditnote')).closest('[role="option"]'))
      .toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByTestId('portal-list-subtype-all'));
    await waitFor(() => expect(listQueries().at(-1).has('subtype')).toBe(false));
  });

  it('offers no document-type filter on a kind with a single type, and no status selector', async () => {
    responses.documents = () => jsonResponse({ documents: [order(1)], totalCount: 1 });
    renderPortal(listPath('ORDER'));
    await listReady();

    expect(screen.queryByTestId('portal-filter-type')).not.toBeInTheDocument();
    // The status is the tabs' alone (product: a selector beside them repeated them, as the app's
    // hideStatusFilter windows avoid).
    expect(screen.queryByTestId('portal-filter-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('portal-status-tab-completed')).toBeInTheDocument();
  });

  // QA CP-47 — a total over several currencies is ONE converted figure; otherwise the backend's
  // per-currency totals of the whole filtered set; an older backend falls back to the rows loaded.
  describe('the totals row', () => {
    const usdOrder = { ...order(2), currency: 'USD', taxBase: 50, grandTotal: 60 };
    const CONVERTED = { currency: 'EUR', amount: 1234.56, approximate: true };
    const totalsRows = () => screen.getAllByTestId('portal-document-totals');

    it('shows one approximate converted amount, and no per-currency rows, over several currencies', () => {
      render(<PortalListTable
        kind="ORDER"
        documents={[order(1), usdOrder]}
        totals={[{ currency: 'EUR', taxBase: 100, grandTotal: 121 }, { currency: 'USD', taxBase: 50, grandTotal: 60 }]}
        convertedTotal={CONVERTED}
        onOpen={vi.fn()} />);

      expect(totalsRows()).toHaveLength(1);
      const converted = screen.getByTestId('portal-document-totals-converted');
      expect(converted).toHaveAttribute('data-approximate', 'true');
      expect(converted.textContent).toContain(eur('1.234,56'));
    });

    it('keeps the backend per-currency total of the whole set when there is one currency', () => {
      render(<PortalListTable
        kind="ORDER"
        documents={[order(1)]}
        totals={[{ currency: 'EUR', taxBase: 1000, grandTotal: 1210 }]}
        convertedTotal={{ ...CONVERTED, amount: 1210 }}
        onOpen={vi.fn()} />);

      expect(totalsRows()).toHaveLength(1);
      expect(screen.queryByTestId('portal-document-totals-converted')).not.toBeInTheDocument();
      expect(totalsRows()[0].textContent).toContain(eur('1.210,00'));
    });

    it('shows one row per currency when the backend sent no converted figure', () => {
      render(<PortalListTable
        kind="ORDER"
        documents={[order(1), usdOrder]}
        totals={[{ currency: 'EUR', taxBase: 100, grandTotal: 121 }, { currency: 'USD', taxBase: 50, grandTotal: 60 }]}
        convertedTotal={null}
        onOpen={vi.fn()} />);

      expect(totalsRows()).toHaveLength(2);
      expect(screen.queryByTestId('portal-document-totals-converted')).not.toBeInTheDocument();
    });

    it('sums the rows loaded when an older backend sends no totals', () => {
      render(<PortalListTable kind="ORDER" documents={[order(1), order(2)]} onOpen={vi.fn()} />);

      expect(totalsRows()).toHaveLength(1);
      expect(totalsRows()[0].textContent).toContain(eur('242,00'));
    });
  });

  it('shows no amount columns for shipments and no total on the card', async () => {
    renderPortal(listPath('SHIPMENT'));
    await listReady();

    const table = screen.getByTestId('portal-document-table');
    expect(within(table).queryByText('portalColTaxBase')).not.toBeInTheDocument();
    expect(within(table).queryByText('portalColTotal')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('portal-document-card')).queryByText('portalSummaryTotal')).not.toBeInTheDocument();
  });

  it('shows an empty state when the kind has nothing in range', async () => {
    renderPortal(listPath('QUOTATION'));

    await waitFor(() => expect(screen.getByTestId('portal-list-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('portal-document-table')).not.toBeInTheDocument();
  });

  it('opens a document from a click anywhere on its row', async () => {
    const user = userEvent.setup();
    renderPortal(listPath('INVOICE'));
    await listReady();

    await user.click(within(screen.getAllByTestId('portal-document-row')[0]).getByText('—'));

    await detailReady();
    expect(urlView()).toEqual({ view: 'doc', kind: 'INVOICE', id: 'inv-1' });
  });

  it('opens a document once from its number, by click or Enter, with only the row\'s hover', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const row = order(1);
    render(<PortalListTable kind="ORDER" documents={[row]} onOpen={onOpen} />);

    const number = screen.getByTestId('portal-document-open');
    // Hover belongs to the row (Figma): the number has no colour of its own, but keeps a focus ring.
    expect(number.className).not.toMatch(/hover:text-/);
    expect(number).toHaveClass('focus-visible:ring-2');

    // The row opens the same document: the number's click must not reach it a second time.
    await user.click(number);
    expect(onOpen.mock.calls).toEqual([[row]]);

    number.focus();
    await user.keyboard('{Enter}');
    expect(onOpen.mock.calls).toEqual([[row], [row]]);
  });
});

describe('PortalPage — mobile layout', () => {
  // The breakpoint is Tailwind's `md` in the markup, which jsdom does not evaluate: what is
  // asserted is that each half carries the class that shows it on its own side of the breakpoint.
  it('renders the list both as a desktop table and as mobile cards, one card per row', async () => {
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();

    expect(screen.getByTestId('portal-document-table-scroll')).toHaveClass('hidden', 'md:block');
    // ETP-6209: the last row's lift shadow keeps its 24px, taken back from the layout (as DataTable).
    expect(screen.getByTestId('portal-document-table-scroll')).toHaveClass('overflow-x-auto', '!-mb-6');
    expect(screen.getByTestId('portal-document-table').parentElement).toHaveClass('pb-6', 'pointer-events-none');
    expect(screen.getByTestId('portal-document-cards')).toHaveClass('md:hidden');
    expect(screen.getAllByTestId('portal-document-card'))
      .toHaveLength(screen.getAllByTestId('portal-document-row').length);
  });

  it('shows on each invoice card the status when it is not completed, and what is still owed', async () => {
    responses.documents = () => jsonResponse({
      documents: [
        { ...INVOICES[1], overdue: false },
        { ...INVOICES[0], id: 'inv-9', documentNo: 'FV/0009', documentStatus: 'CL' },
      ],
      totalCount: 2,
    });
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();

    const [completed, closed] = screen.getAllByTestId('portal-document-card');
    // Completed is what every listed invoice is: the card shows the payment state instead.
    expect(within(completed).queryByTestId('portal-document-status')).not.toBeInTheDocument();
    expect(within(completed).getByTestId('portal-payment-status')).toHaveAttribute('data-state', 'pending');
    expect(within(completed).getByTestId('portal-card-outstanding').textContent)
      .toBe(`portalColOutstanding ${eur('500,00')}`);
    expect(within(closed).getByTestId('portal-document-status')).toHaveAttribute('data-status', 'CL');
    expect(within(closed).getByTestId('portal-card-outstanding').textContent)
      .toBe(`portalColOutstanding ${eur('0,00')}`);
  });

  it('shows the bottom navigation below the breakpoint, with orders and shipments under "Más"', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();

    expect(screen.getByTestId('portal-sidebar')).toHaveClass('hidden', 'md:flex');
    const bottomNav = screen.getByTestId('portal-bottom-nav');
    expect(bottomNav).toHaveClass('md:hidden');
    expect(within(bottomNav).getByTestId('portal-bottom-nav-home')).toHaveAttribute('aria-current', 'page');
    expect(within(bottomNav).queryByTestId('portal-bottom-nav-order')).not.toBeInTheDocument();

    await user.click(within(bottomNav).getByTestId('portal-bottom-nav-more'));
    await user.click(within(bottomNav).getByTestId('portal-bottom-nav-order'));

    await waitFor(() => expect(listKind()).toBe('ORDER'));
    expect(within(bottomNav).getByTestId('portal-bottom-nav-more')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('PortalPage — document detail', () => {
  it('shows the printable in the PDF viewer, with no data sheet, once it arrives', async () => {
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal();
    await detailReady();

    await waitFor(() => expect(screen.getByTestId('pdf-viewer')).toHaveAttribute('data-url', 'blob:portal-object'));
    expect(screen.queryByTestId('portal-document-sheet')).not.toBeInTheDocument();
    expect(callsTo('/documents/invoice/inv-1/pdf')[0][1]).toStrictEqual(PORTAL_GET_OPTIONS);
  });

  it('opens the printable full screen from the mobile "Ver PDF"', async () => {
    const user = userEvent.setup();
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal();
    await detailReady();
    await pdfReady();

    await user.click(screen.getByTestId('portal-view-pdf'));
    expect(screen.getByTestId('pdf-lightbox')).toHaveAttribute('data-url', 'blob:portal-object');
  });

  it('saves the printable already fetched under a path-safe name on "Descargar PDF"', async () => {
    const user = userEvent.setup();
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal();
    await detailReady();
    await pdfReady();

    await user.click(screen.getByTestId('portal-download-pdf'));

    // `FV/0001` would be saved as `0001.pdf` if the slash reached the download attribute.
    await waitFor(() => expect(saveBlobAsFile).toHaveBeenCalledWith(expect.any(Blob), 'FV-0001.pdf'));
    expect(saveBlobAsFile.mock.calls[0][0].type).toBe('application/pdf');
    // ETP-6209 KPIs: the preview was not a download, so the button re-requests the printable as one.
    const pdfCalls = callsTo('/documents/invoice/inv-1/pdf').map(([path]) => path);
    expect(pdfCalls).toEqual([
      '/sws/portal/documents/invoice/inv-1/pdf?purpose=preview',
      '/sws/portal/documents/invoice/inv-1/pdf?purpose=download&origin=detail',
    ]);
  });

  it('offers only "Descargar PDF" in the preview toolbar kebab, and it saves the same file', async () => {
    const user = userEvent.setup();
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal();
    await detailReady();
    await pdfReady();

    await user.click(screen.getByTestId('portal-pdf-more'));
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    await user.click(screen.getByTestId('portal-pdf-more-download'));

    await waitFor(() => expect(saveBlobAsFile).toHaveBeenCalledWith(expect.any(Blob), 'FV-0001.pdf'));
    expect(callsTo('/documents/invoice/inv-1/pdf').at(-1)[0]).toContain('purpose=download');
  });

  for (const [label, pdfAnswer, note] of [
    ['has none the server could render (404)', jsonResponse({}, { status: 404 }), 'portalPdfUnavailableHint'],
    ['failed to arrive', jsonResponse({}, { status: 500 }), 'portalDownloadFailed'],
  ]) {
    it(`falls back to the data sheet, lines read-only, when the printable ${label}`, async () => {
      responses.pdf = pdfAnswer;
      responses.me = jsonResponse(WITH_ENTRY);
      renderPortal();
      await detailReady();

      await waitFor(() => expect(screen.getByTestId('portal-document-sheet')).toBeInTheDocument());
      expect(screen.getByTestId('portal-pdf-unavailable')).toHaveTextContent(note);
      const lines = screen.getByTestId('portal-document-lines');
      expect(within(lines).getAllByRole('row')).toHaveLength(3); // header + two lines
      expect(lines).toHaveTextContent('Tornillo');
      const detail = screen.getByTestId('portal-document-detail');
      expect(within(detail).queryAllByRole('textbox')).toHaveLength(0);
      expect(within(detail).queryAllByRole('spinbutton')).toHaveLength(0);
      expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
    });
  }

  it('says "PDF no disponible", offers no download and asks for no printable when there is none', async () => {
    renderPortal(`/portal/${TOKEN}?view=doc&kind=ORDER&id=ord-1`);
    await detailReady();

    expect(screen.getByTestId('portal-pdf-unavailable')).toHaveTextContent('portalPdfUnavailable');
    expect(screen.queryByTestId('portal-download-pdf')).not.toBeInTheDocument();
    expect(callsTo('/pdf')).toHaveLength(0);
  });

  it('marks an invoice with an owing past-due instalment as overdue in its summary', async () => {
    renderPortal(`/portal/${TOKEN}?view=doc&kind=INVOICE&id=inv-2`);
    await detailReady();

    const panel = within(screen.getByTestId('portal-document-cards-panel'));
    expect(panel.getByTestId('portal-payment-status')).toHaveAttribute('data-state', 'overdue');
  });

  it('opens a related document', async () => {
    const user = userEvent.setup();
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal();
    await detailReady();

    // The desktop panel's row (the mobile list, hidden here, names it the same way).
    await user.click(screen.getAllByRole('button', { name: 'portalKindOrder #PV/0001' })[0]);

    await waitFor(() => expect(screen.getByTestId('portal-panel-title').textContent).toBe('portalKindOrder PV/0001'));
    expect(callsTo('/documents/order/ord-1')).toHaveLength(1);
    expect(urlView()).toEqual({ view: 'doc', kind: 'ORDER', id: 'ord-1' });
  });

  // QA 24/11 d — one invoice read "Completado" from its shipment and "Pendiente" from its order:
  // a related row shows the DOCUMENT status for every kind, never an invoice's payment state.
  it('shows the document status, not the payment state, of related invoices and credit notes', () => {
    render(
      <PortalRelatedList
        related={[
          { kind: 'INVOICE', id: 'inv-2', documentNo: 'FV/0002', documentStatus: 'CO', grandTotal: 500, outstandingAmount: 500, overdue: true },
          { kind: 'INVOICE', id: 'inv-3', documentNo: 'AB/0001', documentStatus: 'CO', isCreditNote: true, grandTotal: -100, outstandingAmount: -100 },
        ]}
        onRefresh={vi.fn()}
        onOpen={vi.fn()} />,
    );

    const items = screen.getAllByTestId('portal-related-item');
    expect(items.map((item) => within(item).getByTestId('portal-document-status').getAttribute('data-status')))
      .toEqual(['CO', 'CO']);
    for (const item of items) expect(within(item).queryByTestId('portal-payment-status')).not.toBeInTheDocument();
    expect(items.map((item) => item.getAttribute('aria-label')))
      .toEqual(['portalKindInvoice #FV/0002', 'portalKindCreditNote #AB/0001']);
  });

  it('refreshes the related documents in place, without the loading screen', async () => {
    const user = userEvent.setup();
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal();
    await detailReady();
    const reads = callsTo('/documents/invoice/inv-1').filter(([path]) => !path.endsWith('/pdf')).length;

    await user.click(screen.getByTestId('portal-related-refresh'));

    await waitFor(() => expect(callsTo('/documents/invoice/inv-1')
      .filter(([path]) => !path.endsWith('/pdf'))).toHaveLength(reads + 1));
    expect(screen.queryByTestId('portal-document-loading')).not.toBeInTheDocument();
    expect(screen.getByTestId('portal-related-panel')).toBeInTheDocument();
  });

  it('opens a document from a list tab as a drawer over that list, and Escape returns to the tab', async () => {
    const user = userEvent.setup();
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE&group=pending`);
    await listReady();
    const listReads = listQueries().length;

    await user.click(screen.getAllByTestId('portal-document-open')[0]);
    await detailReady();

    expect(screen.getByTestId('portal-detail-drawer')).toBeInTheDocument();
    // The list stays underneath, not re-read.
    expect(screen.getByTestId('portal-document-list')).toBeInTheDocument();
    expect(urlView()).toEqual({ view: 'doc', kind: 'INVOICE', id: 'inv-1', group: 'pending' });
    // The open document is not one of its own related documents (user decision).
    expect(screen.queryByTestId('portal-related-current')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByTestId('portal-detail-drawer')).not.toBeInTheDocument());
    expect(urlView()).toEqual({ view: 'list', kind: 'INVOICE', group: 'pending' });
    expect(listQueries()).toHaveLength(listReads);
  });

  it('says the document is not available when it is not found', async () => {
    renderPortal(`/portal/${TOKEN}?view=doc&kind=ORDER&id=ord-404`);

    await waitFor(() => expect(screen.getByTestId('portal-document-unavailable'))
      .toHaveTextContent('portalDocumentNotFoundTitle'));
    expect(screen.queryByTestId('portal-invalid-link')).not.toBeInTheDocument();
  });
});

describe('PortalPage — a read refused after a valid /me', () => {
  /**
   * The link can change state mid-session (it expires, the customer is blocked). A data read that
   * answers 401 after /me said "valid" re-runs /me once and follows what it says now; only a second
   * refusal ends on the dead-link page. The refused read here is the entry document itself.
   */
  const CASES = [
    {
      label: 'goes to the renewal when the link has expired meanwhile',
      recheck: jsonResponse({ ...WITH_ENTRY, state: 'expired' }),
      testId: 'portal-renewed',
      renewals: 1,
      documentReads: 1,
    },
    {
      label: 'goes to the unavailable screen when the customer was blocked meanwhile',
      recheck: jsonResponse({ ...WITH_ENTRY, state: 'unavailable' }),
      testId: 'portal-unavailable',
      renewals: 0,
      documentReads: 1,
    },
    {
      label: 'goes to the dead-link screen when /me refuses the token too',
      recheck: jsonResponse({}, { status: 401 }),
      testId: 'portal-invalid-link',
      renewals: 0,
      documentReads: 1,
    },
  ];

  for (const row of CASES) {
    it(row.label, async () => {
      responses.me = sequence(jsonResponse(WITH_ENTRY), row.recheck);
      responses.document = () => jsonResponse({}, { status: 401 });
      renderPortal();

      // A re-check and a second read: more than the default second under load.
      await waitFor(() => expect(screen.getByTestId(row.testId)).toBeInTheDocument(),
        { timeout: 5000 });
      // Exactly one re-check, whatever it said: the page never loops on a refusing backend.
      expect(callsTo('/me')).toHaveLength(2);
      expect(callsTo('/documents/invoice/inv-1')).toHaveLength(row.documentReads);
      expect(callsTo('/renew')).toHaveLength(row.renewals);
    });
  }
});

describe('PortalPage — link states', () => {
  /**
   * Each row: what `/me` and `/renew` answer, the screen that must end up rendered and how many
   * renewals go out. Every row also guards that `/home` is never requested: only a valid
   * link may read documents.
   */
  const CASES = [
    {
      label: 'an expired link renews itself and says a new link was sent',
      me: { ...IDENTITY, state: 'expired' },
      renew: jsonResponse({ state: 'renewed', renewal: 'sent' }),
      testId: 'portal-renewed',
      title: 'portalRenewedTitle',
      description: 'portalRenewedDescription',
      renewals: 1,
    },
    {
      label: 'an expired link whose renewal went out recently says so instead',
      me: { ...IDENTITY, state: 'expired' },
      renew: jsonResponse({ state: 'renewed', renewal: 'recentlySent' }),
      testId: 'portal-recently-sent',
      title: 'portalRecentlySentTitle',
      description: 'portalRecentlySentDescription',
      renewals: 1,
    },
    {
      label: 'an expired link that the renewal finds unavailable names the company',
      me: { ...IDENTITY, state: 'expired' },
      renew: jsonResponse({ state: 'unavailable' }),
      testId: 'portal-unavailable',
      title: 'portalUnavailableTitle',
      description: t('portalUnavailableDescription', { tenantName: 'Acme SA' }),
      renewals: 1,
    },
    {
      label: 'an unavailable link names the company and asks for no renewal',
      me: { ...IDENTITY, state: 'unavailable' },
      testId: 'portal-unavailable',
      title: 'portalUnavailableTitle',
      description: t('portalUnavailableDescription', { tenantName: 'Acme SA' }),
      renewals: 0,
    },
    {
      label: 'an unavailable link with no tenant name falls back to the generic copy',
      me: { businessPartnerName: 'Cliente Uno', state: 'unavailable' },
      testId: 'portal-unavailable',
      title: 'portalUnavailableTitle',
      description: 'portalUnavailableDescriptionGeneric',
      renewals: 0,
    },
    {
      label: 'a renewal the server could not send offers a retry',
      me: { ...IDENTITY, state: 'expired' },
      renew: jsonResponse({}, { status: 500 }),
      testId: 'portal-renew-error',
      title: 'portalRenewErrorTitle',
      description: 'portalRenewErrorDescription',
      renewals: 1,
    },
  ];

  for (const row of CASES) {
    it(row.label, async () => {
      responses.me = jsonResponse(row.me);
      if (row.renew) responses.renew = row.renew;
      renderPortal();

      await waitFor(() => expect(screen.getByTestId(row.testId)).toBeInTheDocument());
      const notice = within(screen.getByTestId(row.testId));
      expect(notice.getByRole('heading', { level: 1 }).textContent).toBe(row.title);
      // Exact, not a substring: the generic key contains the tenant-specific one.
      expect(screen.getByTestId(`${row.testId}-description`).textContent).toBe(row.description);
      expect(callsTo('/renew')).toHaveLength(row.renewals);
      expect(callsTo('/home')).toHaveLength(0);
      expect(screen.queryByTestId('portal-shell')).not.toBeInTheDocument();
    });
  }

  it('sends one renewal under StrictMode, POSTed with the token in its header', async () => {
    responses.me = jsonResponse({ ...IDENTITY, state: 'expired' });
    renderPortal(undefined, { strict: true });

    await waitFor(() => expect(screen.getByTestId('portal-renewed')).toBeInTheDocument());
    // StrictMode runs the load effect twice; a second /renew would email the customer twice.
    const renewals = callsTo('/renew');
    expect(renewals).toHaveLength(1);
    expect(renewals[0][0]).not.toContain(TOKEN);
    expect(renewals[0][1]).toStrictEqual({ ...PORTAL_GET_OPTIONS, method: 'POST' });
  });

  it('lets the retry button request a new renewal after one failed', async () => {
    const user = userEvent.setup();
    responses.me = jsonResponse({ ...IDENTITY, state: 'expired' });
    responses.renew = jsonResponse({}, { status: 500 });
    renderPortal();

    await waitFor(() => expect(screen.getByTestId('portal-renew-error')).toBeInTheDocument());
    expect(callsTo('/renew')).toHaveLength(1);

    responses.renew = jsonResponse({ state: 'renewed', renewal: 'sent' });
    await user.click(screen.getByTestId('portal-renew-retry'));

    // The once-only guard was cleared by the failure, so the retry really asks again.
    await waitFor(() => expect(screen.getByTestId('portal-renewed')).toBeInTheDocument());
    expect(callsTo('/renew')).toHaveLength(2);
    expect(screen.queryByTestId('portal-renew-error')).not.toBeInTheDocument();
  });
});

// ─── Mobile redesign (designer's proposal, 2026-11-25) ─────────────────────────────────────────
describe('PortalPage — mobile redesign', () => {
  const quotationRow = (overrides) => ({
    kind: 'QUOTATION', id: 'q-1', documentNo: 'PR/0001', date: '2026-08-01', validUntil: '2999-01-10',
    documentStatus: 'UE', currency: 'EUR', taxBase: 100, grandTotal: 121, canDecide: true, ...overrides,
  });

  // PO decision (2026-11-25): the home tiles keep their own wording on both viewports; only the
  // list tabs and badges use the app's status labels (CP-16).
  it('names the home tiles with the same wording on mobile and desktop', async () => {
    renderPortal();
    await shellReady();

    expect(within(screen.getByTestId('portal-tile-quotation')).getByTestId('portal-tile-status').textContent)
      .toBe('portalHighlightAwaitingAnswer');
    expect(within(screen.getByTestId('portal-tile-invoice')).getByTestId('portal-tile-status').textContent)
      .toBe('portalHighlightOverdue');
    expect(screen.queryByTestId('portal-tile-status-mobile')).not.toBeInTheDocument();
  });

  // Several currencies, converted (CP-47): one total and, when the backend converts the overdue
  // part too, one "≈ … vencidos" badge with no date (a date would mix currencies).
  it('shows the converted overdue badge under the converted pending total', async () => {
    responses.home = jsonResponse({
      ...HOME,
      convertedBalance: { amount: 1300.5, currency: 'EUR', approximate: true },
      convertedOverdue: { amount: 847, currency: 'EUR', approximate: true },
    });
    renderPortal();
    await shellReady();

    const hero = within(screen.getByTestId('portal-pending-hero'));
    expect(hero.getAllByTestId('portal-pending-hero-total')).toHaveLength(1);
    expect(hero.getByTestId('portal-pending-hero-converted')).toHaveAttribute('data-approximate', 'true');
    const badges = hero.getAllByTestId('portal-pending-hero-overdue');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe(t('portalOverdueAmount', { amount: `≈ ${eur('847,00')}` }));
    expect(hero.queryByTestId('portal-pending-hero-since')).not.toBeInTheDocument();
  });

  it.each([
    ['is not converted', null],
    ['is zero', { amount: 0, currency: 'EUR', approximate: true }],
    ['is negative', { amount: -12, currency: 'EUR', approximate: true }],
  ])('hides the overdue badge under the converted total when the overdue part %s', async (_label, convertedOverdue) => {
    responses.home = jsonResponse({
      ...HOME,
      convertedBalance: { amount: 1300.5, currency: 'EUR', approximate: true },
      convertedOverdue,
    });
    renderPortal();
    await shellReady();

    const hero = within(screen.getByTestId('portal-pending-hero'));
    expect(hero.getByTestId('portal-pending-hero-converted')).toBeInTheDocument();
    expect(hero.queryByTestId('portal-pending-hero-overdue')).not.toBeInTheDocument();
  });

  it('shows the recent documents\' status as coloured text on mobile', async () => {
    renderPortal();
    await shellReady();

    const rows = screen.getAllByTestId('portal-recent-document-mobile');
    const status = within(rows[0]).getByTestId('portal-document-status');
    expect(status).not.toHaveClass('border');
    expect(status.className).toMatch(/text-\[#/);
  });

  it('draws the mobile document detail with no lines and no comments', async () => {
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal();
    await detailReady();

    const panel = within(screen.getByTestId('portal-document-cards-panel'));
    expect(panel.getByTestId('portal-mobile-summary')).toBeInTheDocument();
    expect(panel.getByTestId('portal-mobile-summary-taxes')).toHaveTextContent('portalFieldTaxes (IVA 21%)');
    expect(panel.getByTestId('portal-view-pdf')).toBeInTheDocument();
    expect(panel.getAllByTestId('portal-related-item-mobile')).toHaveLength(1);
    // Out of scope (PO decision): neither "Líneas" nor "Comentarios".
    expect(panel.queryByTestId('portal-document-lines-mobile')).not.toBeInTheDocument();
    expect(panel.queryByText('portalLines')).not.toBeInTheDocument();
    expect(panel.queryByText(/portalComments/)).not.toBeInTheDocument();
    expect(panel.queryByText('Tornillo')).not.toBeInTheDocument();
  });

  it.each([
    ['a pending quotation the backend lets this customer answer', {}, true],
    ['a quotation not sent to this address (canDecide false, CP-49)', { canDecide: false }, false],
    ['a quotation without canDecide (as /home and /search rows)', { canDecide: undefined }, false],
    ['a rejected quotation', { documentStatus: 'CJ' }, false],
    ['an expired quotation', { validUntil: '2020-01-10' }, false],
  ])('offers Aceptar / Rechazar in a card\'s options on %s: %s', async (_label, overrides, offered) => {
    const user = userEvent.setup();
    responses.documents = () => jsonResponse({ documents: [quotationRow(overrides)], totalCount: 1 });
    renderPortal(`/portal/${TOKEN}?view=list&kind=QUOTATION`);
    await listReady();

    await user.click(within(screen.getByTestId('portal-document-card')).getByTestId('portal-card-menu'));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByTestId('portal-card-menu-open')).toBeInTheDocument();
    expect(menu.getByTestId('portal-card-menu-pdf')).toBeInTheDocument();
    expect(Boolean(menu.queryByTestId('portal-card-menu-accept'))).toBe(offered);
    expect(Boolean(menu.queryByTestId('portal-card-menu-reject'))).toBe(offered);
  });

  it('opens the detail\'s accept popup from a card\'s options, with its recipients', async () => {
    const user = userEvent.setup();
    responses.documents = () => jsonResponse({ documents: [quotationRow({})], totalCount: 1 });
    responses.document = () => jsonResponse({
      ...quotationRow({}), lines: [], related: [], hasPdf: false,
      decision: { canDecide: true, acceptAvailable: true, email: 'a@acme.es', confirmationRecipients: ['a@acme.es', 'b@acme.es'] },
    });
    renderPortal(`/portal/${TOKEN}?view=list&kind=QUOTATION`);
    await listReady();

    await user.click(within(screen.getByTestId('portal-document-card')).getByTestId('portal-card-menu'));
    await user.click(screen.getByTestId('portal-card-menu-accept'));

    const modal = await screen.findByTestId('portal-accept-modal');
    expect(callsTo('/documents/quotation/q-1')).toHaveLength(1);
    expect(within(modal).getAllByTestId('portal-decision-email-address').map((el) => el.textContent))
      .toEqual(['a@acme.es', 'b@acme.es']);
  });

  it('opens the same quick filters as desktop from the mobile funnel (CP-37)', async () => {
    const user = userEvent.setup();
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();

    await user.click(screen.getByTestId('portal-list-filters-mobile'));
    const panel = within(await screen.findByTestId('portal-list-filters-mobile-panel'));
    // ETP-6209: the app toolbar's selector buttons, and the range picker in its compact layout.
    expect(panel.getByTestId('portal-filter-type-mobile')).toHaveTextContent('allTypes');
    expect(panel.queryByTestId('portal-filter-status-mobile')).not.toBeInTheDocument();
    expect(within(panel.getByTestId('portal-list-filters-mobile-range')).getByTestId('date-range-compact'))
      .toBeInTheDocument();

    await user.click(panel.getByTestId('portal-filter-type-mobile'));
    await user.click(await screen.findByTestId('portal-list-subtype-creditnote-mobile'));
    await waitFor(() => expect(listQueries().at(-1).get('subtype')).toBe('creditNote'));
    expect(panel.getByTestId('portal-filter-type-mobile').className).toContain('border-primary/40');
  });

  it('keeps the bottom bar\'s active item marked with its dot', async () => {
    renderPortal();
    await shellReady();

    const home = screen.getByTestId('portal-bottom-nav-home');
    expect(home).toHaveAttribute('aria-current', 'page');
    expect(home).toHaveClass('text-[#325CFF]');
    expect(within(home).getByTestId('portal-bottom-nav-active-dot')).toBeInTheDocument();
  });
});

describe('PortalPage — mobile home summary', () => {
  it.each([
    ['one pending invoice in the singular', [{ currency: 'EUR', outstanding: 10, pendingCount: 1, overdue: 0, overdueCount: 0 }],
      t('portalPendingInvoicesSentence_one', { count: 1 })],
    ['several, summed over every currency, in the plural', HOME.balances,
      t('portalPendingInvoicesSentence_plural', { count: 4 })],
  ])('counts %s', async (_label, balances, sentence) => {
    responses.home = jsonResponse({ ...HOME, balances });
    renderPortal();
    await shellReady();

    expect(screen.getByTestId('portal-mobile-greeting')).toHaveTextContent(sentence);
  });

  it('opens the invoices on their "pending" tab from «Ver facturas pendientes»', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();

    await user.click(screen.getByTestId('portal-view-pending-invoices'));

    await waitFor(() => expect(listKind()).toBe('INVOICE'));
    expect(urlView()).toEqual({ view: 'list', kind: 'INVOICE', group: 'pending' });
    await waitFor(() => expect(listQueries().at(-1).get('group')).toBe('pending'));
  });
});

describe('PortalPage — mobile document detail', () => {
  const entry = (kind, id) => jsonResponse({ ...IDENTITY, entryDocument: { kind, id } });
  const summaryRows = () => within(screen.getByTestId('portal-mobile-summary'))
    .getAllByTestId(/^portal-mobile-summary-/).map((row) => row.getAttribute('data-testid'));

  it('draws a shipment summary with its status and date, and no amount at all', async () => {
    responses.me = entry('SHIPMENT', 'shp-1');
    responses.document = () => jsonResponse({
      kind: 'SHIPMENT', id: 'shp-1', documentNo: 'AL/0001', date: '2026-08-01', documentStatus: 'CO',
      lines: [], taxes: [], related: [], hasPdf: false,
    });
    renderPortal();
    await detailReady();

    const summary = within(screen.getByTestId('portal-mobile-summary'));
    expect(summary.getByTestId('portal-document-status')).toHaveAttribute('data-status', 'CO');
    expect(summaryRows()).toEqual(['portal-mobile-summary-date']);
  });

  it.each([
    ['one tax', [{ tax: 'IVA 21%', taxableAmount: 100, taxAmount: 21 }], 'portalFieldTaxes (IVA 21%)'],
    ['two taxes', [{ tax: 'IVA 21%', taxableAmount: 100, taxAmount: 21 }, { tax: 'IVA 10%', taxableAmount: 50, taxAmount: 5 }], 'portalFieldTaxes'],
    ['no tax', [], 'portalFieldTaxes'],
  ])('names the tax in the taxes row only with exactly one tax: %s', async (_label, taxes, label) => {
    responses.me = entry('ORDER', 'ord-1');
    responses.document = () => jsonResponse({ ...DETAILS['order/ord-1'], taxBase: 150, taxes });
    renderPortal();
    await detailReady();

    const row = screen.getByTestId('portal-mobile-summary-taxes');
    expect(row.querySelector('dt').textContent).toBe(label);
    expect(summaryRows()).toEqual(expect.arrayContaining(['portal-mobile-summary-taxBase', 'portal-mobile-summary-taxes']));
  });

  // The mobile and desktop related lists coexist in the DOM (the breakpoint hides one): each keeps
  // its own ids, so a test or an E2E step can never pick the hidden one by mistake.
  it('gives the mobile related rows their own ids, while desktop keeps portal-related-item', async () => {
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal();
    await detailReady();

    const mobile = within(screen.getByTestId('portal-document-cards-panel'));
    const desktop = within(screen.getByTestId('portal-related-panel'));
    expect(mobile.getAllByTestId('portal-related-item-mobile')).toHaveLength(1);
    expect(mobile.queryByTestId('portal-related-item')).not.toBeInTheDocument();
    expect(desktop.getAllByTestId('portal-related-item')).toHaveLength(1);
    expect(desktop.queryByTestId('portal-related-item-mobile')).not.toBeInTheDocument();
  });

  it('says there are no related documents with the mobile and desktop ids apart', async () => {
    responses.me = entry('INVOICE', 'inv-2');
    renderPortal();
    await detailReady();

    const mobile = within(screen.getByTestId('portal-document-cards-panel'));
    const desktop = within(screen.getByTestId('portal-related-panel'));
    expect(mobile.getByTestId('portal-related-empty-mobile')).toBeInTheDocument();
    expect(mobile.queryByTestId('portal-related-empty')).not.toBeInTheDocument();
    expect(desktop.getByTestId('portal-related-empty')).toBeInTheDocument();
    expect(desktop.queryByTestId('portal-related-empty-mobile')).not.toBeInTheDocument();
  });
});

describe('PortalTag palettes', () => {
  it.each([
    ['the app badge by default', undefined, 'info', ['border', 'rounded-lg'], []],
    ['the Figma badge', 'figma', 'info', ['border', 'bg-[#EBEFFF]', 'text-[#2B48BC]'], []],
    ['coloured text, with no badge', 'text', 'info', ['text-[#2F55E8]'], ['border', 'rounded-lg', 'bg-[#EBEFFF]']],
    ['neutral text for an unknown tone', 'text', 'nope', ['text-[#6B7280]'], ['border']],
  ])('draws %s', (_label, palette, tone, present, absent) => {
    render(<PortalTag palette={palette} tone={tone} testId="tag">x</PortalTag>);

    const tag = screen.getByTestId('tag');
    expect(tag).toHaveClass(...present);
    for (const cls of absent) expect(tag).not.toHaveClass(cls);
  });
});

describe('PortalPage — mobile list card options and filters', () => {
  const cardOf = (documentNo) => screen.getAllByTestId('portal-document-card')
    .find((card) => card.textContent.includes(documentNo));

  async function openCardMenu(user, documentNo) {
    await user.click(within(cardOf(documentNo)).getByTestId('portal-card-menu'));
  }

  it('saves the printable under a path-safe name from a card\'s "Descargar PDF"', async () => {
    const user = userEvent.setup();
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();

    await openCardMenu(user, 'FV/0002');
    await user.click(screen.getByTestId('portal-card-menu-pdf'));

    await waitFor(() => expect(saveBlobAsFile).toHaveBeenCalledWith(expect.any(Blob), 'FV-0002.pdf'));
    expect(saveBlobAsFile.mock.calls[0][0].type).toBe('application/pdf');
    expect(callsTo('/documents/invoice/inv-2/pdf')).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing printable (404)', 404, 'portalPdfUnavailable'],
    ['a failed download (500)', 500, 'portalDownloadFailed'],
  ])('says so on a toast for %s, and saves nothing', async (_label, status, key) => {
    const user = userEvent.setup();
    responses.pdf = jsonResponse({}, { status });
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();

    await openCardMenu(user, 'FV/0002');
    await user.click(screen.getByTestId('portal-card-menu-pdf'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(key));
    expect(saveBlobAsFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId('portal-invalid-link')).not.toBeInTheDocument();
  });

  // A refused read re-runs /me once (see "a read refused after a valid /me"); /me refuses too here.
  it('hands a card\'s download refused as an invalid link to the page, which ends on the dead-link screen', async () => {
    const user = userEvent.setup();
    responses.pdf = jsonResponse({}, { status: 401 });
    responses.me = sequence(jsonResponse(IDENTITY), jsonResponse({}, { status: 401 }));
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();

    await openCardMenu(user, 'FV/0002');
    await user.click(screen.getByTestId('portal-card-menu-pdf'));

    await waitFor(() => expect(screen.getByTestId('portal-invalid-link')).toBeInTheDocument());
    expect(callsTo('/me')).toHaveLength(2);
    expect(toast.error).not.toHaveBeenCalled();
  });

  describe('Aceptar from a card', () => {
    const row = {
      kind: 'QUOTATION', id: 'q-1', documentNo: 'PR/0001', date: '2026-08-01', validUntil: '2999-01-10',
      documentStatus: 'UE', currency: 'EUR', taxBase: 100, grandTotal: 121, canDecide: true,
    };

    beforeEach(() => {
      responses.documents = () => jsonResponse({ documents: [row], totalCount: 1 });
    });

    it.each([
      ['a failed read with a toast', 500, () => expect(toast.error).toHaveBeenCalledWith('portalDecisionError')],
      ['a dead link with the dead-link screen', 401, () => expect(screen.getByTestId('portal-invalid-link')).toBeInTheDocument()],
    ])('opens no popup when the detail cannot be re-read, and ends on %s', async (_label, status, expectOutcome) => {
      const user = userEvent.setup();
      responses.document = () => jsonResponse({}, { status });
      // A refused read re-runs /me once; /me refuses too, so the page ends on the dead link.
      responses.me = sequence(jsonResponse(IDENTITY), jsonResponse({}, { status: 401 }));
      renderPortal(`/portal/${TOKEN}?view=list&kind=QUOTATION`);
      await listReady();

      await openCardMenu(user, 'PR/0001');
      await user.click(screen.getByTestId('portal-card-menu-accept'));

      await waitFor(expectOutcome);
      expect(callsTo('/documents/quotation/q-1')).toHaveLength(1);
      expect(screen.queryByTestId('portal-accept-modal')).not.toBeInTheDocument();
    });

    it('closes the popup and says why on a toast when the request is refused', async () => {
      const user = userEvent.setup();
      responses.document = () => jsonResponse({
        ...row, lines: [], related: [], hasPdf: false,
        decision: { canDecide: true, acceptAvailable: true, email: 'a@acme.es' },
      });
      const answer = apiFetchMock.getMockImplementation();
      apiFetchMock.mockImplementation(async (path, options) => (path.split('?')[0].endsWith('/decision')
        ? jsonResponse({ error: 'cooldown' }, { status: 409 })
        : answer(path, options)));
      renderPortal(`/portal/${TOKEN}?view=list&kind=QUOTATION`);
      await listReady();

      await openCardMenu(user, 'PR/0001');
      await user.click(screen.getByTestId('portal-card-menu-accept'));
      await user.click(await screen.findByTestId('portal-accept-continue'));

      await waitFor(() => expect(toast.error)
        .toHaveBeenCalledWith(t('portalDecisionCooldown', { tenantName: 'Acme SA' })));
      expect(screen.queryByTestId('portal-accept-modal')).not.toBeInTheDocument();
      // The list stays: the card can open the flow again.
      expect(screen.getByTestId('portal-document-card')).toBeInTheDocument();
    });
  });

  it('filters the status on mobile through the status tabs, not the funnel', async () => {
    const user = userEvent.setup();
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();

    await user.click(screen.getByTestId('portal-list-filters-mobile'));
    const panel = within(await screen.findByTestId('portal-list-filters-mobile-panel'));
    expect(panel.queryByTestId('portal-filter-status-mobile')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByTestId('portal-status-tab-pending-mobile'));
    await waitFor(() => expect(listQueries().at(-1).get('group')).toBe('pending'));
    expect(urlView()).toEqual({ view: 'list', kind: 'INVOICE', group: 'pending' });
    expect(screen.getByTestId('portal-status-tab-pending-mobile')).toHaveAttribute('aria-selected', 'true');
  });

  it.each([
    ['a preset replaces the default month', 'dateRangeLast12Months', (from, initial) => expect(from).not.toBe(initial)],
    ['"all time" drops the date bounds', 'dateRangeAllTime', (from) => expect(from).toBeNull()],
  ])('sends the date range picked in the mobile funnel: %s', async (_label, preset, expectFrom) => {
    const user = userEvent.setup();
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();
    const initialFrom = listQueries().at(-1).get('dateFrom');
    expect(initialFrom).toBeTruthy();

    await user.click(screen.getByTestId('portal-list-filters-mobile'));
    const range = within(await screen.findByTestId('portal-list-filters-mobile-range'));
    await user.click(range.getByRole('button', { name: preset }));

    await waitFor(() => expect(listQueries().length).toBeGreaterThan(1));
    expectFrom(listQueries().at(-1).get('dateFrom'), initialFrom);
  });
});

// QA pass 2, CP-18b: the «Vencido» tab was empty while Inicio said «1 Vencida» — the default range
// (the last month) hid every older overdue invoice. A "state" tab lists everything in its state.
describe('PortalPage — state tabs list the whole history', () => {
  // As the server filters: an old overdue invoice only comes back without a date range.
  const OLD_OVERDUE = {
    kind: 'INVOICE', id: 'inv-old', documentNo: 'FV/0099', date: '2025-01-10', dueDate: '2025-02-10',
    documentStatus: 'CO', currency: 'EUR', taxBase: 100, grandTotal: 121, outstandingAmount: 121, overdue: true,
  };
  beforeEach(() => {
    responses.documents = (params) => jsonResponse(params.get('dateFrom')
      ? LISTS.invoice
      : { documents: [OLD_OVERDUE], totalCount: 1, statuses: ['CO'] });
  });

  it('switches «Vencido» to all time, lists the old overdue invoice and says «Todo el tiempo»', async () => {
    const user = userEvent.setup();
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();
    expect(listQueries().at(-1).get('dateFrom')).toBeTruthy();

    await user.click(screen.getByTestId('portal-status-tab-overdue'));

    await waitFor(() => {
      const query = listQueries().at(-1);
      expect([query.get('group'), query.get('dateFrom'), query.get('dateTo')]).toEqual(['overdue', null, null]);
    });
    await waitFor(() => expect(within(screen.getByTestId('portal-document-table')).getByText('FV/0099')).toBeInTheDocument());
    expect(screen.getByTestId('portal-date-range')).toHaveTextContent('dateRangeAllTime');
  });

  it.each(['awaiting', 'pending', 'inProgress'])('treats the %s tab as a state tab too', async (group) => {
    const user = userEvent.setup();
    const kind = group === 'awaiting' ? 'QUOTATION' : group === 'inProgress' ? 'ORDER' : 'INVOICE';
    responses.documents = () => jsonResponse({ documents: [order(1)], totalCount: 1 });
    renderPortal(`/portal/${TOKEN}?view=list&kind=${kind}`);
    await listReady();

    await user.click(screen.getByTestId(`portal-status-tab-${group.toLowerCase()}`));

    await waitFor(() => expect(listQueries().at(-1).get('group')).toBe(group));
    expect(listQueries().at(-1).get('dateFrom')).toBeNull();
  });

  // «Pagado», «Aceptado» and «Todos» (reached from «Pagado», since it is the tab a list opens on)
  // keep the range: the request still carries dateFrom/dateTo.
  it.each([
    ['«Pagado»', 'INVOICE', ['paid'], 'paid'],
    ['«Aceptado»', 'QUOTATION', ['accepted'], 'accepted'],
    ['«Todos»', 'INVOICE', ['paid', 'all'], null],
  ])('keeps the chosen range on the period tab %s', async (_label, kind, clicks, expectedGroup) => {
    const user = userEvent.setup();
    responses.documents = () => jsonResponse({ documents: [order(1)], totalCount: 1 });
    renderPortal(`/portal/${TOKEN}?view=list&kind=${kind}`);
    await listReady();
    const before = listQueries().length;

    for (const tab of clicks) await user.click(screen.getByTestId(`portal-status-tab-${tab}`));

    await waitFor(() => expect(listQueries().length).toBeGreaterThan(before + clicks.length - 1));
    await waitFor(() => expect(listQueries().at(-1).get('group')).toBe(expectedGroup));
    const query = listQueries().at(-1);
    expect(query.get('dateFrom')).toBeTruthy();
    expect(query.get('dateTo')).toBeTruthy();
    expect(screen.getByTestId('portal-date-range')).not.toHaveTextContent('dateRangeAllTime');
  });
});

// Marketing's UTM document (2026-11-25): the portal's etendo.ai links carry `portal_ref`, the
// tenant's AD_Client_ID — only when the portal knows it, and never the token.
describe('PortalPage — portal_ref on the etendo.ai links', () => {
  it('adds no portal_ref when the portal does not know its tenant (a pre-CP-43 link)', async () => {
    renderPortal(`/portal/${TOKEN}`);
    await shellReady();

    expect(within(screen.getByTestId('portal-sidebar')).getByTestId('portal-promo-cta'))
      .toHaveAttribute('href', ETENDO_START_FREE_URL);
    expectEtendoLink(within(screen.getByTestId('portal-view-header')).getByTestId('portal-created-with'), ETENDO_MARKETING_URL);
  });

  it('takes the tenant from /me when the URL does not name it', async () => {
    responses.me = jsonResponse({ ...IDENTITY, clientId: OTHER_CLIENT });
    renderPortal(`/portal/${TOKEN}`);
    await shellReady();

    await waitFor(() => expect(within(screen.getByTestId('portal-sidebar')).getByTestId('portal-promo-cta'))
      .toHaveAttribute('href', `${ETENDO_START_FREE_URL}&portal_ref=${OTHER_CLIENT}`));
  });
});


// ETP-6209 KPIs — the origin of each document open (navigation state → `?origin=`), the PDF's
// purpose, and the etendo.ai click count. Nothing of it in the page URL.
describe('PortalPage — KPI origins, PDF purpose and Etendo clicks', () => {
  // The in-page twin of the boot scrub: a token still in the URL starts a new KPI session.
  it('drops the tab\'s KPI session when a token arrives in the URL, and keeps it on a token-free reload', async () => {
    const SESSION = '0123456789abcdef0123456789abcdef';
    sessionStorage.setItem('etgo.portal.session', SESSION);
    renderPortal();
    await shellReady();
    expect(sessionStorage.getItem('etgo.portal.session')).toBeNull();

    cleanup();
    sessionStorage.setItem('etgo.portal.session', SESSION);
    renderPortal(`/portal/${CLIENT}`);
    await shellReady();
    expect(sessionStorage.getItem('etgo.portal.session')).toBe(SESSION);
  });

  const documentCalls = (kind, id) => callsTo(`/documents/${kind}/${id}`).map(([path]) => path);
  const originOf = (path) => new URL(path, 'http://portal').searchParams.get('origin');

  it('marks the link\'s own document as origin=link', async () => {
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal();
    await detailReady();

    expect(documentCalls('invoice', 'inv-1').map(originOf)).toEqual(['link']);
    expect(screen.getByTestId('location-probe').textContent).not.toContain('origin');
  });

  it('marks an open from Inicio\'s recent documents as origin=home', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();

    await user.click(screen.getAllByTestId('portal-recent-document')[0]);
    await detailReady();

    expect(documentCalls('order', 'ord-1').map(originOf)).toEqual(['home']);
  });

  it('marks an open from the header search as origin=search', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();

    await user.type(screen.getByTestId('portal-global-search'), 'FV');
    await user.click(await screen.findByTestId('portal-search-result'));
    await detailReady();

    expect(documentCalls('invoice', 'inv-2').map(originOf)).toEqual(['search']);
  });

  it('marks an open from a list row as origin=list', async () => {
    const user = userEvent.setup();
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();

    await user.click(within(screen.getAllByTestId('portal-document-row')[0]).getByTestId('portal-document-open'));
    await detailReady();

    expect(documentCalls('invoice', 'inv-1').map(originOf)).toEqual(['list']);
  });

  it('marks an open from a related document as origin=related, and the related refresh as refresh', async () => {
    const user = userEvent.setup();
    responses.me = jsonResponse(WITH_ENTRY);
    renderPortal();
    await detailReady();

    await user.click(screen.getByTestId('portal-related-refresh'));
    await waitFor(() => expect(documentCalls('invoice', 'inv-1').map(originOf)).toEqual(['link', 'refresh']));

    await user.click(screen.getAllByRole('button', { name: 'portalKindOrder #PV/0001' })[0]);
    await waitFor(() => expect(documentCalls('order', 'ord-1').map(originOf)).toEqual(['related']));
  });

  it('asks the printable as a preview for the detail and as a download from a card\'s menu', async () => {
    const user = userEvent.setup();
    responses.documents = () => jsonResponse({
      documents: [{
        kind: 'QUOTATION', id: 'q-1', documentNo: 'PR/0001', date: '2026-08-01', validUntil: '2999-01-10',
        documentStatus: 'UE', currency: 'EUR', taxBase: 100, grandTotal: 121, canDecide: true,
      }],
      totalCount: 1,
    });
    renderPortal(`/portal/${TOKEN}?view=list&kind=QUOTATION`);
    await listReady();

    await user.click(within(screen.getByTestId('portal-document-card')).getByTestId('portal-card-menu'));
    await user.click(await screen.findByTestId('portal-card-menu-pdf'));
    await waitFor(() => expect(callsTo('/documents/quotation/q-1/pdf').map(([path]) => path))
      .toEqual(['/sws/portal/documents/quotation/q-1/pdf?purpose=download&origin=list']));

    await user.click(within(screen.getByTestId('portal-document-card')).getByTestId('portal-card-menu'));
    await user.click(await screen.findByTestId('portal-card-menu-reject'));
    await waitFor(() => expect(documentCalls('quotation', 'q-1').map(originOf)).toEqual(['action']));
  });

  it('counts a click on the etendo.ai links, without holding the link back', async () => {
    const user = userEvent.setup();
    renderPortal();
    await shellReady();

    const banner = within(screen.getByTestId('portal-sidebar')).getByTestId('portal-promo-cta');
    banner.addEventListener('click', (event) => event.preventDefault());
    await user.click(banner);
    const pill = within(screen.getByTestId('portal-view-header')).getByTestId('portal-created-with');
    pill.addEventListener('click', (event) => event.preventDefault());
    await user.click(pill);

    const clicks = callsTo('/events/etendo-click');
    expect(clicks.map(([, options]) => JSON.parse(options.body))).toEqual([
      { reference: 'startFree', location: 'rail' },
      { reference: 'learnMore', location: 'header' },
    ]);
    expect(clicks[0][1]).toMatchObject({ method: 'POST', keepalive: true });
    expect(clicks[0][1].headers['X-Portal-Token']).toBe(TOKEN);
  });
});

// QA pass 3 — a state tab must send ONE request, and leaving it must restore the period range.
describe('PortalPage — state tabs and the period range', () => {
  it('sends one request on entering «Vencido» and restores the month on «Todos»', async () => {
    const user = userEvent.setup();
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();
    // The mount itself sends ONE request: the per-kind reset used to run as an effect after the
    // first commit and re-request the list with a fresh range object (every list GET went out twice).
    expect(listQueries()).toHaveLength(1);
    const monthFrom = listQueries().at(-1).get('dateFrom');
    const before = listQueries().length;

    await user.click(screen.getByTestId('portal-status-tab-overdue'));
    await waitFor(() => expect(listQueries().at(-1).get('group')).toBe('overdue'));
    const overdueQueries = listQueries().slice(before);
    expect(overdueQueries).toHaveLength(1);
    expect(overdueQueries[0].get('dateFrom')).toBeNull();
    expect(screen.getByTestId('portal-date-range')).toHaveTextContent('dateRangeAllTime');

    await user.click(screen.getByTestId('portal-status-tab-all'));
    await waitFor(() => expect(listQueries().at(-1).get('group')).toBeNull());
    expect(listQueries().at(-1).get('dateFrom')).toBe(monthFrom);
    expect(screen.getByTestId('portal-date-range')).not.toHaveTextContent('dateRangeAllTime');
  });

  // The date button carries the app toolbar's active border only when the range is not the tab's
  // default: the rolling month on a period tab, all time on a state tab.
  it('marks the date button active only when the range differs from the tab default', async () => {
    const user = userEvent.setup();
    const pickPreset = async (name) => {
      await user.click(screen.getByTestId('portal-date-range'));
      await user.click(await screen.findByRole('button', { name }));
    };
    const isActive = () => screen.getByTestId('portal-date-range').className.includes('border-primary/40');
    renderPortal(`/portal/${TOKEN}?view=list&kind=INVOICE`);
    await listReady();
    expect(isActive()).toBe(false);

    await pickPreset('dateRangeLast7Days');
    await waitFor(() => expect(isActive()).toBe(true));

    await user.click(screen.getByTestId('portal-status-tab-overdue'));
    await waitFor(() => expect(listQueries().at(-1).get('group')).toBe('overdue'));
    expect(isActive()).toBe(false);

    await pickPreset('dateRangeLast7Days');
    await waitFor(() => expect(listQueries().at(-1).get('dateFrom')).toBeTruthy());
    expect(isActive()).toBe(true);
  });
});
