// @covers gateway/src/public-api/public-api.controller.ts
// Atomic cleanup of the e2e suite. Every record a POST created is registered by api() itself
// (support/client.ts) the moment the server answers, before any assertion can throw, so the
// cleanup below also covers a test that fails half way.
//
//   after(cleanupCreated)            file level safety net: removes whatever is still registered
//   await scoped(async () => {...})  test level: removes what the body created, in a finally
//   keepAsLeftover(path, reason)     a record the API cannot delete (a completed document)
//
// Etendo cannot delete a completed document or a record a document references (409/422), and the
// public API publishes no void/close action and a writable `active` only on product-category. What
// cannot be removed is deactivated when the API allows it and otherwise reported as "left behind";
// every such record carries RUN_PREFIX (`e2e-...`) in its name or search key.
import { api, created } from './client.ts';
import { RUN_PREFIX } from './env.ts';

export interface LeftBehind { path: string; reason: string }

const leftBehind: LeftBehind[] = [];
// Flagged, never spliced out of `created`: scoped() works with indices into that array.
const kept = new Set<string>();
const deactivated: string[] = [];
const MAX_PASSES = 3;

/** Declares a record the API cannot delete (e.g. a completed order) so no delete is attempted on it. */
export function keepAsLeftover(path: string, reason: string): void {
  kept.add(path);
  leftBehind.push({ path, reason });
}

async function tryDelete(path: string): Promise<{ done: boolean; status: number | string }> {
  try {
    const res = await api('DELETE', path, { skipConformance: true });
    return { done: res.status === 204 || res.status === 404, status: res.status };
  } catch (error) {
    return { done: false, status: (error as Error).message };
  }
}

/** Last resort for a top-level record that cannot be deleted: PATCH `active: false` when the resource publishes it. */
async function tryDeactivate(path: string): Promise<boolean> {
  if (path.split('/').length !== 2) return false; // children are not deactivated on their own
  try {
    const read = await api('GET', path, { skipConformance: true });
    const etag = read.headers.get('etag');
    if (read.status !== 200 || !etag || read.json?.data?.attributes?.active !== true) return false;
    const res = await api('PATCH', path, {
      skipConformance: true,
      headers: { 'If-Match': etag },
      body: { data: { type: read.json.data.type, id: read.json.data.id, attributes: { active: false } } },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Deletes the records registered after `mark`, newest first (children before parents). A record
 * still referenced by another is retried in later passes; what is left is deactivated if possible
 * or added to the left-behind report. Never throws.
 */
export async function cleanupFrom(mark: number): Promise<void> {
  let pending = created.splice(mark).reverse().filter((path) => !kept.has(path));
  const lastStatus = new Map<string, number | string>();
  for (let pass = 0; pass < MAX_PASSES && pending.length; pass += 1) {
    const next: string[] = [];
    for (const path of pending) {
      const result = await tryDelete(path);
      if (!result.done) {
        next.push(path);
        lastStatus.set(path, result.status);
      }
    }
    const progressed = next.length < pending.length;
    pending = next;
    if (!progressed && pass > 0) break; // nothing else became deletable
  }
  for (const path of pending) {
    if (await tryDeactivate(path)) deactivated.push(path);
    else leftBehind.push({ path, reason: `DELETE answered ${lastStatus.get(path)}` });
  }
}

/** File-level hook: `after(cleanupCreated)`. Removes everything still registered and prints the report. */
export async function cleanupCreated(): Promise<void> {
  await cleanupFrom(0);
  reportLeftBehind();
}

/**
 * Test-level atomicity: runs `body` and removes the records it created in a finally, whether it
 * passed or threw. Records created before the call (shared fixtures) are untouched.
 */
export async function scoped<T>(body: () => Promise<T>): Promise<T> {
  const mark = created.length;
  try {
    return await body();
  } finally {
    await cleanupFrom(mark);
  }
}

export function leftBehindReport(): { leftBehind: LeftBehind[]; deactivated: string[] } {
  return { leftBehind: [...leftBehind], deactivated: [...deactivated] };
}

/** Prints the short "left behind" report to stderr and clears it. Prints nothing when the run left nothing. */
export function reportLeftBehind(): void {
  if (!leftBehind.length && !deactivated.length) return;
  const lines = [`[public-api e2e] left behind by run ${RUN_PREFIX} (all carry the prefix; a completed document cannot be deleted in Etendo):`];
  for (const item of leftBehind.splice(0)) lines.push(`  - ${item.path}: ${item.reason}`);
  for (const path of deactivated.splice(0)) lines.push(`  - ${path}: deactivated (active=false), not deleted`);
  console.error(lines.join('\n'));
}
