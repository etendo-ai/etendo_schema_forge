#!/usr/bin/env node
/**
 * Mini CLI for the feature-flags panel (https://flags.jc.proxy.vpn.etendo.cloud).
 *
 * The panel sits behind Tinyauth (Google login). `login` opens a browser once and
 * stores only the Tinyauth session cookie in ~/.config/etendo-flags/session.json
 * (mode 600, outside the repo). Every other command calls the panel's JSON API
 * with that cookie — the same endpoints the web UI uses.
 *
 * Rollout model (same as the UI): a flag has a stage (off|alpha|beta|ga), an
 * environment and two rings (alpha, beta) of emails and @groups. Editing the
 * stage or rings only changes the panel's desired state; `apply` pushes it to
 * Datadog, after showing the plan.
 *
 * Usage: node cli/src/flags-panel.js help   (or: make flags ARGS="help")
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.ETENDO_FLAGS_URL || 'https://flags.jc.proxy.vpn.etendo.cloud';
const AUTH_BASE = BASE.replace('://flags.', '://auth.');
const SESSION_DIR = path.join(os.homedir(), '.config', 'etendo-flags');
const SESSION_FILE = path.join(SESSION_DIR, 'session.json');
const STAGES = ['off', 'alpha', 'beta', 'ga'];
const RINGS = ['alpha', 'beta'];

const HELP = `flags-panel — read and edit the feature-flags panel

  login                         Open a browser, sign in, store the session
  whoami                        Show the signed-in user and the GitHub owner used by --mine

  list [filters] [--json]       List flags
      --mine                    Flags I own OR whose alpha/beta audience includes me
      --owner <github>          Owner (GitHub login)
      --member <email>          Email in the alpha/beta audience (groups resolved)
      --team <team>             Team
      --stage <off|alpha|beta|ga|unmanaged>
      --search <text>           Substring of key or description
  show <key> [--json]           Detail: owner, team, stage, rings, sync, recent history

  stage <key> <off|alpha|beta|ga>
  ring <key> <alpha|beta> add|rm <email|@group>...
  env <key> <environment>       Target environment (Production, Experimental)
  owner <key> <github>  |  team <key> <team>  |  type <key> <type>
  plan <key>                    What apply would change in Datadog
  apply <key> --yes [--force]   Push the desired state to Datadog, then verify it with check
                                (--force is required when someone loses access)
  check <key> [--email a,b] [--env production]
                                Ask Datadog's flag CDN what each ring member (and you, or
                                --email) really gets; exit 2 when it differs from the panel

  raw <METHOD> <path> [json]    Call any panel endpoint, e.g. raw GET /api/kpis

Environment: ETENDO_FLAGS_URL (panel URL), ETENDO_FLAGS_OWNER (GitHub login for --mine;
default: \`gh api user\`).`;

// ---------- session & HTTP ----------

function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) fail(`No session. Run: node cli/src/flags-panel.js login`);
  const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  if (s.expires && s.expires * 1000 < Date.now()) fail('Session expired. Run: node cli/src/flags-panel.js login');
  return s;
}

async function request(base, method, url, data) {
  const s = loadSession();
  const res = await fetch(base + url, {
    method,
    headers: { cookie: `${s.name}=${s.value}`, ...(data ? { 'content-type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined,
    redirect: 'manual',
  });
  if (res.status === 401 || (res.status >= 300 && res.status < 400)) {
    fail('Session rejected (401). Run: node cli/src/flags-panel.js login');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) fail(`${method} ${url} → ${res.status}: ${json.error || json.message || res.statusText}`);
  return json;
}
const api = (method, url, data) => request(BASE, method, url, data);

async function login() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    fail('playwright is not installed in this checkout (npm install at the repo root).');
  }
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  console.log('Sign in in the browser window; it closes by itself once the panel loads.');
  const loaded = page.waitForResponse(
    (r) => r.url() === `${BASE}/api/state` && r.status() === 200,
    { timeout: 5 * 60_000 },
  );
  await page.goto(`${BASE}/#/flags`);
  await loaded;
  const cookie = (await context.cookies()).find((c) => c.name.startsWith('tinyauth-session'));
  await browser.close();
  if (!cookie) fail('Signed in, but no tinyauth-session cookie was found.');
  fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ name: cookie.name, value: cookie.value, expires: cookie.expires }), { mode: 0o600 });
  console.log(`Session saved to ${SESSION_FILE} (expires ${new Date(cookie.expires * 1000).toISOString().slice(0, 10)}).`);
}

// ---------- identity ----------

async function me() {
  const user = await request(AUTH_BASE, 'GET', '/api/context/user');
  let owner = process.env.ETENDO_FLAGS_OWNER || '';
  if (!owner) {
    try {
      owner = execFileSync('gh', ['api', 'user', '-q', '.login'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { /* gh missing or not logged in: --mine falls back to audience only */ }
  }
  return { email: (user.auth?.email || '').toLowerCase(), name: user.auth?.name || '', owner };
}

