// @covers tools/app-shell/src/lib/portal/portalLinkSession.js
// @covers tools/app-shell/src/lib/portal/scrubPortalUrl.boot.js
// @covers tools/app-shell/src/main.jsx
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PORTAL_DECISION_STORAGE_KEY,
  PORTAL_LINK_STORAGE_KEY,
  PORTAL_SESSION_STORAGE_KEY,
  clearPortalSession,
  isPortalPath,
  parsePortalPath,
  readPortalSession,
  rememberPortalSession,
  portalPath,
  readPortalDecision,
  readPortalLink,
  resolvePortalRoute,
  scrubPortalTokenFromLocation,
} from '../portalLinkSession.js';

/**
 * The portal link token is the whole credential and must leave the address bar before any
 * third-party tag can read `location` (QA CP-43). Everything here runs against a fake window, so
 * the suite needs no DOM.
 */

const CLIENT = '0123456789ABCDEF0123456789ABCDEF';
const OTHER_CLIENT = 'FEDCBA9876543210FEDCBA9876543210';
const TOKEN = 'Ab-_cdEFghIJklMNopQRstUVwxYZ0123456789abcde';

function fakeStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

function fakeDocument() {
  const metas = [];
  const head = {
    prepend: (el) => { metas.unshift(el); },
    appendChild: (el) => { metas.push(el); },
  };
  return {
    metas,
    head,
    createElement: () => {
      const attrs = {};
      return { attrs, setAttribute: (k, v) => { attrs[k] = v; } };
    },
    querySelector: (selector) => (selector === 'meta[name="referrer"]'
      ? metas.find((m) => m.attrs.name === 'referrer') ?? null
      : null),
  };
}

/** A window at `url` (pathname + optional search/hash), with a working or a blocked sessionStorage. */
function fakeWindow(url, { blockedStorage = false } = {}) {
  const parsed = new URL(url, 'https://go.example.com');
  const replaced = [];
  const win = {
    location: { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash },
    history: { state: { idx: 0 }, replaceState: (state, _title, next) => replaced.push({ state, next }) },
    document: fakeDocument(),
    replaced,
  };
  if (blockedStorage) {
    Object.defineProperty(win, 'sessionStorage', { get() { throw new Error('SecurityError'); } });
  } else {
    win.sessionStorage = fakeStorage();
  }
  return win;
}

const stored = (win, key) => JSON.parse(win.sessionStorage.data.get(key));
const referrerMeta = (win) => win.document.metas.find((m) => m.attrs.name === 'referrer')?.attrs.content ?? null;

describe('parsePortalPath', () => {
  for (const [label, path, expected] of [
    ['a portal email link', `/portal/${CLIENT}/${TOKEN}`,
      { kind: 'link', clientId: CLIENT, token: TOKEN, cleanPath: `/portal/${CLIENT}` }],
    ['a pre-CP-43 link without tenant', `/portal/${TOKEN}`,
      { kind: 'link', clientId: null, token: TOKEN, cleanPath: '/portal' }],
    ['a decision link', `/portal/${CLIENT}/decision/${TOKEN}`,
      { kind: 'decision', clientId: CLIENT, token: TOKEN, cleanPath: `/portal/${CLIENT}/decision` }],
    ['a pre-CP-43 decision link', `/portal/decision/${TOKEN}`,
      { kind: 'decision', clientId: null, token: TOKEN, cleanPath: '/portal/decision' }],
    ['an already scrubbed link', `/portal/${CLIENT}`,
      { kind: 'link', clientId: CLIENT, token: null, cleanPath: `/portal/${CLIENT}` }],
    ['an already scrubbed decision', `/portal/${CLIENT}/decision`,
      { kind: 'decision', clientId: CLIENT, token: null, cleanPath: `/portal/${CLIENT}/decision` }],
    ['the bare portal', '/portal', { kind: 'link', clientId: null, token: null, cleanPath: '/portal' }],
    ['a percent-encoded token', '/portal/a%2Fb', { kind: 'link', clientId: null, token: 'a/b', cleanPath: '/portal' }],
  ]) {
    it(`reads ${label}`, () => {
      assert.deepEqual(parsePortalPath(path), expected);
    });
  }

  for (const path of ['/sales-order', '/', '', null, '/portals/x', `/sales-order/${CLIENT}`]) {
    it(`is null for the non-portal path ${JSON.stringify(path)}`, () => {
      assert.equal(parsePortalPath(path), null);
    });
  }
});

