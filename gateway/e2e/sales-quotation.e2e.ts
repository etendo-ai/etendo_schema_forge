// @covers gateway/src/public-api/public-api.controller.ts
// sales-quotation and its lines (`sales-quotation/{id}/quotation-line`). Neither publishes an action
// (no `complete`), so every record this file creates is a draft and is deleted at the end, also
// when a test fails (scoped / after).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { api, expectErrorDocument, expectStatus, resource } from './support/client.ts';
import { cleanupCreated, scoped } from './support/cleanup.ts';
import { createAddress, createContact, createProduct, createQuotation, createQuotationLine } from './support/fixtures.ts';
import {
  expectDeleted, expectListed, expectMissingIfMatchRefused, expectPatchWithEtag, expectPutWithEtag, expectStaleEtagRefused,
  readWithEtag, type LifecycleSpec,
} from './support/lifecycle.ts';

after(cleanupCreated);

const CENT = 0.01;

describe('sales quotation with lines', () => {
  let contactId = '';
  let addressId = '';
  let productId = '';
  let quotation: LifecycleSpec;
  let line: LifecycleSpec;
  let grossBefore = 0;

  before(async () => {
    contactId = (await createContact('quotation-customer', { is_customer: true })).id;
    addressId = (await createAddress(contactId)).id;
    productId = (await createProduct('quotation-item')).id;
  });

  it('creates a draft quotation for the customer and reads it back with an ETag', async () => {
    const created = await createQuotation(contactId, addressId, { description: 'initial' });
    quotation = {
      collection: 'sales-quotation', type: 'sales-quotation', id: created.id,
      firstPatch: { description: 'changed' }, secondPatch: { description: 'stale write must not land' },
    };
    assert.equal(created.data.type, 'sales-quotation');
    assert.equal(created.data.relationships?.business_partner?.data?.id, contactId);
    const { res } = await readWithEtag(`sales-quotation/${quotation.id}`);
    const attributes = res.json.data.attributes;
    assert.equal(attributes.document_status, 'DR', 'a new quotation is a draft');
    assert.equal(attributes.order_date, '2026-10-14');
    assert.equal(attributes.partner_address, addressId);
    assert.equal(typeof attributes.document_no, 'string', 'document_no is assigned by the server');
    assert.equal(attributes.description, 'initial');
  });

  it('adds a line through its master and reads the amounts the server computes', async () => {
    const created = await createQuotationLine(quotation.id, productId, { ordered_quantity: 2, list_price: 25, discount: 0 });
    line = {
      collection: `sales-quotation/${quotation.id}/quotation-line`, type: 'sales-quotation-quotationLine', id: created.id,
      firstPatch: { ordered_quantity: 3 }, secondPatch: { description: 'stale write must not land' },
    };
    assert.equal(created.data.relationships?.product?.data?.id, productId);
    grossBefore = Number(created.data.attributes.line_gross_amount);
    assert.ok(Number.isFinite(grossBefore) && grossBefore > 0, 'the line carries a positive line_gross_amount');
    assert.equal(Number(created.data.attributes.list_price), 25);
    assert.equal(typeof created.data.attributes.uom, 'string', 'uom is derived from the product and read-only');
  });

  it('a quotation line is reachable only through its master', async () => {
    expectErrorDocument(await api('GET', 'sales-quotation-quotationLine'), 404);
    expectErrorDocument(await api('GET', 'sales-quotation-lines'), 404);
  });

  it('reads the header with a grand total that covers the line, and lists header and line', async () => {
    const { res } = await readWithEtag(`sales-quotation/${quotation.id}`);
    const total = Number(res.json.data.attributes.grand_total_amount);
    assert.ok(total >= grossBefore - CENT, `grand_total_amount ${total} covers the line ${grossBefore}`);
    await expectListed(quotation);
    await expectListed(line);
  });

  it('PATCHing the line quantity recomputes its amount, and the header total follows', async () => {
    await expectPatchWithEtag(line);
    const reread = (await readWithEtag(`${line.collection}/${line.id}`)).res.json.data.attributes;
    assert.equal(String(reread.ordered_quantity), '3');
    assert.ok(Number(reread.line_gross_amount) > grossBefore, 'line_gross_amount grew with the quantity');
    const header = await api('GET', `sales-quotation/${quotation.id}`);
    expectStatus(header, 200);
    assert.ok(Number(header.json.data.attributes.grand_total_amount) >= Number(reread.line_gross_amount) - CENT, 'header total covers the line');
  });

  it('line: a stale ETag is 412, a missing If-Match is 428, and PUT follows the same rules', async () => {
    await expectStaleEtagRefused(line);
    await expectMissingIfMatchRefused(line);
    await expectPutWithEtag(line, { description: 'put' }, { description: 'stale put must not land' });
  });

  it('header: PATCH with the ETag from the read, a stale one is 412, a missing one is 428, and PUT follows the same rules', async () => {
    await expectPatchWithEtag(quotation);
    await expectStaleEtagRefused(quotation);
    await expectMissingIfMatchRefused(quotation);
    await expectPutWithEtag(quotation, { description: 'put' }, { description: 'stale put must not land' });
  });

  it('document_status, document_no and grand_total_amount are read-only: sending them is 400', async () => {
    for (const [field, value] of [['document_status', 'CO'], ['document_no', 'x'], ['grand_total_amount', 1]] as const) {
      const error = expectErrorDocument(await api('POST', 'sales-quotation', {
        body: resource('sales-quotation', { order_date: '2026-10-14', [field]: value }, { business_partner: ['contacts', contactId] }),
      }), 400);
      assert.match(error.detail, new RegExp(field));
    }
  });

  it('exposes no action: complete is 404 unknown_action', async () => {
    expectErrorDocument(await api('POST', `sales-quotation/${quotation.id}/actions/complete`), 404, 'unknown_action');
  });

  it('a second line plus a discount: the header total is the sum of the lines', async () => {
    await scoped(async () => {
      const discounted = await createQuotationLine(quotation.id, productId, { ordered_quantity: 10, list_price: 100, discount: 10 });
      const full = await createQuotationLine(quotation.id, productId, { ordered_quantity: 10, list_price: 100, discount: 0 });
      assert.ok(Number(discounted.data.attributes.line_gross_amount) < Number(full.data.attributes.line_gross_amount), 'a discount lowers the line');
      const lines = await api('GET', `${line.collection}?page[size]=100`);
      expectStatus(lines, 200);
      const amounts = (lines.json.data as any[]).map((l) => Number(l.attributes.line_gross_amount));
      const header = await api('GET', `sales-quotation/${quotation.id}`);
      assert.ok(Math.abs(Number(header.json.data.attributes.grand_total_amount) - amounts.reduce((a, b) => a + b, 0)) <= CENT * amounts.length,
        'grand_total_amount is the sum of the line gross amounts');
    });
  });

  it('deletes the line and the header, and both answer 404 afterwards', async () => {
    await expectDeleted(line);
    await expectDeleted(quotation);
  });
});
