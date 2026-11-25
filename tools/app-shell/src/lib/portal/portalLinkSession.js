/**
 * The customer portal's link token, kept OUT of the address bar (ETP-6209, QA CP-43).
 *
 * The token in a portal email link is the whole credential, and the portal is about to load
 * third-party tags (GTM, Google Analytics, HubSpot). Every one of them reads `location.href` (and
 * `document.referrer` on the next site), so a token left in the URL would be shipped to them on
 * the first page view. This module is what prevents that:
 *
 * 1. {@link scrubPortalTokenFromLocation} runs as the FIRST import of `main.jsx`, before React,
 *    the router, observability or anything else evaluates. It reads the token from the path,
 *    stores it in `sessionStorage` and `history.replaceState`s the URL to its token-free form:
 *    - `/portal/{clientId}/{token}`            → `/portal/{clientId}`
 *    - `/portal/{token}` (pre-CP-43 links)     → `/portal` (then `/portal/{clientId}` once `/me`
 *      names the client)
 *    - `/portal/{clientId}/decision/{token}`   → `/portal/{clientId}/decision`
 *    - `/portal/decision/{token}` (pre-CP-43)  → `/portal/decision`
 *    It also sets `<meta name="referrer" content="same-origin">` on portal routes, so an outbound
 *    link or a cross-origin request never carries even the scrubbed portal URL.
 * 2. The portal pages read the token back with {@link readPortalLink} / {@link readPortalDecision}.
 *    `sessionStorage` is per tab and survives a reload, so reloading `/portal/{clientId}` keeps
 *    working for the rest of the session; a fresh tab without the email link has no token and
 *    shows the generic "link no longer valid" screen.
 *
 * **Portal pages have no tracking** (ETP-6209): when {@link isPortalPath} says the page is a portal
 * page, `main.jsx` skips GTM and starts observability without Datadog RUM or Mixpanel. Anywhere else, tags MUST still be injected
 * after this runs — from JavaScript loaded by `main.jsx` after its first import, never as a static
 * `<script>` in `index.html`. See `docs/customer-portal-link-token.md`.
 *
 * Pure apart from the two functions that touch `window`; everything else takes its inputs, so it
 * can be tested with plain `node --test`.
 */

/** sessionStorage key of the portal link: `{ clientId: string|null, token: string }`. */
export const PORTAL_LINK_STORAGE_KEY = 'etgo.portal.link';

/** sessionStorage key of a decision-confirmation link: `{ clientId: string|null, token: string }`. */
export const PORTAL_DECISION_STORAGE_KEY = 'etgo.portal.decision';

/**
 * sessionStorage key of the portal's KPI session id (ETP-6209): an opaque 32-hex id the backend
 * mints and rotates (`X-Portal-Session`). It grants nothing — the token still authorizes every
 * request — and it never goes into a URL. Per tab, so a reload keeps the session and a new tab
 * from the email starts another.
 */
export const PORTAL_SESSION_STORAGE_KEY = 'etgo.portal.session';

/** Header carrying the KPI session id, both ways (`PortalServlet`). */
export const PORTAL_SESSION_HEADER = 'X-Portal-Session';

/** The path segment of the decision-confirmation landing. */
const DECISION_SEGMENT = 'decision';

/** Header that tells the backend which tenant the token must belong to (optional). */
export const PORTAL_CLIENT_HEADER = 'X-Portal-Client';

/**
 * Whether a path segment is an `AD_Client_ID` rather than a token. Tenant ids are 32 hex
 * characters; tokens are 43-character URL-safe base64 (`PortalTokens.newToken`), so the two
 * shapes never collide.
 */
export function isPortalClientId(segment) {
  return typeof segment === 'string' && /^[0-9A-F]{32}$/i.test(segment);
}

function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * What a portal path carries, relative to the router base (`/portal/...`).
 *
 * @param {string} path the pathname below the router base, starting with `/`
 * @returns {null | {
 *   kind: 'link'|'decision',
 *   clientId: string|null,
 *   token: string|null,
 *   cleanPath: string,
 * }} `null` for a non-portal path. `token` is `null` when the path is already token-free.
 */
