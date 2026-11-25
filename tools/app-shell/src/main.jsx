// ETP-6209 CP-43: FIRST, before anything can read `location` — moves a portal link's token out of
// the address bar. Keep it the first import; nothing may be imported above it.
import './lib/portal/scrubPortalUrl.boot.js';
import { createRoot } from 'react-dom/client';
import { installNeoRequestDedupe } from './lib/neoRequestDedupe.js';
import { initBrowserObservability } from './lib/observability/browser.js';
import { initFeatureFlags } from './lib/flags/index.js';
import { bootSupportSession, isSupportModeActive } from './lib/supportSession.js';
import { installGtm, resolveGtmId } from './lib/marketing/gtm.js';
import { detectBasePath } from './lib/neoBaseUrl.js';
import { isPortalPath } from './lib/portal/portalLinkSession.js';

// ETP-5351 — runs before initFeatureFlags / initBrowserObservability (static imports are evaluated
// earlier, but none of them reports the URL): takes a support ticket out of the
// address bar and decides whether this load is a support session, which keeps product analytics
// from being initialized at all (see lib/supportSession.js).
bootSupportSession({ routerBase: detectBasePath().routerBase });

// ETP-6209 — a customer-portal page has no tracking: no GTM (so no GA4 / HubSpot), no Datadog RUM
// (click actions, replay, session cookie), no Mixpanel and no feature-flag provider. Decided once,
// here, for the three uses below.
const portalPage = isPortalPath({
  pathname: window.location.pathname,
  routerBase: detectBasePath().routerBase,
});

// ETP-6363 — marketing's tag container (consent, Google Analytics, HubSpot's banner and cookie),
// only on the production host, never in a support session and never on a customer-portal page
// (ETP-6209: no tracking there): see lib/marketing/gtm.js.
installGtm(resolveGtmId({
  env: import.meta.env,
  hostname: window.location.hostname,
  supportSession: isSupportModeActive(),
  portalPage,
}));

// ETP-4952 — before anything can issue a request: one network read per resource per page load
// (the NEO session, a record's header, its marked attachment). See lib/neoRequestDedupe.js for
// the allowlist; every other request goes out untouched.
installNeoRequestDedupe();

// Fire-and-forget: never rejects, and flags resolve to their declared defaults
// until (or unless) the provider becomes ready.
// ETP-6209 — not on a customer-portal page: no portal code reads a client-side flag, and the
// remote provider (Datadog Feature Flags) reports flag exposures to Datadog on its own, which
// the portal's no-tracking rule forbids. Every flag there resolves to its declared default.
const flagsReady = portalPage ? undefined : initFeatureFlags();
// Telemetry waits (bounded) for the flags so a provider killed by flag is never started.
initBrowserObservability({ flagsReady, portalPage });
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { IconContext } from '@phosphor-icons/react';
import App from './App.jsx';
import { ICON_DEFAULTS } from './lib/iconDefaults.js';
import './index.css';


if (import.meta.env.VITE_APP_TITLE) {
  document.title = import.meta.env.VITE_APP_TITLE;
}

createRoot(document.getElementById('root')).render(
  <ThemeProvider
    attribute="class"
    defaultTheme="light"
    forcedTheme="light"
    data-testid="ThemeProvider__bc6e1f">
    {/* ETP-6155 — Phosphor is the only icon set. Regular weight everywhere (the navigation
        rail opts into Fill itself), and 24px for an icon that sets no size of its own, so
        it keeps the footprint it had before the migration from lucide. */}
    <IconContext.Provider value={ICON_DEFAULTS}>
      <App data-testid="App__bc6e1f" />
      <Toaster
        position="bottom-right"
        richColors
        data-testid="Toaster__bc6e1f"
        containerAriaLabel="Notifications"
        toastOptions={{
          classNames: {
            error: 'toast-error',
            success: 'toast-success',
            warning: 'toast-warning',
            info: 'toast-info',
          },
        }}
      />
    </IconContext.Provider>
  </ThemeProvider>
);
