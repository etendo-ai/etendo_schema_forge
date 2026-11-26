import { Suspense } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LogoutRoute } from '@etendo-ai/app-shell-core/auth';
import { useLogout } from './auth/useLogout.js';
import WindowLoader from './windows/WindowLoader.jsx';
import PreviewPage from './preview/PreviewPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import FirstStepsPage from './pages/FirstStepsPage.jsx';
import SalesPage from './pages/SalesPage.jsx';
import InventoryPage from './pages/InventoryPage.jsx';
import PurchasesPage from './pages/PurchasesPage.jsx';
import AccountingPage from './pages/AccountingPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import CrmPage from './pages/CrmPage.jsx';
import HrPage from './pages/HrPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import ReportViewerPage from './pages/ReportViewerPage.jsx';
import BankConnectionCallbackPage from './pages/BankConnectionCallbackPage.jsx';
import PisCallbackPage from './pages/PisCallbackPage.jsx';
import ArtifactViewerPage from './pages/ArtifactViewerPage.jsx';
import { useSupportSession } from './hooks/useSupportSession.js';
import { isSupportRestrictedRoute } from './lib/supportSession.js';
import { lazyWithReload } from './lib/lazyWithReload.js';
import RouteChunkErrorBoundary from './components/RouteChunkErrorBoundary.jsx';

const OnboardingPage = lazyWithReload(() => import('./pages/OnboardingPage.jsx'));
const SmartScanPage = lazyWithReload(() => import('./pages/SmartScanPage.jsx'));
const OAuth2ClientsPage = lazyWithReload(() => import('./pages/OAuth2ClientsPage.jsx'));
const ApiKeysPage = lazyWithReload(() => import('./pages/ApiKeysPage.jsx'));
const DocumentTemplatesPage = lazyWithReload(() => import('./pages/DocumentTemplatesPage.jsx'));
const RolesOverviewPage = lazyWithReload(() => import('./pages/RolesOverviewPage.jsx'));
const AcctProcessMonitorPage = lazyWithReload(() => import('./pages/AcctProcessMonitorPage.jsx'));
const AuthorizePage = lazyWithReload(() => import('./pages/AuthorizePage.jsx'));
const QuickSalesOrderPage = lazyWithReload(() => import('./pages/QuickSalesOrderPage.jsx'));
const QuickPurchaseOrderPage = lazyWithReload(() => import('./pages/QuickPurchaseOrderPage.jsx'));
const UnifiedCalendarPage = lazyWithReload(() => import('./pages/UnifiedCalendarPage.jsx'));
const AppStorePage = lazyWithReload(() => import('./pages/AppStorePage.jsx'));
const UpgradePage = lazyWithReload(() => import('./pages/UpgradePage.jsx'));
const AccountSettingsPage = lazyWithReload(() => import('./pages/AccountSettingsPage.jsx'));
const MyCompaniesPage = lazyWithReload(() => import('./pages/MyCompaniesPage.jsx'));
const InviteAcceptancePage = lazyWithReload(() => import('./pages/InviteAcceptancePage.jsx'));
const DevLifecyclePage = import.meta.env.DEV
  ? lazyWithReload(() => import('./pages/DevLifecyclePage.jsx')) : null;
const PortalPage = lazyWithReload(() => import('./pages/PortalPage.jsx'));
const PortalDecisionPage = lazyWithReload(() => import('./pages/PortalDecisionPage.jsx'));
const SupportAccessPage = lazyWithReload(() => import('./pages/SupportAccessPage.jsx'));

const LOADING_FALLBACK = <div className="p-8 text-muted-foreground">Loading...</div>;

function RuntimeLogoutRoute() {
  const logout = useLogout();
  return <LogoutRoute cleanup={logout} safeDestination="/login" data-testid="LogoutRoute__e8c60d" />;
}

// ETP-5351 — a support session never reaches account settings, billing or the screens that mint
// long-lived credentials (`SUPPORT_RESTRICTED_ROUTES`). Hiding the entries is not enough: a typed
// URL must land on the home page too, not on a screen whose every request the backend refuses.
function SupportRestrictedRoute({ children }) {
  const { isSupportMode } = useSupportSession();
  if (isSupportMode) return <Navigate to="/dashboard" replace data-testid="Navigate__support-restricted" />;
  return children;
}

// Resets on navigation: a failed route must not keep its fallback on the next lazy page.
function LocationKeyedBoundary({ children }) {
  const { pathname } = useLocation();
  return (
    <RouteChunkErrorBoundary resetKey={pathname} data-testid="RouteChunkErrorBoundary__e8c60d">
      {children}
    </RouteChunkErrorBoundary>
  );
}

