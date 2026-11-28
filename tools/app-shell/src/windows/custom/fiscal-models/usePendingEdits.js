// Unsaved edits of a fiscal declaration page (303 / 349 / 390), and the leave guard built on them
// (OBS-17, ETP-5716: leaving a declaration through the side menu used to drop its unsaved changes
// without a word).
//
// Two answers, deliberately apart:
//   - `ref` — "something must be saved": read synchronously by the page's save path (Guardar, and
//     the save that Generar / Presentar run first). Set by every change, the page's own automatic
//     ones included (the 390's 303 preload, the 303's layout-fixed `autoValueWhen` values).
//   - `userEdited` — "the USER changed something": what the leave guard asks about. An automatic
//     change is saved with the next save as before, but leaving with only that one pending raises
//     no prompt — the user did nothing they could lose.
// `clear()` resets both. A save uses `version()` before its PUT and `clearIfUnchanged(v)` after it:
// an edit typed while the PUT was in flight is not in its payload, so it must stay pending — dirty
// for the next save and still arming the leave prompt (QA BUG-2, ETP-5716; the 349's own
// `editVersionRef` is the same rule).
import { useCallback, useRef, useState } from 'react';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard.js';
import { requestNavigation } from '@/lib/unsavedChanges.js';

/**
 * @returns {{ ref: {current: boolean}, userEdited: boolean, mark: Function, clear: Function,
 *   version: () => number, clearIfUnchanged: (since: number) => boolean }}
 */
export function usePendingEdits() {
  const ref = useRef(false);
  const versionRef = useRef(0);
  const [userEdited, setUserEdited] = useState(false);
  const mark = useCallback(({ user = true } = {}) => {
    ref.current = true;
    versionRef.current += 1;
    if (user) setUserEdited(true);
  }, []);
  const clear = useCallback(() => {
    ref.current = false;
    setUserEdited(false);
  }, []);
  /** The edit counter now — taken by a save right before its PUT. */
  const version = useCallback(() => versionRef.current, []);
  /** `clear()` only when no edit happened since `since`; true when it cleared. */
  const clearIfUnchanged = useCallback((since) => {
    if (versionRef.current !== since) return false;
    clear();
    return true;
  }, [clear]);
  return { ref, userEdited, mark, clear, version, clearIfUnchanged };
}

/**
 * Registers the page in the app's unsaved-changes registry (`useUnsavedChangesGuard`), so the
 * side menu, the top bar and a reload ask first — the shared "Tienes cambios sin guardar" dialog
 * (`UnsavedChangesNavigationDialog`), with "Guardar y salir" through the page's own `save`.
 * Returns `guardedBack(onBack)`: the breadcrumb's way back to the list (an in-page view switch,
 * not a route change) through the same prompt.
 *
 * @param {boolean} dirty user edits pending (and the declaration still editable)
 * @param {() => Promise<boolean>} save the page's Guardar; resolves falsy when it refuses
 */
export function useDeclarationLeaveGuard(dirty, save) {
  useUnsavedChangesGuard(dirty, save);
  return useCallback((onBack) => () => requestNavigation(() => onBack?.()), []);
}
