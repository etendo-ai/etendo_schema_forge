import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useUI } from '@/i18n';
import { useAuth } from '@/auth/AuthContext.jsx';
import { isDraftStatus } from '@/lib/docStatus.js';
import { useFiscalConfig } from '@/windows/custom/fiscal-config/useFiscalConfig.js';
import { normalizeDateInputValue } from '@/windows/custom/fiscal-config/fiscalConfig.utils.js';
import SiiImportDuaSection, { useSiiImportDuaEnabled } from '@/windows/custom/shared/SiiImportDuaSection.jsx';
import SiiImportTaxesSection, { useSiiDeferredVat } from '@/windows/custom/shared/SiiImportTaxesSection.jsx';
import { getInvoiceFiscalTargets, isSifEligibleByDate } from '@/windows/custom/shared/fiscalTargets.js';
import { resolveInvoiceOrgId } from '@/windows/custom/shared/resolveInvoiceOrgId.js';
import {
  importDuaUncheckPatch, isImportDuaChecked, isImportDuaLockedOn, isImportDuaTypeKey,
  needsUncheckConfirmation, shouldShowImportDuaCards,
} from '@/windows/custom/shared/importDua.js';

/* eslint-disable react/prop-types */

const FIELD = 'etgoImportDua';

function isYes(value) {
  return value === true || value === 'Y';
}

/**
 * Whether the organization of the invoice files SII, read only while `active` (the block is shown,
 * or the type is F5 / LC) so other invoices cost no fiscal-config requests. The same criterion as
 * the SIF tab (`useSifFieldPatcher`):
 *   - `showSii`: SII applies to the organization (`getInvoiceFiscalTargets`) — drives the uncheck
 *     patch (Tipo factura back to F1);
 *   - `adopted`: plus the invoice's accounting date on or after the organization's SII adoption
 *     (`isSifEligibleByDate`) — the invoice is filed to SII, so DUA and Fecha DUA are required.
 * Both read false while the configuration loads.
 */
function useOrgSii(data, apiBaseUrl, active) {
  const { selectedOrg } = useAuth();
  const orgId = active ? resolveInvoiceOrgId(data, selectedOrg?.id) : null;
  const { profile, tbaiRecord, earliestSiiCutoverDate } = useFiscalConfig(orgId, apiBaseUrl);
  const territory = tbaiRecord?.etsgSifTerritory ?? null;
  const showSii = active && getInvoiceFiscalTargets('purchase-invoice', profile, territory).showSii;
  const adopted = showSii && isSifEligibleByDate(data?.accountingDate, earliestSiiCutoverDate);
  return { showSii, adopted };
}

/**
 * ETP-6284 — "Importación con DUA" in the purchase-invoice Lines tab (rendered by
 * PurchaseInvoiceBottomPanel above the totals). A switch bound to the header field `etgoImportDua`
 * (C_Invoice.EM_Etgo_Import_Dua, com.etendoerp.go); while it is on, one block follows: the DUA data
 * first, then the import tax lines (`SiiImportDuaSection` with `SiiImportTaxesSection` inside), with
 * no step numbers and no totals of its own (the invoice totals below already include the manual
 * tax lines). Available for any organization — it does not depend on SII. Only the required-ness
 * of DUA and Fecha DUA does: required only when the organization files SII for the invoice
 * (`useOrgSii().adopted`). For an organization in SII the SIF tab reports the invoice as F5
 * (`importDuaInvoiceTypeToSet`).
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
 * switch shows on. It is locked only for such a legacy import — F5 / LC with the stored check off
 * (`isImportDuaLockedOn`): only changing Tipo factura in the SIF tab turns it off. When the user
 * checked it, the F5 the SIF tab then set does not lock it; unchecking writes, in the same header
 * save, the check off plus Tipo factura F1 when the SIF tab could have set it (`importDuaUncheckPatch`),
 * so the SIF tab does not set F5 again. Unchecking an invoice that already has manual import tax
 * lines asks for confirmation first (the rows stay on the invoice; only the cards are hidden), built
 * on the system Dialog primitives like `LocaleChangeConfirmDialog` — the codebase has no generic
 * confirm component.
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
  const { showSii: orgFilesSii, adopted: siiAdopted } = useOrgSii(
    data, apiBaseUrl, showCards || (enabled && isImportDuaTypeKey(data)));
  const deferredVat = useSiiDeferredVat({
    apiBaseUrl,
    recordId: savedId,
    enabled: showCards,
    refreshKey: `${data?.updated ?? ''}|${checked}`,
  });
  if (!enabled) return null;

  const readOnly = isDocumentReadOnly || windowReadOnly || isYes(data?.aeatsiiIssent)
    || data?.processed === true;
  const lockedOn = isImportDuaLockedOn(data);
  const uncheck = () => {
    const patch = importDuaUncheckPatch({
      record: data,
      isDraft: isDraftStatus(data?.documentStatus),
      siiLocked: readOnly,
      showSii: orgFilesSii,
    });
    patch.forEach(([field, value]) => onFieldChange?.(field, value));
  };
  const handleToggle = (val) => {
    if (val) {
      onFieldChange?.(FIELD, true);
    } else if (needsUncheckConfirmation(data)) {
      setConfirmUncheck(true);
    } else {
      uncheck();
    }
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
        onConfirm={() => { setConfirmUncheck(false); uncheck(); }}
        data-testid="UncheckConfirmDialog__importDua" />
      {showCards && (
        <SiiImportDuaSection
          ui={ui}
          siiTypeKey={getVal('aeatsiiClaveTipoFc') || null}
          getVal={getVal}
          getDateVal={getDateVal}
          onChange={onFieldChange}
          readOnly={readOnly}
          duaRequired={siiAdopted}
          data-testid="SiiImportDuaSection__importDua">
          <SiiImportTaxesSection
            ui={ui}
            multiDua={isYes(getVal('aeatsiiMultiDua'))}
            duaRequired={siiAdopted}
            recordId={savedId}
            data={data}
            apiBaseUrl={apiBaseUrl}
            token={token}
            readOnly={readOnly || !isDraftStatus(data?.documentStatus)}
            onHeaderRefresh={onHeaderRefresh}
            deferredVat={deferredVat}
            accountingRegisterDate={getDateVal('aeatsiiFechaRegCont')}
            data-testid="SiiImportTaxesSection__importDua" />
        </SiiImportDuaSection>
      )}
    </div>
  );
}