describe('isPortalPath', () => {
  it('recognises every portal page, below the router base too', () => {
    for (const [pathname, routerBase] of [
      ['/portal'], ['/portal/ABC'], ['/portal/decision'], ['/portal/decision/tok'],
      ['/go/portal/0123456789ABCDEF0123456789ABCDEF/decision', '/go'],
    ]) {
      assert.equal(isPortalPath({ pathname, routerBase }), true, pathname);
    }
  });

  it('says no to the app and to a path outside the router base', () => {
    for (const [pathname, routerBase] of [
      ['/'], ['/onboarding'], ['/portals'], ['/sales-order/portal'], ['/portal', '/go'],
    ]) {
      assert.equal(isPortalPath({ pathname, routerBase }), false, pathname);
    }
  });
});

describe('scrubPortalTokenFromLocation', () => {
  for (const [label, url, routerBase, expectedUrl, key, expectedEntry] of [
    ['a link', `/portal/${CLIENT}/${TOKEN}`, '/', `/portal/${CLIENT}`,
      PORTAL_LINK_STORAGE_KEY, { clientId: CLIENT, token: TOKEN }],
    ['a pre-CP-43 link', `/portal/${TOKEN}`, '/', '/portal',
      PORTAL_LINK_STORAGE_KEY, { clientId: null, token: TOKEN }],
    ['a decision link', `/portal/${CLIENT}/decision/${TOKEN}`, '/', `/portal/${CLIENT}/decision`,
      PORTAL_DECISION_STORAGE_KEY, { clientId: CLIENT, token: TOKEN }],
    ['a pre-CP-43 decision link', `/portal/decision/${TOKEN}`, '/', '/portal/decision',
      PORTAL_DECISION_STORAGE_KEY, { clientId: null, token: TOKEN }],
    ['a link under the router base, keeping search and hash', `/go/portal/${CLIENT}/${TOKEN}?view=list&kind=ORDER#top`,
      '/go/', `/go/portal/${CLIENT}?view=list&kind=ORDER#top`, PORTAL_LINK_STORAGE_KEY, { clientId: CLIENT, token: TOKEN }],
  ]) {
    it(`moves the token of ${label} into sessionStorage and rewrites the URL without it`, () => {
      const win = fakeWindow(url);

      assert.equal(scrubPortalTokenFromLocation({ win, routerBase }), true);

      assert.equal(win.replaced.length, 1);
      assert.equal(win.replaced[0].next, expectedUrl);
      assert.ok(!win.replaced[0].next.includes(TOKEN));
      assert.deepEqual(win.replaced[0].state, { idx: 0 }, 'keeps the router history state');
      assert.deepEqual(stored(win, key), expectedEntry);
      assert.equal(referrerMeta(win), 'same-origin');
    });
  }

  // ETP-6209 KPIs: a token in the URL is a new click on an email link, so a new session.
  it('clears the stored KPI session when a token arrives in the URL, and keeps it on a reload', () => {
    const SESSION = '0123456789abcdef0123456789abcdef';
    const win = fakeWindow(`/portal/${CLIENT}/${TOKEN}`);
    win.sessionStorage.setItem(PORTAL_SESSION_STORAGE_KEY, SESSION);
    scrubPortalTokenFromLocation({ win });
    assert.equal(readPortalSession(win), null);

    const reload = fakeWindow(`/portal/${CLIENT}`);
    reload.sessionStorage.setItem(PORTAL_SESSION_STORAGE_KEY, SESSION);
    scrubPortalTokenFromLocation({ win: reload });
    assert.equal(readPortalSession(reload), SESSION);
  });

  it('keeps a link and a decision in separate entries', () => {
    const win = fakeWindow(`/portal/${CLIENT}/decision/${TOKEN}`);
    scrubPortalTokenFromLocation({ win });
    assert.equal(win.sessionStorage.data.has(PORTAL_LINK_STORAGE_KEY), false);
    assert.equal(readPortalDecision(CLIENT, win).token, TOKEN);
  });

  it('falls back to memory when sessionStorage is blocked, so the page can still read the link', () => {
    const token = 'memory-only-token-0000000000000000000000000';
    const win = fakeWindow(`/portal/${OTHER_CLIENT}/${token}`, { blockedStorage: true });

    assert.equal(scrubPortalTokenFromLocation({ win }), true);

    assert.equal(win.replaced[0].next, `/portal/${OTHER_CLIENT}`);
    assert.deepEqual(readPortalLink(OTHER_CLIENT, win), { clientId: OTHER_CLIENT, token });
  });

  it('sets the referrer policy on a portal route even when the URL is already token-free', () => {
    const win = fakeWindow(`/portal/${CLIENT}`);

    assert.equal(scrubPortalTokenFromLocation({ win }), false);

    assert.equal(win.replaced.length, 0);
    assert.equal(referrerMeta(win), 'same-origin');
  });

  it('overwrites an existing referrer meta instead of adding a second one', () => {
    const win = fakeWindow(`/portal/${CLIENT}/${TOKEN}`);
    const existing = win.document.createElement('meta');
    existing.setAttribute('name', 'referrer');
    existing.setAttribute('content', 'unsafe-url');
    win.document.head.appendChild(existing);

    scrubPortalTokenFromLocation({ win });

    assert.equal(win.document.metas.length, 1);
    assert.equal(referrerMeta(win), 'same-origin');
  });

  for (const [label, url, routerBase] of [
    ['a non-portal route', `/sales-order/${CLIENT}`, '/'],
    ['a portal-looking path outside the router base', `/portal/${CLIENT}/${TOKEN}`, '/go/'],
  ]) {
    it(`leaves ${label} untouched, with no referrer policy`, () => {
      const win = fakeWindow(url);

      assert.equal(scrubPortalTokenFromLocation({ win, routerBase }), false);

      assert.equal(win.replaced.length, 0);
      assert.equal(win.sessionStorage.data.size, 0);
      assert.equal(referrerMeta(win), null);
    });
  }
});

