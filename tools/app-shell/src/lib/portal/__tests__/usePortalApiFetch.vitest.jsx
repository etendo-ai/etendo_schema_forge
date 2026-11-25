// @covers tools/app-shell/src/lib/portal/usePortalApiFetch.js

// The unit IS the request client, so the double sits one layer below it: `globalThis.fetch`.
// Mocking `useApiFetch`/`apiFetch` here would replace the very thing under test.
import { renderHook } from '@testing-library/react';
import { registerApiSession, resetApiSessionForTests } from '@etendosoftware/app-shell-core/auth';
import { usePortalApiFetch } from '../usePortalApiFetch.js';

const realFetch = globalThis.fetch;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The header the request actually left with, read from the stubbed `fetch`'s call. */
function sentHeader(name) {
  const [, init] = globalThis.fetch.mock.calls[0];
  return new Headers(init.headers).get(name);
}

afterEach(() => {
  globalThis.fetch = realFetch;
  resetApiSessionForTests();
});

describe('usePortalApiFetch — outside the app session', () => {
  it.each([
    ['X-Portal-Token', 'portal-0123456789abcdef'],
    ['X-Portal-Decision-Token', 'dec-0123456789abcdef'],
  ])('sends %s, no seller bearer, and keeps the answer when the app identity changes mid-flight',
    async (header, value) => {
      // A seller session is registered ambiently and its identity is replaced while the portal
      // request is in flight; a session-bound client would discard the answer as superseded.
      let identityReplaced = false;
      registerApiSession({
        getToken: () => 'seller-jwt',
        onUnauthorized: vi.fn(),
        scope: {
          capture: () => ({}),
          isSameIdentity: () => !identityReplaced,
          isCurrent: () => !identityReplaced,
        },
      });
      globalThis.fetch = vi.fn(async () => {
        identityReplaced = true;
        return jsonResponse({ state: 'confirmed' });
      });
      const { result } = renderHook(() => usePortalApiFetch('/sws'));

      const res = await result.current('/portal/decisions/confirm', {
        method: 'POST', headers: { [header]: value }, on401: 'ignore',
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ state: 'confirmed' });
      expect(sentHeader(header)).toBe(value);
      expect(sentHeader('Authorization')).toBeNull();
    });

  it.each([401, 403])('a portal %i never calls the registered session logout', async (status) => {
    const onUnauthorized = vi.fn();
    registerApiSession({ getToken: () => 'seller-jwt', onUnauthorized });
    globalThis.fetch = vi.fn(async () => jsonResponse({}, status));
    const { result } = renderHook(() => usePortalApiFetch('/sws'));

    // No `on401: 'ignore'` here on purpose: the guarantee must hold from the hook itself
    // (no logout handler, no ambient scope), not only from what each caller remembers to send.
    const [outcome] = await Promise.allSettled([
      result.current('/portal/documents', { headers: { 'X-Portal-Token': 'portal-token' } }),
    ]);

    expect(globalThis.fetch).toHaveBeenCalled();
    if (status === 403) expect(outcome.value.status).toBe(403);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

// CP-43 — the backend refuses a token of another tenant only when the request names the tenant.
describe('usePortalApiFetch — X-Portal-Client', () => {
  const CLIENT = '0123456789ABCDEF0123456789ABCDEF';

  it.each([
    ['a known tenant', CLIENT, CLIENT],
    ['no tenant', null, null],
  ])('with %s, sends X-Portal-Client %s alongside the caller headers', async (_label, clientId, expected) => {
    globalThis.fetch = vi.fn(async () => jsonResponse({}));
    const { result } = renderHook(() => usePortalApiFetch('/sws', { clientId }));

    await result.current('/portal/me', { headers: { 'X-Portal-Token': 'portal-token' }, on401: 'ignore' });

    expect(sentHeader('X-Portal-Client')).toBe(expected);
    expect(sentHeader('X-Portal-Token')).toBe('portal-token');
  });

  it('picks up a tenant learned mid-session without handing out a new client', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({}));
    const { result, rerender } = renderHook(({ clientId }) => usePortalApiFetch('/sws', { clientId }), {
      initialProps: { clientId: null },
    });
    const first = result.current;

    rerender({ clientId: CLIENT });
    await result.current('/portal/me', { on401: 'ignore' });

    expect(result.current).toBe(first);
    expect(sentHeader('X-Portal-Client')).toBe(CLIENT);
  });
});

describe('usePortalApiFetch — identity of the returned client', () => {
  it('is the same function across re-renders with the same baseUrl, and a new one when it changes', () => {
    const { result, rerender } = renderHook(({ base }) => usePortalApiFetch(base), {
      initialProps: { base: '/sws' },
    });
    const first = result.current;

    rerender({ base: '/sws' });
    expect(result.current).toBe(first);

    rerender({ base: '/other' });
    expect(result.current).not.toBe(first);
    expect(typeof result.current).toBe('function');
  });
});

// ETP-6209 KPIs — the portal session: sent with every token-authenticated request when the tab has
// one, the answer's (new or rotated) id stored, never in a URL, and nothing on token-less calls.
describe('usePortalApiFetch — X-Portal-Session', () => {
  const SESSION = '0123456789abcdef0123456789abcdef';
  const ROTATED = 'fedcba9876543210fedcba9876543210';
  const withSession = (id) => new Response('{}', {
    status: 200, headers: { 'Content-Type': 'application/json', 'X-Portal-Session': id },
  });

  beforeEach(() => sessionStorage.clear());

  it('sends the stored session with a token request and stores the rotated one it answers', async () => {
    sessionStorage.setItem('etgo.portal.session', SESSION);
    globalThis.fetch = vi.fn(async () => withSession(ROTATED));
    const { result } = renderHook(() => usePortalApiFetch('/sws'));

    await result.current('/portal/me', { headers: { 'X-Portal-Token': 'portal-token' } });

    expect(sentHeader('X-Portal-Session')).toBe(SESSION);
    expect(globalThis.fetch.mock.calls[0][0]).not.toContain(SESSION);
    expect(sessionStorage.getItem('etgo.portal.session')).toBe(ROTATED);
  });

  it('sends no session before the backend minted one, and stores the first it answers', async () => {
    globalThis.fetch = vi.fn(async () => withSession(SESSION));
    const { result } = renderHook(() => usePortalApiFetch('/sws'));

    await result.current('/portal/me', { headers: { 'X-Portal-Token': 'portal-token' } });

    expect(sentHeader('X-Portal-Session')).toBeNull();
    expect(sessionStorage.getItem('etgo.portal.session')).toBe(SESSION);
  });

  it('leaves the session out of a request without the portal token (the decision landing)', async () => {
    sessionStorage.setItem('etgo.portal.session', SESSION);
    globalThis.fetch = vi.fn(async () => withSession(ROTATED));
    const { result } = renderHook(() => usePortalApiFetch('/sws'));

    await result.current('/portal/decisions/confirm', {
      method: 'POST', headers: { 'X-Portal-Decision-Token': 'dec-token' }, on401: 'ignore',
    });

    expect(sentHeader('X-Portal-Session')).toBeNull();
    expect(sessionStorage.getItem('etgo.portal.session')).toBe(SESSION);
  });

  it('ignores an answer header that is not a session id', async () => {
    globalThis.fetch = vi.fn(async () => withSession('not-a-session'));
    const { result } = renderHook(() => usePortalApiFetch('/sws'));

    await result.current('/portal/me', { headers: { 'X-Portal-Token': 'portal-token' } });

    expect(sessionStorage.getItem('etgo.portal.session')).toBeNull();
  });
});
