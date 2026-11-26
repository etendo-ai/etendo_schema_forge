// @covers cli/src/flags-panel.js
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  rolesFor,
  filterFlags,
  impactOf,
  applyRingChange,
  expectedAudience,
} from '../src/flags-panel.js';

/** A flag as GET /api/state returns it: `audience.beta` is cumulative (it includes alpha). */
function flag(overrides = {}) {
  return {
    key: 'sample-flag',
    owner: 'Alice',
    teams: ['plataforma'],
    description: 'Sample flag',
    rollout: { stage: 'alpha', environment: 'Production' },
    audience: { alpha: ['alice@etendo.ai'], beta: ['alice@etendo.ai', 'bob@etendo.ai'] },
    sync: { state: 'applied' },
    ...overrides,
  };
}

const emptyRings = () => ({
  environment: 'Production',
  alpha: { groups: [], emails: [] },
  beta: { groups: [], emails: [] },
});

describe('rolesFor', () => {
  it('matches the owner case-insensitively', () => {
    assert.deepEqual(rolesFor(flag(), { owner: 'alice' }), ['owner']);
  });

  it('puts an alpha member only in alpha, although the beta audience repeats them', () => {
    assert.deepEqual(rolesFor(flag(), { email: 'alice@etendo.ai' }), ['alpha']);
  });

  it('puts a beta-only member in beta', () => {
    assert.deepEqual(rolesFor(flag(), { email: 'bob@etendo.ai' }), ['beta']);
  });

  it('returns no role for someone unrelated', () => {
    assert.deepEqual(rolesFor(flag(), { owner: 'carol', email: 'carol@etendo.ai' }), []);
  });
});

describe('filterFlags', () => {
  const flags = [
    flag(),
    flag({ key: 'unmanaged-flag', owner: 'Carol', rollout: undefined, audience: {}, sync: undefined }),
    flag({ key: 'beta-flag', owner: 'Dave', rollout: { stage: 'beta' }, teams: ['finanzas'] }),
  ];
  const keys = (list) => list.map((f) => f.key);

  it('--mine keeps flags owned by or targeting the user', () => {
    const mine = filterFlags(flags, { mine: true }, { owner: 'carol', email: 'bob@etendo.ai' });
    assert.deepEqual(keys(mine), ['sample-flag', 'unmanaged-flag', 'beta-flag']);
    const none = filterFlags(flags, { mine: true }, { owner: 'zoe', email: 'zoe@etendo.ai' });
    assert.deepEqual(keys(none), []);
  });

  it('--stage unmanaged selects flags the panel does not roll out', () => {
    assert.deepEqual(keys(filterFlags(flags, { stage: 'unmanaged' }, {})), ['unmanaged-flag']);
  });

  it('--member, --team and --search narrow the list', () => {
    assert.deepEqual(keys(filterFlags(flags, { member: 'BOB@etendo.ai' }, {})), ['sample-flag', 'beta-flag']);
    assert.deepEqual(keys(filterFlags(flags, { team: 'finanzas' }, {})), ['beta-flag']);
    assert.deepEqual(keys(filterFlags(flags, { search: 'UNMANAGED' }, {})), ['unmanaged-flag']);
  });
});

describe('impactOf', () => {
  it('is empty for an applied flag, whatever the stale impact says', () => {
    assert.equal(impactOf(flag({ sync: { state: 'applied', impact: { lose: 3 } } })), '');
  });

  it('describes what applying a pending flag would remove or grant', () => {
    assert.equal(impactOf(flag({ sync: { state: 'pending', impact: { lose: 2, rulesLost: 1 } } })), '2 lose, 1 rule(s) removed');
    assert.equal(impactOf(flag({ sync: { state: 'pending', impact: { loseAll: true, lose: 9 } } })), 'everyone loses');
    assert.equal(impactOf(flag({ sync: { state: 'pending', impact: { gainAll: true } } })), 'everyone gains');
  });
});

describe('applyRingChange', () => {
  it('adds an @group to groups and an email, lowercased, to emails', () => {
    const body = emptyRings();
    applyRingChange(body, 'alpha', 'add', ['@salva', 'Someone@Etendo.ai']);
    assert.deepEqual(body.alpha, { groups: ['salva'], emails: ['someone@etendo.ai'] });
    assert.deepEqual(body.beta, { groups: [], emails: [] });
  });

  it('does not duplicate an entry that differs only in case', () => {
    const body = emptyRings();
    body.beta.emails.push('someone@etendo.ai');
    applyRingChange(body, 'beta', 'add', ['SOMEONE@etendo.ai']);
    assert.deepEqual(body.beta.emails, ['someone@etendo.ai']);
  });

  it('removes entries case-insensitively and ignores ones that are absent', () => {
    const body = emptyRings();
    body.alpha.groups.push('comite');
    body.alpha.emails.push('salva@skalo.ai', 'keep@etendo.ai');
    applyRingChange(body, 'alpha', 'rm', ['@COMITE', 'Salva@Skalo.ai', 'missing@etendo.ai']);
    assert.deepEqual(body.alpha, { groups: [], emails: ['keep@etendo.ai'] });
  });
});

describe('expectedAudience', () => {
  it('is null (everyone) for ga', () => {
    assert.equal(expectedAudience(flag({ rollout: { stage: 'ga' } })), null);
  });

  it('is the alpha ring for alpha and the cumulative audience for beta', () => {
    assert.deepEqual([...expectedAudience(flag())], ['alice@etendo.ai']);
    assert.deepEqual([...expectedAudience(flag({ rollout: { stage: 'beta' } }))].sort(), ['alice@etendo.ai', 'bob@etendo.ai']);
  });

  it('is nobody for off and for a flag the panel does not manage', () => {
    assert.equal(expectedAudience(flag({ rollout: { stage: 'off' } })).size, 0);
    assert.equal(expectedAudience(flag({ rollout: undefined })).size, 0);
  });
});