describe('readPortalLink / resolvePortalRoute', () => {
  function windowHolding(entry) {
    const win = fakeWindow('/');
    win.sessionStorage.setItem(PORTAL_LINK_STORAGE_KEY, JSON.stringify(entry));
    return win;
  }

  for (const [label, entry, asked, expected] of [
    ['the stored tenant', { clientId: CLIENT, token: TOKEN }, CLIENT, { clientId: CLIENT, token: TOKEN }],
    ['any tenant', { clientId: CLIENT, token: TOKEN }, null, { clientId: CLIENT, token: TOKEN }],
    ['a tenant, for a link stored without one', { clientId: null, token: TOKEN }, CLIENT, { clientId: null, token: TOKEN }],
    ['another tenant', { clientId: CLIENT, token: TOKEN }, OTHER_CLIENT, null],
  ]) {
    it(`${expected ? 'returns' : 'refuses'} the stored link when asked for ${label}`, () => {
      assert.deepEqual(readPortalLink(asked, windowHolding(entry)), expected);
    });
  }

  const storedFor = (link) => (clientId) => (
    !clientId || !link.clientId || link.clientId === clientId ? link : null);

  for (const [label, params, readStored, expected] of [
    ['a tenant segment with a matching stored link', { segment: CLIENT },
      storedFor({ clientId: CLIENT, token: TOKEN }), { clientId: CLIENT, token: TOKEN, inUrl: false }],
    ['a tenant segment whose stored link is another tenant', { segment: CLIENT },
      storedFor({ clientId: OTHER_CLIENT, token: TOKEN }), { clientId: CLIENT, token: '', inUrl: false }],
    ['a token segment (pre-CP-43 in-app navigation)', { segment: TOKEN },
      () => null, { clientId: null, token: TOKEN, inUrl: true }],
    ['clientId + token in the URL', { clientId: CLIENT, token: TOKEN },
      () => null, { clientId: CLIENT, token: TOKEN, inUrl: true }],
    ['a malformed clientId', { clientId: 'not-a-tenant', token: TOKEN },
      () => null, { clientId: null, token: '', inUrl: true }],
    ['the bare /portal with a stored link', {},
      storedFor({ clientId: CLIENT, token: TOKEN }), { clientId: CLIENT, token: TOKEN, inUrl: false }],
    ['the bare /portal with nothing stored', {},
      () => null, { clientId: null, token: '', inUrl: false }],
  ]) {
    it(`resolves ${label}`, () => {
      assert.deepEqual(resolvePortalRoute(params, readStored), expected);
    });
  }
});

