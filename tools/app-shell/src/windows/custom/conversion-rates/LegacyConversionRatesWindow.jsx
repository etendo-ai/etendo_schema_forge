import ConversionRatesApp from '@generated/conversion-rates/generated/web/conversion-rates/index.jsx';

/**
 * ETP-6365 — the Conversion Rates window AS IT WAS BEFORE the redesign, shown while the per-account
 * flag `currency-conversion-v2` is off (see `CurrencyConversionRoute`): the generated list and form
 * of the `conversion-rates` spec, read-only, under the old name. Owned by the flag: retiring it
 * deletes this file.
 *
 * `window.readOnly` is what the generated page carried before ETP-6365 (`decisions.json`
 * `window.readOnly: true`): ListView hides «Nuevo», bulk delete, print and the row write actions,
 * and DetailView renders the form read-only with no Delete. The old name travels as the window
 * name, list title and breadcrumb; each is a menu label already translated in the locales
 * ("Conversion Rates" → "Rangos de conversión").
 */
// i18n-allowlist: ["Conversion Rates", "Finance / Conversion Rates"]
export const LEGACY_WINDOW = Object.freeze({
  category: 'finance',
  name: 'Conversion Rates',
  readOnly: true,
  id: '116',
});

export const LEGACY_LABEL = 'Conversion Rates';
export const LEGACY_BREADCRUMB = 'Finance / Conversion Rates';

export default function LegacyConversionRatesWindow({ window: _ignored, ...props }) {
  return (
    <ConversionRatesApp
      {...props}
      window={LEGACY_WINDOW}
      // The list is titled with the old window name; the detail keeps its generated record label.
      {...(props.recordId ? {} : { entityLabel: LEGACY_LABEL })}
      breadcrumb={LEGACY_BREADCRUMB}
      data-testid="ConversionRatesApp__legacy" />
  );
}
