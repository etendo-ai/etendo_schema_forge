import { WindowAccessGuard, useWindowAccess } from '@/auth/AuthContext.jsx';
import NotPostedDocumentsPage from './NotPostedDocumentsPage';

/**
 * "Documentos no contabilizados" is the GO feature `not-posted-documents` (ETP-4802): its access is
 * the role's GO Access row, or the legacy OBUIAPP process grant while it has none, resolved by the
 * backend's `GoFeatureAccess` and published as `windowAccess['not-posted-documents']`. The same
 * decision backs `NotPostedDocumentsHandler` and the sidebar entry (`SFListMenu`), so the page, the
 * menu and the API always agree.
 */
export const NOT_POSTED_DOCUMENTS_FEATURE_ID = 'not-posted-documents';

/**
 * ETP-5485 (BUG-2) — route entry: a role without access sees the access-denied screen instead of
 * the page, matching the sidebar, which already hides the entry for that role. While the access map
 * is still loading the tier is `none` and the denied screen shows briefly (same as every
 * window-gated page); the page never mounts, so it fires no request before access resolves.
 */
export default function NotPostedDocumentsRoute(props) {
  const tier = useWindowAccess(NOT_POSTED_DOCUMENTS_FEATURE_ID);
  if (tier === 'none') {
    return (
      <WindowAccessGuard windowId={NOT_POSTED_DOCUMENTS_FEATURE_ID} data-testid="WindowAccessGuard__adfd18" />
    );
  }
  return <NotPostedDocumentsPage {...props} data-testid="NotPostedDocumentsPage__adfd18" />;
}