// ---------- reading ----------

const stageOf = (f) => f.rollout?.stage || 'unmanaged';
const audienceOf = (f, ring) => (f.audience?.[ring] || []).map((e) => e.toLowerCase());
/** The panel's beta audience is cumulative (it includes alpha); this returns each ring's own people. */
const ringPeople = (f, ring) => {
  const people = audienceOf(f, ring);
  if (ring === 'alpha') return people;
  const alpha = new Set(audienceOf(f, 'alpha'));
  return people.filter((e) => !alpha.has(e));
};

/** Why a flag concerns `who`: 'owner' and/or the ring ('alpha' or 'beta') that includes them. */
export function rolesFor(f, who) {
  const roles = [];
  if (who.owner && (f.owner || '').toLowerCase() === who.owner.toLowerCase()) roles.push('owner');
  for (const ring of RINGS) if (who.email && ringPeople(f, ring).includes(who.email)) roles.push(ring);
  return roles;
}

export function filterFlags(flags, opts, who) {
  const q = opts.search?.toLowerCase();
  return flags.filter((f) => {
    if (opts.mine && rolesFor(f, who).length === 0) return false;
    if (opts.owner && (f.owner || '').toLowerCase() !== opts.owner.toLowerCase()) return false;
    if (opts.member && !RINGS.some((r) => audienceOf(f, r).includes(opts.member.toLowerCase()))) return false;
    if (opts.team && !(f.teams || []).includes(opts.team)) return false;
    if (opts.stage && stageOf(f) !== opts.stage) return false;
    if (q && !`${f.key} ${f.description || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function table(rows, headers) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(headers));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  rows.forEach((r) => console.log(line(r)));
}

const syncOf = (f) => (!f.rollout ? '' : f.sync?.state === 'applied' ? 'applied' : 'pending');
/** What applying a pending flag would remove, as the panel computes it (sync.impact). */
export function impactOf(f) {
  const i = f.sync?.state === 'pending' && f.sync.impact;
  if (!i) return '';
  return [
    i.loseAll ? 'everyone loses' : i.lose ? `${i.lose} lose` : '',
    i.rulesLost ? `${i.rulesLost} rule(s) removed` : '',
    i.gainAll ? 'everyone gains' : '',
  ].filter(Boolean).join(', ');
}
/** Datadog distribution channel: SERVER = backend only, CLIENT = front only, ALL = both. */
const channelOf = (f) => ({ SERVER: 'backend', CLIENT: 'front' })[f.channel] || '';

async function list(opts) {
  const state = await api('GET', '/api/state');
  const who = opts.mine ? await me() : {};
  if (opts.mine && !who.owner) console.error('warning: GitHub login unknown (set ETENDO_FLAGS_OWNER); --mine matches audience only');
  const flags = filterFlags(state.flags, opts, who);
  if (opts.json) return print(flags);
  const headers = ['KEY', 'STAGE', 'SYNC', 'OWNER', 'TEAM', 'α', 'β', 'ONLY', ...(opts.mine ? ['MINE'] : []), 'TTL', 'APPLY WOULD'];
  table(flags.map((f) => [
    f.key, stageOf(f), syncOf(f), f.owner || '', (f.teams || []).join(','),
    ringPeople(f, 'alpha').length, ringPeople(f, 'beta').length, channelOf(f),
    ...(opts.mine ? [rolesFor(f, who).join(',')] : []), f.ttl || '', impactOf(f),
  ]), headers);
  console.log(`\n${flags.length} of ${state.flags.length} flags`);
}

async function findFlag(key) {
  const state = await api('GET', '/api/state');
  const f = state.flags.find((x) => x.key === key);
  if (!f) fail(`Unknown flag "${key}". Try: list --search ${key}`);
  return { f, state };
}

async function show(key, opts) {
  const { f, state } = await findFlag(key);
  const history = state.state.flags?.[key]?.history || [];
  if (opts.json) return print({ ...f, history });
  const r = f.rollout;
  console.log(`${f.key}${f.unregistered ? '  (not in flags-registry.json)' : ''}`);
  if (f.description) console.log(`  ${f.description}`);
  console.log(`  owner ${f.owner || '-'} · team ${(f.teams || []).join(',') || '-'} · type ${state.state.types?.[key] || '-'} · jira ${f.jira || '-'} · ttl ${f.ttl || '-'}`);
  console.log(`  stage ${stageOf(f)}${r ? ` · env ${r.environment} · sync ${syncOf(f)}` : ''}${channelOf(f) ? ` · ${channelOf(f)} only` : ''}`);
  if (impactOf(f)) console.log(`  ⚠ apply would: ${impactOf(f)}`);
  for (const ring of RINGS) {
    if (!r) break;
    const groups = r[ring].groups.map((g) => `@${g}`);
    console.log(`  ${ring}: ${[...groups, ...r[ring].emails].join(', ') || '-'}  (${ringPeople(f, ring).length} people)`);
  }
  for (const env of f.environments || []) {
    console.log(`  datadog ${env.name}: ${env.everyone ? 'everyone' : `${env.emails} emails`}, ${env.otherRules} other rules`);
  }
  if (history.length) {
    console.log('  history:');
    for (const h of history.slice(-5)) {
      console.log(`    ${h.at.slice(0, 16).replace('T', ' ')} ${h.by} ${h.event}${h.from ? ` ${h.from}→${h.to}` : h.to ? ` →${h.to}` : ''}`);
    }
  }
}

// ---------- writing ----------

/** Body for PUT /api/flags/:key — the UI always sends the whole rollout. */
function rolloutBody(r) {
  return {
    environment: r.environment,
    alpha: { groups: [...r.alpha.groups], emails: [...r.alpha.emails] },
    beta: { groups: [...r.beta.groups], emails: [...r.beta.emails] },
  };
}

async function editRollout(key, mutate) {
  const { f } = await findFlag(key);
  const r = f.rollout || { environment: 'Production', alpha: { groups: [], emails: [] }, beta: { groups: [], emails: [] } };
  const body = rolloutBody(r);
  mutate(body);
  await api('PUT', `/api/flags/${key}`, body);
  console.log(`${key}: saved (not applied — run: plan ${key} / apply ${key} --yes)`);
}

export function applyRingChange(body, ring, op, items) {
  for (const item of items) {
    const isGroup = item.startsWith('@');
    const list = body[ring][isGroup ? 'groups' : 'emails'];
    const value = isGroup ? item.slice(1) : item.toLowerCase();
    const i = list.findIndex((x) => x.toLowerCase() === value.toLowerCase());
    if (op === 'add' && i === -1) list.push(value);
    if (op === 'rm' && i !== -1) list.splice(i, 1);
  }
}

async function plan(key) {
  const p = await api('GET', `/api/flags/${key}/plan`);
  const d = p.diff;
  console.log(`${key} → ${p.environment} (status ${p.status}${p.requiresApproval ? ', requires approval' : ''}${p.defaultIsTrue ? ', DEFAULT IS TRUE' : ''})`);
  if (d.everyoneAfter && !d.everyoneBefore) console.log('  gain: EVERYONE');
  else console.log(`  gain (${d.gain.length}): ${d.gain.join(', ') || '-'}`);
  if (d.everyoneBefore && !d.everyoneAfter) console.log('  lose: EVERYONE');
  else console.log(`  lose (${d.lose.length}): ${d.lose.join(', ') || '-'}`);
  if (d.unmanagedRulesLost.length) console.log(`  rules removed: ${d.unmanagedRulesLost.join('; ')}`);
  const risky = (d.everyoneBefore && !d.everyoneAfter) || d.lose.length > 0 || d.unmanagedRulesLost.length > 0;
  return { risky };
}

async function apply(key, opts) {
  const { risky } = await plan(key);
  if (!opts.yes) return console.log('\nDry run. Re-run with --yes to apply.');
  if (risky && !opts.force) fail('Someone loses access or a rule is removed. Re-run with --yes --force to confirm.');
  const r = await api('POST', `/api/flags/${key}/apply`);
  if (r.pendingApproval) return console.log('Submitted: pending approval in Datadog (nothing to verify yet).');
  console.log('Applied in the panel. Verifying what Datadog serves…\n');
  // Datadog's assignment CDN can lag the API: poll before calling it a mismatch.
  for (let attempt = 1; ; attempt++) {
    const quiet = attempt < VERIFY_ATTEMPTS;
    const { mismatches } = await check(key, { ...opts, quiet, strict: true });
    if (!mismatches) return undefined;
    if (!quiet) return process.exit(2);
    await new Promise((res) => setTimeout(res, VERIFY_DELAY_MS));
  }
}

// ---------- Datadog verification ----------
// Asks Datadog's flag CDN — the same precompute-assignments call the SPA makes —
// what each person actually gets. Independent of the panel: it proves an apply
// reached Datadog, and a mismatch is concrete feedback for the panel.

const VERIFY_ATTEMPTS = 6;
const VERIFY_DELAY_MS = 10_000;
const GH_REPO = 'etendosoftware/etendo_schema_forge';

function ghVariable(name) {
  try {
    return execFileSync('gh', ['variable', 'get', name, '-R', GH_REPO], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const ddClients = new Map();
/** Public browser credentials of the SPA build for `ddEnv` (GitHub Actions variables, not secrets). */
function datadogClient(ddEnv) {
  if (ddClients.has(ddEnv)) return ddClients.get(ddEnv);
  const suffix = ddEnv.toUpperCase();
  const client = {
    token: process.env.ETENDO_FLAGS_DD_CLIENT_TOKEN || ghVariable(`VITE_DATADOG_CLIENT_TOKEN_${suffix}`),
    appId: process.env.ETENDO_FLAGS_DD_APPLICATION_ID || ghVariable(`VITE_DATADOG_APPLICATION_ID_${suffix}`),
    site: process.env.ETENDO_FLAGS_DD_SITE || ghVariable('VITE_DATADOG_SITE') || 'datadoghq.eu',
  };
  if (!client.token) fail(`No Datadog client token for ${ddEnv}: set ETENDO_FLAGS_DD_CLIENT_TOKEN or log in with gh (reads ${GH_REPO} variables).`);
  ddClients.set(ddEnv, client);
  return client;
}

/** What Datadog serves `email` for `key` in `ddEnv`, built like the SPA's buildEvaluationContext. */
async function datadogAssignment(ddEnv, key, email) {
  const { token, appId, site } = datadogClient(ddEnv);
  const res = await fetch(`https://preview.ff-cdn.${site}/precompute-assignments?dd_env=${encodeURIComponent(ddEnv)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/vnd.api+json', 'dd-client-token': token, ...(appId ? { 'dd-application-id': appId } : {}) },
    body: JSON.stringify({ data: { type: 'precompute-assignments-request', attributes: {
      env: { dd_env: ddEnv },
      source: { sdk_name: 'browser', sdk_version: '2.1.0' },
      subject: { targeting_key: email, targeting_attributes: { targetingKey: email, email, Email: email } },
    } } }),
  });
  if (!res.ok) fail(`Datadog precompute-assignments ${ddEnv} → ${res.status} ${await res.text()}`);
  const flag = (await res.json()).data?.attributes?.flags?.[key];
  return flag ? { value: flag.variationValue, allocation: flag.allocationKey } : { value: undefined, allocation: '(flag not served)' };
}

/** Who the panel says must get the flag at its current stage. `null` = everyone. */
export function expectedAudience(f) {
  const stage = stageOf(f);
  if (stage === 'ga') return null;
  if (stage === 'alpha') return new Set(audienceOf(f, 'alpha'));
  if (stage === 'beta') return new Set(audienceOf(f, 'beta'));
  return new Set();
}

async function check(key, opts) {
  const { f } = await findFlag(key);
  if (f.channel === 'SERVER') {
    // Datadog keeps backend-only flags out of client SDKs, so the CDN cannot answer for them.
    console.log(`${key} is backend only (channel SERVER): Datadog's client CDN does not serve it, so check cannot verify it.`);
    return { mismatches: 0 };
  }
  const ddEnv = (opts.env || f.rollout?.environment || 'Production').toLowerCase();
  const expected = expectedAudience(f);
  const emails = new Set([...audienceOf(f, 'beta'), ...audienceOf(f, 'alpha')]);
  if (opts.email) opts.email.split(',').forEach((e) => emails.add(e.trim().toLowerCase()));
  else emails.add((await me()).email);
  // A pending flag's desired state has not been pushed yet: a gap is expected, not a defect.
  // apply passes strict, since right after an apply nothing may be left unserved.
  const pending = syncOf(f) === 'pending' && !opts.strict;
  const rows = [];
  let mismatches = 0;
  for (const email of emails) {
    const got = await datadogAssignment(ddEnv, key, email);
    const want = expected === null || expected.has(email);
    // Only "should have it and does not" is a mismatch: an unmanaged rule (e.g. a domain regex) may grant more.
    const bad = want && got.value !== true;
    if (bad && !pending) mismatches++;
    let status = 'ok';
    if (bad) status = pending ? 'not applied' : 'MISMATCH';
    else if (got.value === true && !want) status = 'extra rule';
    rows.push([email, want ? 'on' : '-', String(got.value), got.allocation, status]);
  }
  if (opts.quiet && mismatches) return { mismatches };
  if (opts.json) print(rows.map(([email, want, got, allocation, status]) => ({ email, want, got, allocation, status })));
  else {
    console.log(`${key} · stage ${stageOf(f)} · sync ${syncOf(f) || '-'} · dd_env ${ddEnv}`);
    table(rows, ['EMAIL', 'PANEL', 'DATADOG', 'ALLOCATION', 'STATUS']);
    if (mismatches) console.log(`\n${mismatches} mismatch(es): the panel expects access Datadog does not serve.`);
    else if (pending && rows.some((r) => r[4] === 'not applied')) console.log('\nPending in the panel: Datadog still serves the previous state (run apply).');
    else console.log('\nDatadog matches the panel.');
  }
  return { mismatches };
}

// ---------- entry ----------

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
const print = (x) => console.log(JSON.stringify(x, null, 2));

function parse(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const name = a.slice(2);
    if (['mine', 'json', 'yes', 'force'].includes(name)) opts[name] = true;
    else {
      if (argv[i + 1] === undefined) fail(`--${name} needs a value`);
      opts[name] = argv[++i];
    }
  }
  return { pos, opts };
}

