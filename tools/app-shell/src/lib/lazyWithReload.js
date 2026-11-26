import { lazy } from 'react';

const RELOAD_MARK_KEY = 'go:chunk-reload';
const RELOAD_GUARD_MS = 10_000;
const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

/** True when `error` is the browser's failure to fetch a (stale) hashed chunk or its CSS. */
export function isChunkLoadError(error) {
  if (!error) return false;
  return error.name === 'ChunkLoadError' || CHUNK_ERROR_PATTERN.test(String(error.message ?? ''));
}

// Set once a reload was triggered: the page is going away, so later failures must stay silent.
let reloadInProgress = false;

function defaultStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reloads the page at most once per guard window after a chunk failed to load (a stale build
 * whose hashed chunks were removed by a deploy). Returns true when a reload was triggered.
 */
export function reloadOnceForStaleChunk({
  storage = defaultStorage(),
  reload = () => window.location.reload(),
  now = Date.now(),
} = {}) {
  try {
    const mark = Number(storage.getItem(RELOAD_MARK_KEY));
    if (mark && now - mark < RELOAD_GUARD_MS) return false;
    storage.setItem(RELOAD_MARK_KEY, String(now));
  } catch {
    // No usable storage: reloading could loop, so let the error reach the boundary instead.
    return false;
  }
  reloadInProgress = true;
  reload();
  return true;
}

/** `lazy()` whose chunk failures reload the page once (see `reloadOnceForStaleChunk`). */
export function lazyWithReload(factory, { storage = defaultStorage(), reload } = {}) {
  return lazy(async () => {
    try {
      const module = await factory();
      return module;
    } catch (error) {
      if (isChunkLoadError(error) && (reloadInProgress || reloadOnceForStaleChunk({ storage, reload }))) {
        // Never settles: the page is reloading, so no error flashes in the meantime.
        return new Promise(() => {});
      }
      throw error;
    }
  });
}

/** @internal Test helper: forgets that a reload was triggered. */
export function resetReloadInProgress() {
  reloadInProgress = false;
}
