// @covers tools/app-shell/src/lib/lazyWithReload.js
import { Component, Suspense, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import {
  handlePreloadError, installPreloadErrorReload, isChunkLoadError, lazyWithReload,
  reloadOnceForStaleChunk, resetReloadInProgress,
} from '../lazyWithReload.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: vi.fn((k, v) => { data[k] = String(v); }),
    removeItem: vi.fn((k) => { delete data[k]; }),
  };
}

afterEach(() => resetReloadInProgress());

const MARK = 'go:chunk-reload';
const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /assets/OnboardingPage-abc.js');

// Renders the lazy component and returns what it threw/showed.
class Catcher extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? createElement('div', { 'data-testid': 'caught' }, this.state.error.message) : this.props.children; }
}

function renderLazy(Lazy) {
  return render(createElement(Catcher, null, createElement(Suspense, { fallback: 'loading' }, createElement(Lazy))));
}

describe('isChunkLoadError', () => {
  it.each([
    new TypeError('Failed to fetch dynamically imported module: x'),
    new Error('Importing a module script failed.'),
    new Error('error loading dynamically imported module: x'),
    new Error('Unable to preload CSS for /assets/a.css'),
    Object.assign(new Error('boom'), { name: 'ChunkLoadError' }),
  ])('recognizes %s', (error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it('rejects a generic Error', () => {
    expect(isChunkLoadError(new Error('render exploded'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(new TypeError('x is undefined'))).toBe(false);
  });
});

describe('reloadOnceForStaleChunk', () => {
  it('reloads once and marks, then refuses inside the guard window', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk({ storage, reload, now: 1000 })).toBe(true);
    expect(reloadOnceForStaleChunk({ storage, reload, now: 5000 })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads again once the mark is older than the guard window', () => {
    const storage = memoryStorage({ [MARK]: '1000' });
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk({ storage, reload, now: 20000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('lazyWithReload', () => {
  it('reloads once and stores the mark when the chunk fails without a mark', async () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    renderLazy(lazyWithReload(() => Promise.reject(chunkError()), { storage, reload }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(storage.setItem).toHaveBeenCalledWith(MARK, expect.any(String));
    expect(screen.queryByTestId('caught')).toBeNull();
  });

  it('propagates the error when a recent mark exists', async () => {
    const storage = memoryStorage({ [MARK]: String(Date.now()) });
    const reload = vi.fn();
    renderLazy(lazyWithReload(() => Promise.reject(chunkError()), { storage, reload }));
    expect(await screen.findByTestId('caught')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('clears the mark and renders when the factory resolves', async () => {
    const storage = memoryStorage({ [MARK]: '1' });
    const Page = () => createElement('div', null, 'page ok');
    renderLazy(lazyWithReload(() => Promise.resolve({ default: Page }), { storage, reload: vi.fn() }));
    expect(await screen.findByText('page ok')).toBeTruthy();
    expect(storage.removeItem).toHaveBeenCalledWith(MARK);
  });

  it('propagates an unrelated error without reloading', async () => {
    const reload = vi.fn();
    renderLazy(lazyWithReload(() => Promise.reject(new Error('render exploded')), { storage: memoryStorage(), reload }));
    expect(await screen.findByTestId('caught')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('propagates the error without reloading when storage throws', async () => {
    const storage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    const reload = vi.fn();
    renderLazy(lazyWithReload(() => Promise.reject(chunkError()), { storage, reload }));
    expect(await screen.findByTestId('caught')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('handlePreloadError', () => {
  it('reloads and prevents default when there is no mark', () => {
    const event = { preventDefault: vi.fn() };
    const reload = vi.fn();
    handlePreloadError(event, { storage: memoryStorage(), reload });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('does neither with a recent mark', () => {
    const event = { preventDefault: vi.fn() };
    const reload = vi.fn();
    handlePreloadError(event, { storage: memoryStorage({ [MARK]: String(Date.now()) }), reload });
    expect(reload).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('preload error followed by a failing factory', () => {
  it('stays silent while the page reloads (no boundary flash)', async () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    handlePreloadError({ preventDefault: vi.fn() }, { storage, reload });
    renderLazy(lazyWithReload(() => Promise.reject(chunkError()), { storage, reload }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('caught')).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('installPreloadErrorReload', () => {
  it('wires vite:preloadError to the one-reload policy and can be removed', () => {
    const target = new EventTarget();
    const remove = installPreloadErrorReload(target);
    const event = new Event('vite:preloadError', { cancelable: true });
    window.sessionStorage.clear();
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
    target.dispatchEvent(event);
    Object.defineProperty(window, 'location', { configurable: true, value: original });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    remove();
    window.sessionStorage.clear();
    resetReloadInProgress();
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
