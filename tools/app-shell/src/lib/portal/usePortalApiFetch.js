import { useMemo, useRef } from 'react';
import { createApiFetch } from '@etendo-ai/app-shell-core/auth';
import {
  PORTAL_CLIENT_HEADER, PORTAL_SESSION_HEADER, readPortalSession, rememberPortalSession,
} from './portalLinkSession.js';

/** The header every token-authenticated portal request carries (`portalApi.js`). */
const PORTAL_TOKEN_HEADER = 'X-Portal-Token';

/** The portal holds no session credential of its own: its token rides `X-Portal-Token`. */
const NO_SESSION_TOKEN = () => null;

/**
 * The customer portal's request client: the shared helper (same headers, base URL, timeout and
 * `NetworkError` contract as `useApiFetch`), but OUTSIDE the app's session scope.
 *
 * Why not `useApiFetch`. That client is bound to the app's session identity: it captures the
 * identity when a request leaves and, if the identity changed by the time the answer arrives,
 * throws "The request belongs to a superseded session" and discards the answer
 * (`createApiFetch`'s `isOurs()` check, app-shell-core `auth/api.js`). A customer opening a portal
 * link from an email has no app session, so the app's auth bootstrap resolves the identity
 * (unknown, then anonymous) WHILE the portal's first requests are in flight. The backend answered
 * 200 and had committed the decision, and the page still showed "No pudimos aplicar tu decisión";
 * a retry, sent after the bootstrap settled, then read "Ya habías respondido" (ETP-6209, live in
 * production; never on localhost, where the browser already holds a session).
 *
 * The portal belongs to no session by design — the link token is its whole credential — so it has
 * no identity to lose. Passing `null` as the scope opts out of the ambient session entirely, the
 * same way the support handoff does (`lib/supportSession.js`). Two more consequences, both wanted:
 * there is no logout handler, so a portal 401 can never log anybody out (every call also sends
 * `on401: 'ignore'`), and nothing here touches the app's data cache or write announcements, which
 * only ever concern `/sws/neo` records.
 *
 * **The tenant (ETP-6209, CP-43).** When the page knows the link's `AD_Client_ID` (from the URL
 * `/portal/{clientId}`, or from `/me`), every request also carries it as {@link
 * PORTAL_CLIENT_HEADER}; the backend refuses a token of another tenant with the usual
 * invalid-link answer. Read through a ref, so learning the tenant mid-session (a pre-CP-43 link
 * normalized after `/me`) does not hand the page a new client and refetch everything.
 *
 * **The KPI session (ETP-6209).** A request that carries the portal token also carries this tab's
 * session id as {@link PORTAL_SESSION_HEADER} when there is one, and the id the backend answers
 * with (a new or rotated one) is stored for the next request. It is not a credential, and it never
 * goes into a URL. The decision landing's requests carry no portal token, so no session either.
 *
 * @param {string} [baseUrl] prefix for relative paths (see `resolvePortalBaseUrl`)
 * @param {{ clientId?: string|null }} [options]
 */
export function usePortalApiFetch(baseUrl, { clientId = null } = {}) {
  const clientRef = useRef(clientId);
  clientRef.current = clientId;
  return useMemo(() => {
    const base = createApiFetch(baseUrl, NO_SESSION_TOKEN, null, null);
    return async (url, options = {}) => {
      const headers = { ...(options.headers ?? {}) };
      const tenant = clientRef.current;
      if (tenant) headers[PORTAL_CLIENT_HEADER] = tenant;
      const withToken = Boolean(headers[PORTAL_TOKEN_HEADER]);
      const session = withToken ? readPortalSession() : null;
      if (session) headers[PORTAL_SESSION_HEADER] = session;
      const response = await base(url, { ...options, headers });
      if (withToken) rememberPortalSession(response?.headers?.get?.(PORTAL_SESSION_HEADER));
      return response;
    };
  }, [baseUrl]);
}
