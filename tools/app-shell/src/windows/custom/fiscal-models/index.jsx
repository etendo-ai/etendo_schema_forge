import { useWindowAccess, WindowAccessGuard } from '@/auth/AuthContext.jsx';
import FiscalModelsPage from './FiscalModelsPage';

/**
 * "Modelos Fiscales" is the GO feature `fiscal-models` (ETP-4802): its access is the role's GO Access
 * row, or the legacy Tax Report grant while it has none, resolved by the backend's
 * `GoFeatureAccess` and published as `windowAccess['fiscal-models']`, so this guard answers like the
 * `/fiscal303`, `/fiscal349` and catalog endpoints (ETP-5546) and the Role window's GO Access subtab.
 */
export const FISCAL_MODELS_FEATURE_ID = 'fiscal-models';

/**
 * ETP-5546 — route entry: a role without the window grant sees the access-denied screen
 * instead of the page. Before this fix, `index.jsx` was a bare re-export with no guard at
 * all, so navigating directly to `/fiscal-models` rendered the full page regardless of role
 * (the sidebar already hid the entry, but the route itself enforced nothing).
 */
export default function FiscalModelsRoute(props) {
  const windowAccessTier = useWindowAccess(FISCAL_MODELS_FEATURE_ID);
  if (windowAccessTier === 'none') {
    return <WindowAccessGuard windowId={FISCAL_MODELS_FEATURE_ID} data-testid="WindowAccessGuard__fiscalmodels" />;
  }
  return <FiscalModelsPage {...props} data-testid="FiscalModelsPage__fiscalmodels" />;
}
