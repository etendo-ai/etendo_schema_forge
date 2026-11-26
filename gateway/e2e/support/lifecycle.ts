// @covers gateway/src/public-api/public-api.controller.ts
// The shared versioned-record lifecycle: read, list, PATCH with If-Match, stale
// ETag (412), missing If-Match (428), delete and 404 afterwards.
import assert from 'node:assert/strict';
import { api, expectErrorDocument, expectStatus, resource, type ApiResponse } from './client.ts';

export interface LifecycleSpec {
  /** Collection path, e.g. `contacts` or `sales-order/<id>/lines`. */
  collection: string;
  /** Public resource type of the records, e.g. `contacts`. */
  type: string;
  id: string;
  /** Two distinct single-field changes, applied one after the other. */
  firstPatch: Record<string, unknown>;
  secondPatch: Record<string, unknown>;
  /** Filled by expectPatchWithEtag: the version before the first PATCH. */
  staleEtag?: string;
}

export const itemPath = (spec: Pick<LifecycleSpec, 'collection' | 'id'>) => `${spec.collection}/${spec.id}`;

export async function readWithEtag(path: string): Promise<{ res: ApiResponse; etag: string }> {
  const res = await api('GET', path);
  expectStatus(res, 200);
  const etag = res.headers.get('etag');
  assert.ok(etag, `GET ${path} carries no ETag header`);
  assert.equal(res.json.data.meta?.etag, etag, 'meta.etag equals the ETag header');
  return { res, etag };
}

export async function patch(spec: LifecycleSpec, attributes: Record<string, unknown>, ifMatch?: string): Promise<ApiResponse> {
  return api('PATCH', itemPath(spec), {
    body: resource(spec.type, attributes, undefined, spec.id),
    headers: ifMatch === undefined ? {} : { 'If-Match': ifMatch },
  });
}

/** The listing of the collection filtered by id finds the record. */
export async function expectListed(spec: Pick<LifecycleSpec, 'collection' | 'id'>): Promise<void> {
  const res = await api('GET', `${spec.collection}?filter[id]=${encodeURIComponent(spec.id)}`);
  expectStatus(res, 200);
  assert.ok(Array.isArray(res.json.data), 'list data is an array');
  assert.ok(res.json.data.some((r: any) => r.id === spec.id), `${spec.id} not found in list of ${spec.collection}`);
}

export async function expectPatchWithEtag(spec: LifecycleSpec): Promise<void> {
  const { etag } = await readWithEtag(itemPath(spec));
  const res = await patch(spec, spec.firstPatch, etag);
  expectStatus(res, 200);
  const [field, value] = Object.entries(spec.firstPatch)[0];
  assert.equal(String(res.json.data.attributes[field]), String(value), `PATCH response reflects ${field}`);
  assert.ok(res.headers.get('etag'), 'PATCH response carries the new ETag');
  assert.notEqual(res.headers.get('etag'), etag, 'the version changed');
  spec.staleEtag = etag; // kept for the 412 test
}

/**
 * PUT is published next to PATCH on every writable resource (the manifest lists it in `operations`)
 * and follows the same If-Match rules (docs/public-api.md 4.2, 4.5): the current ETag applies the
 * write and answers a new ETag, none or `*` is 428, a stale one is 412 and changes nothing.
 * The OpenAPI lists the required fields on PUT bodies, so `requiredFields` are sent too (omitted fields
 * are kept, as with PATCH; the server does not reject their omission today, see docs 4.2).
 * Needs `staleEtag` (set by expectPatchWithEtag) for the 412 check.
 */
export async function expectPutWithEtag(
  spec: LifecycleSpec,
  changed: Record<string, unknown>,
  staleChanged: Record<string, unknown>,
  /** Attributes the OpenAPI lists as `required` on the PUT body of this resource: sent with their current value. */
  requiredFields: string[] = [],
): Promise<void> {
  const current = (await readWithEtag(itemPath(spec))).res.json.data.attributes;
  const carried = Object.fromEntries(requiredFields.map((field) => [field, current[field]]));
  const attributes = changed;
  const staleAttributes = staleChanged;
  const put = (attrs: Record<string, unknown>, ifMatch?: string) => api('PUT', itemPath(spec), {
    body: resource(spec.type, { ...carried, ...attrs }, undefined, spec.id),
    headers: ifMatch === undefined ? {} : { 'If-Match': ifMatch },
  });
  expectErrorDocument(await put(attributes), 428);
  expectErrorDocument(await put(attributes, '*'), 428);

  const { etag } = await readWithEtag(itemPath(spec));
  const res = await put(attributes, etag);
  expectStatus(res, 200);
  const [field, value] = Object.entries(attributes)[0];
  assert.equal(String(res.json.data.attributes[field]), String(value), `PUT response reflects ${field}`);
  const newEtag = res.headers.get('etag');
  assert.ok(newEtag, 'PUT response carries the new ETag');
  assert.notEqual(newEtag, etag, 'the version changed');
  assert.equal(res.json.data.meta?.etag, newEtag, 'meta.etag equals the ETag header');

  if (spec.staleEtag) {
    expectErrorDocument(await put(staleAttributes, spec.staleEtag), 412);
    const { res: reread } = await readWithEtag(itemPath(spec));
    const [staleField, staleValue] = Object.entries(staleAttributes)[0];
    assert.notEqual(String(reread.json.data.attributes[staleField]), String(staleValue), 'a refused PUT leaves the record unchanged');
  }
}

export async function expectStaleEtagRefused(spec: LifecycleSpec): Promise<void> {
  const stale = spec.staleEtag;
  assert.ok(stale, 'the PATCH-with-ETag test must run first');
  const res = await patch(spec, spec.secondPatch, stale);
  expectErrorDocument(res, 412);
  const { res: reread } = await readWithEtag(itemPath(spec));
  const [field, value] = Object.entries(spec.secondPatch)[0];
  assert.notEqual(String(reread.json.data.attributes[field]), String(value), 'a refused write leaves the record unchanged');
}

export async function expectMissingIfMatchRefused(spec: LifecycleSpec): Promise<void> {
  expectErrorDocument(await patch(spec, spec.secondPatch), 428);
  expectErrorDocument(await patch(spec, spec.secondPatch, '*'), 428);
}

export async function expectDeleted(spec: Pick<LifecycleSpec, 'collection' | 'id'>): Promise<void> {
  const del = await api('DELETE', itemPath(spec));
  expectStatus(del, 204);
  assert.equal(del.text, '', 'DELETE answers an empty body');
  expectErrorDocument(await api('GET', itemPath(spec)), 404);
}
