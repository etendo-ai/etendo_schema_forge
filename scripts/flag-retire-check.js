#!/usr/bin/env node
// flag-retire-check.js — the pre-retirement gate for a feature flag (ETP-6425).
//
// Usage: node scripts/flag-retire-check.js --flag <key|feature-id> [--verify] [--json]
//                                          [--root <path>] [--registry <path>] [--go-module <path>]
//        (or: make flag-retire-check FLAG=<key> [VERIFY=1] [JSON=1] [GO_MODULE=<path>])
//
// Exit 0 = nothing blocks; 1 = at least one BLOCK item; 2 = usage error.
//
// Why it exists: in ETP-6425 a bot retired `acct-process-monitor` with an open deferred item,
// no Datadog evidence, no published guide and no QA run, and every gate went green, because no
// gate looked at the debt. This script is that gate. It reads both registries — this repo's
// flags-registry.json (the feature header) and com.etendoerp.go's (the backend contribution) —
// and refuses while any debt item is neither resolved with evidence nor accepted by a named
// human with a link to their written decision. It never edits anything.
//
// It deliberately lives here, not in the published `sf-flag-debt` scorer: the scorer is a
// report-only tool owned by schema_forge_core (always exit 0, by design), while this is a
// policy over THIS repo's registry data that must run in a bare checkout (no npm install, no
// core publish) wherever a bot can run `make`. Manual: docs/flag-retirement.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sanitizedGitEnv } from './lib/git-env.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = process.env.SF_ROOT || resolve(HERE, '..');
export const REGISTRY_FILENAME = 'flags-registry.json';

/** A `by` that names an automated account. An agent may propose debt; it may never accept it. */
export const AUTOMATED_ACCOUNT = /\[bot\]|\bbot\b|claude|codex|copilot|\bgpt\b|dagu|\bagents?\b|automation/i;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LINK = /https?:\/\/\S+/;
const NOT_USER_VISIBLE = /^not-user-visible:\s*\S/;

// ── Registry access ─────────────────────────────────────────────────────────

export function loadJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The key of the flag being retired: the live flag object, else the retirement record's copy. */
export function flagKeyOf(feature) {
  return feature.flag?.key || feature.retirement?.key || null;
}

/** A feature matches by its id, its live flag key, or the key recorded at retirement. */
export function findFeature(registry, name) {
  return (registry.features || []).find((feature) => feature.id === name
    || feature.flag?.key === name || feature.retirement?.key === name) || null;
}

/** com.etendoerp.go's slice: matched by feature id or by the backend `flagKey`. */
export function findContribution(goRegistry, feature) {
  if (!goRegistry) return null;
  const key = flagKeyOf(feature);
  return (goRegistry.features || []).find((entry) => entry.id === feature.id
    || (key && entry.flagKey === key)) || null;
}

function isDirectory(target) {
  try { return statSync(target).isDirectory(); } catch { return false; }
}

/**
 * Where the com.etendoerp.go checkout is. Explicit wins; then ETENDO_GO_MODULE; then the
 * declared backend root under this repo, under the main checkout, and the epic-worktree layout
 * where the module sits next to this repo (`<dir>/modules/com.etendoerp.go`).
 */
export function resolveGoModule({ repoRoot, registry, explicit = null, env = process.env }) {
  const backend = registry.roots?.backend || 'etendo_core/modules/com.etendoerp.go';
  const candidates = [
    explicit,
    env.ETENDO_GO_MODULE,
    join(repoRoot, backend),
    join(repoRoot, '..', '..', backend),
    join(repoRoot, '..', 'modules', 'com.etendoerp.go'),
    join(repoRoot, '..', 'com.etendoerp.go'),
  ].filter(Boolean).map((candidate) => resolve(candidate));
  return { dir: candidates.find(isDirectory) || null, candidates };
}

// ── Acceptance records ──────────────────────────────────────────────────────

