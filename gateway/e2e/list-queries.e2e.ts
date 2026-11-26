// @covers gateway/src/public-api/public-api.controller.ts
// List queries (docs/public-api.md 4.10): pagination, links, the page[size] limit, sort and the
// filter operators. The suite creates three product categories of its own and scopes every query to
// them with `filter[description][contains]=<RUN_PREFIX>`, so totals and orders are exact whatever else
// the tenant holds. Conversion rates (read-only, published for everyone) cover number operators.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RUN_PREFIX } from './support/env.ts';
import { api, expectErrorDocument, expectStatus } from './support/client.ts';
import { cleanupCreated } from './support/cleanup.ts';
import { createProductCategory } from './support/fixtures.ts';

after(cleanupCreated);

// The scope uses `description`, a field no test below filters on: two filters on one field collide
// (one value per filter parameter; the shorthand and an operator on one field are parsed together).
const SCOPE = `filter[description][contains]=${RUN_PREFIX}`;
const LABELS = ['pg-a', 'pg-b', 'pg-c'];
const keyOf = (label: string) => `${RUN_PREFIX}-${label}`;

/** Asserts a 400 invalid_query_parameter whose source.parameter names `parameter` (when given). */
async function expectInvalidQuery(query: string, parameter?: string, resource = 'product-category'): Promise<void> {
  const error = expectErrorDocument(await api('GET', `${resource}?${query}`), 400, 'invalid_query_parameter');
  assert.ok(error.source?.parameter, `source.parameter names the offending parameter of ${query}`);
  if (parameter) assert.equal(error.source.parameter, parameter, `source.parameter of ${query}`);
}

const decoded = (url: string | null) => (url === null ? null : decodeURIComponent(url));
const searchKeys = (res: { json: any }): string[] => (res.json.data as any[]).map((r) => r.attributes.search_key);

