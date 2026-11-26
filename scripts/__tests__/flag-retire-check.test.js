// @covers scripts/flag-retire-check.js
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptanceProblems,
  checkDeferredItems,
  checkRetirementRecord,
  checkSpecs,
  checkVerify,
  classifyHit,
  findContribution,
  findFeature,
  flagIdentifiers,
  gitGrep,
  parseArgs,
  resolveGoModule,
  runCheck,
  upperSnake,
} from '../flag-retire-check.js';
import { isolatedGitEnv } from './isolatedGitEnv.js';

/**
 * The pre-retirement gate (ETP-6425). Every case runs against a synthetic pair of checkouts in
 * a temp directory — schema_forge plus a sibling com.etendoerp.go — so the assertions describe
 * the gate's rules, not whatever this repo's registry happens to hold today.
 */

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'flag-retire-check.js');
const NOW = new Date('2026-11-26T00:00:00Z');
const HUMAN = { by: 'sebastianbarrozo', date: '2026-11-26', ref: 'https://etendoproject.atlassian.net/browse/ETP-6425?focusedCommentId=1' };

let base;
let sfRoot;
let goRoot;

function write(root, relative, contents = '') {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`);
  return target;
}

/** A retirement record that passes every gate check. Tests break one field at a time. */
function cleanRetirement(overrides = {}) {
  return {
    branch: 'ship',
    ticket: 'ETP-6425',
    evidence: {
      datadog: 'https://app.datadoghq.eu/feature-flags/x — everyone in production since 2026-10-01',
      userDocs: 'https://help.etendo.ai/acct-process-monitor',
    },
    ticketItems: [{ id: 'qa-manual-run', note: 'QA ran it in two companies', evidence: 'https://etendoproject.atlassian.net/browse/ETP-6425?c=2' }],
    signOff: HUMAN,
    ...overrides,
  };
}

function writeRegistries(feature, contribution = null) {
  write(sfRoot, 'flags-registry.json', {
    version: 2,
    roots: { frontend: '.', backend: 'etendo_core/modules/com.etendoerp.go' },
    conventions: { frameworkPaths: ['tools/app-shell/src/lib/flags/'] },
    features: [feature],
  });
  write(goRoot, 'flags-registry.json', {
    version: 3,
    conventions: { frameworkPaths: ['com/etendoerp/go/featureflags/'] },
    features: contribution ? [contribution] : [],
  });
}

const noGrep = () => [];
const run = (name, extra = {}) => runCheck({ name, repoRoot: sfRoot, env: {}, grep: noGrep, now: NOW, ...extra });
const codes = (items, severity = 'block') => items.filter((item) => item.severity === severity).map((item) => item.code);

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'flag-retire-check-'));
  sfRoot = join(base, 'schema-forge');
  goRoot = join(base, 'modules', 'com.etendoerp.go');
  mkdirSync(sfRoot, { recursive: true });
  mkdirSync(goRoot, { recursive: true });
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('acceptanceProblems — only a named human with a link can accept', () => {
  it('accepts a complete human record', () => {
    assert.deepEqual(acceptanceProblems(HUMAN), []);
  });

  it('rejects automated accounts, whatever the casing', () => {
    for (const by of ['Etendo Bot', 'claude', 'codex-agent', 'dependabot[bot]', 'dagu-pipeline']) {
      const problems = acceptanceProblems({ ...HUMAN, by });
      assert.equal(problems.length, 1, by);
      assert.match(problems[0], /automated account/);
    }
  });

  it('requires a link to the written decision and an ISO date', () => {
    const problems = acceptanceProblems({ by: 'someone', date: '26/11/2026', ref: 'said yes on a call' });
    assert.equal(problems.length, 2);
    assert.ok(problems.some((p) => p.includes('"date"')));
    assert.ok(problems.some((p) => p.includes('"ref"')));
    assert.deepEqual(acceptanceProblems(null), ['not an object']);
  });
});

describe('registry lookup', () => {
  const registry = { features: [
    { id: 'live', flag: { key: 'live-key' } },
    { id: 'retired', retirement: { key: 'old-key' } },
  ] };

  it('finds a feature by id, live flag key, or the key kept in the retirement record', () => {
    assert.equal(findFeature(registry, 'live').id, 'live');
    assert.equal(findFeature(registry, 'live-key').id, 'live');
    assert.equal(findFeature(registry, 'old-key').id, 'retired');
    assert.equal(findFeature(registry, 'nope'), null);
  });

  it('finds the backend contribution by feature id or flagKey', () => {
    const go = { features: [{ id: 'other', flagKey: 'live-key' }, { id: 'retired', contribution: true }] };
    assert.equal(findContribution(go, registry.features[0]).id, 'other');
    assert.equal(findContribution(go, registry.features[1]).id, 'retired');
    assert.equal(findContribution(null, registry.features[0]), null);
  });

  it('resolves the go module: explicit, then ETENDO_GO_MODULE, then the epic-worktree sibling', () => {
    const registryRoots = { roots: { backend: 'etendo_core/modules/com.etendoerp.go' } };
    assert.equal(resolveGoModule({ repoRoot: sfRoot, registry: registryRoots, env: {} }).dir, goRoot);
    const other = join(base, 'elsewhere');
    mkdirSync(other);
    assert.equal(resolveGoModule({ repoRoot: sfRoot, registry: registryRoots, env: { ETENDO_GO_MODULE: other } }).dir, other);
    assert.equal(resolveGoModule({ repoRoot: sfRoot, registry: registryRoots, explicit: goRoot, env: { ETENDO_GO_MODULE: other } }).dir, goRoot);
  });
});

describe('checkDeferredItems — every open decision blocks until closed or accepted', () => {
  it('blocks every kind, cosmetic included', () => {
    const items = checkDeferredItems({ deferredItems: [
      { id: 'a', kind: 'precondition', note: 'x' }, { id: 'b', kind: 'open' },
      { id: 'c', kind: 'cosmetic' }, { id: 'd', kind: 'scope' },
    ] });
    assert.deepEqual(codes(items), ['deferred-item-open', 'deferred-item-open', 'deferred-item-open', 'deferred-item-open']);
  });

  it('a valid human acceptance turns the block into info', () => {
    const [item] = checkDeferredItems({
      deferredItems: [{ id: 'a', kind: 'open' }],
      retirement: { branch: 'ship', accepted: [{ item: 'a', ...HUMAN }] },
    });
    assert.equal(item.severity, 'info');
    assert.match(item.message, /accepted by sebastianbarrozo/);
  });

  it('an agent-written acceptance keeps the block and says why', () => {
    const [item] = checkDeferredItems({
      deferredItems: [{ id: 'a', kind: 'open' }],
      retirement: { accepted: [{ item: 'a', ...HUMAN, by: 'Etendo Bot' }] },
    });
    assert.equal(item.severity, 'block');
    assert.match(item.message, /acceptance record rejected: .*automated account/);
  });

  it('on the kill branch an accepted item must say where it was re-homed', () => {
    const feature = { deferredItems: [{ id: 'a', kind: 'open' }], retirement: { branch: 'kill', accepted: [{ item: 'a', ...HUMAN }] } };
    assert.equal(checkDeferredItems(feature)[0].severity, 'block');
    feature.retirement.accepted[0].rehomedTo = 'ETP-9999';
    const [item] = checkDeferredItems(feature);
    assert.equal(item.severity, 'info');
    assert.match(item.message, /re-homed to ETP-9999/);
  });
});

describe('checkSpecs — an empty promise never passes', () => {
  it('passes present specs, blocks pending and unmarked missing ones, reports accepted debt', () => {
    write(sfRoot, 'present.test.js');
    const items = checkSpecs([
      { path: 'present.test.js' },
      { path: 'pending.test.js', expected: true },
      { path: 'unmarked.test.js' },
      { path: 'accepted.test.js', acceptedDebt: true, note: 'team decision' },
    ], { rootDirs: { frontend: sfRoot }, retirement: null, source: 'schema_forge' });
    assert.deepEqual(codes(items), ['spec-pending', 'spec-missing']);
    assert.deepEqual(codes(items, 'info'), ['spec-accepted-debt']);
  });

  it('a pending spec can be accepted by a human through the retirement record', () => {
    const items = checkSpecs([{ path: 'pending.test.js', expected: true }],
      { rootDirs: { frontend: sfRoot }, retirement: { accepted: [{ item: 'pending.test.js', ...HUMAN }] }, source: 'schema_forge' });
    assert.deepEqual(codes(items), []);
  });

  it('a spec under an unavailable root blocks as unverifiable; a written one still marked expected warns', () => {
    write(sfRoot, 'done.test.js');
    const items = checkSpecs([{ root: 'backend', path: 'X.java' }, { path: 'done.test.js', expected: true }],
      { rootDirs: { frontend: sfRoot, backend: null }, retirement: null, source: 'schema_forge' });
    assert.deepEqual(codes(items), ['spec-unverifiable']);
    assert.deepEqual(codes(items, 'warn'), ['spec-stale-marker']);
  });
});

describe('checkRetirementRecord — the out-of-registry evidence', () => {
  it('a missing record lists every missing piece, and the ttlNote on top', () => {
    const items = checkRetirementRecord({ owner: 'o', flag: { ttlNote: 'Removal target once the manual trigger has been exercised.' } });
    assert.deepEqual(codes(items), ['no-retirement-record', 'branch-missing', 'ticket-missing', 'evidence-datadog',
      'evidence-user-docs', 'ttl-note', 'ticket-items-missing', 'signoff-missing']);
  });

  it('a complete record passes', () => {
    assert.deepEqual(codes(checkRetirementRecord({ retirement: cleanRetirement() })), []);
  });

  it('a ttlNote — live, or copied into the record at removal — needs linked evidence that it holds', () => {
    const feature = { flag: { ttlNote: 'Remove after the pilot accepts it.' }, retirement: cleanRetirement() };
    assert.deepEqual(codes(checkRetirementRecord(feature)), ['ttl-note']);
    feature.retirement.evidence.ttlNote = 'https://etendoproject.atlassian.net/browse/ETP-1?c=3';
    assert.deepEqual(codes(checkRetirementRecord(feature)), []);
    const copied = { retirement: cleanRetirement({ ttlNote: 'Permanent switch, no retirement planned.' }) };
    assert.deepEqual(codes(checkRetirementRecord(copied)), ['ttl-note']);
  });

  it('accepts "not-user-visible: <reason>" instead of a docs link, but not a bare label', () => {
    const ok = cleanRetirement({ evidence: { datadog: 'https://dd/x', userDocs: 'not-user-visible: internal kill switch' } });
    assert.deepEqual(codes(checkRetirementRecord({ retirement: ok })), []);
    const bare = cleanRetirement({ evidence: { datadog: 'https://dd/x', userDocs: 'not-user-visible:' } });
    assert.deepEqual(codes(checkRetirementRecord({ retirement: bare })), ['evidence-user-docs']);
  });

  it('every ticket item needs a link or a human acceptance; a bot sign-off is rejected', () => {
    const retirement = cleanRetirement({
      ticketItems: [
        { id: 'docs', note: 'publish the guide' },
        { id: 'smoke', accepted: HUMAN },
        { id: 'archive', accepted: { ...HUMAN, by: 'claude' } },
      ],
      signOff: { ...HUMAN, by: 'Etendo Bot' },
    });
    assert.deepEqual(codes(checkRetirementRecord({ retirement })), ['ticket-item-open', 'ticket-item-open', 'signoff-invalid']);
  });
});

describe('verify — nothing may still declare or evaluate the flag', () => {
  it('derives the flag-only identifiers from the key', () => {
    assert.equal(upperSnake('acct-process-monitor'), 'ACCT_PROCESS_MONITOR');
    assert.deepEqual(flagIdentifiers('acct-process-monitor'),
      ['acct-process-monitor', 'ACCT_PROCESS_MONITOR', 'etendo.go.flags.acct-process-monitor']);
  });

  it('ship: constants, properties, framework files and flag API lines block; feature names only warn', () => {
    const ctx = { key: 'my-flag', branch: 'ship', frameworkPaths: ['lib/flags/'] };
    assert.equal(classifyHit({ file: 'a.jsx', text: 'useFeatureFlag(MY_FLAG)' }, ctx), 'block');
    assert.equal(classifyHit({ file: 'G.java', text: 'String FLAG_MY_FLAG = "my-flag";' }, ctx), 'block');
    assert.equal(classifyHit({ file: 'a.properties', text: 'etendo.go.flags.my-flag=true' }, ctx), 'block');
    assert.equal(classifyHit({ file: 'src/lib/flags/keys.js', text: "'my-flag'" }, ctx), 'block');
    assert.equal(classifyHit({ file: 'menu.json', text: '"name": "my-flag"' }, ctx), 'warn');
    assert.equal(classifyHit({ file: 'menu.json', text: '"name": "my-flag"' }, { ...ctx, branch: 'kill' }), 'block');
  });

  it('ship: a remaining flag object or backend flagKey blocks', () => {
    const feature = { id: 'f', flag: { key: 'my-flag', symbols: ['Page'] }, retirement: { branch: 'ship' } };
    const items = checkVerify(feature, { id: 'f', flagKey: 'my-flag' }, { rootDirs: { frontend: sfRoot }, frameworkPaths: [], grep: noGrep });
    assert.deepEqual(codes(items), ['flag-object-present', 'go-flagkey-present']);
  });

  it('ship: greps only the flag identifiers; kill also greps every symbol and requires owned paths gone', () => {
    const seen = [];
    const grep = (dir, terms) => { seen.push(terms); return []; };
    const shipped = { id: 'f', retirement: { branch: 'ship', key: 'my-flag', symbols: ['MyPage'] } };
    assert.deepEqual(codes(checkVerify(shipped, { id: 'f', contribution: true }, { rootDirs: { frontend: sfRoot }, frameworkPaths: [], grep })), []);
    assert.ok(!seen[0].includes('MyPage'));

    write(sfRoot, 'src/MyPage.jsx');
    const killed = { id: 'f', paths: { frontend: ['src/MyPage.jsx'] }, retirement: { branch: 'kill', key: 'my-flag', symbols: ['MyPage'] } };
    assert.deepEqual(codes(checkVerify(killed, null, { rootDirs: { frontend: sfRoot }, frameworkPaths: [], grep })), ['owned-path-present']);
    assert.ok(seen[1].includes('MyPage'));
  });

  it('gitGrep finds code references and skips docs and the registry', () => {
    const env = isolatedGitEnv();
    execFileSync('git', ['init', '-q'], { cwd: sfRoot, env });
    write(sfRoot, 'src/a.js', "useFeatureFlag(MY_FLAG);\n");
    write(sfRoot, 'docs/a.md', 'MY_FLAG was retired\n');
    write(sfRoot, 'flags-registry.json', '{"MY_FLAG": 1}\n');
    execFileSync('git', ['add', '.'], { cwd: sfRoot, env });
    assert.deepEqual(gitGrep(sfRoot, ['MY_FLAG']), [{ file: 'src/a.js', line: 1, text: 'useFeatureFlag(MY_FLAG);' }]);
    assert.deepEqual(gitGrep(sfRoot, ['NOT_THERE']), []);
  });
});

describe('runCheck — both registries, end to end', () => {
  it('ETP-6425: flag removed with an open item and no record is BLOCKED', () => {
    writeRegistries({
      id: 'acct-process-monitor', owner: 'sebastianbarrozo', jira: 'ETP-5269',
      paths: { backend: ['src/SFAcctProcessMonitor.java'] },
      deferredItems: [{ id: 'manual-trigger-runtime-verification', kind: 'open', note: 'no manual run on a deployed build yet' }],
    }, { id: 'acct-process-monitor', contribution: true, testSpecs: { unit: [{ path: 'src-test/SFAcctProcessMonitorTest.java' }] } });
    write(goRoot, 'src-test/SFAcctProcessMonitorTest.java');
    const result = run('acct-process-monitor');
    assert.equal(result.blocked, true);
    assert.ok(codes(result.items).includes('deferred-item-open'));
    assert.ok(codes(result.items).includes('no-retirement-record'));
    assert.ok(codes(result.items, 'info').includes('flag-already-removed'));
    assert.equal(result.registries.go, join(goRoot, 'flags-registry.json'));
  });

  it('a backend spec from the go registry is checked against the go checkout', () => {
    writeRegistries({ id: 'f', flag: { key: 'f' }, retirement: cleanRetirement() },
      { id: 'f', flagKey: 'f', testSpecs: { unit: [{ path: 'src-test/FTest.java', expected: true }] } });
    const result = run('f');
    assert.deepEqual(codes(result.items), ['spec-pending']);
    assert.match(result.items.find((item) => item.code === 'spec-pending').message, /^com\.etendoerp\.go backend/);
  });

  it('a clean feature with a complete record is CLEAR', () => {
    writeRegistries({ id: 'f', flag: { key: 'f', ttl: '2026-12-31' }, retirement: cleanRetirement() });
    const result = run('f');
    assert.equal(result.blocked, false);
    assert.ok(codes(result.items, 'info').includes('ttl'));
  });

  it('a feature with backend parts blocks when the go checkout cannot be found', () => {
    write(sfRoot, 'flags-registry.json', { roots: {}, features: [{ id: 'f', flag: { key: 'f' }, paths: { backend: ['src/X.java'] }, retirement: cleanRetirement() }] });
    rmSync(join(base, 'modules'), { recursive: true });
    assert.ok(codes(run('f').items).includes('backend-unavailable'));
  });

  it('an unknown name is a usage error', () => {
    writeRegistries({ id: 'f' });
    assert.throws(() => run('nope'), (error) => error.usage === true);
  });
});

describe('CLI', () => {
  it('parses flags in both forms and rejects unknown ones', () => {
    const options = parseArgs(['--flag=x', '--verify', '--json', '--go-module', '/tmp/go']);
    assert.equal(options.name, 'x');
    assert.equal(options.verify, true);
    assert.equal(options.json, true);
    assert.equal(options.goModule, resolve('/tmp/go'));
    assert.throws(() => parseArgs(['--nope']), /unknown option/);
    assert.throws(() => parseArgs(['--flag']), /needs a value/);
  });

  it('exits 1 when blocked, 0 when clear, 2 on a usage error', () => {
    writeRegistries({ id: 'f', flag: { key: 'f' }, deferredItems: [{ id: 'x', kind: 'open' }], retirement: cleanRetirement() });
    const env = { ...isolatedGitEnv(), ETENDO_GO_MODULE: '' };
    const cli = (...args) => spawnSync(process.execPath, [SCRIPT, '--root', sfRoot, ...args], { encoding: 'utf8', env });
    const blocked = cli('--flag', 'f');
    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /RESULT: BLOCKED/);

    writeRegistries({ id: 'f', flag: { key: 'f' }, retirement: cleanRetirement() });
    const clear = cli('--flag', 'f', '--json');
    assert.equal(clear.status, 0);
    assert.equal(JSON.parse(clear.stdout).blocked, false);

    assert.equal(cli('--flag', 'nope').status, 2);
    assert.equal(cli().status, 2);
  });
});
