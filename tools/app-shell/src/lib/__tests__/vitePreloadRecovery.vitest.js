import { installVitePreloadRecovery } from '../vitePreloadRecovery.js';

function fakeTarget() {
  const store = {};
  const listeners = {};
  return {
    sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    location: { reload: vi.fn() },
    addEventListener: (n, f) => { listeners[n] = f; },
    removeEventListener: (n) => { delete listeners[n]; },
    fire: (n) => listeners[n]({ preventDefault: vi.fn() }),
    store,
  };
}

describe('installVitePreloadRecovery', () => {
  it('reloads once and marks the session', () => {
    const t = fakeTarget();
    installVitePreloadRecovery(t);
    t.fire('vite:preloadError');
    t.fire('vite:preloadError');
    expect(t.location.reload).toHaveBeenCalledTimes(1);
    expect(t.store['vite-preload-reloaded']).toBe('1');
  });

  it('does not reload when storage is unavailable', () => {
    const t = fakeTarget();
    t.sessionStorage.getItem = () => { throw new Error('denied'); };
    installVitePreloadRecovery(t);
    t.fire('vite:preloadError');
    expect(t.location.reload).not.toHaveBeenCalled();
  });
});
