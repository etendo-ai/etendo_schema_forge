// Relative import, not the `@/` alias: keeps this module loadable by plain `node --test`.
import { isPortalClientId } from '../../lib/portal/portalLinkSession.js';

/**
 * The portal's two links to etendo.ai, as marketing's UTM document gives them, verbatim
 * (ETP-6209; base URLs approved 2026-11-24/25):
 * - `learnMore`: the "Creado con etendo.ai" pill (desktop) and the compact Etendo tile (mobile);
 * - `startFree`: the rail banner's «Empieza gratis».
 */
export const ETENDO_LINK_BASES = Object.freeze({
  learnMore: 'https://etendo.ai/?utm_source=portal_clientes&utm_medium=in_app&utm_campaign=portal_clientes&utm_content=boton_conoce_mas',
  startFree: 'https://etendo.ai/precios/?utm_source=portal_clientes&utm_medium=in_app&utm_campaign=portal_clientes&utm_content=banner_empieza_gratis',
});

/**
 * One etendo.ai link of the portal, with `&portal_ref=<portal id>` (marketing's UTM document,
 * 2026-11-25). The portal id is the issuing tenant's `AD_Client_ID`, the one the portal already
 * knows from its URL or `/me`, and nothing else: it never carries the link token nor anything
 * about the recipient. Only a value of the tenant-id shape (`isPortalClientId`: 32 hex characters)
 * is used, so a token (43 URL-safe base64 characters) can never end up here by mistake. Without a
 * tenant id, the base URL alone. Emails carry no `portal_ref`: this is the portal's own links only.
 *
 * @param {'learnMore'|'startFree'} piece which link
 * @param {string|null} [clientId] the portal's tenant id
 * @returns {string}
 */
export function etendoLinkFor(piece, clientId = null) {
  // An unknown piece falls back to the pill's link rather than building "undefined&portal_ref=…".
  const base = ETENDO_LINK_BASES[piece] ?? ETENDO_LINK_BASES.learnMore;
  if (!isPortalClientId(clientId)) return base;
  return `${base}&portal_ref=${encodeURIComponent(clientId)}`;
}