/**
 * Everything wrong with an acceptance or sign-off record. Empty means it is well formed.
 * Well formed is the most a script can prove: that a HUMAN said yes is proven by the link,
 * which the reviewer opens. An automated `by` is rejected outright.
 */
export function acceptanceProblems(record) {
  if (!record || typeof record !== 'object') return ['not an object'];
  const problems = [];
  if (typeof record.by !== 'string' || !record.by.trim()) {
    problems.push('"by" is missing (the human who decided)');
  } else if (AUTOMATED_ACCOUNT.test(record.by)) {
    problems.push(`"by" is "${record.by}", an automated account: an agent can never accept debt`);
  }
  if (!ISO_DATE.test(record.date || '')) problems.push('"date" is missing or not YYYY-MM-DD');
  if (!LINK.test(record.ref || '')) {
    problems.push('"ref" must link to the human\'s written decision (Jira comment, PR review)');
  }
  return problems;
}

function acceptanceFor(retirement, id) {
  return (retirement?.accepted || []).find((record) => record && record.item === id) || null;
}

/** How to describe the fix for an unresolved item, in one line. */
const ACCEPT_HINT = 'or a human adds { "item", "by", "date", "ref" } to retirement.accepted';

// ── Checks ──────────────────────────────────────────────────────────────────

function block(code, message, remedy) { return { severity: 'block', code, message, remedy }; }
function warn(code, message, remedy) { return { severity: 'warn', code, message, remedy }; }
function info(code, message) { return { severity: 'info', code, message }; }

