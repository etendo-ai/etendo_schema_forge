// ETP-6365 — FROZEN COPY of the generated Conversion Rates window as it was before ETP-6365
// (artifacts/conversion-rates/generated/web/conversion-rates/, revision 0aa24ca6b^). Owned by the
// per-account flag currency-conversion-v2: with the flag off, LegacyConversionRatesWindow renders
// it so the user sees the window exactly as before the redesign (read-only, date-only validity,
// no Status column). Never regenerated and never edited to follow decisions.json; deleted with
// the flag. The current generated window (regenerated from the new decisions.json) is not used.
// The labels below are the generator's English fallbacks; at runtime each one is translated from its
// AD column through useLabel, exactly as in the generated window this copies.
// i18n-allowlist: ["Currency", "To Currency", "Valid From Date", "Valid To Date", "Multiple Rate By", "Divide Rate By", "Synced"]
import { forwardRef } from 'react';
import { DataTable, InlineLinesPanel } from '@/components/contract-ui';

export const columns = [
  { key: 'currency', column: 'C_Currency_ID', type: 'selector', label: 'Currency', required: true },
  { key: 'toCurrency', column: 'C_Currency_ID_To', type: 'selector', label: 'To Currency', required: true },
  { key: 'validFromDate', column: 'ValidFrom', type: 'date', label: 'Valid From Date', required: true },
  { key: 'validToDate', column: 'ValidTo', type: 'date', label: 'Valid To Date' },
  { key: 'multipleRateBy', column: 'MultiplyRate', type: 'number', label: 'Multiple Rate By', required: true },
  { key: 'divideRateBy', column: 'DivideRate', type: 'number', label: 'Divide Rate By', required: true },
  { key: 'sMFCRSynced', column: 'EM_SMFCR_Is_Synced', type: 'boolean', label: 'Synced' },
];

const filters = ['currency', 'toCurrency'];

const ConversionRateTable = forwardRef(function ConversionRateTable(props, ref) {
  // Inline-editable layout always uses InlineLinesPanel for existing rows so column
  // widths (flex layout) never shift when the add-row form opens. When addRow is
  // active we render a header-hidden, data-hidden DataTable below for just the
  // add-row form — it owns callouts, selectors, validation and the imperative flush
  // ref. The ref is forwarded to InlineLinesPanel so DetailView can flush pending
  // inline edits on global save.
  if (props.linesLayout === 'inlineEditable') {
    if (props.addRow?.active) {
      return (
        <>
          <InlineLinesPanel
            ref={ref}
            columns={columns}
            {...props}
            addRow={undefined}
            data-testid="InlineLinesPanel__4e8626" />
          <DataTable
            columns={columns}
            filters={filters}
            {...props}
            hideHeader
            hideDataRows
            data-testid="DataTable__4e8626" />
        </>
      );
    }
    return (
      <InlineLinesPanel
        ref={ref}
        columns={columns}
        {...props}
        data-testid="InlineLinesPanel__4e8626" />
    );
  }
  return (
    <DataTable
      columns={columns}
      filters={filters}
      {...props}
      data-testid="DataTable__4e8626" />
  );
});

export default ConversionRateTable;
