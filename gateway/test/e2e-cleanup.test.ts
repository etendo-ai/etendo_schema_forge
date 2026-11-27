// @covers gateway/e2e/support/cleanup.ts
// The e2e suite's cleanup machinery, driven by a stubbed global fetch (the e2e client calls it
// directly): newest-first deletion, retry of a referenced record, deactivation, left-behind report
// and the test-level scope. No gateway or backend is needed.
import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.PUBLIC_API_BASE_URL = 'http://localhost:4399';
process.env.PUBLIC_API_KEY = 'etgo-test:secret';

const { created } = await import('../e2e/support/client.ts');
const cleanup = await import('../e2e/support/cleanup.ts');

type Handler = (method: string, path: string, body?: any) => { status: number; json?: unknown; etag?: string };
let handler: Handler;
const calls: string[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  const path = url.pathname.replace('/api/v1/', '');
  const method = init.method ?? 'GET';
  calls.push(`${method} ${path}`);
  const answer = handler(method, path, init.body ? JSON.parse(init.body) : undefined);
  const body = answer.json === undefined ? '' : JSON.stringify(answer.json);
  return new Response(body || null, { status: answer.status, headers: answer.etag ? { etag: answer.etag } : {} });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

beforeEach(() => {
  created.splice(0);
  calls.length = 0;
  cleanup.reportLeftBehind(); // clears the report of the previous test
});

const originalError = console.error;
function captureReport(): string[] {
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { cleanup.reportLeftBehind(); } finally { console.error = originalError; }
  return lines;
}

describe('cleanupFrom', () => {
  test('deletes newest first, so a child goes before its parent', async () => {
    handler = () => ({ status: 204 });
    created.push('sales-order/o1', 'sales-order/o1/lines/l1');
    await cleanup.cleanupFrom(0);
    assert.deepEqual(calls, ['DELETE sales-order/o1/lines/l1', 'DELETE sales-order/o1']);
    assert.deepEqual(created, []);
    assert.deepEqual(cleanup.leftBehindReport().leftBehind, []);
  });

  test('a 404 counts as already gone', async () => {
    handler = () => ({ status: 404 });
    created.push('product/p1');
    await cleanup.cleanupFrom(0);
    assert.deepEqual(cleanup.leftBehindReport().leftBehind, []);
  });

  test('a record refused as still referenced is retried once what references it is gone', async () => {
    const removed = new Set<string>();
    handler = (method, path) => {
      if (path === 'contacts/c1' && !removed.has('product/p1')) return { status: 409 };
      removed.add(path);
      return { status: 204 };
    };
    created.push('product/p1', 'contacts/c1'); // newest first: the contact is attempted first and refused
    await cleanup.cleanupFrom(0);
    assert.deepEqual(calls, ['DELETE contacts/c1', 'DELETE product/p1', 'DELETE contacts/c1']);
    assert.deepEqual(cleanup.leftBehindReport().leftBehind, []);
  });

  test('a record that can never be deleted is reported with the status that refused it, and is not retried forever', async () => {
    handler = () => ({ status: 422 });
    created.push('sales-order/o1');
    await cleanup.cleanupFrom(0);
    const { leftBehind } = cleanup.leftBehindReport();
    assert.deepEqual(leftBehind, [{ path: 'sales-order/o1', reason: 'DELETE answered 422' }]);
    assert.ok(calls.filter((c) => c === 'DELETE sales-order/o1').length <= 3, 'bounded number of passes');
  });

  test('a top-level record that publishes active is deactivated when it cannot be deleted', async () => {
    handler = (method, path, body) => {
      if (method === 'DELETE') return { status: 409 };
      if (method === 'GET') return { status: 200, etag: '"v1"', json: { data: { type: 'product-category', id: 'c1', attributes: { active: true } } } };
      assert.equal(method, 'PATCH');
      assert.deepEqual(body.data.attributes, { active: false });
      return { status: 200, json: { data: { type: 'product-category', id: 'c1', attributes: { active: false } } } };
    };
    created.push('product-category/c1');
    await cleanup.cleanupFrom(0);
    const report = cleanup.leftBehindReport();
    assert.deepEqual(report.deactivated, ['product-category/c1']);
    assert.deepEqual(report.leftBehind, []);
  });

  test('a record without a writable active is left behind, not patched', async () => {
    handler = (method) => (method === 'DELETE' ? { status: 409 } : { status: 200, etag: '"v1"', json: { data: { type: 'product', id: 'p1', attributes: { name: 'x' } } } });
    created.push('product/p1');
    await cleanup.cleanupFrom(0);
    assert.equal(cleanup.leftBehindReport().leftBehind.length, 1);
    assert.ok(!calls.some((c) => c.startsWith('PATCH')), 'nothing was patched');
  });

  test('a network failure does not throw and is reported', async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('socket closed'); }) as typeof fetch;
    try {
      created.push('product/p1');
      await cleanup.cleanupFrom(0);
    } finally { globalThis.fetch = saved; }
    assert.match(cleanup.leftBehindReport().leftBehind[0].reason, /socket closed/);
  });
});

describe('keepAsLeftover', () => {
  test('removes the record from the registry so no DELETE is attempted, and reports it', async () => {
    handler = () => ({ status: 204 });
    created.push('sales-order/o1');
    cleanup.keepAsLeftover('sales-order/o1', 'completed order');
    await cleanup.cleanupFrom(0);
    assert.deepEqual(calls, []);
    const lines = captureReport();
    assert.match(lines.join('\n'), /sales-order\/o1: completed order/);
  });
});

describe('scoped', () => {
  test('removes what the body created and leaves earlier records alone', async () => {
    handler = () => ({ status: 204 });
    created.push('contacts/shared');
    await cleanup.scoped(async () => { created.push('product/p1'); });
    assert.deepEqual(calls, ['DELETE product/p1']);
    assert.deepEqual(created, ['contacts/shared']);
  });

  test('removes what the body created even when it throws, and rethrows', async () => {
    handler = () => ({ status: 204 });
    await assert.rejects(cleanup.scoped(async () => { created.push('product/p1'); throw new Error('assertion failed'); }), /assertion failed/);
    assert.deepEqual(calls, ['DELETE product/p1']);
  });
});

describe('keepAsLeftover inside a scope', () => {
  test('flagging a record created before the scope does not shift the scope mark: what the body created is still removed', async () => {
    handler = () => ({ status: 204 });
    created.push('sales-order/shared');
    await cleanup.scoped(async () => {
      cleanup.keepAsLeftover('sales-order/shared', 'completed order');
      created.push('product/p1');
    });
    assert.deepEqual(calls, ['DELETE product/p1'], 'the scoped record is deleted, the flagged one is not touched');
    await cleanup.cleanupFrom(0);
    assert.deepEqual(calls, ['DELETE product/p1'], 'the file-level cleanup skips the flagged record too');
    assert.deepEqual(created, []);
    assert.match(captureReport().join('\n'), /sales-order\/shared: completed order/);
  });
});

describe('reportLeftBehind', () => {
  test('prints nothing when the run left nothing, and clears the report once printed', async () => {
    assert.deepEqual(captureReport(), []);
    handler = () => ({ status: 422 });
    created.push('sales-order/o1');
    await cleanup.cleanupFrom(0);
    assert.equal(captureReport().length, 1);
    assert.deepEqual(captureReport(), [], 'printing clears the report');
  });
});
