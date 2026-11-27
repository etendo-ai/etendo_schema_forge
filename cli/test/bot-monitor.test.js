// @covers cli/src/bot-monitor.js
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  issueOf,
  latestRuns,
  botState,
  devRows,
  prSummary,
  defaultLogStep,
  parse,
} from '../src/bot-monitor.js';

const run = (id, status, startedAt) => ({ dagRunId: id, status, startedAt, finishedAt: startedAt });

/** Shape of GET /api/dagu/runs, trimmed to what the CLI reads. */
function monitor() {
  return {
    runs: [
      run('ETP-1-auto-20261120-100000', 'failed', '2026-11-20T10:00:00-03:00'),
      run('ETP-1-auto-20261121-100000', 'succeeded', '2026-11-21T10:00:00-03:00'),
      run('ETP-2-ui-20261122-100000', 'succeeded', '2026-11-22T10:00:00-03:00'),
      run('ETP-3-auto-20261123-100000', 'failed', '2026-11-23T10:00:00-03:00'),
      run('ETP-4-auto-20261124-100000', 'failed', '2026-11-24T10:00:00-03:00'),
      run('ETP-5-auto-20261125-100000', 'succeeded', '2026-11-25T10:00:00-03:00'),
    ],
    jira: {
      'ETP-1': { status: 'TBD', assignee: 'Valentin Vivaldi', summary: 'one' },
      'ETP-2': { status: 'QA', assignee: 'Valentin Vivaldi', summary: 'two' },
      'ETP-3': { status: 'In Progress', assignee: 'Valentin Vivaldi', summary: 'three' },
      'ETP-4': { status: 'TBD', assignee: 'Someone Else', summary: 'four' },
      'ETP-5': { status: 'Done', assignee: 'Valentin Vivaldi', summary: 'five' },
    },
    human: { 'ETP-3': { kind: 'dependency', reason: 'core CI is red' } },
    handoff: { 'ETP-4': { at: 1795112524, note: 'taken' } },
    closed: { 'ETP-5': 'cerrada en Jira (Done)' },
    prs: { 'ETP-1': [{ state: 'OPEN' }, { state: 'OPEN' }, { state: 'MERGED' }] },
  };
}
const keys = (rows) => rows.map((r) => r.key);

describe('issueOf', () => {
  it('reads the Jira key from any Dagu run id', () => {
    assert.equal(issueOf('ETP-6395-auto-20261125-234723'), 'ETP-6395');
    assert.equal(issueOf('ETP-6395-preticket-20261120-094432'), 'ETP-6395');
    assert.equal(issueOf('not-a-run'), '');
  });
});

describe('latestRuns', () => {
  it('keeps only the newest run of each task, so a later success hides an earlier failure', () => {
    const latest = latestRuns(monitor().runs);
    assert.equal(latest.length, 5);
    assert.equal(latest.find((r) => issueOf(r.dagRunId) === 'ETP-1').status, 'succeeded');
  });
});

describe('botState', () => {
  const d = monitor();
  it('counts a task a person took over as done, like the monitor', () => {
    assert.equal(botState(d.runs[4], d), 'handoff');
  });
  it('tells a failure that waits for a person from a plain failure', () => {
    assert.equal(botState(d.runs[3], d), 'needs-human');
    assert.equal(botState(d.runs[0], { ...d, handoff: {}, human: {} }), 'failed');
  });
});

describe('devRows', () => {
  it('defaults to tasks the bot finished that are not closed', () => {
    assert.deepEqual(keys(devRows(monitor())), ['ETP-4', 'ETP-2', 'ETP-1']);
  });

  it('answers "which of mine are pre-worked but not started" (Jira TBD)', () => {
    assert.deepEqual(keys(devRows(monitor(), { assignee: 'valentin vivaldi', jira: 'tbd' })), ['ETP-1']);
  });

  it('filters several Jira statuses and other run states', () => {
    assert.deepEqual(keys(devRows(monitor(), { jira: 'TBD, QA' })), ['ETP-4', 'ETP-2', 'ETP-1']);
    assert.deepEqual(keys(devRows(monitor(), { run: 'needs-human' })), ['ETP-3']);
    assert.deepEqual(keys(devRows(monitor(), { run: 'failed' })), ['ETP-3']);
  });

  it('shows closed tasks only with --all', () => {
    assert.ok(!keys(devRows(monitor())).includes('ETP-5'));
    assert.ok(keys(devRows(monitor(), { all: true })).includes('ETP-5'));
  });
});

describe('prSummary', () => {
  it('counts pull requests by state', () => {
    assert.equal(prSummary(monitor().prs['ETP-1']), '2 open, 1 merged');
    assert.equal(prSummary([]), '');
  });
});

describe('defaultLogStep', () => {
  it('prefers the review loop, then the older dev_phase, else nothing', () => {
    assert.equal(defaultLogStep([{ name: 'route' }, { name: 'rounds' }]), 'rounds');
    assert.equal(defaultLogStep([{ name: 'dev_phase' }]), 'dev_phase');
    assert.equal(defaultLogStep([{ name: 'route' }]), undefined);
  });
});

describe('parse', () => {
  it('reads boolean flags and valued options', () => {
    assert.deepEqual(parse(['dev', '--mine', '--jira', 'TBD', '--all']), { pos: ['dev'], opts: { mine: true, jira: 'TBD', all: true } });
  });
});
