import { useAuthOptional } from '@etendo-ai/app-shell-core/auth';
import { ListProgressBar } from '@/components/contract-ui/ListProgressBar.jsx';
import { useCapabilitiesSafe } from '@/hooks/useCapabilitiesSafe.js';
import { CURRENCY_CONVERSION_V2_CAPABILITY, isCapabilityVisible } from '@/lib/capabilityVisibility.js';
import ConversionRatesPage from './ConversionRatesPage.jsx';
import LegacyConversionRatesWindow from './LegacyConversionRatesWindow.jsx';

/**
 * ETP-6365 — route entry of `conversion-rates`, the toggle point of the per-account flag
 * `currency-conversion-v2`. The backend evaluates the flag and publishes it as
 * `capabilities.currencyConversionV2` (`SFWindowAccessMap`); the browser never evaluates it, so the
 * window shown and the writes the backend accepts always agree.
 *
 * - on: the redesigned Currency Conversion page (`ConversionRatesPage`);
 * - off, or an older backend that does not publish the capability: the window as it was before
 *   ETP-6365 (`LegacyConversionRatesWindow`, the generated read-only list and form).
 *
 * While the access maps load (a reload or a deep link) they read as `{}`, which would flash the
 * read-only window before switching, so until `accessLoaded` is true a progress bar shows. Without
 * an `AuthProvider` (unit tests) or with a core that does not publish `accessLoaded`, the maps are
 * taken as loaded. Same shape as the remittance and invoice-inbox route guards.
 */
export default function CurrencyConversionRoute(props) {
  const capabilities = useCapabilitiesSafe();
  const accessLoaded = useAuthOptional()?.accessLoaded;
  if (accessLoaded === false) {
    return <ListProgressBar testId="conversion-rates-access-loading" data-testid="ListProgressBar__6365a1" />;
  }
  if (isCapabilityVisible(capabilities, CURRENCY_CONVERSION_V2_CAPABILITY)) {
    return <ConversionRatesPage {...props} data-testid="ConversionRatesPage__convrate" />;
  }
  return <LegacyConversionRatesWindow {...props} data-testid="LegacyConversionRatesWindow__6365a1" />;
}
