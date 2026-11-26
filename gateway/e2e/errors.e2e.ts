// @covers gateway/src/public-api/public-api.controller.ts
// The JSON:API error contract (docs/public-api.md 4.1, 4.3, 4.8, 4.10).
// Gateway-originated errors have no `code` per the docs, so `code` is asserted
// only where the docs promise one.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { READONLY_KEY, RUN_PREFIX } from './support/env.ts';
import { api, expectErrorDocument, expectStatus, MISSING_ID, resource, type ApiResponse } from './support/client.ts';
import { cleanupCreated } from './support/cleanup.ts';
import {
  createAddress, createContact, createProduct, createProductCategory, createQuotation, createQuotationLine, firstPaymentMethodId, firstWarehouseId,
} from './support/fixtures.ts';
import { createDraftOrder } from './support/orders.ts';
import { itemPath, readWithEtag, type LifecycleSpec } from './support/lifecycle.ts';

after(cleanupCreated);

describe('authentication errors', () => {
  it('401 when the Authorization header is missing', async () => {
    const error = expectErrorDocument(await api('GET', 'product', { key: null }), 401);
    assert.match(error.detail, /Missing API key/);
  });

  it('401 when the credential is not <id>:<secret>', async () => {
    const error = expectErrorDocument(await api('GET', 'product', { key: 'no-colon-here' }), 401);
    assert.match(error.detail, /Malformed API key/);
  });

  it('401 when the key is unknown or wrong', async () => {
    const error = expectErrorDocument(await api('GET', 'product', { key: 'etgo-doesnotexist:wrong-secret' }), 401);
    assert.match(error.detail, /Invalid API key/);
  });
});

describe('not found', () => {
  it('404 for an unknown record id', async () => {
    expectErrorDocument(await api('GET', `product/${MISSING_ID}`), 404);
  });

  it('404 for an unknown resource', async () => {
    const error = expectErrorDocument(await api('GET', `no-such-resource-${RUN_PREFIX}`), 404);
    assert.match(error.detail, /Unknown public entity/);
  });

  it('404 for resources outside V1, including warehouse and fiscal monitors', async () => {
    for (const name of ['warehouse', 'sales-invoice', 'purchase-invoice', 'goods-shipment', 'goods-receipt', 'monitor-verifactu', 'sii-monitor', 'tbai-facturas-enviadas']) {
      expectErrorDocument(await api('GET', name), 404);
    }
  });

  it('404 for a child resource addressed at top level', async () => {
    expectErrorDocument(await api('GET', 'sales-order-lines'), 404);
  });
});

describe('write validation', () => {
  it('400 for an attribute that is not in the manifest', async () => {
    const res = await api('POST', 'product', {
      body: resource('product', { search_key: `${RUN_PREFIX}-x`, name: `${RUN_PREFIX}-x`, no_such_field: 'x' }),
    });
    const error = expectErrorDocument(res, 400);
    assert.match(error.detail, /no_such_field/);
  });

  it('400 for a read-only field (sale_price, updated)', async () => {
    for (const field of ['sale_price', 'updated']) {
      const res = await api('POST', 'product', {
        body: resource('product', { search_key: `${RUN_PREFIX}-ro`, name: `${RUN_PREFIX}-ro`, [field]: field === 'updated' ? '2026-01-01T00:00:00Z' : 10 }),
      });
      const error = expectErrorDocument(res, 400);
      assert.match(error.detail, new RegExp(field));
    }
  });

  it('400 for an invalid country code on an address', async () => {
    const contact = await createContact('country');
    const res = await api('POST', `contacts/${contact.id}/location-address`, {
      body: resource('contacts-locationAddress', { address_line1: 'x', city_name: 'x', postal_code: '1', country: 'ZZ' }),
    });
    expectErrorDocument(res, 400);
    const ok = await createAddress(contact.id); // the same contact accepts a valid code
    assert.ok(ok.id);
  });

  // 422 is reachable only through an Etendo business rule; none of the published
  // resources exposes an action in v1 (complete is opt-in), so a missing required
  // field is the validation failure within reach. Etendo may answer 400 or 422.
  it('a missing required field yields a validation error document (400 or 422)', async () => {
    const res = await api('POST', 'product', { body: resource('product', { search_key: `${RUN_PREFIX}-noname` }) });
    assert.ok([400, 422].includes(res.status), `expected 400 or 422, got ${res.status}: ${res.text.slice(0, 400)}`);
    expectErrorDocument(res, res.status);
  });

  it('400 with code invalid_query_parameter and source.parameter for an unknown filter field', async () => {
    const error = expectErrorDocument(await api('GET', 'product?filter[no_such_field]=x'), 400, 'invalid_query_parameter');
    assert.ok(error.source?.parameter, 'source.parameter names the offending parameter');
  });
});

