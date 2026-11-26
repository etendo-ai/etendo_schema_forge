// @covers gateway/src/public-api/public-api.controller.ts
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { api, expectErrorDocument, expectStatus, MISSING_ID, resource } from './support/client.ts';
import { cleanupCreated } from './support/cleanup.ts';
import { createProduct, createProductCategory } from './support/fixtures.ts';
import {
  expectDeleted, expectListed, expectMissingIfMatchRefused, expectPatchWithEtag, expectPutWithEtag, expectStaleEtagRefused,
  readWithEtag, type LifecycleSpec,
} from './support/lifecycle.ts';

after(cleanupCreated);

describe('product', () => {
  let product: LifecycleSpec;

  it('creates a product and reads it back with an ETag', async () => {
    const created = await createProduct('product', { description: 'initial' });
    product = { collection: 'product', type: 'product', id: created.id, firstPatch: { description: 'changed' }, secondPatch: { name: 'renamed' } };
    const { res } = await readWithEtag(`product/${product.id}`);
    assert.equal(res.json.data.attributes.search_key, created.data.attributes.search_key);
    assert.equal(res.json.data.attributes.description, 'initial');
  });

  it('lists the product', async () => {
    await expectListed(product);
  });

  it('PATCH with the ETag from the read updates only the sent field', async () => {
    const before = (await readWithEtag(`product/${product.id}`)).res.json.data.attributes;
    await expectPatchWithEtag(product);
    const after = (await readWithEtag(`product/${product.id}`)).res.json.data.attributes;
    assert.equal(after.description, 'changed');
    assert.equal(after.name, before.name);
  });

  it('a stale ETag is 412 and a missing If-Match is 428', async () => {
    await expectStaleEtagRefused(product);
    await expectMissingIfMatchRefused(product);
  });

  it('PUT is exposed: the current ETag applies it, none or * is 428, a stale one is 412', async () => {
    await expectPutWithEtag(product, { description: 'put' }, { name: 'stale put must not land' });
  });

  it('deletes the product and it answers 404 afterwards', async () => {
    await expectDeleted(product);
  });
});

describe('product category', () => {
  let category: LifecycleSpec;

  it('creates a category and reads it back with an ETag', async () => {
    const created = await createProductCategory('category', { description: 'initial' });
    category = {
      collection: 'product-category', type: 'product-category', id: created.id,
      firstPatch: { description: 'changed' }, secondPatch: { name: 'renamed' },
    };
    const { res } = await readWithEtag(`product-category/${category.id}`);
    const attributes = res.json.data.attributes;
    assert.equal(attributes.search_key, created.data.attributes.search_key);
    assert.equal(attributes.name, created.data.attributes.name);
    assert.equal(attributes.description, 'initial');
    assert.equal(attributes.default, false);
    assert.equal(attributes.active, true, 'a new category is active');
  });

  it('lists the category', async () => {
    await expectListed(category);
  });

  it('PATCH with the ETag from the read updates only the sent field', async () => {
    const before = (await readWithEtag(`product-category/${category.id}`)).res.json.data.attributes;
    await expectPatchWithEtag(category);
    const after = (await readWithEtag(`product-category/${category.id}`)).res.json.data.attributes;
    assert.equal(after.description, 'changed');
    assert.equal(after.name, before.name);
  });

  it('a stale ETag is 412 and a missing If-Match is 428', async () => {
    await expectStaleEtagRefused(category);
    await expectMissingIfMatchRefused(category);
  });

  it('PUT is exposed: the current ETag applies it, none or * is 428, a stale one is 412', async () => {
    await expectPutWithEtag(category, { description: 'put' }, { name: 'stale put must not land' });
  });

  it('active is the one writable switch: deactivating a category reads back active=false', async () => {
    const { etag } = await readWithEtag(`product-category/${category.id}`);
    const res = await api('PATCH', `product-category/${category.id}`, {
      body: resource('product-category', { active: false }, undefined, category.id), headers: { 'If-Match': etag },
    });
    expectStatus(res, 200);
    const { res: reread } = await readWithEtag(`product-category/${category.id}`);
    assert.equal(reread.json.data.attributes.active, false);
  });

  it('refuses an attribute that is not published: 400', async () => {
    const error = expectErrorDocument(await api('POST', 'product-category', {
      body: resource('product-category', { search_key: 'x', name: 'x', no_such_field: 1 }),
    }), 400);
    assert.match(error.detail, /no_such_field/);
  });

  it('deletes the category and it answers 404 afterwards', async () => {
    await expectDeleted(category);
  });
});

// product/{id}/costing is read-only (GET and LIST). A product created by the suite has no cost yet.
describe('product costing (read-only child of product)', () => {
  let productId = '';

  it('lists the costing of a product: an empty page for a new product, with the page envelope', async () => {
    productId = (await createProduct('costing')).id;
    const res = await api('GET', `product/${productId}/costing`);
    expectStatus(res, 200);
    assert.ok(Array.isArray(res.json.data), 'data is an array');
    assert.equal(res.json.meta.page.total, res.json.data.length, 'meta.page.total counts the records');
    assert.match(res.json.links.self, new RegExp(`^/api/v1/product/${productId}/costing`), 'links.self is the child collection');
  });

  it('reads one costing record of an existing product when the tenant has one, and 404 for an unknown id', async (t) => {
    expectErrorDocument(await api('GET', `product/${productId}/costing/${MISSING_ID}`), 404);
    const products = await api('GET', 'product?page[size]=10');
    expectStatus(products, 200);
    for (const product of products.json.data as Array<{ id: string }>) {
      const list = await api('GET', `product/${product.id}/costing?page[size]=5`);
      expectStatus(list, 200);
      const first = list.json.data[0];
      if (!first) continue;
      const one = await api('GET', `product/${product.id}/costing/${first.id}`);
      expectStatus(one, 200);
      assert.equal(one.json.data.type, 'product-costing');
      assert.equal(typeof one.json.data.attributes.cost, 'number', 'cost is a number');
      assert.match(one.json.data.attributes.starting_date, /^\d{4}-\d{2}-\d{2}$/, 'starting_date is a date');
      return;
    }
    t.skip('no product among the first 10 of the tenant has a costing record: only the empty list was checked');
  });

  it('is read-only: POST, PATCH, PUT and DELETE answer 404 Operation not exposed, and it is not a top-level resource', async () => {
    const base = `product/${productId}/costing`;
    const body = resource('product-costing', { cost: 1 });
    for (const [method, path] of [['POST', base], ['PATCH', `${base}/${MISSING_ID}`], ['PUT', `${base}/${MISSING_ID}`], ['DELETE', `${base}/${MISSING_ID}`]] as const) {
      const error = expectErrorDocument(await api(method, path, { body: method === 'DELETE' ? undefined : body, headers: method === 'PATCH' || method === 'PUT' ? { 'If-Match': '"x"' } : {} }), 404);
      assert.match(error.detail, /not exposed/i, `${method} ${path}`);
    }
    expectErrorDocument(await api('GET', 'product-costing'), 404);
  });
});
