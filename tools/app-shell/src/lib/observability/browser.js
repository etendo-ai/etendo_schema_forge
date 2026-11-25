import { initObservability, track, disable, enable } from '../observability.js';
import { bindTelemetryKillSwitch, killStateToDisabled, readKillState } from './killSwitch.js';
import { OBSERVABILITY_EVENTS } from './events.js';
import { createMixpanelProvider } from './providers/mixpanel.js';
import { createRumProvider } from '../rum.js';
import { createDatadogProvider } from './providers/datadog.js';

/**
 * The providers of this page load.
 *
 * ETP-6209 — a customer-portal page (`portalPage`, decided once in `main.jsx` with `isPortalPath`)
 * has no tracking. Its visitors are customers of our customers and never see a consent banner.
 * - **Datadog Browser RUM is left out.** The core adapter always tracks user interactions (click
 *   actions), it may record session replay, and it keeps its `_dd_s` session cookie. None of that
 *   can be switched off from here, and there is no non-RUM Datadog logger to fall back to, so the
 *   portal does not report its JS errors to Datadog.
 * - **Mixpanel is left out** (product analytics).
 * - **AWS CloudWatch RUM stays** when enabled: it records only performance, errors and HTTP calls
 *   (`DEFAULT_RUM_TELEMETRIES`, no interactions), with cookies off by default
 *   (`VITE_RUM_ALLOW_COOKIES`). It is the portal's error monitoring.
 */
function browserProviders({ env, logger, storage, hostname, portalPage }) {
  const rum = createRumProvider({ env, logger });
  if (portalPage) return [rum];
  return [
    createDatadogProvider({
      env,
      logger,
    }),
    rum,
    createMixpanelProvider({
      enabled: env.VITE_MIXPANEL_ENABLED,
      token: env.VITE_MIXPANEL_TOKEN,
      debug: env.VITE_MIXPANEL_DEBUG,
      apiHost: env.VITE_MIXPANEL_API_HOST,
      logger,
      storage,
      hostname,
      allowLocal: env.VITE_MIXPANEL_ALLOW_LOCAL,
    }),
  ];
}

export function buildBrowserObservabilityConfig({
  env = import.meta.env,
  location = globalThis.window?.location,
  logger = console,
  storage = globalThis.localStorage,
  portalPage = false,
} = {}) {
  const hostname = location?.hostname;
  // Build default + whatever the flags say right now. A provider killed here is never started.
  const killState = readKillState({ env, logger });

  return {
    logger,
    disabled: killStateToDisabled(killState),
    killState,
    context: {
      app: 'app-shell',
      environment: hostname,
      hostname,
      mockMode: env.VITE_MOCK === 'true',
    },
    metadata: {
      app: 'app-shell',
      environment: hostname,
      hostname,
      mockMode: env.VITE_MOCK === 'true',
    },
    providers: browserProviders({ env, logger, storage, hostname, portalPage }),
  };
}

/**
 * How long startup waits for the flag provider before starting telemetry anyway. Long enough
 * for the local provider (immediate) and a warm remote one; short enough that a slow control
 * plane does not cost the app its first errors. A kill flag that answers later still applies,
 * in place, through `bindTelemetryKillSwitch`.
 */
export const FLAGS_READY_WAIT_MS = 1500;

function waitFor(promise, ms) {
  if (!promise) return Promise.resolve();
  return Promise.race([
    Promise.resolve(promise).catch(() => undefined),
    new Promise((resolve) => { setTimeout(resolve, ms); }),
  ]);
}

export async function initBrowserObservability(
  options = {},
  client = { initObservability, track, disable, enable }
) {
  // Flags first, so a provider killed by flag is not even started. Never rejects, bounded.
  await waitFor(options.flagsReady, options.flagsWaitMs ?? FLAGS_READY_WAIT_MS);
  const { killState, ...config } = buildBrowserObservabilityConfig(options);
  await client.initObservability(config);
  if (typeof client.disable === 'function' && typeof client.enable === 'function') {
    bindTelemetryKillSwitch(client, { env: options.env, initial: killState, logger: options.logger });
  }
  // The Mixpanel one-time stale-identity reset (see docs/surveys.md) is no longer
  // orchestrated here: it lives inside createMixpanelProvider's getClient() gate
  // (providers/mixpanel.js), so it is guaranteed to run before ANY provider
  // method touches the SDK, regardless of call ordering across the app.
  await client.track(OBSERVABILITY_EVENTS.APP_STARTED.name);
}