export function parsePortalPath(path) {
  const segments = String(path ?? '').split('/').filter(Boolean);
  if (segments[0] !== 'portal') return null;
  const rest = segments.slice(1).map(decode);
  // A leading tenant id is optional (pre-CP-43 links have none).
  const clientId = isPortalClientId(rest[0]) ? rest[0] : null;
  const tail = clientId ? rest.slice(1) : rest;
  const prefix = clientId ? `/portal/${clientId}` : '/portal';
  if (tail[0] === DECISION_SEGMENT) {
    return {
      kind: 'decision',
      clientId,
      token: tail[1] ? tail[1] : null,
      cleanPath: `${prefix}/${DECISION_SEGMENT}`,
    };
  }
  return {
    kind: 'link',
    clientId,
    token: tail[0] ? tail[0] : null,
    cleanPath: prefix,
  };
}

function storageOf(win) {
  try {
    return win?.sessionStorage ?? null;
  } catch {
    // Blocked storage (privacy mode, sandboxed frame): the portal still works for this load.
    return null;
  }
}

function readEntry(storage, key) {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? 'null');
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token.trim()) return null;
    return {
      token: parsed.token.trim(),
      clientId: isPortalClientId(parsed.clientId) ? parsed.clientId : null,
    };
  } catch {
    return null;
  }
}

function writeEntry(storage, key, entry) {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify({ clientId: entry.clientId ?? null, token: entry.token }));
  } catch {
    // Quota or blocked storage: nothing to do, a reload will simply need the email link again.
  }
}

/** Memory fallback for a browser whose sessionStorage is unavailable: lives for this page load. */
const memory = new Map();

function read(key, win) {
  return readEntry(storageOf(win), key) ?? memory.get(key) ?? null;
}

function write(key, entry, win) {
  memory.set(key, { clientId: entry.clientId ?? null, token: entry.token });
  writeEntry(storageOf(win), key, entry);
}

/** An entry matches the URL's tenant when either side does not name one. */
function matchesClient(entry, clientId) {
  return Boolean(entry) && (!clientId || !entry.clientId || entry.clientId === clientId);
}

/**
 * The portal link this tab holds for `clientId` (`null` matches any), or `null`.
 *
 * @returns {{ clientId: string|null, token: string } | null}
 */
export function readPortalLink(clientId = null, win = globalThis.window) {
  const entry = read(PORTAL_LINK_STORAGE_KEY, win);
  return matchesClient(entry, clientId) ? entry : null;
}

/** Remembers the portal link for this tab (a decision landing hands over a fresh one). */
export function rememberPortalLink({ clientId = null, token }, win = globalThis.window) {
  if (!token) return;
  write(PORTAL_LINK_STORAGE_KEY, { clientId: isPortalClientId(clientId) ? clientId : null, token }, win);
}

/** The decision-confirmation token this tab holds for `clientId` (`null` matches any), or `null`. */
export function readPortalDecision(clientId = null, win = globalThis.window) {
  const entry = read(PORTAL_DECISION_STORAGE_KEY, win);
  return matchesClient(entry, clientId) ? entry : null;
}

/** Remembers a decision-confirmation token for this tab. */
export function rememberPortalDecision({ clientId = null, token }, win = globalThis.window) {
  if (!token) return;
  write(PORTAL_DECISION_STORAGE_KEY, { clientId: isPortalClientId(clientId) ? clientId : null, token }, win);
}

/** Whether a value has the shape of a portal session id (32 hex characters). */
export function isPortalSessionId(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/i.test(value);
}

/** The KPI session id this tab holds, or `null`. */
export function readPortalSession(win = globalThis.window) {
  const storage = storageOf(win);
  let value;
  try {
    // The in-memory copy only stands in for a storage that cannot be used at all.
    value = storage ? storage.getItem(PORTAL_SESSION_STORAGE_KEY) : memory.get(PORTAL_SESSION_STORAGE_KEY);
  } catch {
    value = memory.get(PORTAL_SESSION_STORAGE_KEY);
  }
  return isPortalSessionId(value) ? value : null;
}

