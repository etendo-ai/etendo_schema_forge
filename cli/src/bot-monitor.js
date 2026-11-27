#!/usr/bin/env node
/**
 * Read-only CLI for the bot monitor ("serruchín", https://monitor.jc.proxy.vpn.etendo.cloud).
 *
 * The monitor turns sources into pre-tickets (steps 1-2), keeps the queue of Jira tasks the
 * bots may work on (step 3) and runs each task through a Dagu development DAG (step 4,
 * "Desarrollo"): worktree, gate, reviews, PR and CI. A developer then picks up the pre-worked
 * task, QAs it and completes it.
 *
 * It sits behind the same Tinyauth as the flags panel (cookie domain .jc.proxy.vpn.etendo.cloud),
 * so it reuses that session: sign in once with `make flags ARGS=login`. Only GET endpoints are
 * called; every action (enqueue, retake, decide, refresh) stays in the web UI.
 *
 * Usage: node cli/src/bot-monitor.js help   (or: make bots ARGS="help")
 */

import { request, signedInUser } from './flags-panel.js';

const BASE = process.env.ETENDO_MONITOR_URL || 'https://monitor.jc.proxy.vpn.etendo.cloud';

const HELP = `bot-monitor — read the bot monitor ("serruchín"). Read-only.

  dev [filters] [--json]        Step 4 "Desarrollo": one row per task, its latest bot run and its
                                Jira status. Default: the bot finished (run succeeded or a person
                                took it over) and the task is not closed
      --mine                    Tasks assigned to me in Jira (the signed-in Tinyauth user)
      --assignee <text>         Jira assignee contains <text>
      --jira <status,...>       Jira status, e.g. TBD (pre-worked, not started), QA, "In Progress"
      --run <state>             done (default) | failed | needs-human | running | queued | any
      --all                     Include closed tasks (PRs merged or Jira done / won't fix)
  run <ISSUE>                   Every bot run of a task, its PRs, why it stopped, and the steps of
                                the latest run
  log <dagRunId> [--step <name>] Output of one step of a run (default step: dev_phase)
  tasks [--mine] [--jira <s>] [--json]
                                Step 3: Jira tasks waiting for a bot, with the bot's decision
  pretickets [--json]           Steps 1-2: pre-tickets (GitHub issues opened by the router)
  log <dagRunId> [--step <name>] Output of one step of a run (default: the rounds — plan, dev and
                                review loop — or dev_phase on older DAGs)
  raw <path>                    GET any monitor endpoint, e.g. raw /api/stats

Session: the flags panel's (make flags ARGS=login). Environment: ETENDO_MONITOR_URL.`;

// ---------- HTTP ----------

const query = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
  return q.toString() ? `?${q}` : '';
};
const get = (path, params) => request(BASE, 'GET', path + query(params));

/** The monitor answers `{ ok: false, error }` with HTTP 200 when it cannot reach a source. */
async function getOk(path, params) {
  const d = await get(path, params);
  if (d.ok === false || d.ok === 'false') fail(`${path}: ${d.error || 'the monitor could not answer'}`);
  return d;
}

// ---------- model ----------

const ISSUE_RE = /^[A-Z][A-Z0-9]*-\d+/;
/** Jira key of a Dagu run id such as `ETP-6395-auto-20261125-234723`. */
export const issueOf = (dagRunId) => (String(dagRunId).match(ISSUE_RE) || [''])[0];
const when = (r) => r.startedAt || r.queuedAt || '';

/** The latest run of each task, newest first. */
export function latestRuns(runs) {
  const latest = new Map();
  for (const r of runs || []) {
    const key = issueOf(r.dagRunId);
    if (key && (!latest.has(key) || when(r) > when(latest.get(key)))) latest.set(key, r);
  }
  return [...latest.values()].sort((a, b) => when(b).localeCompare(when(a)));
}

/**
 * What the bot did with a task, as the monitor shows it: a person who took the task over
 * (`handoff`) counts as done; a failed run that stopped for a person is `needs-human`.
 */
