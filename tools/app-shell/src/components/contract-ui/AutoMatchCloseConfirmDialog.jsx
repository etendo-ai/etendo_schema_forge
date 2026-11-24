import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUI } from '@/i18n';

/**
 * "¿Deseas cerrar la ventana?" (ETP-6359): asked when the automatch modal is closed without
 * applying while rows are still selected. "Seguir trabajando" keeps the modal and its selection as
 * they were; "Cerrar" closes it and the selection is lost. Built on the project's `Dialog` with the
 * shared `Button` — outline for the safe choice, destructive for the one that discards.
 *
 * @param {{ open: boolean, onKeep: () => void, onConfirm: () => void }} props
 */
export function AutoMatchCloseConfirmDialog({ open, onKeep, onConfirm }) {
  const ui = useUI();
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onKeep(); }}>
      <DialogContent
        className="max-w-[456px] gap-0 p-0 py-2"
        data-testid="automatch-close-confirm">
        <DialogHeader className="gap-1 px-7 py-3">
          <DialogTitle className="text-xl font-semibold leading-7 text-[hsl(var(--foreground))]">
            {ui('financeReconcileAutomatchCloseTitle')}
          </DialogTitle>
          <DialogDescription className="text-sm leading-5 text-[hsl(var(--foreground))]">
            {ui('financeReconcileAutomatchCloseBody')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="px-7 py-3 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={onKeep}
            className="h-10 rounded-full px-4"
            data-testid="automatch-close-keep">
            {ui('financeReconcileAutomatchCloseKeep')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            className="h-10 rounded-full px-4"
            data-testid="automatch-close-confirm-action">
            {ui('financeReconcileAutomatchCloseConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AutoMatchCloseConfirmDialog;