describe('list queries on product-category', () => {
  const ids = new Map<string, string>();

  before(async () => {
    for (const label of LABELS) ids.set(label, (await createProductCategory(label, { description: `${RUN_PREFIX}-scope` })).id);
  });

  describe('pagination', () => {
    it('page[size]=2 returns the first two of three, with meta.page and links', async () => {
      const res = await api('GET', `product-category?${SCOPE}&sort=search_key&page[size]=2`);
      expectStatus(res, 200);
      assert.deepEqual(searchKeys(res), [keyOf('pg-a'), keyOf('pg-b')]);
      assert.deepEqual(res.json.meta.page, { number: 1, size: 2, total: 3 });
      const links = Object.fromEntries(Object.entries(res.json.links).map(([name, url]) => [name, decoded(url as string | null)])) as Record<string, string | null> & { self: string; first: string; next: string; last: string };
      assert.match(links.self, /^\/api\/v1\/product-category\?/, 'links are root-relative');
      assert.ok(links.self.includes('page[number]=1') && links.self.includes('page[size]=2'), 'page[size] is always explicit in links');
      assert.ok(links.self.includes(RUN_PREFIX) && links.self.includes('sort=search_key'), 'links keep the client filter and sort');
      assert.equal(links.first, links.self);
      assert.equal(links.prev, null, 'no previous page on the first page');
      assert.ok(links.next.includes('page[number]=2'), 'next points at page 2');
      assert.ok(links.last.includes('page[number]=2'), 'last points at the last page');
    });

    it('page[number]=2 returns the rest, prev is page 1 and next is null; following next reaches the same page', async () => {
      const res = await api('GET', `product-category?${SCOPE}&sort=search_key&page[size]=2&page[number]=2`);
      expectStatus(res, 200);
      assert.deepEqual(searchKeys(res), [keyOf('pg-c')]);
      assert.deepEqual(res.json.meta.page, { number: 2, size: 2, total: 3 });
      assert.ok(decoded(res.json.links.prev)!.includes('page[number]=1'));
      assert.equal(res.json.links.next, null, 'no next page on the last page');

      const first = await api('GET', `product-category?${SCOPE}&sort=search_key&page[size]=2`);
      const followed = await api('GET', first.json.links.next);
      expectStatus(followed, 200);
      assert.deepEqual(searchKeys(followed), [keyOf('pg-c')], 'links.next is a usable URL');
    });

    it('pages do not overlap and together hold every record once', async () => {
      const seen: string[] = [];
      for (const number of [1, 2, 3]) {
        const res = await api('GET', `product-category?${SCOPE}&sort=search_key&page[size]=1&page[number]=${number}`);
        expectStatus(res, 200);
        assert.equal(res.json.data.length, 1);
        seen.push(res.json.data[0].id);
      }
      assert.deepEqual(new Set(seen).size, 3, 'three distinct records');
      assert.deepEqual(new Set(seen), new Set(ids.values()));
    });

    // docs 4.10: `meta.page.total` is the exact number of matching records. Suspected bug when this fails:
    // without `_noCount=false` core skips the count and answers "rows shown + offset (+1 when the page is
    // full)", a grid scroll hint (DefaultJsonDataService.fetch, preventCountOperation), and the REST path
    // never sends `_noCount=false` (only the MCP list does, McpToolRouter). A 3-record set read with
    // page[size]=2 happens to give 3 that way, so only a page size that does not coincide shows it.
    it('meta.page.total is the real count of matches on any page size, and links.last points at the last page', async () => {
      const res = await api('GET', `product-category?${SCOPE}&sort=search_key&page[size]=1`);
      expectStatus(res, 200);
      assert.equal(res.json.meta.page.total, 3, 'three records match, whatever the page size');
      assert.ok(decoded(res.json.links.last)!.includes('page[number]=3'), 'links.last is page 3');
      const filtered = await api('GET', `product-category?${SCOPE}&filter[search_key][ne]=${keyOf('pg-a')}&page[size]=1`);
      expectStatus(filtered, 200);
      assert.equal(filtered.json.meta.page.total, 2);
    });

    it('a page beyond the last answers 200 with an empty page, the real total and a prev that points at the last page', async () => {
      const res = await api('GET', `product-category?${SCOPE}&sort=search_key&page[size]=2&page[number]=9`);
      expectStatus(res, 200);
      assert.deepEqual(res.json.data, []);
      assert.equal(res.json.meta.page.total, 3);
      assert.ok(decoded(res.json.links.prev)!.includes('page[number]=2'), 'prev points at the last page');
      assert.equal(res.json.links.next, null);
    });

    it('page[size]=100 is the maximum accepted; 101, 0 and non-numbers are 400 invalid_query_parameter', async () => {
      const ok = await api('GET', `product-category?${SCOPE}&page[size]=100`);
      expectStatus(ok, 200);
      assert.equal(ok.json.meta.page.size, 100);
      assert.ok(ok.json.data.length <= 100);
      await expectInvalidQuery(`${SCOPE}&page[size]=101`, 'page[size]');
      await expectInvalidQuery(`${SCOPE}&page[size]=0`, 'page[size]');
      await expectInvalidQuery(`${SCOPE}&page[size]=abc`, 'page[size]');
    });

    it('page[number] below 1 or not a number is 400', async () => {
      await expectInvalidQuery(`${SCOPE}&page[number]=0`, 'page[number]');
      await expectInvalidQuery(`${SCOPE}&page[number]=-1`, 'page[number]');
      await expectInvalidQuery(`${SCOPE}&page[number]=x`, 'page[number]');
    });

    it('the default page size is 50', async () => {
      const res = await api('GET', `product-category?${SCOPE}`);
      expectStatus(res, 200);
      assert.equal(res.json.meta.page.size, 50);
      assert.equal(res.json.meta.page.number, 1);
    });

    it('an unknown query parameter is refused instead of ignored', async () => {
      await expectInvalidQuery('page[offset]=1', 'page[offset]');
      await expectInvalidQuery('limit=5', 'limit');
    });
  });

  describe('sort', () => {
    it('sort=search_key is ascending and sort=-search_key is descending', async () => {
      const asc = await api('GET', `product-category?${SCOPE}&sort=search_key`);
      expectStatus(asc, 200);
      assert.deepEqual(searchKeys(asc), LABELS.map(keyOf));
      const desc = await api('GET', `product-category?${SCOPE}&sort=-search_key`);
      expectStatus(desc, 200);
      assert.deepEqual(searchKeys(desc), [...LABELS].reverse().map(keyOf));
    });

    it('sorts by several fields: the second breaks the ties of the first', async () => {
      const res = await api('GET', `product-category?${SCOPE}&sort=default,-search_key`);
      expectStatus(res, 200);
      assert.deepEqual(searchKeys(res), [...LABELS].reverse().map(keyOf), 'all share default=false, so -search_key decides');
    });

    it('an unknown sort field, a repeated one and more than five are 400 invalid_query_parameter', async () => {
      await expectInvalidQuery('sort=no_such_field', 'sort');
      await expectInvalidQuery('sort=name,-name', 'sort');
      await expectInvalidQuery('sort=search_key,name,description,default,active,updated', 'sort');
    });
  });

  describe('filter operators', () => {
    const list = async (query: string) => {
      const res = await api('GET', `product-category?${SCOPE}&sort=search_key&${query}`);
      expectStatus(res, 200);
      return searchKeys(res);
    };

    it('equals: filter[field]=v and filter[field][eq]=v are the same', async () => {
      assert.deepEqual(await list(`filter[search_key]=${keyOf('pg-b')}`), [keyOf('pg-b')]);
      assert.deepEqual(await list(`filter[search_key][eq]=${keyOf('pg-b')}`), [keyOf('pg-b')]);
    });

    it('ne excludes the value', async () => {
      assert.deepEqual(await list(`filter[search_key][ne]=${keyOf('pg-b')}`), [keyOf('pg-a'), keyOf('pg-c')]);
    });

    it('contains is a case-insensitive substring', async () => {
      assert.deepEqual(await list('filter[search_key][contains]=PG-B'), [keyOf('pg-b')], 'upper case matches');
      assert.deepEqual(await list('filter[name][contains]=pg-'), LABELS.map(keyOf));
      assert.deepEqual(await list('filter[name][contains]=no-such-text-anywhere'), []);
    });

    it('in takes a comma-separated list', async () => {
      assert.deepEqual(await list(`filter[search_key][in]=${keyOf('pg-a')},${keyOf('pg-c')}`), [keyOf('pg-a'), keyOf('pg-c')]);
    });

    it('boolean fields take eq and ne with true or false', async () => {
      assert.deepEqual(await list('filter[default]=false'), LABELS.map(keyOf));
      assert.deepEqual(await list('filter[default]=true'), []);
      assert.deepEqual(await list('filter[active][ne]=false'), LABELS.map(keyOf));
    });

    it('date-time fields take whole calendar days with gt, gte, lt, lte', async () => {
      assert.deepEqual(await list('filter[updated][gte]=2000-01-01'), LABELS.map(keyOf));
      assert.deepEqual(await list('filter[updated][lt]=2999-01-01'), LABELS.map(keyOf));
      assert.deepEqual(await list('filter[updated][lt]=2000-01-01'), []);
      assert.deepEqual(await list('filter[updated][gt]=2999-01-01'), []);
    });

    it('several filters combine with AND', async () => {
      assert.deepEqual(await list(`filter[name][contains]=pg-&filter[search_key][ne]=${keyOf('pg-a')}&filter[default]=false`), [keyOf('pg-b'), keyOf('pg-c')]);
    });

    it('meta.page.total counts the records that match the filters, not the page', async () => {
      const res = await api('GET', `product-category?${SCOPE}&filter[search_key][ne]=${keyOf('pg-a')}&page[size]=1`);
      expectStatus(res, 200);
      assert.equal(res.json.data.length, 1);
      assert.equal(res.json.meta.page.total, 2);
    });

    it('refuses with 400 invalid_query_parameter: unknown field, unknown operator, operator not valid for the type, bad values, a repeated parameter', async () => {
      await expectInvalidQuery('filter[no_such_field]=x', 'filter[no_such_field]');
      await expectInvalidQuery(`${SCOPE}&filter[name][like]=x`);
      await expectInvalidQuery(`${SCOPE}&filter[name][gt]=x`); // string: eq, ne, contains, in
      await expectInvalidQuery(`${SCOPE}&filter[default][contains]=x`); // boolean: eq, ne
      await expectInvalidQuery(`${SCOPE}&filter[default]=maybe`);
      await expectInvalidQuery(`${SCOPE}&filter[updated][gte]=2026-02-30`); // a day that does not exist
      await expectInvalidQuery(`${SCOPE}&filter[updated][gte]=2026-10-01T10:00:00Z`); // a timestamp, not a day
      await expectInvalidQuery(`${SCOPE}&filter[name]=a&filter[name]=b`); // repeated: use `in`
      await expectInvalidQuery(`${SCOPE}&filter[name]=a&filter[name][contains]=b`); // the shorthand and an operator on one field (the message of this one is confusing: it names the value as an operator)
      await expectInvalidQuery(`${SCOPE}&filter[name][in]=a,,b`); // empty member
      await expectInvalidQuery(`${SCOPE}&filter[name][contains]=`); // empty value
    });

    it('more than 20 filters are refused', async () => {
      const many = Array.from({ length: 21 }, (_, i) => `filter[name][ne]=x${i}`).join('&');
      await expectInvalidQuery(many);
    });
  });
});

