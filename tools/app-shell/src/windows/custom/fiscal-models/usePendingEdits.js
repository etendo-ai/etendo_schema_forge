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
// `clear()` after a successful save resets both.
import { useCallback, useRef, useState } from 'react';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard.js';
import { requestNavigation } from '@/lib/unsavedChanges.js';

/** @returns {{ ref: {current: boolean}, userEdited: boolean, mark: Function, clear: Function }} */
export function usePendingEdits() {
  const ref = useRef(false);
  const [userEdited, setUserEdited] = useState(false);
  const mark = useCallback(({ user = true } = {}) => {
    ref.current = true;
    if (user) setUserEdited(true);
  }, []);
  const clear = useCallback(() => {
    ref.current = false;
    setUserEdited(false);
  }, []);
  return { ref, userEdited, mark, clear };
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
