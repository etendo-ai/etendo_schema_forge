// @covers tools/app-shell/src/lib/marketing/consent.js
import { clearMixpanelCookies, onAnalyticsConsent } from '../consent.js';

/**
 * ETP-6363 — the Analytics choice of marketing's cookie banner (HubSpot's), which product
 * analytics waits for.
 */
describe('onAnalyticsConsent', () => {
  function bannerWindow() {
    const win = {};
    const fire = (categories) => {
      for (const [command, callback] of win._hsp) {
        if (command === 'addPrivacyConsentListener') callback({ categories });
      }
    };
    return { win, fire };
  }

  it('registers with HubSpot and reports the Analytics category on load and on every change', () => {
    const { win, fire } = bannerWindow();
    const listener = vi.fn();
    onAnalyticsConsent(listener, win);

    fire({ analytics: false, advertisement: true });
    fire({ analytics: true });
    expect(listener.mock.calls).toEqual([[false], [true]]);
  });

  it('keeps what HubSpot already queued in _hsp', () => {
    const win = { _hsp: [['setPath', '/']] };
    onAnalyticsConsent(vi.fn(), win);
    expect(win._hsp[0]).toEqual(['setPath', '/']);
    expect(win._hsp[1][0]).toBe('addPrivacyConsentListener');
  });

  it('takes a missing or malformed choice as no consent', () => {
    const { win } = bannerWindow();
    const listener = vi.fn();
    onAnalyticsConsent(listener, win);
    win._hsp[0][1](undefined);
    win._hsp[0][1]({ categories: { analytics: 'yes' } });
    expect(listener.mock.calls).toEqual([[false], [false]]);
  });

  it('stops calling the listener once unsubscribed, and never lets it break the banner', () => {
    const { win, fire } = bannerWindow();
    const listener = vi.fn(() => { throw new Error('boom'); });
    const stop = onAnalyticsConsent(listener, win);
    expect(() => fire({ analytics: true })).not.toThrow();
    stop();
    fire({ analytics: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does nothing outside a browser or without a listener', () => {
    expect(onAnalyticsConsent(vi.fn(), null)).toBeTypeOf('function');
    const win = {};
    onAnalyticsConsent(null, win);
    expect(win._hsp).toBeUndefined();
  });
});

describe('clearMixpanelCookies', () => {
  function cookieJar(initial) {
    const writes = [];
    return {
      writes,
      get cookie() { return initial; },
      set cookie(value) { writes.push(value); },
    };
  }

  it('expires every Mixpanel cookie on the host and on the parent domain, and nothing else', () => {
    const doc = cookieJar('mp_abc_mixpanel=1; hubspotutk=x; _ga=y; mp_optout=1');
    clearMixpanelCookies(doc, 'app.etendo.ai');
    expect(doc.writes).toEqual([
      'mp_abc_mixpanel=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/',
      'mp_abc_mixpanel=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.etendo.ai',
      'mp_optout=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/',
      'mp_optout=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.etendo.ai',
    ]);
  });

  it('only clears the host when it has no parent domain, and tolerates no document', () => {
    const doc = cookieJar('mp_abc_mixpanel=1');
    clearMixpanelCookies(doc, 'localhost');
    expect(doc.writes).toEqual(['mp_abc_mixpanel=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/']);
    expect(() => clearMixpanelCookies(null, 'app.etendo.ai')).not.toThrow();
  });
});