function firstSentence(text, max = 180) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).replace(/\s+\S*$/, '')}…` : flat;
}

/**
 * Applies an acceptance to an unresolved item: a valid record turns the block into info, a
 * malformed one keeps it blocking and says why. On the kill branch the entry is deleted, so an
 * accepted item must also say where it was re-homed (playbook §4.5).
 */
function resolveWithAcceptance(retirement, id, blocked) {
  const record = acceptanceFor(retirement, id);
  if (!record) return blocked;
  const problems = acceptanceProblems(record);
  if (retirement?.branch === 'kill' && !record.rehomedTo) {
    problems.push('kill branch: "rehomedTo" is required (a ticket or another feature id) — deleting the entry is never closure');
  }
  if (problems.length) {
    return block(blocked.code, `${blocked.message} — acceptance record rejected: ${problems.join('; ')}`, blocked.remedy);
  }
  const where = record.rehomedTo ? `, re-homed to ${record.rehomedTo}` : '';
  return info('accepted', `${id}: accepted by ${record.by} on ${record.date}${where} (${record.ref})`);
}

/** Every open decision on the feature blocks, whatever its kind — closure or a human yes. */
export function checkDeferredItems(feature) {
  return (feature.deferredItems || []).map((item) => resolveWithAcceptance(
    feature.retirement,
    item.id,
    block(
      'deferred-item-open',
      `${item.id} (${item.kind || 'open'}): ${firstSentence(item.note)}`,
      'close it with evidence (remove it from deferredItems and record the closure in a $…ClosedComment) '
        + `${ACCEPT_HINT}`,
    ),
  ));
}

function specList(testSpecs) {
  const specs = testSpecs || {};
  return [...(specs.unit || []), ...(specs.e2e || [])]
    .map((spec) => (typeof spec === 'string' ? { path: spec } : spec));
}

/**
 * A spec blocks unless it is on disk or already carries `acceptedDebt` (a standing human
 * decision). `expected: true` is a promise nobody kept yet; no marker is a hole with no intent.
 */
export function checkSpecs(specs, { rootDirs, retirement, source }) {
  const results = [];
  for (const spec of specs) {
    const root = spec.root || 'frontend';
    const rootDir = rootDirs[root];
    const label = `${source} ${root}: ${spec.path}`;
    if (!rootDir) {
      results.push(block('spec-unverifiable', `${label} — the ${root} checkout is not available`,
        'point GO_MODULE (or ETENDO_GO_MODULE) at the com.etendoerp.go checkout and rerun'));
      continue;
    }
    if (existsSync(join(rootDir, spec.path))) {
      if (spec.expected) results.push(warn('spec-stale-marker', `${label} exists but is still marked expected: true`, 'drop the marker'));
      continue;
    }
    if (spec.acceptedDebt) {
      results.push(info('spec-accepted-debt', `${label} — carried accepted debt${spec.note ? `: ${firstSentence(spec.note, 120)}` : ''}`));
      continue;
    }
    const code = spec.expected ? 'spec-pending' : 'spec-missing';
    const what = spec.expected ? 'agreed (expected: true) but not written' : 'declared but missing, with no marker';
    results.push(resolveWithAcceptance(retirement, spec.path,
      block(code, `${label} — ${what}`, `write it, ${ACCEPT_HINT} (item = the spec path)`)));
  }
  return results;
}

function hasLink(value) {
  return typeof value === 'string' && LINK.test(value);
}

/**
 * The retirement record: the out-of-registry evidence (Datadog, user docs, the ticket's own
 * debt list, the owner's yes) that ETP-6425 shows a bot will otherwise never look for.
 */
export function checkRetirementRecord(feature) {
  const record = feature.retirement && typeof feature.retirement === 'object' ? feature.retirement : null;
  const retirement = record || {};
  const ttlNote = feature.flag?.ttlNote || retirement.ttlNote || '';
  const results = [];
  if (!record) {
    results.push(block('no-retirement-record', 'the feature has no "retirement" record — every field below is missing',
      'add one per docs/flag-retirement.md §3; only a human can fill signOff and acceptances'));
  }
  if (!['ship', 'kill'].includes(retirement.branch)) {
    results.push(block('branch-missing', `retirement.branch is "${retirement.branch ?? ''}"`, 'set "ship" or "kill" — decided with the human, never by the agent'));
  }
  if (typeof retirement.ticket !== 'string' || !retirement.ticket.trim()) {
    results.push(block('ticket-missing', 'retirement.ticket is missing', 'name the ticket that authorizes the retirement'));
  }
  const evidence = retirement.evidence || {};
  if (!hasLink(evidence.datadog)) {
    results.push(block('evidence-datadog', 'no Datadog evidence linked (retirement.evidence.datadog)',
      'link the production allocation history: everyone (ship) or nobody (kill), unchanged for the eligibility window'));
  }
  if (!hasLink(evidence.userDocs) && !NOT_USER_VISIBLE.test(evidence.userDocs || '')) {
    results.push(block('evidence-user-docs', 'no user documentation linked (retirement.evidence.userDocs)',
      'link the published help.etendo.ai page, or write "not-user-visible: <reason>"'));
  }
  // The ttlNote is the team's own written condition for removal ("once the manual trigger has
  // been exercised…", "permanent, no retirement planned"). Whatever it says, it was written to
  // be read at this moment: link the evidence that it holds.
  if (ttlNote.trim() && !hasLink(evidence.ttlNote)) {
    results.push(block('ttl-note', `ttlNote: "${firstSentence(ttlNote)}"`,
      'link evidence that what it states holds in retirement.evidence.ttlNote'));
  }
  if (!Array.isArray(retirement.ticketItems)) {
    results.push(block('ticket-items-missing', 'retirement.ticketItems is missing',
      'copy every pre-GA / debt / acceptance-criteria item of the ticket, each with "evidence" (a link) or "accepted"'));
  } else {
    for (const item of retirement.ticketItems) {
      const id = item?.id || '(no id)';
      if (hasLink(item?.evidence)) {
        // Evidence counts only when it was taken in Production: a QA, staging or local run says
        // nothing about what users get (ETP-6425).
        if (item.env !== 'production') {
          results.push(block('ticket-item-not-production', `ticket item ${id}: evidence is from "${item.env ?? 'unstated'}", not production`,
            'repeat it in Production and link that, then set "env": "production" — QA, staging or local runs are not evidence'));
        }
        continue;
      }
      if (item?.accepted) {
        const problems = acceptanceProblems(item.accepted);
        if (!problems.length) {
          results.push(info('accepted', `ticket item ${id}: accepted by ${item.accepted.by} on ${item.accepted.date} (${item.accepted.ref})`));
          continue;
        }
        results.push(block('ticket-item-open', `ticket item ${id}: acceptance record rejected: ${problems.join('; ')}`,
          'fix the record; only a human can accept'));
        continue;
      }
      results.push(block('ticket-item-open', `ticket item ${id}: ${firstSentence(item?.note || '')} — no evidence linked`,
        'do it and link the evidence, or a human accepts it ("accepted": { by, date, ref })'));
    }
  }
  const signOffProblems = acceptanceProblems(retirement.signOff);
  if (!retirement.signOff) {
    results.push(block('signoff-missing', 'no owner sign-off (retirement.signOff)',
      `${feature.owner || 'the owner'} (a human) approves in writing; record { by, date, ref }`));
  } else if (signOffProblems.length) {
    results.push(block('signoff-invalid', `retirement.signOff rejected: ${signOffProblems.join('; ')}`, 'only a human can sign off'));
  }
  return results;
}

// ── Verify (after the code change) ──────────────────────────────────────────

export function upperSnake(key) {
  return key.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
}

/** The identifiers that exist only to evaluate the flag — none may survive a retirement. */
export function flagIdentifiers(key) {
  const constant = upperSnake(key);
  return [key, constant, `etendo.go.flags.${key}`];
}

/**
 * Classifies a remaining reference after removal. On ship, the feature's own names (a page, a
 * menu item, an e2e file named like the key) legitimately stay; what must be gone is anything
 * that still DECLARES or EVALUATES the flag. On kill, every reference blocks.
 */
export function classifyHit({ file, text }, { key, branch, frameworkPaths }) {
  if (branch === 'kill') return 'block';
  const constant = upperSnake(key);
  const constantPattern = new RegExp(`(?:^|[^A-Za-z0-9_])(?:ETGO_)?(?:FLAG_)?${constant}(?![A-Za-z0-9_])`);
  if (constantPattern.test(text)) return 'block';
  if (text.includes(`etendo.go.flags.${key}`)) return 'block';
  if (frameworkPaths.some((fragment) => file.includes(fragment))) return 'block';
  // A flag API on the same line (useFeatureFlag('key'), isEnabled(...)): ignore the key itself,
  // which may contain the word.
  if (/flag/i.test(text.split(key).join(''))) return 'block';
  return 'warn';
}

/** `git grep` for fixed strings, skipping docs and the registries. Returns [{file, line, text}]. */
export function gitGrep(dir, terms) {
  if (!terms.length) return [];
  const args = ['-C', dir, 'grep', '-n', '-I', '-F'];
  for (const term of terms) args.push('-e', term);
  args.push('--', '.', ':(exclude)*.md', `:(exclude)*${REGISTRY_FILENAME}`);
  let output;
  try {
    output = execFileSync('git', args, { encoding: 'utf8', env: sanitizedGitEnv(), maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error.status === 1) return [];
    throw new Error(`git grep failed in ${dir}: ${error.stderr || error.message}`);
  }
  return output.split('\n').filter(Boolean).map((row) => {
    const match = row.match(/^(.*?):(\d+):(.*)$/);
    return match ? { file: match[1], line: Number(match[2]), text: match[3] } : { file: row, line: 0, text: '' };
  });
}

export function checkVerify(feature, contribution, { rootDirs, frameworkPaths, grep = gitGrep }) {
  const results = [];
  const retirement = feature.retirement || {};
  const branch = retirement.branch;
  const key = flagKeyOf(feature);
  if (!key) {
    return [block('verify-no-key', 'no flag key to verify (neither flag.key nor retirement.key)',
      'copy the key and symbols into retirement.key / retirement.symbols when you delete the flag object')];
  }
  if (branch === 'ship' && feature.flag) {
    results.push(block('flag-object-present', 'ship: the `flag` object is still in flags-registry.json',
      'delete it (never the entry), after copying key and symbols into the retirement record'));
  }
  if (branch === 'kill') {
    for (const [root, list] of Object.entries(feature.paths || {})) {
      for (const owned of list || []) {
        const dir = rootDirs[root];
        if (dir && existsSync(join(dir, owned))) {
          results.push(block('owned-path-present', `kill: owned path still on disk: ${root}: ${owned}`, 'delete it'));
        }
      }
    }
  }
  if (contribution && contribution.flagKey) {
    results.push(block('go-flagkey-present', `com.etendoerp.go registry entry ${contribution.id} still declares flagKey "${contribution.flagKey}"`,
      branch === 'kill' ? 'delete the contribution entry' : 'replace flagKey with "contribution": true and remove the GoFeatureFlags constant'));
  } else if (contribution && branch === 'ship' && contribution.contribution !== true) {
    results.push(block('go-contribution-marker', `com.etendoerp.go registry entry ${contribution.id} lacks "contribution": true`, 'add it'));
  }
  const symbols = feature.flag?.symbols || retirement.symbols || [];
  const terms = [...new Set(branch === 'kill' ? [...flagIdentifiers(key), ...symbols] : flagIdentifiers(key))];
  for (const [root, dir] of Object.entries(rootDirs)) {
    if (!dir) continue;
    for (const hit of grep(dir, terms)) {
      const where = `${root}: ${hit.file}:${hit.line}`;
      const severity = classifyHit(hit, { key, branch, frameworkPaths });
      const text = firstSentence(hit.text, 120);
      if (severity === 'block') {
        results.push(block('flag-still-referenced', `${where} — ${text}`, 'remove the flag declaration/evaluation'));
      } else {
        results.push(warn('remaining-reference', `${where} — ${text}`, 'confirm it is a feature name, not an evaluation'));
      }
    }
  }
  return results;
}

// ── Production deployment ──────────────────────────────────────────────────

/** True when `sha` is reachable from origin/main in `dir` (main is Production). */
export function gitInMain(dir, sha) {
  try {
    execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin', 'main'], { env: sanitizedGitEnv(), stdio: 'ignore' });
  } catch { /* offline: fall back to the local origin/main */ }
  try {
    execFileSync('git', ['-C', dir, 'merge-base', '--is-ancestor', sha, 'origin/main'], { env: sanitizedGitEnv(), stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Closing needs the removal live in Production, not merged to develop: every removal commit
 * reachable from main in its repo, the Production deploy run linked, and a live check of
 * Production linked (what the served build or API shows). Without it nothing is evidence.
 */
export function checkProduction(feature, { dirs, inMain = gitInMain }) {
  const production = feature.retirement?.production || {};
  const results = [];
  const commits = Array.isArray(production.removalCommits) ? production.removalCommits : [];
  if (!commits.length) {
    results.push(block('prod-commits-missing', 'retirement.production.removalCommits is empty',
      'list every merge commit of the removal as { "repo": "schema_forge" | "com.etendoerp.go", "sha" }'));
  }
  for (const commit of commits) {
    const dir = dirs[commit?.repo];
    if (!dir) {
      results.push(block('prod-commit-unverifiable', `${commit?.repo ?? '?'} ${commit?.sha ?? '?'}: no checkout to verify it`,
        'set GO_MODULE=<path> or fix the repo name'));
    } else if (!commit.sha || !inMain(dir, commit.sha)) {
      results.push(block('prod-not-deployed', `${commit.repo} ${commit.sha}: not in main — not in Production yet`,
        'wait for the daily cut to reach main and deploy; nothing is closed before that'));
    } else {
      results.push(info('prod-in-main', `${commit.repo} ${String(commit.sha).slice(0, 9)} is in main`));
    }
  }
  if (!hasLink(production.deployRun)) {
    results.push(block('prod-deploy-missing', 'no Production deploy linked (retirement.production.deployRun)',
      'link the successful deploy run from main that contains the removal'));
  }
  if (!hasLink(production.liveCheck)) {
    results.push(block('prod-live-check-missing', 'no live Production check linked (retirement.production.liveCheck)',
      'check the served build/API in Production (flag gone, feature working) and link the record'));
  }
  return results;
}

// ── Orchestration ───────────────────────────────────────────────────────────

/**
 * Runs the gate (and, with `verify`, the post-removal checks) for one flag. Pure apart from
 * the filesystem reads and the injected grep, so tests drive it against temp directories.
 */
export function runCheck({ name, verify = false, repoRoot = DEFAULT_REPO_ROOT, registryPath = null,
  goModule = null, env = process.env, grep = gitGrep, inMain = gitInMain, now = new Date() }) {
  const sfRegistryPath = registryPath || join(repoRoot, REGISTRY_FILENAME);
  const registry = loadJson(sfRegistryPath);
  const feature = findFeature(registry, name);
  if (!feature) {
    const error = new Error(`no feature or flag "${name}" in ${sfRegistryPath}`);
    error.usage = true;
    throw error;
  }
  const go = resolveGoModule({ repoRoot, registry, explicit: goModule, env });
  const goRegistryPath = go.dir ? join(go.dir, REGISTRY_FILENAME) : null;
  const goRegistry = goRegistryPath && existsSync(goRegistryPath) ? loadJson(goRegistryPath) : null;
  const contribution = findContribution(goRegistry, feature);
  const rootDirs = { frontend: resolve(repoRoot, registry.roots?.frontend || '.'), backend: go.dir };

  const items = [];
  const key = flagKeyOf(feature);
  if (!feature.flag) {
    items.push(info('flag-already-removed', feature.retirement
      ? 'the flag object is already gone; checking the recorded retirement'
      : 'the flag object is already gone and no retirement record exists — this retirement skipped the gate'));
  } else if (feature.flag.ttl) {
    const days = Math.ceil((Date.parse(`${feature.flag.ttl}T00:00:00Z`) - now.getTime()) / 86400000);
    items.push(info('ttl', `TTL ${feature.flag.ttl} (${days >= 0 ? `${days} days left` : `${-days} days overdue`})`));
  }
  const declaresBackend = (feature.paths?.backend || []).length > 0
    || specList(feature.testSpecs).some((spec) => spec.root === 'backend');
  if (!go.dir) {
    const message = `com.etendoerp.go checkout not found (looked in: ${go.candidates.join(', ')})`;
    items.push(declaresBackend
      ? block('backend-unavailable', message, 'set GO_MODULE=<path> (or ETENDO_GO_MODULE); the backend half cannot be verified without it')
      : warn('backend-unavailable', message, 'set GO_MODULE=<path> to include the backend registry'));
  } else if (!goRegistry) {
    items.push(warn('go-registry-missing', `${goRegistryPath} not found`, 'check the module branch'));
  } else if (!contribution && declaresBackend) {
    items.push(warn('go-contribution-missing', `no entry for ${feature.id} in ${goRegistryPath}`, 'the backend slice should be registered there'));
  }

  items.push(...checkDeferredItems(feature));
  items.push(...checkSpecs(specList(feature.testSpecs), { rootDirs, retirement: feature.retirement, source: 'schema_forge' }));
  if (contribution) {
    const backendSpecs = specList(contribution.testSpecs).map((spec) => ({ ...spec, root: 'backend' }));
    const seen = new Set(specList(feature.testSpecs).filter((spec) => spec.root === 'backend').map((spec) => spec.path));
    items.push(...checkSpecs(backendSpecs.filter((spec) => !seen.has(spec.path)),
      { rootDirs, retirement: feature.retirement, source: 'com.etendoerp.go' }));
  }
  items.push(...checkRetirementRecord(feature));
  if (verify) {
    const frameworkPaths = [...(registry.conventions?.frameworkPaths || []), ...(goRegistry?.conventions?.frameworkPaths || [])];
    items.push(...checkVerify(feature, contribution, { rootDirs, frameworkPaths, grep }));
    items.push(...checkProduction(feature, { dirs: { schema_forge: repoRoot, 'com.etendoerp.go': go.dir }, inMain }));
  }

  return {
    feature: feature.id,
    key,
    jira: feature.jira || null,
    owner: feature.owner || null,
    mode: verify ? 'verify' : 'gate',
    registries: { schemaForge: sfRegistryPath, go: goRegistry ? goRegistryPath : null },
    blocked: items.some((item) => item.severity === 'block'),
    items,
  };
}

const LABEL = { block: 'BLOCK', warn: 'WARN ', info: 'INFO ' };

export function render(result) {
  const lines = [];
  lines.push(`flag-retire-check [${result.mode}] — flag ${result.key || '(none)'} · feature ${result.feature}`
    + `${result.jira ? ` · ${result.jira}` : ''}${result.owner ? ` · owner ${result.owner}` : ''}`);
  lines.push(`  registries: ${result.registries.schemaForge}`);
  lines.push(`              ${result.registries.go || 'com.etendoerp.go registry not available'}`);
  lines.push('');
  for (const severity of ['block', 'warn', 'info']) {
    for (const item of result.items.filter((entry) => entry.severity === severity)) {
      lines.push(`  ${LABEL[severity]} [${item.code}] ${item.message}`);
      if (item.remedy && severity !== 'info') lines.push(`        -> ${item.remedy}`);
    }
  }
  lines.push('');
  const blocking = result.items.filter((item) => item.severity === 'block').length;
  lines.push(result.blocked
    ? `  RESULT: BLOCKED — ${blocking} item(s). Do NOT edit code. Resolve each with evidence, or get a human's explicit acceptance. See docs/flag-retirement.md.`
    : `  RESULT: CLEAR — no blocking items${result.mode === 'gate' ? '; proceed with the mechanics, then rerun with VERIFY=1' : ''}.`);
  return `${lines.join('\n')}\n`;
}

