import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useUI } from '@/i18n';
import { isDraftStatus } from '@/lib/docStatus.js';
import { normalizeDateInputValue } from '@/windows/custom/fiscal-config/fiscalConfig.utils.js';
import SiiImportDuaSection, { useSiiImportDuaEnabled } from '@/windows/custom/shared/SiiImportDuaSection.jsx';
import SiiImportTaxesSection, { useSiiDeferredVat } from '@/windows/custom/shared/SiiImportTaxesSection.jsx';
import {
  isImportDuaChecked, isImportDuaTypeKey, needsUncheckConfirmation, shouldShowImportDuaCards,
} from '@/windows/custom/shared/importDua.js';

/* eslint-disable react/prop-types */

const FIELD = 'etgoImportDua';

function isYes(value) {
  return value === true || value === 'Y';
}

/**
 * ETP-6284 — "Importación con DUA" in the purchase-invoice Lines tab (rendered by
 * PurchaseInvoiceBottomPanel above the totals). A switch bound to the header field `etgoImportDua`
 * (C_Invoice.EM_Etgo_Import_Dua, com.etendoerp.go); while it is on, the DUA card and the
 * import-taxes card follow. Available for any organization — it does not depend on SII. For an
 * organization in SII the SIF tab reports the invoice as F5 (`importDuaInvoiceTypeToSet`).
 *
 * Behind the `siiImportDua` capability (backend flag `sii-import-dua`): off, nothing renders.
 *
 * The switch and the DUA fields write into DetailView's shared editing state (`onFieldChange`); the
 * header save persists them, and com.etendoerp.go refuses the save without DUA and DUA date unless
 * Multiple DUA is on. The import tax rows save themselves (`SiiImportTaxesSection`) and re-read the
 * header totals through `onHeaderRefresh`.
 *
 * Read-only on a document the user cannot edit (completed, read-only role) or already sent to SII.
 *
 * Effective value: an SII invoice type F5 / LC counts as checked (a legacy or Classic import), so the
 * switch shows on — locked, since only changing Tipo factura in the SIF tab can turn it off.
 * Unchecking an invoice that already has manual import tax lines asks for confirmation first (the
 * rows stay on the invoice; only the cards are hidden), built on the system Dialog primitives like
 * `LocaleChangeConfirmDialog` — the codebase has no generic confirm component.
 */
function UncheckConfirmDialog({ ui, open, onConfirm, onCancel }) {
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onCancel(); }} data-testid="Dialog__importDuaUncheck">
      <DialogContent className="sm:max-w-md" data-testid="DialogContent__importDuaUncheck">
        <DialogHeader data-testid="DialogHeader__importDuaUncheck">
          <DialogTitle data-testid="DialogTitle__importDuaUncheck">{ui('sifDataTabs.dua.uncheckTitle')}</DialogTitle>
          <DialogDescription data-testid="DialogDescription__importDuaUncheck">
            {ui('sifDataTabs.dua.uncheckBody')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter data-testid="DialogFooter__importDuaUncheck">
          <Button variant="outline" onClick={onCancel} data-testid="Button__importDuaUncheck-cancel">{ui('cancel')}</Button>
          <Button onClick={onConfirm} data-testid="Button__importDuaUncheck-confirm">{ui('sifDataTabs.dua.uncheckConfirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ImportDuaLinesSection({
  data, recordId, apiBaseUrl, token, isDocumentReadOnly = false, windowReadOnly = false,
  onFieldChange, onHeaderRefresh,
}) {
  const ui = useUI();
  const [confirmUncheck, setConfirmUncheck] = useState(false);
  const enabled = useSiiImportDuaEnabled();
  const checked = isImportDuaChecked(data);
  const savedId = data?.id || recordId || null;
  const showCards = shouldShowImportDuaCards({ enabled, record: data });
  const deferredVat = useSiiDeferredVat({
    apiBaseUrl,
    recordId: savedId,
    enabled: showCards,
    refreshKey: `${data?.updated ?? ''}|${checked}`,
  });
  if (!enabled) return null;

  const readOnly = isDocumentReadOnly || windowReadOnly || isYes(data?.aeatsiiIssent)
    || data?.processed === true;
  const lockedOn = isImportDuaTypeKey(data);
  const handleToggle = (val) => {
    if (!val && needsUncheckConfirmation(data)) {
      setConfirmUncheck(true);
      return;
    }
    onFieldChange?.(FIELD, val);
  };
  const getVal = key => data?.[key] ?? '';
  const getDateVal = key => normalizeDateInputValue(data?.[key] ?? '');

  return (
    <div className="space-y-3 px-4 pt-4" data-testid="ImportDuaLinesSection__root">
      <div className="flex items-start gap-3" data-testid="ImportDuaLinesSection__check">
        <Switch
          id="pinv-importDua"
          checked={checked}
          onCheckedChange={handleToggle}
          disabled={readOnly || lockedOn}
          data-testid="Switch__importDua" />
        <div className="space-y-0.5">
          <Label htmlFor="pinv-importDua" className="text-sm text-foreground font-medium" data-testid="Label__importDua">
            {ui('sifDataTabs.dua.importCheck')}
          </Label>
          <p className="text-xs text-muted-foreground" data-testid="ImportDuaLinesSection__help">
            {ui('sifDataTabs.dua.importCheckHelp')}
          </p>
        </div>
      </div>
      <UncheckConfirmDialog
        ui={ui}
        open={confirmUncheck}
        onCancel={() => setConfirmUncheck(false)}
        onConfirm={() => { setConfirmUncheck(false); onFieldChange?.(FIELD, false); }}
        data-testid="UncheckConfirmDialog__importDua" />
      {showCards && (
        <>
          <SiiImportDuaSection
            ui={ui}
            siiTypeKey={getVal('aeatsiiClaveTipoFc') || null}
            getVal={getVal}
            getDateVal={getDateVal}
            onChange={onFieldChange}
            readOnly={readOnly}
            step={1}
            data-testid="SiiImportDuaSection__importDua" />
          <SiiImportTaxesSection
            ui={ui}
            multiDua={isYes(getVal('aeatsiiMultiDua'))}
            recordId={savedId}
            data={data}
            apiBaseUrl={apiBaseUrl}
            token={token}
            readOnly={readOnly || !isDraftStatus(data?.documentStatus)}
            onHeaderRefresh={onHeaderRefresh}
            deferredVat={deferredVat}
            accountingRegisterDate={getDateVal('aeatsiiFechaRegCont')}
            step={2}
            data-testid="SiiImportTaxesSection__importDua" />
        </>
      )}
    </div>
  );
}
