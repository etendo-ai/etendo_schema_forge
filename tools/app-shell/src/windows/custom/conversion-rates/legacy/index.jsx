// ETP-6365 — FROZEN COPY of the generated Conversion Rates window as it was before ETP-6365
// (artifacts/conversion-rates/generated/web/conversion-rates/, revision 0aa24ca6b^). Owned by the
// per-account flag currency-conversion-v2: with the flag off, LegacyConversionRatesWindow renders
// it so the user sees the window exactly as before the redesign (read-only, date-only validity,
// no Status column). Never regenerated and never edited to follow decisions.json; deleted with
// the flag. The current generated window (regenerated from the new decisions.json) is not used.
import ConversionRatePage, { api } from './ConversionRatePage';

const windowMeta = { category: 'finance', name: 'Conversion Rates', readOnly: true, id: '116' };

export default function App({ windowName, recordId, token, apiBaseUrl, window, ...rest }) {
  return (
    <ConversionRatePage
      windowName={windowName}
      recordId={recordId}
      token={token}
      apiBaseUrl={apiBaseUrl}
      window={window || windowMeta}
      api={api}
      {...rest}
      data-testid="ConversionRatePage__a3aa8a" />
  );
}