describe('number filters on conversion-rates (read-only reference data)', () => {
  it('gt and lte on multiple_rate_by return only matching rows and partition the non-null rows', async (t) => {
    const all = await api('GET', 'conversion-rates?page[size]=100');
    expectStatus(all, 200);
    if (all.json.meta.page.total > 100) return t.skip('more than 100 conversion rates: the first page is not the whole set');
    const rates = (all.json.data as any[]).map((r) => r.attributes.multiple_rate_by).filter((v) => v !== null && v !== undefined).map(Number);
    if (rates.length < 2) return t.skip('fewer than two conversion rates with a value on this tenant: nothing to partition; string, boolean and date operators are covered above');
    const pivot = [...rates].sort((a, b) => a - b)[Math.floor(rates.length / 2)];
    const above = await api('GET', `conversion-rates?filter[multiple_rate_by][gt]=${pivot}&page[size]=100`);
    expectStatus(above, 200);
    for (const row of above.json.data) assert.ok(Number(row.attributes.multiple_rate_by) > pivot, `${row.attributes.multiple_rate_by} > ${pivot}`);
    const upTo = await api('GET', `conversion-rates?filter[multiple_rate_by][lte]=${pivot}&page[size]=100`);
    expectStatus(upTo, 200);
    for (const row of upTo.json.data) assert.ok(Number(row.attributes.multiple_rate_by) <= pivot, `${row.attributes.multiple_rate_by} <= ${pivot}`);
    assert.equal(above.json.meta.page.total + upTo.json.meta.page.total, rates.length, 'gt and lte partition the rows that have a value');
  });

  it('a number operator takes a decimal with a point and refuses an exponent or NaN', async () => {
    await expectInvalidQuery('filter[multiple_rate_by][gt]=1e3', 'filter[multiple_rate_by][gt]', 'conversion-rates');
    await expectInvalidQuery('filter[multiple_rate_by][gt]=NaN', 'filter[multiple_rate_by][gt]', 'conversion-rates');
    expectStatus(await api('GET', 'conversion-rates?filter[multiple_rate_by][gt]=-12.5'), 200);
  });
});
