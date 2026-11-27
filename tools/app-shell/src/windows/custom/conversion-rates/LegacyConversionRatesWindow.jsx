import LegacyConversionRatesApp from './legacy/index.jsx';

/**
 * ETP-6365 — the Conversion Rates window AS IT WAS BEFORE the redesign, shown while the per-account
 * flag `currency-conversion-v2` is off (see `CurrencyConversionRoute`). Owned by the flag: retiring it
 * deletes this file and the `legacy/` folder.
 *
 * It renders `legacy/`, a frozen copy of the generated window at revision `0aa24ca6b^` (before
 * ETP-6365), NOT the current generated window: that one is regenerated from the redesign's
 * decisions.json (Status column, date-time validity, organization selector, DELETE). The copy keeps
 * the old columns (Currency, To Currency, Valid From Date, Valid To Date as dates, Multiple Rate By,
 * Divide Rate By, Synced), the attachments tab of the detail, the old name and breadcrumb
 * ("Conversion Rates", "Finance / Conversion Rates") and its static `api.window.readOnly` plus
 * `hideCreate`. `window.readOnly` is forced here as well, whatever window the route passes.
 */
export const LEGACY_WINDOW = Object.freeze({
  category: 'finance',
  name: 'Conversion Rates',
  readOnly: true,
  id: '116',
});

export default function LegacyConversionRatesWindow({ window: _ignored, ...props }) {
  return <LegacyConversionRatesApp {...props} window={LEGACY_WINDOW} data-testid="LegacyConversionRatesApp__6365a1" />;
}
