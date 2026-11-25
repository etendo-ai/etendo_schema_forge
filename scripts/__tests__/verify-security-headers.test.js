// @covers scripts/verify-security-headers.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOSTS,
  DEFAULT_ENVS,
  expectedHeaders,
  checkHeaders,
  verifyHost,
} from '../verify-security-headers.mjs';
import { loadPolicyByName } from '../cloudfront-security-headers.mjs';

const ENV = { CSP_CONNECT_ORIGINS: 'https://glitchtip.example.com' };
const HTML = 'etendo-go-security-headers-v2';
const ASSETS = 'etendo-go-assets-headers-v2';

const goodHtml = () => {
  const p = loadPolicyByName(HTML, ENV);
  return {
    'content-security-policy': p.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy,
    'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), geolocation=(), microphone=()',
    'cache-control': 'no-cache, no-store, must-revalidate',
    'reporting-endpoints': 'csp-endpoint="/sws/go/csp-report"',
  };
};

describe('enforced HTML policy v2', () => {
  const p = loadPolicyByName(HTML, ENV);
  const csp = p.SecurityHeadersConfig.ContentSecurityPolicy;
  it('enforces CSP (not report-only) with upgrade-insecure-requests and frame-ancestors none', () => {
    assert.equal(csp.Override, true);
    assert.match(csp.ContentSecurityPolicy, /default-src 'self'/);
    assert.match(csp.ContentSecurityPolicy, /frame-ancestors 'none'/);
    assert.match(csp.ContentSecurityPolicy, /upgrade-insecure-requests/);
    assert.match(csp.ContentSecurityPolicy, /connect-src 'self' https:\/\/dataplane\.rum\.eu-west-3\.amazonaws\.com https:\/\/glitchtip\.example\.com/);
    assert.doesNotMatch(JSON.stringify(p), /Report-Only/i);
    assert.doesNotMatch(csp.ContentSecurityPolicy, /unsafe-inline|unsafe-eval|script-src/);
  });
  // Snapshot of the rendered v2 CSP: it pins the intended policy so an accidental edit of the JSON
  // fails here. It does not track com.etendoerp.go; the baseline there is csp-report-only.json
  // (ETP-4572), and a change to either must be mirrored by hand.
  it('renders the v2 CSP exactly as the pinned snapshot', () => {
    assert.equal(
      csp.ContentSecurityPolicy,
      "default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob: data:; frame-src 'self' blob:; connect-src 'self' https://dataplane.rum.eu-west-3.amazonaws.com https://glitchtip.example.com; upgrade-insecure-requests; report-uri /sws/go/csp-report; report-to csp-endpoint",
    );
  });
  it('tightens XFO to DENY and keeps the live hardening headers', () => {
    assert.equal(p.SecurityHeadersConfig.FrameOptions.FrameOption, 'DENY');
    assert.equal(p.SecurityHeadersConfig.StrictTransportSecurity.AccessControlMaxAgeSec, 31536000);
    assert.equal(p.CorsConfig, undefined);
  });
  it('fails closed without valid deployment connect origins', () => {
    assert.throws(() => loadPolicyByName(HTML, {}), /CSP_CONNECT_ORIGINS/);
    for (const bad of ['http://x.com', 'https://x.com; script-src *', "https://x.com'", '*', '']) {
      assert.throws(() => loadPolicyByName(HTML, { CSP_CONNECT_ORIGINS: bad }), /CSP_CONNECT_ORIGINS|origin/);
    }
  });
  it('never leaves a placeholder in a rendered policy', () => {
    assert.doesNotMatch(JSON.stringify(p), /\{\{/);
  });
});

describe('assets policy v2', () => {
  const p = loadPolicyByName(ASSETS, ENV);
  it('carries the same CSP as the document policy and never overrides Cache-Control', () => {
    const html = loadPolicyByName(HTML, ENV);
    assert.equal(
      p.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy,
      html.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy,
    );
    assert.equal(p.CustomHeadersConfig.Items.find((i) => i.Header === 'Cache-Control'), undefined);
    assert.equal(p.SecurityHeadersConfig.FrameOptions.FrameOption, 'DENY');
  });
});

describe('exact header assertions', () => {
  it('passes the exact enforced HTML set', () => {
    assert.deepEqual(checkHeaders(expectedHeaders('html', ENV), goodHtml()), []);
  });
  it('flags report-only CSP, weakened or missing headers and extra CSP-Report-Only', () => {
    const h = goodHtml();
    delete h['content-security-policy'];
    h['content-security-policy-report-only'] = 'default-src *';
    h['x-frame-options'] = 'SAMEORIGIN';
    delete h['x-content-type-options'];
    h['strict-transport-security'] = 'max-age=300';
    const fails = checkHeaders(expectedHeaders('html', ENV), h).join('\n');
    assert.match(fails, /^content-security-policy: expected/m);
    assert.match(fails, /content-security-policy-report-only: must not be present/);
    for (const name of ['x-frame-options', 'x-content-type-options', 'strict-transport-security']) {
      assert.match(fails, new RegExp(`^${name}: `, 'm'));
    }
  });
  it('flags a header that arrives twice (Headers joins duplicates)', () => {
    const h = new Headers(goodHtml());
    h.append('x-frame-options', 'DENY');
    assert.match(checkHeaders(expectedHeaders('html', ENV), h).join('\n'), /^x-frame-options: expected "DENY", got "DENY, DENY"/m);
  });
  it('rejects immutable caching on a missing asset', () => {
    const e = expectedHeaders('missing-asset', ENV);
    assert.deepEqual(checkHeaders(e, { ...goodHtml(), 'cache-control': 'no-cache, no-store, must-revalidate' }), []);
    assert.deepEqual(checkHeaders(e, { ...goodHtml(), 'cache-control': undefined }), []);
    assert.match(checkHeaders(e, (({ 'content-security-policy': _c, ...h }) => h)(goodHtml())).join(), /^content-security-policy: expected/);
    assert.match(checkHeaders(e, { ...goodHtml(), 'cache-control': 'public, max-age=31536000, immutable' }).join(), /cache-control: must not match/);
    assert.match(checkHeaders(e, { ...goodHtml(), 'cache-control': 'max-age=31536000' }).join(), /cache-control: must not match/);
  });
  it('requires immutable caching on assets', () => {
    const h = { ...goodHtml(), 'cache-control': 'public, max-age=31536000, immutable' };
    assert.deepEqual(checkHeaders(expectedHeaders('asset', ENV), h), []);
    h['cache-control'] = 'public, max-age=60';
    assert.match(checkHeaders(expectedHeaders('asset', ENV), h).join(), /cache-control/);
  });
});

describe('verifyHost', () => {
  const respond = (map) => async (url) => {
    const path = new URL(url).pathname;
    const r = map[path] ?? map['*'];
    return { status: r.status, headers: new Headers(r.headers) };
  };
  it('checks the document, a hashed asset, a missing asset and an SPA error response on one host', async () => {
    const seen = [];
    const html = goodHtml();
    const asset = { ...html, 'cache-control': 'public, max-age=31536000, immutable' };
    const fetchFn = async (url, init) => {
      seen.push(new URL(url).pathname);
      return respond({
        '/': { status: 200, headers: html },
        '/assets/index-abc123.js': { status: 200, headers: asset },
        '*': { status: 404, headers: html },
      })(url, init);
    };
    const res = await verifyHost({ host: 'go.example.com', assetPath: '/assets/index-abc123.js', env: ENV, fetchFn });
    assert.deepEqual(res.failures, []);
    assert.equal(seen.length, 4);
    assert.ok(seen.includes('/') && seen.some((p) => p.startsWith('/assets/__security-headers-probe-missing')));
  });
  it('reports failures prefixed by host and probe', async () => {
    const html = goodHtml();
    html['x-frame-options'] = 'SAMEORIGIN';
    const fetchFn = respond({ '*': { status: 200, headers: html } });
    const res = await verifyHost({ host: 'h.example.com', assetPath: '/assets/a.js', env: ENV, fetchFn });
    assert.ok(res.failures.some((f) => /^h\.example\.com .*html.*x-frame-options/.test(f)));
  });
  it('fails when a missing asset is served immutable (stale SPA shell pinned for a year)', async () => {
    const html = goodHtml();
    const fetchFn = async (url) => {
      const missing = new URL(url).pathname.startsWith('/assets/__security-headers-probe-missing');
      return { status: 200, headers: new Headers(missing ? { ...html, 'cache-control': 'public, max-age=31536000, immutable' } : html) };
    };
    const res = await verifyHost({ host: 'h.example.com', assetPath: '/assets/a.js', env: ENV, fetchFn });
    assert.ok(res.failures.some((f) => /missing-asset.*immutable|missing-asset.*cache-control/.test(f)));
  });
  it('exposes the three hosts; experimental is opt-in until the HSTS inventory exists', () => {
    assert.deepEqual(Object.keys(HOSTS).sort(), ['experimental', 'production', 'staging']);
    assert.deepEqual(DEFAULT_ENVS, ['production', 'staging']);
  });
});
