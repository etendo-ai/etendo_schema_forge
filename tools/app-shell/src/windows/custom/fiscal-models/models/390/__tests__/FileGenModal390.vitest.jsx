// @covers tools/app-shell/src/windows/custom/fiscal-models/models/390/FileGenModal390.jsx
// @covers tools/app-shell/src/windows/custom/fiscal-models/models/303/AeatResultBanner.jsx
// @covers tools/app-shell/src/windows/custom/fiscal-models/useModalFocus.js
//
// Modelo 390 — the "Generar fichero 390" popup: while the page generates and the AEAT validates
// the file it stays open on the loading ring and nothing in it can be clicked again; afterwards
// it shows the validator's answer (rejected / accepted with warnings / could not be validated)
// or closes (a clean file, or a generation the page already explained).
import { vi, describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FileGenModal390 from '../FileGenModal390.jsx';
import { isDialogEscape, initialFocusTarget, useModalFocus } from '../../../useModalFocus.js';

/** A `t` that echoes the key and its params, so the tests see what was asked. */
const t = (key, params) => (params && Object.keys(params).length ? `${key}|${JSON.stringify(params)}` : key);
const line = (code, message) => `fm.m390.file_validation.error_line|${JSON.stringify({ code, message })}`;

const DECL = { id: 'D1', year: 2026, period: '0A' };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderModal(overrides = {}) {
  const props = {
    decl: DECL,
    summary: { result: 360 },
    typeLabel: 'type-label',
    resultLabel: 'result-label',
    onConfirm: vi.fn().mockResolvedValue(null),
    onViewIncidents: vi.fn(),
    onClose: vi.fn(),
    t,
    ...overrides,
  };
  render(<FileGenModal390 {...props} />);
  return props;
}

/** Clicks Generar and waits for the handler to settle. */
async function generate() {
  await act(async () => { fireEvent.click(screen.getByTestId('FileGenModal390__confirm')); });
}

/** The banner (AeatResultBanner root) that holds the given title. */
const bannerOf = (titleKey) => screen.getByText(titleKey).parentElement.parentElement;
const itemsOf = (testId) => [...screen.getByTestId(testId).querySelectorAll('li')].map(li => li.textContent);

describe('FileGenModal390 — file name step', () => {
  it('offers the default file name and the summary, with Generar and Cancelar', () => {
    renderModal();
    expect(screen.getByTestId('FileGenModal390__fileName').value).toBe('390_0A_2026.txt');
    expect(screen.getByTestId('FileGenModal390__summary').textContent).toContain('type-label');
    expect(screen.getByTestId('FileGenModal390__summary').textContent).toContain('result-label');
    expect(screen.getByTestId('FileGenModal390__confirm').textContent).toBe('fm.filegen.generate');
    expect(screen.getByTestId('FileGenModal390__close').textContent).toBe('fm.action.cancel');
    expect(screen.queryByTestId('FileGenModal390__validating')).toBeNull();
    expect(screen.queryByTestId('FileGenModal390__result')).toBeNull();
  });

  it('hands the trimmed file name to the handler', async () => {
    const first = renderModal();
    fireEvent.change(screen.getByTestId('FileGenModal390__fileName'), { target: { value: '  mine.txt ' } });
    await generate();
    expect(first.onConfirm).toHaveBeenCalledWith({ fileName: 'mine.txt' });
  });

  it('hands undefined when the file name is blank', async () => {
    const { onConfirm } = renderModal();
    fireEvent.change(screen.getByTestId('FileGenModal390__fileName'), { target: { value: '   ' } });
    await generate();
    expect(onConfirm).toHaveBeenCalledWith({ fileName: undefined });
  });

  it('Cancelar, the close button and the overlay close it before generating', () => {
    const { onClose, onConfirm } = renderModal();
    fireEvent.click(screen.getByTestId('FileGenModal390__close'));
    fireEvent.click(screen.getByLabelText('fm.action.close'));
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(3);
    // a click inside the modal is not an overlay click
    fireEvent.click(screen.getByTestId('FileGenModal390'));
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('FileGenModal390 — while the file is generated and validated', () => {
  // userEvent (not fireEvent): it honours `disabled`, which is what makes the buttons inert.
  it('shows the loading ring with the validating text and nothing can be clicked again', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const { onConfirm, onClose } = renderModal({ onConfirm: vi.fn(() => pending.promise) });

    await user.click(screen.getByTestId('FileGenModal390__confirm'));

    const loading = screen.getByTestId('FileGenModal390__validating');
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading.textContent).toContain('fm.m390.file_validation.validating');
    expect(loading.querySelector('svg text').textContent).toMatch(/^\d+%$/);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    // the file name step is gone while it works
    expect(screen.queryByTestId('FileGenModal390__fileName')).toBeNull();

    const confirm = screen.getByTestId('FileGenModal390__confirm');
    const cancel = screen.getByTestId('FileGenModal390__close');
    const closeX = screen.getByLabelText('fm.action.close');
    expect(confirm).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(closeX).toBeDisabled();

    await user.click(confirm);
    await user.click(cancel);
    await user.click(closeX);
    // the overlay is not a button: its own guard keeps it inert
    fireEvent.click(screen.getByRole('dialog'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { pending.resolve(null); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a second raw click on Generar while it works does not call the handler again', async () => {
    const pending = deferred();
    const { onConfirm } = renderModal({ onConfirm: vi.fn(() => pending.promise) });
    await generate();
    await generate();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(null); });
  });

  it('the ring advances while it waits', async () => {
    vi.useFakeTimers();
    try {
      const pending = deferred();
      renderModal({ onConfirm: vi.fn(() => pending.promise) });
      await generate();
      const percent = () => screen.getByTestId('FileGenModal390__validating').querySelector('svg text').textContent;
      expect(percent()).toBe('0%');
      await act(async () => { vi.advanceTimersByTime(80 * 5); });
      expect(percent()).toBe('20%');
      await act(async () => { pending.resolve(null); });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FileGenModal390 — result step', () => {
  it('rejected: the red banner lists each AEAT error as "code — message", with "Ver incidencias" and "Cerrar"', async () => {
    const validation = {
      outcome: 'rejected',
      errors: [{ code: '390E01', message: 'Casilla 33 incorrecta' }, { code: '', message: 'Sin codigo' }],
      warnings: [],
    };
    const { onClose } = renderModal({ onConfirm: vi.fn().mockResolvedValue(validation) });
    await generate();

    expect(screen.getByTestId('FileGenModal390__result')).toBeInTheDocument();
    expect(bannerOf('fm.m390.file_validation.rejected.title').style.color).toBe('var(--fm-danger-fg)');
    // an entry without a code shows its message alone
    expect(itemsOf('FileGenModal390__errors')).toEqual([line('390E01', 'Casilla 33 incorrecta'), 'Sin codigo']);
    expect(screen.getByText('fm.m390.file_validation.rejected.body')).toBeInTheDocument();
    expect(screen.queryByTestId('FileGenModal390__warnings')).toBeNull();

    expect(screen.getByTestId('FileGenModal390__viewIncidents').textContent).toBe('fm.m390.file_validation.view_incidents');
    expect(screen.getByTestId('FileGenModal390__close').textContent).toBe('fm.action.close');
    expect(screen.queryByTestId('FileGenModal390__confirm')).toBeNull();
    expect(screen.queryByTestId('FileGenModal390__validating')).toBeNull();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'false');
    // the popup stays open on the result
    expect(onClose).not.toHaveBeenCalled();
  });

  it('rejected with AEAT warnings: they are listed under the errors', async () => {
    const validation = {
      outcome: 'rejected',
      errors: [{ code: '390E01', message: 'err' }],
      warnings: [{ code: '390A01', message: 'warn' }],
    };
    renderModal({ onConfirm: vi.fn().mockResolvedValue(validation) });
    await generate();
    expect(itemsOf('FileGenModal390__errors')).toEqual([line('390E01', 'err')]);
    expect(screen.getByText('fm.aeat.warnings.title')).toBeInTheDocument();
    expect(itemsOf('FileGenModal390__warnings')).toEqual([line('390A01', 'warn')]);
  });

  it('accepted with warnings: the amber banner lists them, with "Ver incidencias"', async () => {
    const validation = {
      outcome: 'accepted', errors: [],
      warnings: [{ code: '390A01', message: 'Aviso uno' }, { code: '390A02', message: 'Aviso dos' }],
    };
    const { onClose } = renderModal({ onConfirm: vi.fn().mockResolvedValue(validation) });
    await generate();

    expect(bannerOf('fm.m390.file_validation.warnings.title').style.color).toBe('var(--fm-warning-fg)');
    expect(itemsOf('FileGenModal390__warnings')).toEqual([line('390A01', 'Aviso uno'), line('390A02', 'Aviso dos')]);
    expect(screen.getByText('fm.m390.file_validation.warnings.body')).toBeInTheDocument();
    expect(screen.queryByTestId('FileGenModal390__errors')).toBeNull();
    expect(screen.getByTestId('FileGenModal390__viewIncidents')).toBeInTheDocument();
    expect(screen.getByTestId('FileGenModal390__close').textContent).toBe('fm.action.close');
    expect(screen.queryByTestId('FileGenModal390__confirm')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['connection_failure', 'not_validated'])(
    '%s: the amber "could not be validated" banner, with "Cerrar" only',
    async (outcome) => {
      const { onClose } = renderModal({ onConfirm: vi.fn().mockResolvedValue({ outcome, errors: [], warnings: [] }) });
      await generate();

      expect(bannerOf('fm.m390.file_validation.unavailable.title').style.color).toBe('var(--fm-warning-fg)');
      expect(screen.getByText('fm.m390.file_validation.unavailable.body')).toBeInTheDocument();
      expect(screen.queryByTestId('FileGenModal390__errors')).toBeNull();
      expect(screen.queryByTestId('FileGenModal390__warnings')).toBeNull();
      expect(screen.queryByTestId('FileGenModal390__viewIncidents')).toBeNull();
      expect(screen.queryByTestId('FileGenModal390__confirm')).toBeNull();
      expect(screen.getByTestId('FileGenModal390__close').textContent).toBe('fm.action.close');
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('FileGenModal390__close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it('accepted without warnings: the popup closes and shows no result step', async () => {
    const { onClose } = renderModal({ onConfirm: vi.fn().mockResolvedValue({ outcome: 'accepted', errors: [], warnings: [] }) });
    await generate();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('FileGenModal390__result')).toBeNull();
    expect(screen.queryByTestId('FileGenModal390__validating')).toBeNull();
  });

  it('nothing to show (the page already explained the failure): the popup closes', async () => {
    const { onClose } = renderModal({ onConfirm: vi.fn().mockResolvedValue(null) });
    await generate();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('FileGenModal390__result')).toBeNull();
  });

  it('a handler that rejects closes the popup', async () => {
    const { onClose } = renderModal({ onConfirm: vi.fn().mockRejectedValue(new Error('boom')) });
    await generate();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('FileGenModal390__result')).toBeNull();
    expect(screen.queryByTestId('FileGenModal390__validating')).toBeNull();
  });

  it('"Ver incidencias" calls its handler and closes the popup', async () => {
    const validation = { outcome: 'rejected', errors: [{ code: 'E', message: 'm' }], warnings: [] };
    const { onViewIncidents, onClose } = renderModal({ onConfirm: vi.fn().mockResolvedValue(validation) });
    await generate();
    fireEvent.click(screen.getByTestId('FileGenModal390__viewIncidents'));
    expect(onViewIncidents).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers no "Ver incidencias" without its handler', async () => {
    const validation = { outcome: 'rejected', errors: [{ code: 'E', message: 'm' }], warnings: [] };
    renderModal({ onConfirm: vi.fn().mockResolvedValue(validation), onViewIncidents: undefined });
    await generate();
    expect(screen.getByTestId('FileGenModal390__errors')).toBeInTheDocument();
    expect(screen.queryByTestId('FileGenModal390__viewIncidents')).toBeNull();
  });
});

// GEN-03 (ETP-5716 QA): the popup is a real modal for the keyboard — it used to leave focus on the
// page, let Tab walk to "Guardar" behind it and ignore Escape although it says aria-modal="true".
describe('FileGenModal390 — keyboard (modal dialog)', () => {
  it('moves focus into the popup on open: the file name, not the header close', () => {
    renderModal();
    expect(document.activeElement).toBe(screen.getByTestId('FileGenModal390__fileName'));
  });

  it('keeps Tab inside: from the last control it wraps to the first, Shift+Tab the other way', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    const confirm = screen.getByTestId('FileGenModal390__confirm');
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(confirm);
    const first = document.activeElement;
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('Escape closes it', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(screen.getByTestId('FileGenModal390__fileName'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape does nothing while the file is being generated', async () => {
    const pending = deferred();
    const { onClose } = renderModal({ onConfirm: vi.fn(() => pending.promise) });
    await act(async () => { fireEvent.click(screen.getByTestId('FileGenModal390__confirm')); });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(null); });
  });

  it('gives focus back to the control that opened it when it closes', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const props = {
      decl: DECL, summary: { result: 0 }, typeLabel: 'x', resultLabel: 'y',
      onConfirm: vi.fn(), onClose: vi.fn(), t,
    };
    const { unmount } = render(<FileGenModal390 {...props} />);
    expect(document.activeElement).not.toBe(trigger);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

// The shared keyboard contract itself (`useModalFocus.js`), on hand-built dialogs: which Escape is
// the dialog's own, which control it opens on, and the way back to a trigger that may be gone.
describe('useModalFocus — isDialogEscape / initialFocusTarget', () => {
  /** Builds `<div role="dialog">` with the given inner HTML, attached to the document. */
  function dialogWith(html) {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.tabIndex = -1;
    dialog.innerHTML = html;
    document.body.appendChild(dialog);
    return dialog;
  }
  const escape = (extra = {}) => ({ key: 'Escape', defaultPrevented: false, ...extra });

  afterEach(() => { document.body.innerHTML = ''; });

  it('ignores an Escape already handled by something inside (defaultPrevented), and any other key', () => {
    const dialog = dialogWith('<button>ok</button>');
    dialog.querySelector('button').focus();
    expect(isDialogEscape(escape(), dialog)).toBe(true);
    expect(isDialogEscape(escape({ defaultPrevented: true }), dialog)).toBe(false);
    expect(isDialogEscape(escape({ key: 'Enter' }), dialog)).toBe(false);
    expect(isDialogEscape(escape(), null)).toBe(false);
  });

  it('is the dialog\'s own with focus on body (nowhere), not with focus outside it', () => {
    const dialog = dialogWith('<button>ok</button>');
    document.activeElement?.blur?.();
    expect(document.activeElement).toBe(document.body);
    expect(isDialogEscape(escape(), dialog)).toBe(true);

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    expect(isDialogEscape(escape(), dialog)).toBe(false);
  });

  it('belongs to a nested dialog when focus is inside it, not to the outer one', () => {
    const outer = dialogWith('<button data-testid="outer-btn">a</button>'
      + '<div role="dialog" data-testid="inner"><button data-testid="inner-btn">b</button></div>');
    const inner = outer.querySelector('[data-testid="inner"]');
    outer.querySelector('[data-testid="inner-btn"]').focus();
    expect(isDialogEscape(escape(), outer)).toBe(false);
    expect(isDialogEscape(escape(), inner)).toBe(true);
    outer.querySelector('[data-testid="outer-btn"]').focus();
    expect(isDialogEscape(escape(), outer)).toBe(true);
  });

  it('opens on [data-autofocus] over the first control', () => {
    const dialog = dialogWith('<button data-testid="first">a</button><input data-testid="marked" data-autofocus />');
    expect(initialFocusTarget(dialog)).toBe(dialog.querySelector('[data-testid="marked"]'));
  });

  it('skips the header close ✕, falls back to it when it is the only control, then to the dialog', () => {
    const dialog = dialogWith('<button class="fm-config-modal__close" data-testid="x">x</button>'
      + '<button disabled>off</button><button tabindex="-1">hidden</button><input data-testid="name" />');
    expect(initialFocusTarget(dialog)).toBe(dialog.querySelector('[data-testid="name"]'));

    const onlyClose = dialogWith('<button class="fm-config-modal__close" data-testid="x2">x</button>');
    expect(initialFocusTarget(onlyClose)).toBe(onlyClose.querySelector('[data-testid="x2"]'));

    const empty = dialogWith('<p>text</p>');
    expect(initialFocusTarget(empty)).toBe(empty);
    expect(initialFocusTarget(null)).toBeNull();
  });

  it('does not try to give focus back to a trigger detached while the dialog was open', () => {
    function Dialog() {
      const ref = useModalFocus(vi.fn());
      return <div role="dialog" tabIndex={-1} ref={ref}><button>ok</button></div>;
    }
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const focusSpy = vi.spyOn(trigger, 'focus');
    const { unmount } = render(<Dialog />);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    trigger.remove();
    expect(() => unmount()).not.toThrow();
    expect(focusSpy).not.toHaveBeenCalled();
  });
});
