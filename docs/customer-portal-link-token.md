# Customer portal: the link token never stays in the URL

ETP-6209, QA CP-43. The token in a customer-portal email link is the whole credential (it works like a
password). The portal runs on the same host as the app (`app.etendo.ai`), where Google Tag Manager
loads Google Analytics and HubSpot. Every one of these tags reads `location.href`, and the next site
reads `document.referrer`. So the token must be out of the address bar before any of them runs.

## Link formats

| Link | Address bar after load | Token kept in |
|---|---|---|
| `/portal/{AD_Client_ID}/{token}` (current emails) | `/portal/{AD_Client_ID}` | `sessionStorage['etgo.portal.link']` |
| `/portal/{token}` (older emails) | `/portal`, then `/portal/{AD_Client_ID}` once `/me` returns `clientId` | same |
| `/portal/{AD_Client_ID}/decision/{token}` (decision confirmation) | `/portal/{AD_Client_ID}/decision` | `sessionStorage['etgo.portal.decision']` |
| `/portal/decision/{token}` (older confirmations) | `/portal/decision` | same |

The first path segment is a tenant id when it is 32 hex characters. A token is 43 URL-safe base64
characters (`PortalTokens.newToken`), so the two shapes never collide.

`sessionStorage` is per tab and survives a reload, so reloading `/portal/{AD_Client_ID}` keeps working
for the rest of the session. **The token-free URL is not a bookmark.** A new tab, or a bookmark of
the scrubbed URL, has no token and shows the generic "link no longer valid" screen. The customer
opens the email link again.

## Where it happens

1. `tools/app-shell/src/lib/portal/scrubPortalUrl.boot.js` is the **first import of `main.jsx`**.
   ES modules run their imports in order before the importer's body, so it runs before the router,
   observability, feature flags and the GTM install. It calls
   `scrubPortalTokenFromLocation()` (`lib/portal/portalLinkSession.js`), which:
   - reads the token from the path and stores it in `sessionStorage`;
   - `history.replaceState`s the URL to its token-free form;
   - on every `/portal…` route, sets `<meta name="referrer" content="same-origin">`. Outbound
     links and cross-origin requests then send no referrer at all. It is not `no-referrer`, because
     that would also send `Origin: null` on the portal's own POSTs.
2. `PortalPage` and `PortalDecisionPage` read the token back (`resolvePortalRoute`,
   `readPortalDecision`). If a token is still in the URL (an in-app navigation that the boot scrub
   did not see), they store it and `navigate(…, { replace: true })` to the token-free path. The
   decision landing sends its confirmation POST only from the token-free URL.
3. The decision landing hands over the fresh portal token from the confirm answer with
   `rememberPortalLink` and opens `/portal/{AD_Client_ID}?view=doc…`. The token is never put in the
   URL.
4. On the wire, the token goes in `X-Portal-Token` and the tenant in `X-Portal-Client`. Neither is
   ever sent in a query string (`lib/portal/portalApi.js`, `usePortalApiFetch.js`).

## What the SPA cannot protect: the first request's access log

The email link's path carries the token, so the browser's first `GET /portal/{AD_Client_ID}/{token}`
(and `GET /portal/{AD_Client_ID}/decision/{token}`) reaches the SPA container and every proxy in
front of it (CloudFront, the gateway) with the token in the request line. Their access logs record
it. This follows from the link shape the story specifies, and no client-side code can prevent it:
the scrub runs only after that request has been served.

**Recommendation (ops):** mask `/portal/*` paths in every access log on the path, by logging the
path truncated after `/portal/{AD_Client_ID}` or with the last segment replaced by `***`. Logs that
already exist for those paths contain live credentials for 48 hours (decision tokens never expire)
and should be treated as secrets. Later portal requests are safe: they go to `/sws/portal/*` with
the token in the `X-Portal-Token` header, which access logs do not record by default.

## Why there is no global referrer meta in `index.html`

A static `<meta name="referrer" content="same-origin">` in `index.html` would apply before any
script, but it would change the referrer policy of the **whole app**, not only the portal. The app
depends on cross-origin `Referer` in places:

- `GoSessionSecurity.isOriginAllowed` (com.etendoerp.go) falls back to the `Referer` origin for its
  CSRF origin check when a request has no `Origin`;
- the bank-connection (`FinancialAccountBankConnectionHandler`) and PIS (`PisPaymentBridge`) flows
  build their return URL from `Origin`, falling back to `Referer`;
- the SPA container can be served from a different origin than the backend (`VITE_API_BASE`), and
  there `same-origin` drops `Referer` on every API call.

Browsers send `Origin` on the unsafe requests those checks guard, so the fallback rarely fires. A
change to the app-wide security behaviour is still out of the portal's scope, so the policy is set
only on portal routes, by the boot scrub, before any tag can load. The meta is not needed to hide
the token: the token is already out of the URL by then. It only keeps the portal URL itself off
outbound navigation. If the SPA container ever gets its own server config, a `Referrer-Policy:
same-origin` response header on `/portal*` is the static equivalent.

## Rule for third-party tags (GTM, Google Analytics, HubSpot, anything new)

- Load them **from JavaScript that runs after `main.jsx`'s first import**, as `installGtm()` does
  in `main.jsx` (ETP-6363). Keep `import './lib/portal/scrubPortalUrl.boot.js'` as the first line
  of `main.jsx`. Nothing may be imported above it.
- **Never add a static `<script>` to `index.html`** for a tag. A classic or `async` script there can
  run before the module graph and read the token.
- Single-page navigations inside the portal only change the search string (`?view=…`). GTM's
  History Change trigger therefore only ever sees token-free URLs.

## Known gap: HubSpot click tracking captures element text (open)

QA found `track.hubspot.com/__ptc.gif?…_hs_element_text=24/11/2026 PR1000060 … Bajo evaluación
900,00`. HubSpot click events record the clicked element's text, so customer document data
(numbers, dates, amounts) reaches HubSpot. This is not a token leak, but it is customer data. No
code change was made for it. The options, to be decided by product and marketing:

1. **In the GTM container (no code):** do not fire the HubSpot tag, or HubSpot's click events, on
   `Page Path` starting with `/portal`. This is the cheapest option and it is reversible.
2. **In HubSpot:** remove or scope the "clicked element" events defined for the app's URLs so that
   they exclude `/portal`.
3. **In the SPA:** push `_hsq.push(['doNotTrack'])` on portal routes. This is HubSpot's documented
   opt-out. It also stops the portal page views that the KPI asks for, and its cookie persists for
   the whole host.
4. **In the SPA:** do not install GTM on portal routes. This conflicts with the acceptance criterion
   that GA and HubSpot receive `/portal/{AD_Client}`.