describe('portalPath', () => {
  for (const [clientId, search, expected] of [
    [CLIENT, 'view=home', `/portal/${CLIENT}?view=home`],
    [CLIENT, new URLSearchParams({ view: 'list', kind: 'ORDER' }), `/portal/${CLIENT}?view=list&kind=ORDER`],
    [CLIENT, '', `/portal/${CLIENT}`],
    [null, 'view=home', '/portal?view=home'],
    ['not-a-tenant', undefined, '/portal'],
  ]) {
    it(`builds ${expected}`, () => {
      assert.equal(portalPath(clientId, search), expected);
    });
  }
});

// GUARDRAIL — the scrub only protects the token if it runs before anything that can read
// `location` (observability, feature flags, a GTM loader). ES modules evaluate imports in order,
// so it must be main.jsx's FIRST import; a merge that puts e.g. `installGtm` above it ships the
// token to third parties on the first page view.
describe('main.jsx boot order', () => {
  const APP_SHELL = resolve(import.meta.dirname, '../../../..');

  it('imports the portal URL scrub before any other module', () => {
    const source = readFileSync(resolve(APP_SHELL, 'src/main.jsx'), 'utf8');
    const firstImport = source.split('\n').map((line) => line.trim()).find((line) => /^import\b/.test(line));
    assert.equal(firstImport, "import './lib/portal/scrubPortalUrl.boot.js';");
  });

  it('keeps the boot module free of anything but the base path and the scrub', () => {
    const source = readFileSync(resolve(APP_SHELL, 'src/lib/portal/scrubPortalUrl.boot.js'), 'utf8');
    const imports = [...source.matchAll(/^import\s.*from\s+'([^']+)';/gm)].map((match) => match[1]);
    assert.deepEqual(imports.sort(), ['../neoBaseUrl.js', './portalLinkSession.js']);
    assert.match(source, /scrubPortalTokenFromLocation\(\{\s*routerBase: detectBasePath\(\)\.routerBase\s*\}\)/);
  });

  // ETP-6209 — the portal has no tracking: main.jsx decides once whether the page is a portal page
  // (isPortalPath, no second regex) and hands that one decision to GTM, to observability and to the
  // feature flags. A merge that drops one hand-off loads GA4/HubSpot, Datadog RUM/Mixpanel or the
  // Datadog Feature Flags SDK (which reports exposures) on the portal again.
  it('hands one portal decision to GTM, to observability and to the feature flags', () => {
    const source = readFileSync(resolve(APP_SHELL, 'src/main.jsx'), 'utf8');
    assert.match(source, /const portalPage = isPortalPath\(\{[^}]*pathname: window\.location\.pathname,[^}]*routerBase: detectBasePath\(\)\.routerBase,?\s*\}\);/);
    assert.match(source, /resolveGtmId\(\{[^}]*\bportalPage\b[^}]*\}\)/);
    assert.match(source, /initBrowserObservability\(\{[^}]*\bportalPage\b[^}]*\}\)/);
    assert.match(source, /const flagsReady = portalPage \? undefined : initFeatureFlags\(\);/);
    assert.equal(source.match(/\binitFeatureFlags\(/g)?.length, 1, 'initFeatureFlags is called only behind the portal guard');
  });
});

describe('portal KPI session id', () => {
  const SESSION = '0123456789abcdef0123456789abcdef';

  it('stores, reads and clears a well-formed session id only', () => {
    const win = fakeWindow(`/portal/${CLIENT}`);
    rememberPortalSession('not-a-session', win);
    assert.equal(readPortalSession(win), null);
    rememberPortalSession(SESSION, win);
    assert.equal(readPortalSession(win), SESSION);
    clearPortalSession(win);
    assert.equal(readPortalSession(win), null);
  });

  it('survives blocked storage for the page load', () => {
    const win = fakeWindow(`/portal/${CLIENT}`, { blockedStorage: true });
    rememberPortalSession(SESSION, win);
    assert.equal(readPortalSession(win), SESSION);
    clearPortalSession(win);
    assert.equal(readPortalSession(win), null);
  });
});

