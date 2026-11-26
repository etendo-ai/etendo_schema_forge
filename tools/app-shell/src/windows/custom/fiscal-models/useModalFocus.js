// Keyboard contract of the fiscal-models popups (`.fm-modal-overlay` + `role="dialog"`,
// GEN-03 of ETP-5716): the WAI-ARIA modal dialog pattern that `aria-modal="true"` promises.
//   - on open, focus moves into the dialog (a `[data-autofocus]` control, else the first control
//     that is not the header ✕, else the dialog itself);
//   - Tab / Shift+Tab cycle inside it (the shared `useDialogFocusTrap` of ActionChoiceModal);
//   - Escape closes it through `onClose` — the popup's own close, so a popup that refuses to
//     close while it works (FileGenModal390 generating) keeps refusing;
//   - on close, focus goes back to the control that opened it.
import { useEffect, useRef } from 'react';
import { useDialogFocusTrap } from '@/components/contract-ui/ActionChoiceModal.jsx';

const FOCUSABLE = [
  'button:not([disabled])', '[href]', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([disabled])',
].map(sel => `${sel}:not([tabindex="-1"])`).join(', ');

/** The control a dialog opens on: `[data-autofocus]`, else the first one that is not a close ✕. */
export function initialFocusTarget(dialog) {
  if (!dialog) return null;
  const marked = dialog.querySelector('[data-autofocus]');
  if (marked) return marked;
  const controls = Array.from(dialog.querySelectorAll(FOCUSABLE));
  return controls.find(el => !el.classList.contains('fm-config-modal__close')) ?? controls[0] ?? dialog;
}

/**
 * True when an Escape keydown is this dialog's to handle: nothing consumed it first (a select or
 * a nested popup) and focus is in this dialog — or nowhere (body) — and not in another dialog
 * nested inside it.
 */
export function isDialogEscape(event, dialog) {
  if (event.key !== 'Escape' || event.defaultPrevented || !dialog) return false;
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  if (!dialog.contains(active)) return false;
  return active.closest?.('[role="dialog"]') === dialog;
}

/**
 * @param {Function} onClose the popup's close (called on Escape)
 * @returns a ref for the `role="dialog"` element (give it `tabIndex={-1}`)
 */
export function useModalFocus(onClose) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useDialogFocusTrap(dialogRef);

  useEffect(() => {
    const trigger = document.activeElement;
    initialFocusTarget(dialogRef.current)?.focus?.();
    return () => {
      if (trigger && trigger !== document.body && trigger.isConnected) trigger.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!isDialogEscape(event, dialogRef.current)) return;
      event.preventDefault();
      onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return dialogRef;
}