function lazyElement(Component, extraProps = {}) {
  return (
    <LocationKeyedBoundary data-testid="LocationKeyedBoundary__e8c60d">
      <Suspense fallback={LOADING_FALLBACK} data-testid="Suspense__e8c60d">
        <Component {...extraProps} data-testid="Component__e8c60d" />
      </Suspense>
    </LocationKeyedBoundary>
  );
}

function lazyRoute(path, Component, extraProps = {}) {
  const page = lazyElement(Component, extraProps);
  return {
    path,
    public: false,
    element: isSupportRestrictedRoute(path)
      ? <SupportRestrictedRoute data-testid="SupportRestrictedRoute__e8c60d">{page}</SupportRestrictedRoute>
      : page,
  };
}

export function buildRuntimeRoutes({ windowMap, apiBaseUrl }) {
  // ETP-5267 — the Business Partner portal, shared by its paths below.
  const portalElement = (
    lazyElement(PortalPage)
  );
  // ETP-6209 Part C — the quotation-decision landing, shared by its four paths below.
  const decisionElement = (
    lazyElement(PortalDecisionPage)
  );

  return [
    { index: true, public: false, element: <Navigate to="/dashboard" replace data-testid="Navigate__e8c60d" /> },
    { path: 'onboarding', public: true, element: (
        lazyElement(OnboardingPage)
      ) },
    { path: 'invite', public: true, element: (
        lazyElement(InviteAcceptancePage)
      ) },
    // Registered UNCONDITIONALLY, and public: the Business Partner who opens this link has no
    // Etendo account and no session — the token in the path is the whole credential, validated
    // server-side on every request. The `bp-portal-link` flag gates whether the invoice email
    // CARRIES a link, never whether the surface exists; it is backend-only, targeted at the
    // sending account, and a frontend flag would be visual gating, not authorization
    // (docs/feature-flags.md, which registers `/upgrade` the same way and for the same reason).
    // Nothing here reads a flag.
    //
    // ETP-6209 CP-43 — links are `/portal/{adClientId}/{token}`, and the token never stays in the
    // address bar: `lib/portal/scrubPortalUrl.boot.js` (main.jsx's first import) moves it into
    // sessionStorage and rewrites the URL to `/portal/{adClientId}` before anything else runs.
    // `:segment` is therefore a tenant id, or a token of a pre-CP-43 `/portal/{token}` link that
    // the scrub could not see (an in-app navigation); the page tells them apart by shape. The
    // `:clientId/:token` form is kept for the same reason; the page scrubs it on mount.
    { path: 'portal/:segment', public: true, element: portalElement },
    { path: 'portal/:clientId/:token', public: true, element: portalElement },
    // ETP-6209 Part C — the confirmation landing of a quotation decision, public like the portal:
    // the token is its whole credential, moved into a header by the page and out of the URL by
    // the same scrub (`/portal/{adClientId}/decision`, or `/portal/decision` for older links).
    { path: 'portal/:clientId/decision', public: true, element: decisionElement },
    { path: 'portal/:clientId/decision/:token', public: true, element: decisionElement },
    { path: 'portal/decision', public: true, element: decisionElement },
    { path: 'portal/decision/:token', public: true, element: decisionElement },
    // `/portal` is where a pre-CP-43 `/portal/{token}` link lands after the scrub (the page reads
    // the token from sessionStorage). With nothing stored it renders the generic "link no longer
    // valid" state — a truncated link deserves that message rather than the catch-all route's
    // blank fallback, and it says nothing a probe could learn from.
    { path: 'portal', public: true, element: portalElement },
    { path: 'login', public: true, element: (
        lazyElement(OnboardingPage)
      ) },
    { path: 'logout', public: true, element: <RuntimeLogoutRoute data-testid="RuntimeLogoutRoute__e8c60d" /> },
    // ETP-5351 — Classic's support handoff (`#t=<ticket>`). Public: the visitor has no GO session
    // yet, the ticket is the credential. A static path, so it outranks `:windowName` below.
    { path: 'support-access', public: true, element: (
        lazyElement(SupportAccessPage)
      ) },
    { path: 'financial-account/bank-connection-callback', public: true, element: <BankConnectionCallbackPage data-testid="BankConnectionCallbackPage__e8c60d" /> },
    { path: 'financial-account/pis-callback', public: true, element: <PisCallbackPage data-testid="PisCallbackPage__e8c60d" /> },
    { path: 'dashboard', public: false, element: <DashboardPage apiBaseUrl={apiBaseUrl} data-testid="DashboardPage__e8c60d" /> },
    { path: 'first-steps', public: false, element: <FirstStepsPage data-testid="FirstStepsPage__e8c60d" /> },
    { path: 'preview', public: false, element: <PreviewPage data-testid="PreviewPage__e8c60d" /> },
    { path: 'sales', public: false, element: <SalesPage data-testid="SalesPage__e8c60d" /> },
    { path: 'inventory', public: false, element: <InventoryPage data-testid="InventoryPage__e8c60d" /> },
    { path: 'purchases', public: false, element: <PurchasesPage data-testid="PurchasesPage__e8c60d" /> },
    { path: 'accounting', public: false, element: <AccountingPage data-testid="AccountingPage__e8c60d" /> },
    // The accounts list is now the `financial-account` window's own list branch
    // (generated ListView + the AccountsHeaderTable slot), reached through the
    // standard `:windowName` route. This legacy path is kept as a redirect so
    // bookmarks, the archive-dialog return and existing E2E gotos keep working.
    { path: 'finance/accounts', public: false, element: <Navigate to="/financial-account" replace data-testid="Navigate__accounts" /> },
    { path: 'reports', public: false, element: <ReportsPage data-testid="ReportsPage__e8c60d" /> },
    { path: 'report-viewer', public: false, element: <ReportViewerPage data-testid="ReportViewerPage__e8c60d" /> },
    { path: 'crm', public: false, element: <CrmPage data-testid="CrmPage__e8c60d" /> },
    { path: 'hr', public: false, element: <HrPage data-testid="HrPage__e8c60d" /> },
    { path: 'projects', public: false, element: <ProjectsPage data-testid="ProjectsPage__e8c60d" /> },
    lazyRoute('smart-scan', SmartScanPage),
    lazyRoute('oauth2-clients', OAuth2ClientsPage),
    lazyRoute('api-keys', ApiKeysPage),
    // ETP-5988. Registered unconditionally; the `doc-template-selection` flag gates the menu entry
    // and the backend authorizes every read and write.
    lazyRoute('document-templates', DocumentTemplatesPage),
    lazyRoute('roles', RolesOverviewPage),
    // ETP-5269. Registered unconditionally, like 'upgrade' below. The menu entry is gated by the
    // isAdminOrClientAdmin capability and SFAcctProcessMonitor enforces admin access itself.
    lazyRoute('acct-process-monitor', AcctProcessMonitorPage),
    lazyRoute('authorize', AuthorizePage),
    lazyRoute('quick-sales-order', QuickSalesOrderPage, { apiBaseUrl }),
    lazyRoute('quick-purchase-order', QuickPurchaseOrderPage, { apiBaseUrl }),
    // Unified Calendar PoC: the `unified-calendar-poc` flag gates the menu entry, not the route.
    // Static mock data only, no backend access.
    lazyRoute('unified-calendar', UnifiedCalendarPage),
    lazyRoute('app-store', AppStorePage),
    // Registered unconditionally: the feature flag gates the visible entry
    // point, not the route, and the backend enforces the paywall regardless.
    lazyRoute('upgrade', UpgradePage),
    lazyRoute('account', AccountSettingsPage),
    // ETP-5734. Registered unconditionally: the `my-companies-page` flag gates the user-menu
    // entry, not the route, and every call the page makes is authorized by the account session.
    lazyRoute('companies', MyCompaniesPage),
    { path: 'artifacts', public: false, element: <ArtifactViewerPage data-testid="ArtifactViewerPage__e8c60d" /> },
    { path: 'artifacts/:windowName', public: false, element: <ArtifactViewerPage data-testid="ArtifactViewerPage__e8c60d" /> },
    { path: ':windowName/:recordId', public: false, element: (
        <WindowLoader
          key="with-record"
          windowMap={windowMap}
          apiBaseUrl={apiBaseUrl}
          data-testid="WindowLoader__e8c60d" />
      ) },
    { path: ':windowName', public: false, element: (
        <WindowLoader
          key="list"
          windowMap={windowMap}
          apiBaseUrl={apiBaseUrl}
          data-testid="WindowLoader__e8c60d" />
      ) },
    ...(DevLifecyclePage ? [lazyRoute('dev/lifecycle', DevLifecyclePage)] : []),
  ];
}
