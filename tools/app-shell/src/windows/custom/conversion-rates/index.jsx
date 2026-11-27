import CurrencyConversionRoute from './CurrencyConversionRoute.jsx';

/**
 * ETP-6365 — "Conversión de divisas" (Currency Conversion): registry entry of `conversion-rates`
 * (`layoutType: "custom"` in `artifacts/conversion-rates/decisions.json`). Which page it shows
 * depends on the per-account flag `currency-conversion-v2` (capability `currencyConversionV2`),
 * decided in `CurrencyConversionRoute`: on, the hand-written page — `/conversion-rates/:recordId`
 * keeps resolving here and shows the same page, rows are edited in a dialog —; off, the generated
 * read-only window as it was before ETP-6365.
 */
export default function App(props) {
  return <CurrencyConversionRoute {...props} data-testid="CurrencyConversionRoute__convrate" />;
}
