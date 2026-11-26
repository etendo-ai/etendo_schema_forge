import { useEffect, useState } from 'react';
import { useUI } from '@/i18n';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { InfoTooltipButton } from '@/components/currency-summary/InfoTooltipButton.jsx';

export const SCHEME_CORE = 'CORE';
export const SCHEME_B2B = 'B2B';

const FIELD_LABEL = 'inline-flex items-center gap-1 text-sm leading-6 font-medium text-foreground';

/** The value shown: what the user chose in this session, else what the server holds (default Core). */
export function advancedOptionValues(info, draft) {
  return {
    scheme: draft.scheme ?? (info?.directDebitScheme === SCHEME_B2B ? SCHEME_B2B : SCHEME_CORE),
  };
}

/**
 * ETP-6247 — the option of a COLLECTION remittance, rendered as a bare grid cell (a fragment) so, through the
 * footer's `inlineInHeaderCard` slot, it flows into a free column of the header form's own grid (row
 * Nombre | Fecha | Esquema), label above: «Esquema de adeudo» (Core | B2B), the remittance's `directDebitScheme`
 * written by the header's CRUD: a change is handed to the header form (`onChange(key, value)`) and saved by its
 * «Guardar», like the IBAN, also on create. Editable until the remittance is processed, read-only afterwards as the
 * same disabled grey input the other read-only header fields use. The caller renders it only for a collection type
 * (never for a payment).
 */
export default function RemittanceAdvancedOptions({ info, processed, onChange, onTouched }) {
  const ui = useUI();
  const [draft, setDraft] = useState({});
  // A different value on the server (after a save, or another remittance) replaces what was chosen.
  useEffect(() => { setDraft({}); }, [info?.directDebitScheme]);
  const { scheme } = advancedOptionValues(info, draft);

  const chooseScheme = (value) => {
    setDraft((prev) => ({ ...prev, scheme: value }));
    onTouched?.();
    onChange?.('directDebitScheme', value);
  };

  return (
    <>
      <div className="flex min-w-0 flex-col gap-2" data-testid="remittance-scheme-row">
        <Label htmlFor="remittance-scheme" className={FIELD_LABEL} data-testid="Label__scheme">
          {ui('remittanceDirectDebitScheme')}
          <InfoTooltipButton label={ui('remittanceDirectDebitSchemeInfo')} testId="remittance-scheme-info" contentTestId="remittance-scheme-info-tooltip" data-testid="InfoTooltipButton__scheme" />
        </Label>
        {processed ? (
          <Input
            id="remittance-scheme"
            value={ui(scheme === SCHEME_B2B ? 'remittanceSchemeB2b' : 'remittanceSchemeCore')}
            disabled
            readOnly
            data-testid="remittance-scheme-value" />
        ) : (
          <Select value={scheme} onValueChange={chooseScheme} data-testid="Select__scheme">
            <SelectTrigger id="remittance-scheme" className="bg-card" data-testid="remittance-scheme-trigger">
              <SelectValue data-testid="SelectValue__scheme" />
            </SelectTrigger>
            <SelectContent data-testid="SelectContent__scheme">
              <SelectItem value={SCHEME_CORE} data-testid="remittance-scheme-option-core">{ui('remittanceSchemeCore')}</SelectItem>
              <SelectItem value={SCHEME_B2B} data-testid="remittance-scheme-option-b2b">{ui('remittanceSchemeB2b')}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    </>
  );
}