export function parseArgs(argv) {
  const options = { name: null, verify: false, json: false, repoRoot: DEFAULT_REPO_ROOT, registryPath: null, goModule: null, help: false };
  const values = { '--flag': 'name', '--root': 'repoRoot', '--registry': 'registryPath', '--go-module': 'goModule' };
  for (let i = 0; i < argv.length; i += 1) {
    const [arg, inline] = argv[i].split(/=(.*)/s, 2);
    if (arg === '--verify') options.verify = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (values[arg]) {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw new Error(`${arg} needs a value`);
      options[values[arg]] = arg === '--flag' ? value : resolve(value);
    } else throw new Error(`unknown option: ${argv[i]}`);
  }
  return options;
}

const HELP = `flag-retire-check — pre-retirement gate for a feature flag (docs/flag-retirement.md)

Usage: node scripts/flag-retire-check.js --flag <key|feature-id> [options]
  --verify            Also run the post-removal checks (flag object gone, no declaration or evaluation left,
                      removal in main and live in Production) — required before closing the ticket
  --json              Print the result as JSON
  --go-module <path>  com.etendoerp.go checkout (default: ETENDO_GO_MODULE, then the usual sibling locations)
  --registry <path>   schema_forge registry (default: <root>/flags-registry.json)
  --root <path>       schema_forge repo root
Exit: 0 clear, 1 blocked, 2 usage error.
`;

export function main(argv = process.argv.slice(2), { stdout = process.stdout } = {}) {
  const options = parseArgs(argv);
  if (options.help) { stdout.write(HELP); return 0; }
  if (!options.name) throw Object.assign(new Error('--flag <key> is required (make flag-retire-check FLAG=<key>)'), { usage: true });
  const result = runCheck(options);
  stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : render(result));
  return result.blocked ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`flag-retire-check: ${error.message}\n`);
    process.exitCode = 2;
  }
}
