// @covers tools/app-shell/src/windows/custom/fiscal-models/usePendingEdits.js
// OBS-17 (ETP-5716) — unsaved user edits of a fiscal declaration page are published to the app's
// unsaved-changes registry (side menu / top bar / reload ask first), automatic edits are not, and
// the breadcrumb's way back to the list goes through the same prompt. Runs against the real
// registry (`@/lib/unsavedChanges.js`), whose own contract is covered by unsavedChanges.vitest.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  hasUnsavedChanges, subscribeNavigationPrompt, confirmPendingNavigation,
  savePendingNavigation, resetUnsavedChangesForTests,
} from '@/lib/unsavedChanges.js';
import { usePendingEdits, useDeclarationLeaveGuard } from '../usePendingEdits.js';

function usePage(save) {
  const edits = usePendingEdits();
  const guardedBack = useDeclarationLeaveGuard(edits.userEdited, save);
  return { ...edits, guardedBack };
}

beforeEach(() => resetUnsavedChangesForTests());

describe('usePendingEdits', () => {
  it('a user edit marks both the save ref and the leave guard', () => {
    const { result } = renderHook(() => usePage(vi.fn()));
    expect(hasUnsavedChanges()).toBe(false);
    act(() => result.current.mark());
    expect(result.current.ref.current).toBe(true);
    expect(result.current.userEdited).toBe(true);
    expect(hasUnsavedChanges()).toBe(true);
  });

  it('an automatic edit must be saved but raises no leave prompt', () => {
    const { result } = renderHook(() => usePage(vi.fn()));
    act(() => result.current.mark({ user: false }));
    expect(result.current.ref.current).toBe(true);
    expect(result.current.userEdited).toBe(false);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('clear() after a save resets both answers', () => {
    const { result } = renderHook(() => usePage(vi.fn()));
    act(() => result.current.mark());
    act(() => result.current.clear());
    expect(result.current.ref.current).toBe(false);
    expect(hasUnsavedChanges()).toBe(false);
  });

  // QA BUG-2 (ETP-5716) — an edit typed while the save's PUT is in flight is not in that save's
  // payload: the save must not clear it, or it loses both the leave prompt and the next save.
  it('a save clears only when no edit happened while it was in flight', () => {
    const { result } = renderHook(() => usePage(vi.fn()));
    act(() => result.current.mark());
    const savedAt = result.current.version();
    act(() => result.current.mark()); // typed during the PUT
    act(() => { result.current.clearIfUnchanged(savedAt); });
    expect(result.current.ref.current).toBe(true);
    expect(result.current.userEdited).toBe(true);
    expect(hasUnsavedChanges()).toBe(true);

    const again = result.current.version();
    act(() => { result.current.clearIfUnchanged(again); });
    expect(result.current.ref.current).toBe(false);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('unmounting a dirty page leaves the registry clean', () => {
    const { result, unmount } = renderHook(() => usePage(vi.fn()));
    act(() => result.current.mark());
    unmount();
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe('useDeclarationLeaveGuard — breadcrumb back to the list', () => {
  it('goes straight back when nothing is pending', () => {
    const prompt = vi.fn();
    subscribeNavigationPrompt(prompt);
    const onBack = vi.fn();
    const { result } = renderHook(() => usePage(vi.fn()));
    result.current.guardedBack(onBack)();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('holds the way back behind the prompt while the user has unsaved edits', () => {
    const prompt = vi.fn();
    subscribeNavigationPrompt(prompt);
    const onBack = vi.fn();
    const { result } = renderHook(() => usePage(vi.fn()));
    act(() => result.current.mark());
    result.current.guardedBack(onBack)();
    expect(prompt).toHaveBeenCalledWith(true);
    expect(onBack).not.toHaveBeenCalled();
    // "Descartar y salir"
    confirmPendingNavigation();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('"Guardar y salir" runs the page save and leaves only when it succeeds', async () => {
    subscribeNavigationPrompt(vi.fn());
    const onBack = vi.fn();
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { result } = renderHook(() => usePage(save));
    act(() => result.current.mark());

    result.current.guardedBack(onBack)();
    await act(async () => { await savePendingNavigation(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();

    result.current.guardedBack(onBack)();
    await act(async () => { await savePendingNavigation(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