export function botState(run, d) {
  const key = issueOf(run.dagRunId);
  if (d.handoff?.[key]) return 'handoff';
  if (run.status === 'succeeded') return 'done';
  if (run.status === 'failed' && d.human?.[key]) return 'needs-human';
  return run.status;
}

const RUN_FILTERS = {
  done: (s) => s === 'done' || s === 'handoff',
  failed: (s) => s === 'failed' || s === 'needs-human' || s === 'aborted',
  'needs-human': (s) => s === 'needs-human',
  running: (s) => s === 'running',
  queued: (s) => s === 'queued',
  any: () => true,
};

/** Rows of the "Desarrollo" step after the filters of `dev`. `assignee` is matched as a substring. */
export function devRows(d, { assignee, jira, run = 'done', all = false } = {}) {
  const wantRun = RUN_FILTERS[run];
  if (!wantRun) fail(`--run ${run}: expected ${Object.keys(RUN_FILTERS).join(' | ')}`);
  const statuses = jira ? jira.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
  return latestRuns(d.runs)
    .map((r) => {
      const key = issueOf(r.dagRunId);
      const j = d.jira?.[key] || {};
      return {
        key,
        jira: j.status || '?',
        bot: botState(r, d),
        finished: r.finishedAt || '',
        closed: d.closed?.[key] || '',
        assignee: j.assignee || '',
        prs: d.prs?.[key] || [],
        summary: j.summary || '',
        url: j.url || '',
        run: r.dagRunId,
      };
    })
    .filter((row) => all || !row.closed)
    .filter((row) => wantRun(row.bot))
    .filter((row) => !assignee || row.assignee.toLowerCase().includes(assignee.toLowerCase()))
    .filter((row) => !statuses || statuses.includes(row.jira.toLowerCase()));
}

/** "2 open, 1 merged" */
export function prSummary(prs) {
  const counts = {};
  for (const p of prs || []) counts[p.state.toLowerCase()] = (counts[p.state.toLowerCase()] || 0) + 1;
  return Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ');
}

// ---------- output ----------

function table(rows, headers) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(headers));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  rows.forEach((r) => console.log(line(r)));
}
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const day = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : '-');
const print = (x) => console.log(JSON.stringify(x, null, 2));

// ---------- commands ----------

async function assigneeFor(opts) {
  if (!opts.mine) return opts.assignee;
  const { name } = await signedInUser();
  if (!name) fail('Signed-in user has no name: use --assignee <name>.');
  return name;
}

async function dev(opts) {
  const d = await getOk('/api/dagu/runs');
  const rows = devRows(d, { assignee: await assigneeFor(opts), jira: opts.jira, run: opts.run, all: opts.all });
  if (opts.json) return print(rows);
  table(rows.map((r) => [r.key, r.jira, r.bot, day(r.finished), prSummary(r.prs), r.closed ? 'yes' : '', short(r.summary, 70)]),
    ['ISSUE', 'JIRA', 'BOT', 'FINISHED', 'PRS', 'CLOSED', 'SUMMARY']);
  const byJira = {};
  for (const r of rows) byJira[r.jira] = (byJira[r.jira] || 0) + 1;
  console.log(`\n${rows.length} task(s): ${Object.entries(byJira).map(([s, n]) => `${s} ${n}`).join(' · ') || '-'}`);
}

async function run(issue) {
  const d = await getOk('/api/dagu/runs');
  const runs = (d.runs || []).filter((r) => issueOf(r.dagRunId) === issue).sort((a, b) => when(b).localeCompare(when(a)));
  const j = d.jira?.[issue] || {};
  console.log(`${issue}  ${j.summary || ''}`);
  console.log(`  jira ${j.status || '?'} · ${j.assignee || '-'} · ${j.url || ''}`);
  if (d.closed?.[issue]) console.log(`  closed: ${d.closed[issue]}`);
  if (d.handoff?.[issue]) console.log(`  taken over: ${d.handoff[issue].note || ''} (${new Date(d.handoff[issue].at * 1000).toISOString().slice(0, 16)})`);
  if (d.human?.[issue]) console.log(`  needs a person (${d.human[issue].kind}): ${d.human[issue].reason}`);
  for (const p of d.prs?.[issue] || []) console.log(`  PR ${p.state.toLowerCase()}: ${p.url}`);
  if (!runs.length) return console.log('  no bot run');
  console.log('runs:');
  for (const r of runs) console.log(`  ${r.dagRunId}  ${r.status}  ${day(r.startedAt)} → ${day(r.finishedAt)}`);
  const latest = await getOk('/api/dagu/run', { id: runs[0].dagRunId });
  console.log(`latest run steps (${runs[0].dagRunId}):`);
  for (const s of latest.steps || []) console.log(`  ${s.status.padEnd(11)} ${s.name}${s.error ? `  — ${s.error}` : ''}`);
  if (latest.failure) console.log(`failure: ${typeof latest.failure === 'string' ? latest.failure : JSON.stringify(latest.failure)}`);
}

