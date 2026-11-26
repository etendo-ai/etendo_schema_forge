// @covers tools/app-shell/src/lib/observability/browser.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildBrowserObservabilityConfig, initBrowserObservability } from '../observability/browser.js';

describe('browser observability startup', () => {
  it('emits app_started once after initializing providers', async () => {
    const calls = [];
    const client = {
      async initObservability(config) {
        calls.push(['initObservability', config.context.app]);
      },
      async track(eventName) {
        calls.push(['track', eventName]);
      },
    };

    await initBrowserObservability(
      {
        env: {},
        location: { hostname: 'localhost' },
        logger: { warn() {} },
      },
      client
    );

    assert.deepEqual(calls, [
      ['initObservability', 'app-shell'],
      ['track', 'app_started'],
    ]);
  });
});

// ETP-6209 — a customer-portal page has no tracking: no Datadog RUM (click actions, replay, its
// session cookie) and no Mixpanel. AWS RUM (performance, errors, HTTP; cookies off) stays as the
// portal's error monitoring. Every other page keeps the three providers.
describe('browser observability on customer-portal pages', () => {
  const providerNames = (portalPage) => buildBrowserObservabilityConfig({
    env: {},
    location: { hostname: 'app.etendo.ai' },
    logger: { warn() {} },
    storage: null,
    ...(portalPage === undefined ? {} : { portalPage }),
  }).providers.map((provider) => provider.name);

  it('starts neither Datadog nor Mixpanel on a portal page', () => {
    assert.deepEqual(providerNames(true), ['aws-rum']);
  });

  it('keeps every provider on any other page', () => {
    assert.deepEqual(providerNames(false), ['datadog', 'aws-rum', 'mixpanel']);
    assert.deepEqual(providerNames(undefined), ['datadog', 'aws-rum', 'mixpanel']);
  });

  it('hands the portal decision from initBrowserObservability to the providers', async () => {
    let names;
    await initBrowserObservability(
      { env: {}, location: { hostname: 'app.etendo.ai' }, logger: { warn() {} }, storage: null, portalPage: true },
      {
        async initObservability(config) { names = config.providers.map((provider) => provider.name); },
        async track() {},
      },
    );
    assert.deepEqual(names, ['aws-rum']);
  });
});

// The Mixpanel one-time stale-identity reset used to be orchestrated here (an
// external `resetStaleMixpanelIdentity()` step between `initObservability()` and
// the first `track()` call). That ordering assumption turned out to be unsafe:
// other call sites (e.g. ObservabilityRouteTracker's route-change `page()` call)
// go through core.js's shared `initialized` gate, not through this function's
// sequencing, and could reach the Mixpanel provider before this file's reset step
// ran. The reset now lives entirely inside `createMixpanelProvider`'s internal
// `getClient()` gate (providers/mixpanel.js), which every provider method funnels
// through before it ever touches the SDK — see observability-mixpanel.test.js for
// the coverage of that gate (ordering, exactly-once, concurrent-caller, and
// failure/retry behavior).
