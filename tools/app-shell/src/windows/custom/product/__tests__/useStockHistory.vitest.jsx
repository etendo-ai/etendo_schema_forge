/** @covers tools/app-shell/src/windows/custom/product/useStockHistory.js */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useStockHistory, loadMovementHistory, historyWindowStart, buildHistoryPageQuery,
  HISTORY_PAGE_SIZE, HISTORY_MAX_PAGES, READ_RETRY_DELAY_MS,
} from '../useStockHistory';

const rows = (n) => Array.from({ length: n }, (_, i) => ({ movementDate: '2026-10-28', movementQuantity: 1, id: i }));
const ok = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve({ response: { data } }) });

function pagedFetch(pages) {
  let call = 0;
  return vi.fn((path) => {
    if (path.startsWith('/stock')) return ok([{ quantityOnHand: 1 }]);
    return ok(pages[call++] ?? []);
  });
}
const txCalls = (fn) => fn.mock.calls.map(c => c[0]).filter(p => p.startsWith('/transactions'));

const RETRY_WAIT = { timeout: READ_RETRY_DELAY_MS + 3000 };

afterEach(() => vi.useRealTimers());

describe('buildHistoryPageQuery', () => {
  it('sorts newest-first and filters on the window start', () => {
    const q = buildHistoryPageQuery('P1', new Date(2025, 10, 3), 500);
    const params = new URL(q, 'http://x').searchParams;
    expect(params.get('parentId')).toBe('P1');
    expect(params.get('_sortBy')).toMatch(/^-transactionProcessDate/);
    expect(params.get('_startRow')).toBe('500');
    expect(params.get('_endRow')).toBe('999');
    expect(JSON.parse(params.get('criteria'))).toEqual([{ fieldName: 'transactionProcessDate', operator: 'greaterOrEqual', value: '2025-11-03' }]);
  });

  it('the window start is today minus 12 months', () => {
    expect(historyWindowStart(new Date(2026, 10, 3))).toEqual(new Date(2025, 10, 3));
  });
});

describe('loadMovementHistory', () => {
  const start = new Date(2025, 10, 3);
  it('stops after one short page', async () => {
    const f = pagedFetch([rows(120)]);
    const r = await loadMovementHistory(f, 'P', start);
    expect(r.rows).toHaveLength(120);
    expect(r.partial).toBe(false);
    expect(txCalls(f)).toHaveLength(1);
  });

  it('reads an empty page after exactly 500 rows (never trusts totalRows)', async () => {
    const f = pagedFetch([rows(HISTORY_PAGE_SIZE), []]);
    const r = await loadMovementHistory(f, 'P', start);
    expect(r.rows).toHaveLength(500);
    expect(txCalls(f)).toHaveLength(2);
    expect(r.partial).toBe(false);
  });

  it('reads two pages', async () => {
    const f = pagedFetch([rows(500), rows(21)]);
    const r = await loadMovementHistory(f, 'P', start);
    expect(r.rows).toHaveLength(521);
    expect(txCalls(f)[1]).toContain('_startRow=500');
  });

  it('flags partial when the safety cap is reached', async () => {
    const f = pagedFetch(Array.from({ length: 20 }, () => rows(500)));
    const r = await loadMovementHistory(f, 'P', start);
    expect(txCalls(f)).toHaveLength(HISTORY_MAX_PAGES);
    expect(r.rows).toHaveLength(HISTORY_MAX_PAGES * 500);
    expect(r.partial).toBe(true);
  });

  it('keeps what was loaded when a later page fails', async () => {
    let n = 0;
    const f = vi.fn(() => (n++ === 0 ? ok(rows(500)) : Promise.resolve({ ok: false })));
    const r = await loadMovementHistory(f, 'P', start);
    expect(r.rows).toHaveLength(500);
    expect(r.failed).toBe(false);
  });

  it('reports failed when the first page fails', async () => {
    const f = vi.fn(() => Promise.resolve({ ok: false }));
    const r = await loadMovementHistory(f, 'P', start);
    expect(r).toEqual({ rows: [], partial: false, failed: true });
  });
});

