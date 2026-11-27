// ETP-6365 — FROZEN COPY of the generated Conversion Rates window as it was before ETP-6365
// (artifacts/conversion-rates/generated/web/conversion-rates/, revision 0aa24ca6b^). Owned by the
// per-account flag currency-conversion-v2: with the flag off, LegacyConversionRatesWindow renders
// it so the user sees the window exactly as before the redesign (read-only, date-only validity,
// no Status column). Never regenerated and never edited to follow decisions.json; deleted with
// the flag. The current generated window (regenerated from the new decisions.json) is not used.
// The labels below are the generator's English fallbacks; at runtime each one is translated from its
// AD column through useLabel, exactly as in the generated window this copies.
// i18n-allowlist: ["Currency", "To Currency", "Valid From Date", "Valid To Date", "Multiple Rate By", "Divide Rate By", "Synced"]
import { EntityForm } from '@/components/contract-ui';

const fields = [
  { key: 'currency', column: 'C_Currency_ID', type: 'selector', label: 'Currency', required: true, section: 'principal', reference: 'Currency', inputMode: 'selector', defaultValue: '@SQL=SELECT C_CURRENCY_ID FROM AD_CLIENT  WHERE AD_CLIENT_ID = @AD_CLIENT_ID@', readOnlyLogic: (record) => (record['sMFCRSynced'] === true || record['sMFCRSynced'] === 'Y') },
  { key: 'toCurrency', column: 'C_Currency_ID_To', type: 'selector', label: 'To Currency', required: true, section: 'principal', reference: 'Currency', inputMode: 'selector', defaultValue: '@SQL=SELECT C_CURRENCY_ID FROM AD_CLIENT  WHERE AD_CLIENT_ID = @AD_CLIENT_ID@', readOnlyLogic: (record) => (record['sMFCRSynced'] === true || record['sMFCRSynced'] === 'Y') },
  { key: 'validFromDate', column: 'ValidFrom', type: 'date', label: 'Valid From Date', required: true, section: 'principal', readOnlyLogic: (record) => (record['sMFCRSynced'] === true || record['sMFCRSynced'] === 'Y') },
  { key: 'validToDate', column: 'ValidTo', type: 'date', label: 'Valid To Date', section: 'principal', readOnlyLogic: (record) => (record['sMFCRSynced'] === true || record['sMFCRSynced'] === 'Y') },
  { key: 'multipleRateBy', column: 'MultiplyRate', type: 'number', label: 'Multiple Rate By', required: true, section: 'other', readOnlyLogic: (record) => (record['sMFCRSynced'] === true || record['sMFCRSynced'] === 'Y') },
  { key: 'divideRateBy', column: 'DivideRate', type: 'number', label: 'Divide Rate By', required: true, section: 'other', readOnlyLogic: (record) => (record['sMFCRSynced'] === true || record['sMFCRSynced'] === 'Y') },
  { key: 'sMFCRSynced', column: 'EM_SMFCR_Is_Synced', type: 'checkbox', label: 'Synced', readOnly: true, section: 'principal' },
];

export default function ConversionRateForm(props) {
  return <EntityForm fields={fields} {...props} data-testid="EntityForm__8c0432" />;
}
ConversionRateForm.fields = fields;