// A key without write and process capabilities (PUBLIC_API_KEY_READONLY). Etendo refuses every write
// with 403 (docs/public-api.md 4.4, 4.8): the gateway does not evaluate capabilities. docs 4.8 promises
// a snake_case `code` on every refusal (Etendo's own or `forbidden`), the standard title `Forbidden`
// and a `detail`. Each case also checks, with the main key, that the refused write changed nothing.
describe('write-protected key', { skip: READONLY_KEY ? false : 'PUBLIC_API_KEY_READONLY is not set' }, () => {
  const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
  const readOnly = { key: READONLY_KEY! };
  let contact: LifecycleSpec;
  let category: LifecycleSpec;
  let product: LifecycleSpec;
  let quotation: LifecycleSpec;
  let quotationLine: LifecycleSpec;
  let order: LifecycleSpec;
  let orderLine: LifecycleSpec;
  let contactId = '';
  let addressId = '';

  function expectForbidden(res: ApiResponse): void {
    const error = expectErrorDocument(res, 403);
    assert.equal(error.title, 'Forbidden');
    assert.match(error.code, SNAKE_CASE, `errors[0].code is snake_case (got ${error.code}) in ${res.method} ${res.path}`);
  }

  const patchAs = async (spec: LifecycleSpec, attributes: Record<string, unknown>, method: 'PATCH' | 'PUT' = 'PATCH') => {
    const { etag } = await readWithEtag(itemPath(spec)); // read with the main key: the 403 must come from the capability, not from a missing If-Match
    return api(method, itemPath(spec), { ...readOnly, body: resource(spec.type, attributes, undefined, spec.id), headers: { 'If-Match': etag } });
  };

  before(async () => {
    const mk = (collection: string, type: string, id: string): LifecycleSpec => ({ collection, type, id, firstPatch: {}, secondPatch: {} });
    const created = await createContact('ro-contact', { is_customer: true });
    contactId = created.id;
    contact = mk('contacts', 'contacts', created.id);
    addressId = (await createAddress(contactId)).id;
    category = mk('product-category', 'product-category', (await createProductCategory('ro-category', { description: 'initial' })).id);
    const productRecord = await createProduct('ro-product', { description: 'initial' });
    product = mk('product', 'product', productRecord.id);
    const quote = await createQuotation(contactId, addressId, { description: 'initial' });
    quotation = mk('sales-quotation', 'sales-quotation', quote.id);
    const quoteLine = await createQuotationLine(quote.id, productRecord.id);
    quotationLine = mk(`sales-quotation/${quote.id}/quotation-line`, 'sales-quotation-quotationLine', quoteLine.id);
    const warehouseId = await firstWarehouseId('sales-order');
    const paymentMethodId = await firstPaymentMethodId('sales-order');
    const header = await createDraftOrder('sales-order', { contactId, addressId, warehouseId }, { payment_method: paymentMethodId });
    order = mk('sales-order', 'sales-order', header.id);
    const line = await api('POST', `sales-order/${header.id}/lines`, {
      body: resource('sales-order-lines', { ordered_quantity: 1, list_price: 10, discount: 0 }, { product: ['product', productRecord.id] }),
    });
    expectStatus(line, 201);
    orderLine = mk(`sales-order/${header.id}/lines`, 'sales-order-lines', line.json.data.id);
  });

  it('the key can read (so the 403s below come from the missing capability, not from a bad key)', async () => {
    expectStatus(await api('GET', 'product?page[size]=1', readOnly), 200);
    expectStatus(await api('GET', itemPath(order), readOnly), 200);
  });

  it('POST is 403 on every kind of resource: top-level, child and document', async () => {
    const bodies: Array<[string, unknown]> = [
      ['product', resource('product', { search_key: `${RUN_PREFIX}-403`, name: `${RUN_PREFIX}-403` })],
      ['product-category', resource('product-category', { search_key: `${RUN_PREFIX}-403`, name: `${RUN_PREFIX}-403`, default: false })],
      ['contacts', resource('contacts', { name: `${RUN_PREFIX}-403` })],
      [`contacts/${contactId}/contact`, resource('contacts-contact', { first_name: `${RUN_PREFIX}-403`, last_name: 'Person' })],
      ['sales-quotation', resource('sales-quotation', { order_date: '2026-10-14', partner_address: addressId }, { business_partner: ['contacts', contactId] })],
      [orderLine.collection, resource('sales-order-lines', { ordered_quantity: 1, list_price: 1, discount: 0 }, { product: ['product', product.id] })],
    ];
    for (const [collection, body] of bodies) expectForbidden(await api('POST', collection, { ...readOnly, body }));
    // nothing was created: a record the key managed to create would have been registered and deleted by the cleanup
    const lines = await api('GET', `${orderLine.collection}?page[size]=100`);
    assert.equal(lines.json.data.length, 1, 'the refused line POST created nothing');
  });

  it('PATCH and PUT are 403 and leave the record unchanged', async () => {
    for (const spec of [contact, category, product, quotation, quotationLine, order, orderLine]) {
      const attributes = spec === order ? { order_date: '2026-12-31' } : spec === contact ? { web: 'refused.example.com' } : { description: 'refused' };
      expectForbidden(await patchAs(spec, attributes, 'PATCH'));
      expectForbidden(await patchAs(spec, attributes, 'PUT'));
      const { res } = await readWithEtag(itemPath(spec));
      const [field, value] = Object.entries(attributes)[0];
      assert.notEqual(res.json.data.attributes[field], value, `${spec.type}: the refused write did not land`);
    }
  });

  it('DELETE is 403 and the record is still there', async () => {
    for (const spec of [orderLine, order, quotationLine, quotation, category, product, contact]) {
      expectForbidden(await api('DELETE', itemPath(spec), readOnly));
      expectStatus(await api('GET', itemPath(spec)), 200, `${spec.type} must survive the refused DELETE`);
    }
  });

  it('POST .../actions/complete is 403 and the order stays a draft', async () => {
    expectForbidden(await api('POST', `${itemPath(order)}/actions/complete`, readOnly));
    const { res } = await readWithEtag(itemPath(order));
    assert.equal(res.json.data.attributes.document_status, 'DR');
  });
});
