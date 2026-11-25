#!/usr/bin/env node
// Exact-value header assertions on the three Etendo Go distributions (ETP-4574, ADR-0002).
// Probes an HTML document, a content-hashed asset and an SPA error response per host and compares
// each header with the repo policies (single source of truth), not with a header score.
//
// Also probes a MISSING file under the asset path: the SPA error response must never be served
// `immutable` (it would pin a stale index.html for a year) and still carries the CSP.
//
// Experimental is opt-in (`--env experimental`): it serves no HSTS today and the v2 policies would
// introduce includeSubDomains; preload there, which is gated on the HTTPS inventory (runbook).
//
// Usage: CSP_CONNECT_ORIGINS=<https origins> node scripts/verify-security-headers.mjs \
//          [--env production,staging[,experimental]] [--host <hostname>] --asset /assets/index-<hash>.js
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicyByName } from './cloudfront-security-headers.mjs';

export const HOSTS = {
  production: 'go.etendo.cloud',
  staging: 'go.staging.etendo.cloud',
  experimental: 'go.experimental.etendo.cloud',
};
export const DEFAULT_ENVS = ['production', 'staging'];
const HTML_POLICY = 'etendo-go-security-headers-v2';
const ASSET_POLICY = 'etendo-go-assets-headers-v2';
const ERROR_PATH = '/__security-headers-probe-missing-route__';
const MISSING_ASSET_PATH = '/assets/__security-headers-probe-missing__.js';
const IMMUTABLE = /immutable/;
const IMMUTABLE_OR_LONG = /immutable|max-age=(?!0\b)\d{6,}/;

// Lower-cased header name -> exact expected value, derived from a policy file.
function fromPolicy(policy) {
  const s = policy.SecurityHeadersConfig;
  const hsts = s.StrictTransportSecurity;
  const out = {
    'strict-transport-security': `max-age=${hsts.AccessControlMaxAgeSec}${hsts.IncludeSubdomains ? '; includeSubDomains' : ''}${hsts.Preload ? '; preload' : ''}`,
    'x-content-type-options': 'nosniff',
    'x-frame-options': s.FrameOptions.FrameOption,
    'referrer-policy': s.ReferrerPolicy.ReferrerPolicy,
  };
  if (s.ContentSecurityPolicy) out['content-security-policy'] = s.ContentSecurityPolicy.ContentSecurityPolicy;
  for (const { Header, Value } of policy.CustomHeadersConfig?.Items ?? []) out[Header.toLowerCase()] = Value;
  return out;
}

// `missing-asset` is the SPA fallback served for an unknown file under the asset path. CloudFront
// applies the policy of the behavior matching the request path, so it gets the ASSETS policy (which
// carries the same CSP and sets no Cache-Control), and must not be long-lived or immutable. A real
// asset must be immutable, which comes from the origin object metadata, not from the policy.
export function expectedHeaders(kind, env = process.env) {
  const expected = fromPolicy(loadPolicyByName(kind === 'html' ? HTML_POLICY : ASSET_POLICY, env));
  const forbiddenValues = kind === 'missing-asset' ? { 'cache-control': IMMUTABLE_OR_LONG } : {};
  const requiredValues = kind === 'asset' ? { 'cache-control': IMMUTABLE } : {};
  return { expected, forbidden: ['content-security-policy-report-only'], forbiddenValues, requiredValues };
}

export function checkHeaders({ expected, forbidden, forbiddenValues = {}, requiredValues = {} }, headers) {
  const get = (n) => (headers instanceof Headers ? headers.get(n) : headers[n]);
  const failures = Object.entries(expected)
    .filter(([name, value]) => get(name) !== value)
    .map(([name, value]) => `${name}: expected "${value}", got ${JSON.stringify(get(name) ?? null)}`);
  for (const name of forbidden) if (get(name) != null) failures.push(`${name}: must not be present`);
  for (const [name, re] of Object.entries(forbiddenValues)) {
    if (re.test(get(name) ?? '')) failures.push(`${name}: must not match ${re} (got ${JSON.stringify(get(name))})`);
  }
  for (const [name, re] of Object.entries(requiredValues)) {
    if (!re.test(get(name) ?? '')) failures.push(`${name}: must match ${re} (got ${JSON.stringify(get(name) ?? null)})`);
  }
  return failures;
}

export async function verifyHost({ host, assetPath, env = process.env, fetchFn = fetch }) {
  const probes = [
    ['html', '/', 'html', [200]],
    ['asset', assetPath, 'asset', [200]],
    ['error', ERROR_PATH, 'html', [200, 404]],
    ['missing-asset', MISSING_ASSET_PATH, 'missing-asset', [200, 404]],
  ];
  const failures = [];
  for (const [label, path, kind, statuses] of probes) {
    const res = await fetchFn(`https://${host}${path}`, { redirect: 'manual' });
    if (!statuses.includes(res.status)) failures.push(`${host} ${label} ${path}: unexpected status ${res.status}`);
    for (const f of checkHeaders(expectedHeaders(kind, env), res.headers)) failures.push(`${host} ${label} ${path}: ${f}`);
  }
  return { host, failures };
}

async function main(argv) {
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i < 0 ? undefined : argv[i + 1]; };
  const names = opt('env')?.split(',') ?? DEFAULT_ENVS;
  const assetPath = opt('asset');
  const hostOverride = opt('host');
  const unknown = names.filter((n) => !HOSTS[n]);
  if (!assetPath || unknown.length > 0 || (hostOverride && (names.length !== 1 || !/^[a-z0-9.-]+$/i.test(hostOverride)))) {
    console.error(`usage: verify-security-headers.mjs --asset /assets/<hashed file> [--host <hostname>, with exactly one --env] [--env ${Object.keys(HOSTS).join(',')}] (default: ${DEFAULT_ENVS.join(',')})`);
    process.exit(2);
  }
  const results = await Promise.all(names.map((n) => verifyHost({ host: hostOverride || HOSTS[n], assetPath })));
  for (const r of results) console.log(JSON.stringify(r));
  if (results.some((r) => r.failures.length > 0)) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
