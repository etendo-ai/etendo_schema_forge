import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GTM_ID,
  installGtm,
  isGtmInstalled,
  resolveGtmId,
  showCookieBanner,
} from '../gtm.js';
import { isPortalPath } from '../../portal/portalLinkSession.js';

/**
 * ETP-6363 — marketing's tag container loads on the production host only, never in a support
 * session, and the cookie settings reopen HubSpot's banner.
 *
 * @covers tools/app-shell/src/lib/marketing/gtm.js
 * @covers tools/app-shell/src/lib/portal/portalLinkSession.js
 */
describe('resolveGtmId', () => {
  it('loads the app container on the production host', () => {
    expect(resolveGtmId({ hostname: 'app.etendo.ai' })).toBe(DEFAULT_GTM_ID);
    expect(resolveGtmId({ hostname: 'APP.ETENDO.AI' })).toBe(DEFAULT_GTM_ID);
  });

  it('loads nothing on a developer machine, a staging host or in a support session', () => {
    expect(resolveGtmId({ hostname: 'localhost' })).toBeNull();
    expect(resolveGtmId({ hostname: 'staging.etendo.ai' })).toBeNull();
    expect(resolveGtmId({ hostname: 'app.etendo.ai', supportSession: true })).toBeNull();
    expect(resolveGtmId({ hostname: 'app.etendo.ai', env: { VITE_GTM_ENABLED: 'false' } })).toBeNull();
  });

  it('takes the hosts and the container from the build when set', () => {
    const env = { VITE_GTM_HOSTS: 'local.etendo.ai, staging.etendo.ai', VITE_GTM_ID: 'GTM-TEST1' };
    expect(resolveGtmId({ hostname: 'local.etendo.ai', env })).toBe('GTM-TEST1');
    expect(resolveGtmId({ hostname: 'app.etendo.ai', env })).toBeNull();
    expect(resolveGtmId({ hostname: 'app.etendo.ai', env: { VITE_GTM_ID: 'not-a-container' } })).toBeNull();
  });
});

// ETP-6209 — the customer portal loads no tags at all (no tracking without a consent banner);
// every other page of the production host keeps the container. Same call main.jsx makes.
describe('resolveGtmId on customer-portal pages', () => {
  const gtmFor = (pathname, routerBase = '/') => resolveGtmId({
    hostname: 'app.etendo.ai',
    portalPage: isPortalPath({ pathname, routerBase }),
  });

  it.each([
    ['/portal'],
    ['/portal/0123456789ABCDEF0123456789ABCDEF'],
    ['/portal/0123456789ABCDEF0123456789ABCDEF/decision'],
    ['/portal/decision'],
    ['/go/portal/0123456789ABCDEF0123456789ABCDEF', '/go'],
  ])('installs nothing on %s', (pathname, routerBase) => {
    expect(gtmFor(pathname, routerBase)).toBeNull();
    const win = {};
    expect(installGtm(gtmFor(pathname, routerBase), { win, doc: document })).toBe(false);
    expect(isGtmInstalled(win)).toBe(false);
  });

  it.each([
    ['/onboarding'],
    ['/dashboard'],
    ['/sales-order/0123456789ABCDEF0123456789ABCDEF'],
    ['/portals'],
    ['/go/onboarding', '/go'],
  ])('keeps the container on %s', (pathname, routerBase) => {
    expect(gtmFor(pathname, routerBase)).toBe(DEFAULT_GTM_ID);
  });
});

describe('installGtm', () => {
  it('starts the dataLayer and adds the container script once', () => {
    const win = {};
    expect(installGtm('GTM-TEST1', { win, doc: document })).toBe(true);
    expect(installGtm('GTM-TEST1', { win, doc: document })).toBe(false);

    expect(isGtmInstalled(win)).toBe(true);
    expect(win.dataLayer[0]).toMatchObject({ event: 'gtm.js' });
    const scripts = [...document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]')];
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toContain('id=GTM-TEST1');
    expect(scripts[0].async).toBe(true);
  });

  it('does nothing without a container', () => {
    const win = {};
    expect(installGtm(null, { win, doc: document })).toBe(false);
    expect(isGtmInstalled(win)).toBe(false);
    expect(win.dataLayer).toBeUndefined();
  });
});

describe('showCookieBanner', () => {
  it('asks HubSpot to show its banner again', () => {
    const win = {};
    showCookieBanner(win);
    expect(win._hsp).toEqual([['showBanner']]);
  });
});
