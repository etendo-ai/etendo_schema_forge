/**
 * Side-effect module: MUST stay the first import of `main.jsx` (ETP-6209, QA CP-43).
 *
 * ES modules evaluate their imports in order before the importer's body, so importing this first
 * rewrites a portal email link (`/portal/{clientId}/{token}`) to its token-free form before the
 * router, observability, feature flags or any analytics loader can read `location`. See
 * `portalLinkSession.js` for the contract and `docs/customer-portal-link-token.md` for where
 * third-party tags may be injected.
 */
import { detectBasePath } from '../neoBaseUrl.js';
import { scrubPortalTokenFromLocation } from './portalLinkSession.js';

scrubPortalTokenFromLocation({ routerBase: detectBasePath().routerBase });
