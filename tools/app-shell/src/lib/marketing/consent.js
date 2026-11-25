/**
 * ETP-6363 — the visitor's choice in marketing's cookie banner (HubSpot's, loaded by GTM on the
 * production host). Product analytics (Mixpanel) waits for the "Analytics" category.
 *
 * HubSpot calls a privacy-consent listener once its banner script has loaded and again every time
 * the visitor changes the choice. Where the banner never loads (another host, a support session,
 * GTM blocked) the listener is never called, so whatever waits for consent never starts.
 */

/**
 * Registers `listener` for the Analytics category of the cookie banner.
 *
 * @param {(granted: boolean) => void} listener called with the current choice, then on each change
 * @param {Window} [win] the browser's, by default
 * @returns {() => void} stops calling `listener`
 */
export function onAnalyticsConsent(listener, win = globalThis.window) {
  if (!win || typeof listener !== 'function') return () => {};
  let active = true;
  try {
    win._hsp = win._hsp || [];
    win._hsp.push(['addPrivacyConsentListener', (consent) => {
      if (!active) return;
      try {
        listener(consent?.categories?.analytics === true);
      } catch {
        // A listener that fails must not break HubSpot's banner.
      }
    }]);
  } catch {
    // An unusable `_hsp` only means no consent: nothing waiting for it starts.
  }
  return () => { active = false; };
}

/**
 * Removes Mixpanel's cookies (`mp_*`) from this host and its parent domain, where the SDK keeps
 * them when the cookie is shared with the website. Called when the visitor withdraws consent.
 *
 * @param {Document} [doc] the browser's, by default
 * @param {string} [hostname]
 */
export function clearMixpanelCookies(doc = globalThis.document, hostname = globalThis.location?.hostname) {
  if (!doc || typeof doc.cookie !== 'string') return;
  const names = doc.cookie.split(';')
    .map(part => part.split('=')[0].trim())
    .filter(name => name.startsWith('mp_'));
  const labels = typeof hostname === 'string' ? hostname.split('.') : [];
  const parent = labels.length > 1 ? `.${labels.slice(-2).join('.')}` : null;
  const scopes = parent ? ['', `; domain=${parent}`] : [''];
  for (const name of names) {
    for (const scope of scopes) {
      doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${scope}`;
    }
  }
}
