import { writePortalView } from './portalPresentation.js';
import { portalPath } from '../../lib/portal/portalLinkSession.js';

/**
 * ETP-6209 Part C — the way from a confirmed quotation decision into the portal.
 *
 * The confirmation landing (`/portal/{clientId}/decision`) receives, in the confirm POST's answer,
 * a fresh portal token (`portalToken`), the quotation (`quotationId`) and the tenant (`clientId`).
 * It then opens the portal on the quotation, with no notice: the Figma has none (the confirmation
 * page already said what happened), so the earlier one-off "Has rechazado el presupuesto…" banner
 * was removed.
 *
 * **The token never goes into the URL (CP-43).** The entry is a token-free path plus the link to
 * remember for this tab; the caller stores the link (`rememberPortalLink`) and then navigates.
 */

/** The quotation kind the portal opens on (the backend's `PortalDocumentKind`). */
const QUOTATION_KIND = 'QUOTATION';

/**
 * The portal entry a confirmation leads to, or `null` when its answer carries no way in (invalid
 * token, portal closed for the customer, minting failed): the landing then keeps its own card.
 *
 * @param {{ portalToken?: string|null, quotationId?: string|null, clientId?: string|null }} result
 *   the confirm answer
 * @param {string|null} [fallbackClientId] the tenant from the landing's own URL, for a backend
 *   whose answer does not name it
 * @returns {{ path: string, link: { clientId: string|null, token: string } }|null}
 */
export function portalEntryPath(result, fallbackClientId = null) {
  if (!result?.portalToken || !result?.quotationId) return null;
  const clientId = result.clientId ?? fallbackClientId ?? null;
  const search = writePortalView({ view: 'doc', kind: QUOTATION_KIND, id: result.quotationId });
  return {
    path: portalPath(clientId, search),
    link: { clientId, token: result.portalToken },
  };
}
