// @covers tools/app-shell/src/pages/portal/portalMarketingLinks.js
// New file: a new module (the portal's etendo.ai links); no existing test covers it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ETENDO_LINK_BASES, etendoLinkFor } from '../portalMarketingLinks.js';

const CLIENT = '0123456789ABCDEF0123456789ABCDEF';
const TOKEN = 'abcDEF_-0123456789abcdefghijklmnopqrstuvwxy';

describe('etendoLinkFor', () => {
  it('keeps marketing\'s base URLs verbatim', () => {
    assert.equal(ETENDO_LINK_BASES.learnMore, 'https://etendo.ai/?utm_source=portal_clientes&utm_medium=in_app&utm_campaign=portal_clientes&utm_content=boton_conoce_mas');
    assert.equal(ETENDO_LINK_BASES.startFree, 'https://etendo.ai/precios/?utm_source=portal_clientes&utm_medium=in_app&utm_campaign=portal_clientes&utm_content=banner_empieza_gratis');
  });

  it('falls back to the learnMore link for an unknown piece', () => {
    assert.equal(etendoLinkFor('nope', CLIENT), `${ETENDO_LINK_BASES.learnMore}&portal_ref=${CLIENT}`);
    assert.equal(etendoLinkFor(undefined), ETENDO_LINK_BASES.learnMore);
  });

  for (const piece of ['learnMore', 'startFree']) {
    it(`appends portal_ref=<AD_Client_ID> to ${piece}`, () => {
      assert.equal(etendoLinkFor(piece, CLIENT), `${ETENDO_LINK_BASES[piece]}&portal_ref=${CLIENT}`);
    });

    it(`returns the base ${piece} URL without a tenant id, and never carries a token`, () => {
      for (const value of [null, undefined, '', TOKEN, 'not-a-client']) {
        assert.equal(etendoLinkFor(piece, value), ETENDO_LINK_BASES[piece]);
      }
    });
  }
});
