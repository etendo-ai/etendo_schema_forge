# Customer portal: the link token never stays in the URL

ETP-6209, QA CP-43. The token in a customer-portal email link is the whole credential (it works like a
password). The portal runs on the same host as the app (`app.etendo.ai`), where Google Tag Manager
loads Google Analytics and HubSpot on the app's pages. Portal pages load none of them (see "Portal
pages load no third-party tags and no tracking" below). The token still leaves the address bar before
anything runs, so that no script, extension or next site (`document.referrer`) can read it.

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

## Portal pages load no third-party tags and no tracking

ETP-6209, agreed with QA and the product owner: the portal has **no tracking**. Marketing's rule is
no analytics, pixels or cookies without a consent banner, and the portal's visitors are customers of
our customers, who never see one. `main.jsx` decides once whether the page load starts on a portal
path (`const portalPage = isPortalPath(…)`), and hands that one decision to the tag container and to
observability:

- `isPortalPath({ pathname, routerBase })` (`lib/portal/portalLinkSession.js`) recognises `/portal`,
  `/portal/…` and the decision landing, below the router base too. It reuses `parsePortalPath`, so
  there is no second regex;
- **no Google Tag Manager, so no Google Analytics or HubSpot**: `resolveGtmId({ …, portalPage })`
  (`lib/marketing/gtm.js`) returns `null` and `installGtm(null)` does nothing. The marketing
  `dataLayer` pushes (`lib/marketing/dataLayer.js`) are no-ops without GTM (`isGtmInstalled`);
- **no Datadog Browser RUM**: `initBrowserObservability({ portalPage })` (`lib/observability/browser.js`)
  leaves the Datadog provider out. The core adapter always tracks user interactions (click actions),
  may record session replay and keeps the `_dd_s` session cookie, and none of that can be switched
  off per page. There is no non-RUM Datadog logger, so **the portal's JS errors do not reach
  Datadog** (accepted trade-off);
- **no browser Mixpanel**: the Mixpanel provider is left out as well;
- **no feature-flag provider**: `main.jsx` skips `initFeatureFlags()` on a portal page. No portal code
  reads a client-side flag (checked across the 96 modules the two portal pages import, the shared
  components included). With remote flags, the Datadog Feature Flags SDK would report exposures to
  Datadog on its own. Every flag resolves to its declared default there. As a side effect, a
  **remote** telemetry kill (`telemetry-kill-aws-rum`) does not reach a portal tab; the build-time
  `VITE_TELEMETRY_KILL` still does;
- **AWS CloudWatch RUM stays when it is enabled**. It records performance, errors and HTTP calls only
  (no interactions), with cookies off by default (`VITE_RUM_ALLOW_COOKIES`), and it is the portal's
  only browser error monitoring.

The `main.jsx boot order` guardrail in `lib/portal/__tests__/portalLinkSession.test.js` fails if
`main.jsx` stops handing `portalPage` to `resolveGtmId`, to `initBrowserObservability` or to the
`initFeatureFlags()` guard. If portal code ever needs a flag, that guard has to be revisited, and
the flag would need a provider that sends no exposures.

**Deciding once per page load is enough, because the portal is a separate entry.** Nothing in the
app navigates into `/portal` (the only way in is the email link, which is a full page load). The
portal never navigates into the app inside the same document: its outbound links ("Creado con
Etendo", "Empieza gratis") open a new tab, which is a fresh page load that decides for itself. If
an in-app link into `/portal` is ever added, it must be a full navigation (`window.location`),
never a router `navigate()`. Otherwise GTM, Datadog RUM and Mixpanel, already started by the app
page, would see the portal (GTM through its History Change trigger, the others through their route
tracking).

Everywhere else (sign-up, onboarding, the app) GTM loads as before. The rules that kept the token
safe from tags still apply to any tag the app adds:

- Load tags **from JavaScript that runs after `main.jsx`'s first import**, as `installGtm()` does.
  Keep `import './lib/portal/scrubPortalUrl.boot.js'` as the first line of `main.jsx`.
- **Never add a static `<script>` to `index.html`** for a tag. A classic or `async` script there would
  run on portal pages too, before the module graph, and could read the token.

## The etendo.ai links carry the tenant, never the token

The portal's two links to etendo.ai are built by `etendoLinkFor(piece, clientId)`
(`tools/app-shell/src/pages/portal/portalMarketingLinks.js`):

- "Creado con etendo.ai" (the desktop pill and the mobile tile) uses the `learnMore` link;
- the rail banner's «Empieza gratis» uses the `startFree` link.

Each link is marketing's verbatim UTM URL plus `&portal_ref=<AD_Client_ID>` (marketing's UTM
document, 2026-11-25). The id is the tenant the portal already knows: from the URL, or from `/me`
for a pre-CP-43 link. `PortalPage` provides it through `PortalClientContext`.

`etendoLinkFor` only accepts a value shaped like a tenant id (`isPortalClientId`, 32 hex
characters). So the 43-character token can never become a `portal_ref`, and nothing about the
recipient ever travels in the link. When the tenant is not known, the link is the bare base URL.

The links still open in a new tab with `rel="noopener noreferrer"`. The transactional emails carry
no `portal_ref`.

## KPI session id, open origins and Etendo clicks (ETP-6209 KPIs)

The portal's KPIs are counted server-side and only from the portal's own servlet. No third party is
involved.

- **Session id.** An opaque 32-hex id that the backend mints and rotates.
  - It travels as the `X-Portal-Session` header, in both directions, on every request that carries
    `X-Portal-Token` (`usePortalApiFetch`). `/me` also returns it as `sessionId`.
  - It is kept per tab in `sessionStorage['etgo.portal.session']`.
  - **It is not a credential:** it grants nothing, and the token still authorizes every request.
  - **It is never put in a URL.**
  - A token arriving in the URL (a new email click, or a decision landing's way into the portal)
    clears it, so that visit starts a new session. A reload keeps it.
- **Origin of a document open.** It travels in the router's navigation state, never in the page
  URL, and the detail sends it as `?origin=` on its request to `/sws/portal`. The values are:
  - `link`: the entry landing;
  - `home`: Inicio's recent documents;
  - `search`: the header search;
  - `list`: a list row or card;
  - `related`: a related document;
  - `refresh`: the related-documents refresh;
  - `action`: the card menu's accept / reject pre-read.
- **PDF purpose.** The detail's automatic preview asks `?purpose=preview`. The detail's Download
  button re-requests `?purpose=download&origin=detail`. The card menu asks
  `?purpose=download&origin=list`.
- **Clicks on the etendo.ai links.** Only clicks are counted, not where the visitor goes next.
  - Endpoint: `POST /sws/portal/events/etendo-click`, body `{reference, location}`, with
    `reference ∈ learnMore|startFree` and `location ∈ header|mobile|rail`.
  - It is sent through the portal's `apiFetch` with `keepalive`, fire-and-forget
    (`sendPortalEtendoClick`). It never delays the link, and its errors are swallowed.

## Closed: HubSpot click tracking captured element text

QA found `track.hubspot.com/__ptc.gif?…_hs_element_text=24/11/2026 PR1000060 … Bajo evaluación
900,00`: HubSpot click events recorded the text of the clicked element, so customer document data
reached HubSpot. It is closed by the rule above: HubSpot is loaded only through GTM, and GTM no
longer loads on portal pages.
