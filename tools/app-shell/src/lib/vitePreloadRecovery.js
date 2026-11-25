// ETP-6441 — a truncated or undecodable chunk makes a dynamic import fail with a TypeError nobody
// handles. Vite fires `vite:preloadError` for it: reload once per session to fetch it again.
const RELOAD_FLAG = 'vite-preload-reloaded';

export function installVitePreloadRecovery(target = window) {
  const onPreloadError = (event) => {
    try {
      if (target.sessionStorage.getItem(RELOAD_FLAG)) return;
      target.sessionStorage.setItem(RELOAD_FLAG, '1');
    } catch {
      return; // no storage, no way to bound the reloads: do not risk a loop
    }
    event.preventDefault?.();
    target.location.reload();
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => target.removeEventListener('vite:preloadError', onPreloadError);
}
