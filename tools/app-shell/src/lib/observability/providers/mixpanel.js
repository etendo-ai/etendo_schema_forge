import { createMixpanelAdapter } from '@etendo-ai/app-shell-core/observability/adapters/mixpanel';
import { loadMixpanel } from '../sdk.js';
import { SAFE_EVENT_PROPERTY_KEYS } from '../payload.js';
import { TRUSTED_CONTEXT_KEYS } from '../core.js';

/**
 * ETP-5466 — the only hosts that emit to the Mixpanel project: production. Exact hostnames, no
 * subdomains. Local development, Playwright runs (a new device per test), staging and any other
 * host stay silent even with `VITE_MIXPANEL_ENABLED=true` and a token, so dev traffic never
 * reaches the KPIs.
 */
export const MIXPANEL_ALLOWED_HOSTS = Object.freeze(['app.etendo.software', 'app.etendo.ai']);

/**
 * Whether Mixpanel may emit from `hostname`: one of {@link MIXPANEL_ALLOWED_HOSTS}, or any host
 * when `allowLocal` is the literal `true` (`VITE_MIXPANEL_ALLOW_LOCAL`, to validate emission on
 * purpose from a developer machine).
 */
export function isMixpanelHostAllowed(hostname, allowLocal = false) {
  if (allowLocal === true || allowLocal === 'true') return true;
  const host = typeof hostname === 'string' ? hostname.trim().toLowerCase().replace(/\.$/, '') : '';
  return MIXPANEL_ALLOWED_HOSTS.includes(host);
}

/**
 * The host's Mixpanel provider (ETP-4578): the core's adapter with this app's environment
 * wiring. Mixpanel adds `$current_url` (with its full query string), `$referrer`, persisted
 * marketing parameters and super-properties to every event AFTER the gateway sanitized it, and
 * the SDK sends its `$identify` event with hooks skipped. The adapter closes that with the SDK's
 * own `property_blacklist` and `before_send_*` / `before_register*` hooks.
 *
 * Optional and off by default (D3): it needs an explicit `enabled` AND a project token. The SDK
 * is only downloaded when it is enabled and first used. The one-time stale-identity reset (GDPR,
 * ETP-4352) lives in the adapter, behind the same single gate every method funnels through.
 *
 * ETP-5466: it is also off on any host outside {@link MIXPANEL_ALLOWED_HOSTS} unless `allowLocal`
 * opts in, whatever `enabled` and the token say.
 *
 * Still open with the owner, so they stay at the conservative defaults: which SDK properties are
 * approved, whether URL properties go out as a normalized path or not at all, IP geolocation
 * (off), and whether the organization name is allowlisted (it is not).
 */
export function createMixpanelProvider({
  enabled = false,
  token,
  debug = false,
  apiHost,
  logger = console,
  loader = loadMixpanel,
  storage = globalThis.localStorage,
  hostname = globalThis.location?.hostname,
  allowLocal = false,
  consent,
  onConsentWithdrawn = () => {},
} = {}) {
  const hostAllowed = isMixpanelHostAllowed(hostname, allowLocal);
  const adapter = createMixpanelAdapter({
    loadSdk: loader,
    enabled: hostAllowed ? enabled : false,
    token,
    apiHost,
    debug,
    // ETP-6363 — marketing's request: one cookie for the app and the website (`.etendo.ai`).
    crossSubdomainCookie: true,
    allowedKeys: SAFE_EVENT_PROPERTY_KEYS,
    // The gateway already trusts these; without it this adapter's own sanitizer redacts `reportSessionId`.
    trustedKeys: TRUSTED_CONTEXT_KEYS,
    logger,
    storage,
  });
  const track = adapter.track;
  // ETP-6363 — the flag evaluations were 72 % of the project's volume and no report reads them;
  // Datadog keeps receiving them.
  adapter.track = (eventName, ...rest) => (
    FLAG_EVENTS.has(eventName) ? Promise.resolve() : track(eventName, ...rest)
  );
  // ETP-5351 — `analytics: true`: product analytics, silenced as a whole while a support session
  // is active (see `setAnalyticsSuppressed` in ../core.js).
  const provider = Object.assign(adapter, { analytics: true });
  // Only the production hosts have the banner: a developer who opts in from their machine
  // (`allowLocal`) has nothing to accept.
  const productionHost = isMixpanelHostAllowed(hostname, false);
  return typeof consent === 'function' && productionHost
    ? withConsent(provider, consent, onConsentWithdrawn)
    : provider;
}

/** Feature-flag events Mixpanel no longer receives (ETP-6363). */
export const FLAG_EVENTS = new Set(['feature_flag_evaluated', 'feature_flags_diagnostic']);

/**
 * ETP-6363 — Mixpanel only once the visitor accepted the Analytics cookies. Until then the
 * provider is off for the gateway, which reads `enabled` on every call: the SDK is not even
 * downloaded, so no cookie is written and no event leaves. On acceptance the gateway starts it and
 * hands it the current user and groups; the events before that are not replayed. If the visitor
 * withdraws consent the SDK stops for the rest of the page load and its cookies are removed.
 *
 * @param {object} provider the Mixpanel provider
 * @param {(listener: (granted: boolean) => void) => unknown} subscribe the banner's choice
 * @param {() => void} onWithdrawn removes what the SDK stored
 */
function withConsent(provider, subscribe, onWithdrawn) {
  if (provider.enabled !== true) return provider;
  let granted = false;
  let withdrawn = false;
  subscribe((value) => {
    if (granted && !value) {
      withdrawn = true;
      Promise.resolve(provider.shutdown()).catch(() => {}).finally(() => onWithdrawn());
    }
    granted = value;
  });
  provider.enabled = () => granted && !withdrawn;
  return provider;
}