function need(cond, usage) {
  if (!cond) fail(`usage: ${usage}`);
}

async function main() {
  const { pos: [cmd, ...args], opts } = parse(process.argv.slice(2));
  switch (cmd) {
    case 'login': return login();
    case 'whoami': return print(await me());
    case 'list': case 'ls':
      need(!opts.stage || [...STAGES, 'unmanaged'].includes(opts.stage), 'list --stage off|alpha|beta|ga|unmanaged');
      return list(opts);
    case 'show':
      need(args[0], 'show <key>');
      return show(args[0], opts);
    case 'stage':
      need(args[0] && STAGES.includes(args[1]), 'stage <key> <off|alpha|beta|ga>');
      await api('POST', `/api/flags/${args[0]}/stage`, { stage: args[1] });
      return console.log(`${args[0]}: stage ${args[1]} (not applied — run: plan ${args[0]} / apply ${args[0]} --yes)`);
    case 'ring': {
      const [key, ring, op, ...items] = args;
      need(key && RINGS.includes(ring) && ['add', 'rm'].includes(op) && items.length, 'ring <key> <alpha|beta> add|rm <email|@group>...');
      return editRollout(key, (body) => applyRingChange(body, ring, op, items));
    }
    case 'env':
      need(args[0] && args[1], 'env <key> <environment>');
      return editRollout(args[0], (body) => { body.environment = args[1]; });
    case 'owner': case 'team': case 'type':
      need(args[0] && args[1], `${cmd} <key> <value>`);
      await api('PUT', `/api/flags/${args[0]}/${cmd}`, { [cmd]: args[1] });
      return console.log(`${args[0]}: ${cmd} = ${args[1]}`);
    case 'check': {
      need(args[0], 'check <key> [--email a,b] [--env production]');
      const { mismatches } = await check(args[0], opts);
      return mismatches ? process.exit(2) : undefined;
    }
    case 'plan':
      need(args[0], 'plan <key>');
      await plan(args[0]);
      return undefined;
    case 'apply':
      need(args[0], 'apply <key> --yes [--force]');
      return apply(args[0], opts);
    case 'raw': {
      const [method, url, json] = args;
      need(method && url?.startsWith('/'), 'raw <METHOD> </path> [json]');
      return print(await api(method.toUpperCase(), url, json ? JSON.parse(json) : undefined));
    }
    case undefined: case 'help': case '-h': case '--help':
      return console.log(HELP);
    default:
      fail(`Unknown command "${cmd}".\n\n${HELP}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => fail(e.stack || e.message));