/** The step whose output tells what the agent did: the review loop, or dev_phase on older DAGs. */
export function defaultLogStep(steps) {
  const names = (steps || []).map((s) => s.name);
  return ['rounds', 'dev_phase'].find((n) => names.includes(n));
}

async function log(id, opts) {
  let step = opts.step;
  if (!step) {
    const { steps } = await getOk('/api/dagu/run', { id });
    step = defaultLogStep(steps);
    if (!step) fail(`No agent step in ${id}. Pick one with --step: ${(steps || []).map((s) => s.name).join(', ')}`);
  }
  const d = await getOk('/api/dagu/log', { id, step });
  console.log(d.content || '(no output)');
}

async function tasks(opts) {
  const d = await getOk('/api/tasks');
  const assignee = await assigneeFor(opts);
  const statuses = opts.jira ? opts.jira.split(',').map((s) => s.trim().toLowerCase()) : null;
  const rows = (d.issues || [])
    .filter((i) => !assignee || (i.assignee || '').toLowerCase().includes(assignee.toLowerCase()))
    .filter((i) => !statuses || statuses.includes((i.status || '').toLowerCase()));
  if (opts.json) return print(rows);
  table(rows.map((i) => [i.key, i.status, i.priority || '', i.assignee || '', i.run ? `${i.run.status}` : '', short(i.summary || '', 70)]),
    ['ISSUE', 'JIRA', 'PRIORITY', 'ASSIGNEE', 'BOT RUN', 'SUMMARY']);
  console.log(`\n${rows.length} of ${(d.issues || []).length} task(s)`);
}

async function pretickets(opts) {
  const d = await getOk('/api/pretickets');
  const rows = d.issues || [];
  if (opts.json) return print(rows);
  table(rows.map((i) => [`#${i.number}`, i.status || '', (i.cells || []).join(','), (i.assignees || []).join(','), i.jira || '', i.repo || '', short(i.title || '', 70)]),
    ['ISSUE', 'STATUS', 'CELL', 'ASSIGNEES', 'JIRA', 'REPO', 'TITLE']);
  console.log(`\n${rows.length} pre-ticket(s)`);
}

// ---------- entry ----------

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const FLAGS = ['mine', 'json', 'all'];

export function parse(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const name = a.slice(2);
    if (FLAGS.includes(name)) opts[name] = true;
    else {
      if (argv[i + 1] === undefined) fail(`--${name} needs a value`);
      opts[name] = argv[++i];
    }
  }
  return { pos, opts };
}

async function main() {
  const { pos: [cmd, arg], opts } = parse(process.argv.slice(2));
  switch (cmd) {
    case 'dev': return dev(opts);
    case 'run':
      if (!ISSUE_RE.test(arg || '')) fail('usage: run <ISSUE>   e.g. run ETP-6395');
      return run(arg);
    case 'log':
      if (!arg) fail('usage: log <dagRunId> [--step <name>]');
      return log(arg, opts);
    case 'tasks': return tasks(opts);
    case 'pretickets': return pretickets(opts);
    case 'raw':
      if (!arg?.startsWith('/')) fail('usage: raw </path>');
      return print(await get(arg));
    case undefined: case 'help': case '-h': case '--help':
      return console.log(HELP);
    default:
      return fail(`Unknown command "${cmd}".\n\n${HELP}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => fail(e.stack || e.message));
