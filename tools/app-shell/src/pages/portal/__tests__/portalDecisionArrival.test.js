// @covers tools/app-shell/src/pages/portal/portalDecisionArrival.js
// New file: no test covered this module; portalPresentation.test.js is about another module
// (the portal's presentation rules), not the way from a decision confirmation into the portal.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { portalEntryPath } from '../portalDecisionArrival.js';

describe('portalEntryPath', () => {
  const CLIENT = '0123456789ABCDEF0123456789ABCDEF';
  const OTHER = 'FEDCBA9876543210FEDCBA9876543210';
  for (const [label, result, fallback, expectedPath, expectedClient] of [
    ['the answer names the tenant', { portalToken: 'tok/a b+c', quotationId: 'q-1', clientId: CLIENT }, OTHER,
      `/portal/${CLIENT}`, CLIENT],
    ['only the landing URL names the tenant', { portalToken: 'tok/a b+c', quotationId: 'q-1' }, CLIENT,
      `/portal/${CLIENT}`, CLIENT],
    ['no tenant is known (pre-CP-43 link)', { portalToken: 'tok/a b+c', quotationId: 'q-1' }, null,
      '/portal', null],
  ]) {
    it(`opens the portal on the quotation with a token-free path when ${label}`, () => {
      const entry = portalEntryPath(result, fallback);

      const [pathname, search] = entry.path.split('?');
      assert.equal(pathname, expectedPath);
      assert.ok(!entry.path.includes('tok'), 'the token never goes into the URL');
      assert.deepEqual(Object.fromEntries(new URLSearchParams(search)), {
        view: 'doc', kind: 'QUOTATION', id: 'q-1',
      });
      assert.deepEqual(entry.link, { clientId: expectedClient, token: 'tok/a b+c' });
    });
  }

  for (const [label, result] of [
    ['no answer', null],
    ['no portal token', { portalToken: null, quotationId: 'q-1' }],
    ['an empty portal token', { portalToken: '', quotationId: 'q-1' }],
    ['no quotation', { portalToken: 'tok-1', quotationId: null }],
  ]) {
    it(`is null with ${label}, so the landing keeps its own card`, () => {
      assert.equal(portalEntryPath(result), null);
    });
  }
});