describe('useStockHistory', () => {
  it('fires /stock and the first /transactions page once per mount, even when apiFetch changes identity', async () => {
    const f = pagedFetch([rows(3)]);
    const { result, rerender } = renderHook(({ fetcher }) => useStockHistory('P1', fetcher), { initialProps: { fetcher: f } });
    rerender({ fetcher: (...a) => f(...a) });
    rerender({ fetcher: (...a) => f(...a) });
    await waitFor(() => expect(result.current.transactions).toHaveLength(3));
    expect(f.mock.calls.filter(c => c[0].startsWith('/stock'))).toHaveLength(1);
    expect(txCalls(f)).toHaveLength(1);
    expect(result.current.stockRows).toHaveLength(1);
    expect(result.current.partial).toBe(false);
  });

  it('flags failed reads instead of reporting an empty stock when requests reject', async () => {
    const f = vi.fn(() => Promise.reject(new Error('boom')));
    const { result } = renderHook(() => useStockHistory('P1', f));
    await waitFor(() => expect(result.current.historyFailed).toBe(true), RETRY_WAIT);
    await waitFor(() => expect(result.current.stockFailed).toBe(true), RETRY_WAIT);
    expect(result.current.transactions).toEqual([]);
    expect(result.current.stockRows).toBeNull();
  });

  it('flags a non-ok stock response as failed, not as empty', async () => {
    const f = vi.fn((path) => (path.startsWith('/stock') ? Promise.resolve({ ok: false, status: 500 }) : ok([])));
    const { result } = renderHook(() => useStockHistory('P1', f));
    await waitFor(() => expect(result.current.stockFailed).toBe(true), RETRY_WAIT);
    await waitFor(() => expect(result.current.transactions).toEqual([]));
    expect(result.current.stockRows).toBeNull();
    expect(result.current.historyFailed).toBe(false);
  });

  it('keeps stockRows [] with no failure flags for a legitimately empty product', async () => {
    const f = vi.fn(() => ok([]));
    const { result } = renderHook(() => useStockHistory('P1', f));
    await waitFor(() => expect(result.current.transactions).toEqual([]));
    await waitFor(() => expect(result.current.stockRows).toEqual([]));
    expect(result.current.stockFailed).toBe(false);
    expect(result.current.historyFailed).toBe(false);
  });

  it('aborts the in-flight read on unmount and does not update state', async () => {
    const signals = [];
    const f = vi.fn((path, opts) => { signals.push(opts.signal); return new Promise(() => {}); });
    const { unmount } = renderHook(() => useStockHistory('P1', f));
    unmount();
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every(s => s.aborted)).toBe(true);
  });

  describe('one retry of a failed read', () => {
    const stockPath = (p) => p.startsWith('/stock');
    const failOnce = (matches, failure) => {
      let failed = false;
      return vi.fn((path) => {
        if (matches(path) && !failed) { failed = true; return failure(); }
        return stockPath(path) ? ok([{ quantityOnHand: 1 }]) : ok(rows(2));
      });
    };

    it('recovers when the first /stock read is cut off: stock shown, no failure flag, one retry request', async () => {
      const f = failOnce(stockPath, () => Promise.reject(new TypeError('Failed to fetch')));
      const { result } = renderHook(() => useStockHistory('P1', f));
      await waitFor(() => expect(result.current.stockRows).toHaveLength(1), RETRY_WAIT);
      await waitFor(() => expect(result.current.transactions).toHaveLength(2));
      expect(result.current.stockFailed).toBe(false);
      expect(result.current.historyFailed).toBe(false);
      expect(f.mock.calls.filter(c => stockPath(c[0]))).toHaveLength(2);
    });

    it('recovers from a first non-ok /stock answer', async () => {
      const f = failOnce(stockPath, () => Promise.resolve({ ok: false, status: 502 }));
      const { result } = renderHook(() => useStockHistory('P1', f));
      await waitFor(() => expect(result.current.stockRows).toHaveLength(1), RETRY_WAIT);
      expect(result.current.stockFailed).toBe(false);
    });

    it('recovers when the first history page fails once', async () => {
      const f = failOnce(p => !stockPath(p), () => Promise.resolve({ ok: false, status: 500 }));
      const { result } = renderHook(() => useStockHistory('P1', f));
      await waitFor(() => expect(result.current.transactions).toHaveLength(2), RETRY_WAIT);
      expect(result.current.historyFailed).toBe(false);
      expect(txCalls(f)).toHaveLength(2);
    });

    it('retries a persistent failure exactly once, then shows the failure', async () => {
      const f = vi.fn((path) => (stockPath(path) ? Promise.resolve({ ok: false, status: 500 }) : ok([])));
      const { result } = renderHook(() => useStockHistory('P1', f));
      await waitFor(() => expect(result.current.stockFailed).toBe(true), RETRY_WAIT);
      expect(f.mock.calls.filter(c => stockPath(c[0]))).toHaveLength(2);
    });

    it('does not retry a read that was aborted (record change / unmount)', async () => {
      vi.useFakeTimers();
      const f = vi.fn((path, opts) => new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
      const { unmount } = renderHook(() => useStockHistory('P1', f));
      const first = f.mock.calls.length;
      unmount();
      await vi.advanceTimersByTimeAsync(READ_RETRY_DELAY_MS * 3);
      expect(f.mock.calls.length).toBe(first);
    });

    it('a record change mid-retry drops the old product and reads the new one once', async () => {
      const calls = [];
      const f = vi.fn((path) => {
        calls.push(path);
        if (path.includes('parentId=P1') && stockPath(path)) return Promise.resolve({ ok: false, status: 500 });
        return stockPath(path) ? ok([{ quantityOnHand: 7 }]) : ok([]);
      });
      const { result, rerender } = renderHook(({ id }) => useStockHistory(id, f), { initialProps: { id: 'P1' } });
      await waitFor(() => expect(f).toHaveBeenCalled());
      rerender({ id: 'P2' });
      await waitFor(() => expect(result.current.stockRows).toEqual([{ quantityOnHand: 7 }]), RETRY_WAIT);
      await new Promise(r => setTimeout(r, READ_RETRY_DELAY_MS + 200));
      expect(calls.filter(p => stockPath(p) && p.includes('P1'))).toHaveLength(1);
      expect(result.current.stockFailed).toBe(false);
    });
  });
});
