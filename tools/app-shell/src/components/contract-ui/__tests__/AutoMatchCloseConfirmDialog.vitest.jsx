// @covers tools/app-shell/src/components/contract-ui/AutoMatchCloseConfirmDialog.jsx
/**
 * "¿Deseas cerrar la ventana?" of the automatch modal, on the REAL Radix dialog: Esc, the X and the
 * overlay all map to "keep working"; only the destructive "Cerrar" confirms.
 */
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/i18n', () => ({ useUI: () => (key) => key }));

import { AutoMatchCloseConfirmDialog } from '../AutoMatchCloseConfirmDialog.jsx';

function renderDialog(overrides = {}) {
  const props = { open: true, onKeep: vi.fn(), onConfirm: vi.fn(), ...overrides };
  return { ...render(<AutoMatchCloseConfirmDialog {...props} />), props };
}

describe('AutoMatchCloseConfirmDialog', () => {
  it('renders the title and the body', () => {
    renderDialog();
    expect(screen.getByTestId('automatch-close-confirm')).toBeInTheDocument();
    expect(screen.getByText('financeReconcileAutomatchCloseTitle')).toBeInTheDocument();
    expect(screen.getByText('financeReconcileAutomatchCloseBody')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId('automatch-close-confirm')).toBeNull();
  });

  it('"Seguir trabajando" calls onKeep only', () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByTestId('automatch-close-keep'));
    expect(screen.getByTestId('automatch-close-keep')).toHaveTextContent('financeReconcileAutomatchCloseKeep');
    expect(props.onKeep).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('"Cerrar" calls onConfirm only', () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByTestId('automatch-close-confirm-action'));
    expect(screen.getByTestId('automatch-close-confirm-action')).toHaveTextContent('financeReconcileAutomatchCloseConfirm');
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onKeep).not.toHaveBeenCalled();
  });

  it('Esc maps to "keep working", never to the confirmation', () => {
    const { props } = renderDialog();
    fireEvent.keyDown(screen.getByTestId('automatch-close-confirm'), { key: 'Escape', code: 'Escape' });
    expect(props.onKeep).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('the X of the dialog maps to "keep working"', () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onKeep).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('a click on the overlay maps to "keep working"', async () => {
    const { props } = renderDialog();
    // Radix attaches its outside-pointer listener on the next tick after mounting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const overlay = document.querySelector('[data-testid="DialogOverlay__6a5928"]');
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay);
    fireEvent.pointerUp(overlay);
    fireEvent.click(overlay);
    await vi.waitFor(() => expect(props.onKeep).toHaveBeenCalled());
    expect(props.onKeep).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('"Cerrar" is the destructive variant and "Seguir trabajando" the outline one', () => {
    renderDialog();
    expect(screen.getByTestId('automatch-close-confirm-action').className).toContain('bg-destructive');
    const keep = screen.getByTestId('automatch-close-keep').className;
    expect(keep).not.toContain('bg-destructive');
    expect(keep).toContain('border');
  });
});