/** Remembers the session id the backend answered with (only a well-formed one). */
export function rememberPortalSession(sessionId, win = globalThis.window) {
  if (!isPortalSessionId(sessionId)) return;
  memory.set(PORTAL_SESSION_STORAGE_KEY, sessionId);
  try {
    storageOf(win)?.setItem(PORTAL_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Blocked storage: the in-memory copy serves this page load.
  }
}

/** Forgets the session id: a token that arrives in a URL (a new email click) is a new session. */
export function clearPortalSession(win = globalThis.window) {
  memory.delete(PORTAL_SESSION_STORAGE_KEY);
  try {
    storageOf(win)?.removeItem(PORTAL_SESSION_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * The token-free portal path of a link, for `navigate()` (router-relative, with the search).
 *
 * @param {string|null} clientId the tenant, when known
 * @param {URLSearchParams|string} [search] the view's search string
 */
export function portalPath(clientId, search) {
  const query = search ? String(search) : '';
  const base = isPortalClientId(clientId) ? `/portal/${clientId}` : '/portal';
  return query ? `${base}?${query}` : base;
}

/**
 * The link a portal route stands for: the route's own params, else this tab's stored link.
 *
 * Route params (see `runtime-routes.jsx`): `segment` (`/portal/:segment` — a tenant id, or the
 * token of a pre-CP-43 link), or `clientId` + `token`. `inUrl` says the token is still in the
 * address bar (an in-app navigation the boot scrub never saw): the page must then scrub it.
 *
 * @param {{ segment?: string, clientId?: string, token?: string }} params
 * @param {(clientId: string|null) => ({ clientId: string|null, token: string }|null)} [readStored]
 * @returns {{ clientId: string|null, token: string, inUrl: boolean }}
 */
export function resolvePortalRoute(params, readStored = readPortalLink) {
  const segment = params?.segment?.trim() || null;
  let clientId = params?.clientId?.trim() || null;
  let token = params?.token?.trim() || null;
  if (segment) {
    if (isPortalClientId(segment)) clientId = segment;
    else token = segment;
  }
  if (clientId && !isPortalClientId(clientId)) {
    // `/portal/{x}/{y}` where x is no tenant id: nothing this page can trust.
    return { clientId: null, token: '', inUrl: Boolean(token) };
  }
  if (token) return { clientId, token, inUrl: true };
  const stored = readStored(clientId);
  return {
    clientId: clientId ?? stored?.clientId ?? null,
    token: stored?.token ?? '',
    inUrl: false,
  };
}

/** Makes sure portal pages never send a referrer with their URL off-origin. */
function applyReferrerPolicy(doc) {
  if (!doc?.head || typeof doc.createElement !== 'function') return;
  let meta = doc.querySelector?.('meta[name="referrer"]');
  if (!meta) {
    meta = doc.createElement('meta');
    meta.setAttribute('name', 'referrer');
    doc.head.prepend?.(meta) ?? doc.head.appendChild(meta);
  }
  // `same-origin`, not `no-referrer`: the latter also turns the `Origin` of the portal's own
  // POSTs into `null`, which any same-origin check on the backend would reject.
  meta.setAttribute('content', 'same-origin');
}

/** The pathname below the router base, or `null` when it is outside the base. */
function belowRouterBase(pathname, routerBase) {
  const base = routerBase && routerBase !== '/' ? routerBase.replace(/\/+$/, '') : '';
  if (base && !String(pathname ?? '').startsWith(`${base}/`)) return null;
  return { base, path: String(pathname ?? '').slice(base.length) };
}

/**
 * Whether a browser pathname is a customer-portal page (`/portal`, `/portal/…`, the decision
 * landing included), honouring the router base path. The portal loads no third-party tags at all
 * (ETP-6209: no tracking without a consent banner), so `main.jsx` asks this before installing GTM.
 *
 * @param {{ pathname?: string, routerBase?: string }} [options]
 * @returns {boolean}
 */
export function isPortalPath({ pathname = '', routerBase = '/' } = {}) {
  const below = belowRouterBase(pathname, routerBase);
  return Boolean(below && parsePortalPath(below.path));
}

/**
 * Moves a portal token from the address bar into this tab's sessionStorage and rewrites the URL
 * without it. Runs once, synchronously, at module evaluation of `main.jsx`'s first import.
 *
 * @param {{ win?: Window, routerBase?: string }} [options]
 * @returns {boolean} whether the URL was rewritten
 */
export function scrubPortalTokenFromLocation({ win = globalThis.window, routerBase = '/' } = {}) {
  const location = win?.location;
  if (!location?.pathname) return false;
  const below = belowRouterBase(location.pathname, routerBase);
  if (!below) return false;
  const { base } = below;
  const parsed = parsePortalPath(below.path);
  if (!parsed) return false;
  applyReferrerPolicy(win.document);
  if (!parsed.token) return false;
  // A token in the URL is a new click on an email link: a new KPI session (ETP-6209).
  clearPortalSession(win);
  if (parsed.kind === 'decision') {
    rememberPortalDecision({ clientId: parsed.clientId, token: parsed.token }, win);
  } else {
    rememberPortalLink({ clientId: parsed.clientId, token: parsed.token }, win);
  }
  try {
    win.history.replaceState(
      win.history.state,
      '',
      `${base}${parsed.cleanPath}${location.search ?? ''}${location.hash ?? ''}`,
    );
    return true;
  } catch {
    return false;
  }
}
