# ETP-6051 — QA findings: plan (currency, failure reasons, vendor suggestions)

Status: batch 1 (sections 2, 2b, 3.4 backend part, 5) implemented and live-verified. Batches 2 to 4
(vendor tiers, section 3.3; OCR currency, section 1.5 phase A; currency choice in the panel, section 1.5
phase B) are implemented, with review and unit tests, and AWAIT LIVE QA (not yet verified in the browser).
Manual-line pricing (section 1.8b, option 2) is implemented on top of them and also awaits live QA.
Source: the live acceptance run of ETP-6051 (real upload, real OCR through Copilot, confirm and
discard in the browser, local environment `ETP-6051`) plus one problem reported by QA (Valeria).
Sizes follow the `/estimate` model (`.claude/skills/estimate/points-table.md`, 1 point = 1 hour).

## 0. Summary

| # | Finding | Decision | Size (pts) |
|---|---------|----------|-----------:|
| 1 | A document printed in another currency is created in the vendor's currency, silently | Support it: the OCR reads the currency, the system's conversion is used, no conversion means an error | A: 19, B: 25, total 44, split (see section 1.9) |
| 2 | The partial-failure toast shows a generic reason | Fix now | 4 |
| 3 | The result toast disappears in a few seconds | Fix now: keep it for a reasonable time (section 2b) | 4 |
| 4a | Vendor suggestion: a candidate with a different tax id is tagged "Más probable" and "create new" comes second | Fix now | 14 (8 if only reordered) |
| 4b | QA error `Operation 'loc' rejected by server`: the real reason is lost | Fix now (surface the reason); root cause needs her data | 5 |
| 5 | A doubtful product match (for example 62 %) is pre-chosen and can be confirmed with one click | Keep the behavior; the opened list must show the percentage (section 5) | 4 |

## 1. Currency support

### 1.1 What the product does today (verified live, local environment)

The rules below were checked in the purchase invoice window, not only read.

- **Currency field.** The header has a mandatory "Moneda" field. It shows the code and the rate to the
  organization currency ("EUR — 1,00").
- **Only currencies with a defined conversion can be chosen.** The selector header reads
  "Conversiones al 24/11/2026" and lists the organization currency plus every currency that has a
  conversion for that date. In the test tenant: EUR 1,00 and USD 1,47. It has a search box.
- **Choosing a currency uses the system conversion.** Picking USD shows "USD — 1,47", the totals switch to
  `$`, and an "Tipos de cambio" tab appears on the invoice.
- **A custom rate is optional.** A pencil next to the field turns the rate into an editable value with
  accept / cancel. If it is not touched, the conversion defined in the system is used.
- **Backend rules** (`public-api.md` section 4.12, `DocumentCurrencyRate`, `CurrencyOptionsHandler`):
  the rate is the `C_Conversion_Rate` valid on the reference date (the accounting date on invoices); a
  rate sent by the caller is kept; saving or completing a foreign-currency document without a rate is
  refused; lines created with a price keep it as a price in the document currency (never converted).

### 1.2 What the inbox does today

| Piece | Today |
|-------|-------|
| OCR schema (`ocr/ocr-config.json`) | Has **no** currency field |
| Matcher (`ocr/InboxMatcher.putHeaderScalars`) | Currency = the printed one, else the organization's, else the client's (revised: the vendor's list currency no longer infers anything) |
| Stored document | `header.currencyId` (set by the matcher), `C_CURRENCY_ID` summary column |
| Review panel | Shows the currency through `CurrencyRatePicker`, **read only**, with the rate hardcoded to `1`, and no `apiBaseUrl`, so it cannot list options |
| Verdict | `exchangeRate` blocker already exists (`InvoiceInboxLiveChecks.rateMissing`): foreign currency with no rate on the invoice date |
| Confirm | `headerBody` already sends `currency`; `InvoiceInboxConfirmVerify` already refuses with `currency_mismatch` if the invoice does not come out in that currency |
| List / batch dialog | The list currency column and the per-currency totals in the dialog already exist |

### 1.3 Live proof that the backend already supports it

Both cases were forced by editing the stored `currencyId` of a pending document and using the real UI.

1. **Currency with a conversion (USD, 1,47).** The panel showed "USD — 1,00" (wrong rate) and `$` totals.
   Confirm produced invoice FC1000016: currency **USD**, rate **1.47** taken from the system, completed
   (`CO`), lines kept at the printed price (210 and 64.50, not converted), total 1094.45, and an automatic
   USD to EUR row (0.680272) in the document's exchange rates.
2. **Currency with no conversion (GBP).** The panel showed a red banner: "Falta el tipo de cambio. Etendo
   no tiene tipo de cambio para la moneda de la factura en su fecha. Añádelo en Etendo para poder
   confirmar", "1 obligatorio pendiente", and Confirm disabled.

So the backend needs **no change to create the invoice in the right currency**. The work is to make the
document arrive with the right currency, and to let the user act on it.

### 1.4 Requirement (as agreed)

1. The OCR reads the currency printed on the document.
2. If the tenant has a conversion for it on the invoice date, it is used (the system's, or a custom one if
   the user sets it).
3. If it does not, the document is marked as an error and the user fixes it by hand.
4. A document that prints no currency keeps today's behavior (the vendor's currency).

### 1.5 Design

**Status: phase A (OCR currency) and phase B (choice in the panel) implemented in blocks 3 and 4, awaiting
live QA.** As built: the OCR fields `currency` / `currency_raw`; `currencyByCode` and `currenciesBySymbol`
lookups; header keys `currencySource`, `currencyRaw`, `currencyUnavailable`; notice
`currency_symbol_ambiguous`; apply operation `setCurrency` (422 `invalid_currency`); inbox action
`currencyOptions`; review answer `currency {id, isoCode, symbol, scale, rate, source}`; panel picker with no
pencil (`allowRateEdit={false}`), source tag and a "Usar {iso}" button for a printed currency the tenant
does not have. Reference: `neo-headless.md` section 4.12 (inbox) and `docs/generated-custom-windows/invoice-inbox.md`.

**OCR (`com.etendoerp.go`, `ocr/`).** Add two nullable fields to the header of the schema: `currency`
(ISO 4217 code, uppercase) and `currency_raw` (exactly as printed: "€", "US$", "USD", "EUR"). The question
text must tell the model to return the ISO code only when it is certain, and null otherwise. A bare "$" is
ambiguous (USD, CAD, MXN, ARS, and others), so it must not be guessed: when the document prints only an
ambiguous symbol the code is null and `currency_raw` carries the symbol.

**Matcher.** New lookup `OcrLookups.currencyByCode(isoCode)`, implemented in `PurchaseInvoiceOcrLookups`
(active currency of the tenant, by ISO code). Precedence:

1. printed ISO code that resolves to an active currency, with source `printed`;
2. printed symbol only (`currency_raw`, no ISO code): among the currencies the selector would offer (the
   organization currency plus those with a conversion), the ones whose symbol matches. Exactly one: use it,
   with source `printed`. None or several: fall back, with a notice;
3. otherwise the existing fallback (vendor price list, organization, client), with source `default`.

The symbol is already at hand: `C_Currency.CURSYMBOL` is read by `PurchaseInvoiceOcrLookups.describe`
(`id`, `isoCode`, `symbol`, `scale`), so the resolution happens inside the backend matcher and needs no
extra request. Checked in the test tenant: "$" is shared by 9 active currencies (ARS, AUD, GWP, LRD, MXN,
NZD, SRD, TPE, USD), "£" by GBP and SDG, "¥" by CNY and JPY, which is why the symbol alone is never enough
and why it is restricted to the currencies with a conversion (in the demo, "$" then resolves to USD only).
In the SPA, `currencyOptions` returns `id`, `isoCode` and `rate` (no symbol), but `getCurrencySymbol(iso)`
from `formatCurrency.js` derives the symbol locally, so the picker needs nothing more.

The header stores `currencyId` and a new `currencySource` (`printed` or `default`). A printed code that
does not resolve to an active currency is kept as a notice and falls back to the default; it is not
silently dropped.

**Verdict.** Nothing new for the main case: a printed currency without a rate already produces the
`exchangeRate` blocker. Decision needed for a printed currency that is not defined in the tenant at all
(section 1.8).

**Panel and manual fix (phase B).** The user must be able to act on the error. Two ways, both exist in the
product:

- define the conversion in the Conversion Rates window, then reload the document;
- change the currency in the panel, choosing among the currencies registered in the system.

Decision: **no custom rate in the panel.** The user can only pick a currency that has a conversion, and the
system's rate is always used. So: a new apply operation `setCurrency { currencyId }` (stored in
`header.currencyId`), an inbox action `currencyOptions` that delegates to `CurrencyOptionsHandler` with the
purchase invoice's rate type and the document's invoice date, and `CurrencyRatePicker` wired with
`apiBaseUrl` so it lists the options, without the pencil. The review answer carries the rate valid on the
date (today the SPA hardcodes `1`). Confirm does not need to send any rate: the invoice header pipeline
computes it, as shown in section 1.3.

**KPI.** Changing the currency or the rate by hand is an adjustment (a header change since the scan) and
must mark `ADJUSTED` through `InvoiceInboxAdjustedPolicy`. Accepting the printed currency is not.

**What does not change.** Totals and decimals already follow `currency.scale`; the batch dialog already
sums per currency; the list column is already a real column; the line prices stay in the document
currency, as printed.

### 1.6 Files expected to change

`com.etendoerp.go`: `ocr/ocr-config.json`, `ocr/OcrExtractionParser`, `ocr/OcrSanitizer`,
`ocr/InboxMatcher`, `ocr/InboxDocument` (new keys), `ocr/OcrLookups` and `PurchaseInvoiceOcrLookups`
(`currencyByCode`), `InvoiceInboxApply` and `InvoiceInboxApplyResolution` (`setCurrency`, phase B),
`InvoiceInboxAdjustedPolicy`, `InvoiceInboxHeaderHandler` (`currencyOptions`, phase B),
`InvoiceInboxReview` (rate in the answer),
`docs/neo-headless.md`.

`etendo_schema_forge`: `InvoiceInboxReviewForm.jsx` (`CurrencyField`), `invoiceInboxReviewModel.js`
(`buildOp.setCurrency` and its local apply), `InvoiceInboxReviewBanners.jsx` (text of the rate blocker),
locales (`en_US`, `es_ES`, `es_AR`), `docs/generated-custom-windows/invoice-inbox.md`.

### 1.7 Shared-schema risk

`ocr-config.json` is read by three consumers: the inbox worker, `NeoOcrConfigEndpoint` (the single-document
"Subir factura" flow in the purchase invoice, `ocrDocTypes.js`) and the MCP OCR tools. The new fields are
nullable, so they should be harmless, but each consumer needs a smoke test (the same condition the printed
unit of measure had). Reading the currency in the single-document flow is a separate improvement and is not
part of this work.

### 1.8 Decisions (agreed)

**Status: implemented in blocks 3 and 4, awaiting live QA.**


1. **A printed currency the tenant does not have** (inactive or never defined): the same "falta el tipo de
   cambio" blocker as a currency without conversion. No distinct message.
2. **A bare symbol such as "$"**: resolved against the currencies with a conversion (section 1.5). Exactly
   one match: use it. Otherwise fall back to the default with a notice.
3. **Rate date**: the invoice date (the accounting date follows it at confirm; verified live).
4. **Phase B**: yes, but without editing the rate. The user is limited to the currencies registered in the
   system.
5. **Lines after a currency change**: the existing lines keep the prices as printed (the same as the
   purchase invoice, which never re-prices existing lines). A line the user adds by hand after that follows
   the purchase invoice rule: priced from the price list converted by the document's rate, and a price typed
   by the user is taken as a price in the document currency (`public-api.md` section 4.12). **Open point:**
   the inbox did not price manual lines. Superseded: option 2 of 1.8b was implemented (see there).

### 1.8b Pricing of a manual line (decision revised: option 2 implemented)

**Status: option 2 implemented, awaiting live QA.** A manual line (`manual: true`, set by `addLine`) whose
product is picked ALWAYS takes (overwriting the current price, as the purchase invoice does; revised 2026-11-26, it was first "only while the price is 0") the price from the document's purchase price list (the vendor's,
else the default one), converted by the org-to-document rate when the document is in another currency than the organization's.
The list price is always read as an organization-currency price (parity with the purchase invoice, verified live 2026-11-26; the list's own currency is ignored: in GO a price list only dictates a price in the organization currency). Reference: `neo-headless.md` section 4.12 "Manual line pricing" and
`docs/generated-custom-windows/invoice-inbox.md`. The text below is the original analysis, kept for context.

A line added with "Añadir línea" is created with description empty, quantity 1, **unit price 0** and no
product (`InvoiceInboxApply.addLine`). The user types the price and links or creates a product. There is no
price-list lookup in the inbox, also for documents in the organization currency. So "the conversion applies
as in the purchase invoice" has nothing to convert until the inbox prices a line from a product.

- **Option 1 (smaller)**: keep it as today. A manual line is typed in the document currency, with no
  conversion. Consistent with the printed lines.
- **Option 2** (superseded: always overwrites): when the user links a product to a manual line whose price is still 0, take the price from the
  vendor's purchase price list, converted by the document rate when the currencies differ (rounded to the
  currency precision), as the purchase invoice does. About 6 more points, and it also changes documents in
  the organization currency (the price would no longer be 0).

### 1.9 Estimate (method: `/estimate`)

Reuse audit: the rate lookup, the blocker, the completion guard, the currency verification at confirm, the
options handler, the picker, the per-currency dialog and the scale handling already exist. The work is the
OCR field, the resolution, and the editing in the panel.

**Phase A: the OCR reads the currency (backend + display).** Delivers requirement items 1 to 4, with the fix
by hand being "define the conversion in Etendo, or discard".

| Item | Pts | Note |
|------|----:|------|
| `ocr-extraction-field` (currency, currency_raw, lookup, matcher precedence, source) | 5 | new row, provisional |
| `bugfix-small`: notice and distinct message for a currency not in the tenant | 1 | verdict text |
| `bugfix-small`: review answer carries the rate on the date; panel shows it instead of `1` | 1 | |
| `bugfix-small`: banner text of the rate blocker mentions both fixes | 1 | |
| `i18n-keys` | 1 | |
| `unit-tests` (Java matcher and lookup) | 2 | |
| `unit-tests` (SPA model) | 2 | |
| `e2e-test`: printed currency with and without conversion | 3 | mocked spec |
| Base | **16** | |

Risk: `external-backend-change` +30%, `ci-quality-gates` +20%, `late-test-discovery` +30% (symbols,
real documents). Discounts: `behaviour-is-native-reuse` -40%, `mature-scaffolding` -20%.
Net factor 1.2, **about 19 pts, size L (2 to 3 days)**.

**Phase B: fix it in the panel (choose among the registered currencies, no custom rate).**

| Item | Pts | Note |
|------|----:|------|
| `java-handler`: `setCurrency` operation, validation, `ADJUSTED` policy | 3 | |
| `extend-shared-component`: `CurrencyRatePicker` wired for the inbox (options, no pencil) | 2 | shared component |
| `extend-shared-component`: `currencyOptions` action on the inbox header | 2 | delegates, no new logic |
| `callout-validation`: local apply of `setCurrency` in the editor | 2 | |
| `i18n-keys` | 1 | |
| `unit-tests` (Java and SPA) | 4 | |
| `e2e-test` | 3 | |
| Base | **17** | |

Risk: `shared-component-refactor` +30%, `external-backend-change` +30%, `ci-quality-gates` +20%,
`late-test-discovery` +30%. Discounts: `behaviour-is-native-reuse` -40%, `mature-scaffolding` -20%.
Net factor 1.5, **about 25 pts, size XL (most of a week)**. Dropping the custom rate removed the confirm
change (1 pt) and the rate validation.

**Total about 44 pts (XXL): split, as the model says.** Phase A first: it already satisfies the
requirement and removes the silent wrong amount. Phase B follows.

Top difficulties:

- Currency detection on real documents: symbols, languages and layouts are where the OCR will fail, and
  only real documents reveal it (hence `late-test-discovery`).
- The shared OCR schema: three consumers to smoke-test, and Copilot behavior is only verifiable with the
  real service.
- `CurrencyRatePicker` is shared by every document window; wiring it for the inbox must not change them.
- A currency change after the lines exist: line prices are never re-priced by design. The panel must make
  clear that changing the currency changes only the header.

### 1.10 Test cases

1. Printed EUR on an EUR tenant: unchanged behavior, no notice.
2. Printed USD, conversion defined: invoice in USD, system rate, completed, `ADJUSTED` unchanged.
3. Printed GBP, no conversion: document in error with the rate blocker, Confirm disabled, nothing created.
4. Printed currency not in the tenant (inactive or undefined): the same blocker, nothing created.
5. Printed "$" only: resolves to USD when it is the only currency with a conversion that uses that symbol; with several, falls back to the default with a notice.
6. Nothing printed: the vendor's currency, as today.
7. Phase B: change currency to one with conversion, `ADJUSTED = Y`, confirm creates it in that currency.
8. Phase B: the selector lists only the currencies with a conversion on the invoice date, and has no way to type a rate.
9. Batch with two currencies: dialog totals per currency (already supported, regression).
10. The single-document OCR and the MCP OCR still work with the new schema fields.

## 2. Failure reason in the partial toast

**Status: implemented in batch 1 (review approved, tests passing, live-verified for the toasts).**

- **Today.** The 422 answer already carries `detailCode` and `detailParams` (for example
  `step_failed` with the step and the reason, or `refused` with the message). The queue
  (`runConfirmQueue`, `confirmToastText`) keys the reason on `error.code` only, so every `confirm_failed`
  reads as "no se pudo crear la factura".
- **Change.** Key the toast reason on `detailCode` / `detailParams` through the existing
  `CONFIRM_FAILED_DETAIL_KEYS` translation table, falling back to the generic text. Several different
  reasons keep the existing "varios motivos" text.
- **Estimate.** `bugfix-small` 1 + `unit-tests` 2 = 3 pts, `ci-quality-gates` +20%: **about 4 pts (S)**.
- **Test cases.** One failure with a known reason shows that reason; two failures with different reasons
  show "varios motivos"; an unknown code shows the generic text; a stop (quota, access) is unchanged.

## 2b. The result toast disappears too soon (finding 3)

**Status: implemented in batch 1 (review approved, tests passing, live-verified for the toasts).**

- **Cause.** `showConfirmToast` and `showDiscardToast` call `toast[tone](text)` (sonner) with no options,
  and the global `Toaster` (`main.jsx`) sets no duration, so sonner's default applies (4 seconds). Checked
  live: the result of a batch was already gone about 8 seconds after the click.
- **Change.** Pass an explicit duration to the confirm and discard result toasts, with a close button:
  success about 10 seconds; warning and error stay until dismissed (a failed document is something the user
  must read). The same helper serves the batch and the single confirm from the panel.
- **Estimate.** `bugfix-small` 1 + `unit-tests` 2 = 3, `ci-quality-gates` +20%: **about 4 pts (S)**.
- **Test cases.** The success toast is still visible after 8 seconds and goes after its duration; a
  partial or failed result stays until closed; the close button dismisses it; two runs in a row do not hide
  each other.

## 3. Vendor suggestions and the `loc` error (Valeria)

### 3.1 Report

"The contact should have suggested creating a new one as the first option, because none of the suggestions
was probable. I chose to create the contact, pressed confirm and got an error":
`Dirección del nuevo proveedor: Operation 'loc' rejected by server`. Her file:
`Factura_FitzRoy_ME-2026-0457.pdf` (vendor Montaña Equipamientos S.L., NIF B76543214, receiver Fitz Roy
Adventures, NIF B12345674). Her panel also showed "Posible duplicado en la bandeja": the same file twice.

### 3.2 What was reproduced

| Environment | Result |
|-------------|--------|
| Local, her PDF as a new vendor | Confirmed correctly (FC1000014) |
| Local, ambiguous vendor, "Ninguno · crear proveedor nuevo", confirm | Confirmed correctly (FC1000015) |
| Local, forced rejection of `loc` (339-character address) | The full reason reaches the user ("Location.addressLine1: Value too long. Length 339, maximum allowed 60") |
| Production (demo tenant of the account in use), her PDF as uploaded | "La factura no está emitida a tu empresa": the receiver NIF differs from that tenant's company |
| Production, a variant of her PDF addressed to that tenant's company (same vendor, same number) | Same panel as hers: the "Posible duplicado en la bandeja" notice and "Proveedor nuevo" (no suggestions in that tenant). **Confirm not pressed**, see 3.5 |

The `loc` error was not reproduced. The cause depends on her tenant, role or data.

### 3.3 Finding 4a: suggestion order (reproduced locally)

**Status: implemented in block 2 (explicit `probable` flag, three tiers, "Ninguno" first when no candidate is
probable), awaiting live QA.**

`InboxVendorMatcher.matchByName` returns `ambiguous` for any vendor whose name contains the printed name,
when there is no exact match and no tax id match. With a vendor printed as "Montaña Equipamientos" and a
different NIF (B55555551), the panel says "Etendo AI propone 1 proveedor", tags
"MONTAÑA EQUIPAMIENTOS S.L." (NIF B76543214) as **"Más probable"**, and offers "Ninguno · crear proveedor
nuevo" second. The document stays blocked until one option is picked.

The candidate has a **different tax id** from the printed one and is still the most likely. Both tax ids are
known, so the conflict is detectable.

**Principle (agreed: the three tiers below).** Same as the review panel's own rule for a certain match: select only
when the match is certain, otherwise propose and let the user choose. For vendors today that is already
the case: a vendor linked by tax id or by exact name arrives selected ("Vinculado por NIF", with "Cambiar"),
and an ambiguous one is not selected and the first candidate carries "Más probable". Three tiers:

1. **Certain**: same tax id, or exact name with no tax id conflict. Selected, with "Cambiar" (exists).
2. **Probable, not certain**: partial name match and a tax id missing on one side. Not selected. The best
   candidate is tagged "Más probable" and listed first. The document waits for a choice (exists).
3. **Weak**: partial name match and **both tax ids present and different**. A different tax id proves it is
   another company. The candidate is not tagged "Más probable" and is not offered first; "Ninguno · crear
   proveedor nuevo" comes first. Resolution (assumed unless the owner objects): the document arrives as
   "Proveedor nuevo" directly, with the candidates under "Buscar existente", because two different tax ids
   settle it. A missing tax id on either side never lands here (that is tier 2).

**Change.**

1. Matcher: classify each candidate into the tiers above and add a `probable` flag (tiers 1 and 2 only).
2. Panel: tag "Más probable" only when the flag is set; order "Ninguno · crear proveedor nuevo" first when
   no candidate is probable.
3. Tests for each tier, including the missing-tax-id case that must never become a silent "new vendor".

**Estimate.** `java-handler` 3 + `bugfix-medium` 3 (panel and model) + `unit-tests` 2 + `e2e-test` 3 = 11,
`ci-quality-gates` +20%, `external-backend-change` +30%, `mature-scaffolding` -20%: factor 1.3,
**about 14 pts (L)**. If the alternative (reorder only) is chosen it drops to about 8.

### 3.4 Finding 4b: the lost reason (cause in code, root cause open)

**Status: backend part (the reason from the HTTP status, `step_refused_status`) implemented in batch 1 (review approved, tests passing). The root cause stays open and needs the QA data below. Findings 4a, the currency work and the production reproduction stay open.**

- `BatchService` builds the failure of an operation as "Operation '<id>' rejected by server" with the
  response body as `detail`. `InvoiceInboxConfirmWork.reasonOf` looks for the message in
  `error.detail.error.message`, `error.detail.message` and `error.message`. If the refused response has no
  message in those places (a body without `error.message`, or no body), the user gets the generic text.
- The server logs the status of the failed operation: `[BATCH] op 'loc' (index N) failed with status S`.
  That line from her Tomcat identifies the cause. A 403 for a role without access to the address entity is
  a hypothesis, **not verified**.

**Change.** When the body carries no message, build one from the HTTP status and the operation (for
example "la dirección fue rechazada (HTTP 403)"), keep the status in `detailParams`, and log the body.
Translate it in `CONFIRM_FAILED_DETAIL_KEYS`. Also make the vendor-address step name the operation in a
way the user can act on.

**Estimate.** `bugfix-small` 1 + `unit-tests` 2 = 3, `ci-quality-gates` +20%, `late-test-discovery` +30%:
**about 4.5 pts (S)**. The root cause is separate and needs data from QA.

**Data needed from QA to close the root cause.** Tomcat log lines around the failed confirm
(`[BATCH] op 'loc'`), her role and whether it can create business partner addresses, and any
customization on `contacts/locationAddress` in her tenant.

### 3.5 Production test state

The production account in use is a **demo tenant** whose banner states that contacts and products are
migrated to the productive environment. The product owner agreed to create the test records there with
identifiable names, so the variant was renamed in the panel ("PRUEBA QA Montaña Equipamientos S.L." and four
lines "PRUEBA QA ..."). The **Confirm click was then blocked** by the session's permission classifier
(creating real records in a production tenant), and it was not retried by another route. Current state of
that tenant's inbox: her file in error for receiver, and the renamed variant pending review. Nothing was
created in contacts, products or invoices. To finish the test, either the owner presses Confirm in that
document himself, or approves the action for the session.

## 4. Product matching (reviewed to answer how vendors should behave)

Reviewed in `OcrProductMatch`, `InboxLineMatcher` and the guide. Products have **three** outcomes, not two:

| Outcome | Rule | What the user sees |
|---------|------|--------------------|
| Auto matched | one exact normalized name, or similarity of 90 % or more held by a single candidate | Linked, "Coincidencia exacta" / "Por similitud" |
| **Suggested** | several candidates, a tie, or similarity below 90 % | **Also linked**: the best candidate is chosen for the user, tagged "Elegido por OCR · N %", with the other candidates in the dropdown and the chosen one checked |
| New | no candidate | "Producto nuevo" |

The `ambiguous` state (not chosen, "Elige uno", blocking) is **no longer produced** for products. It was
replaced in ETP-6051 on purpose (commit "Choose the best OCR product candidate for the user"), so that the
line is complete and the document can be confirmed. Changing the choice marks the document as adjusted.

Evidence from the run: in `P1_faro.pdf` the line "Consultoría de procesos" was linked to the existing
product "Consultoría de experiencia de usuario" at **62 %**, and confirming from the panel created invoice
FC1000006 with that product, with no further question.

## 5. Finding 5: a doubtful product match is pre-chosen (decision: keep, show the percentage)

**Status: implemented in batch 1 (review approved, tests passing, live-verified for the toasts).**

Decision: keep the behavior (the best doubtful candidate is chosen for the user), **on the condition that
the opened list shows the percentage that made the choice**.

Checked live (local, `P1_faro_producto62.pdf`): the line chip reads "Elegido por OCR · 63 %", and the opened
panel shows "En el documento: «Consultoría de procesos»", one candidate tagged "Más probable", and
"Ninguno · crear producto nuevo". **The list itself shows no percentage**; it appears only in the chip. The
data is there (`candidatesOf` stores `similarity` for each candidate), so this is a display change.

**Change.** Show the similarity next to each candidate in the opened list ("63 %"), keep "Más probable" on
the chosen one, and show nothing when a candidate has no similarity.

One more observation: the same line read "62 %" in the first run and "63 %" now. The similarity comes from a
search over a catalog that has changed since (new products were created), so the number is not a constant of
the text. Not a defect, but the percentage must not be treated as stable.

**Estimate.** `bugfix-small` 1 + `unit-tests` 2 = 3, `ci-quality-gates` +20%: **about 4 pts (S)**.

## 6. Suggested order

Work continues under **ETP-6051** (no new Jira task). Four deliveries, in this order:

1. **Toasts and failure reasons**: finding 2 (reason in the partial toast), finding 3 (duration), finding
   4b (reason of the `loc` refusal) and finding 5 (percentage in the list). About 17 pts.
2. **Vendor suggestions** (4a, three tiers), about 14 pts.
3. **Currency phase A** (OCR reads the currency), about 19 pts.
4. **Currency phase B** (choose among the registered currencies), about 25 pts, plus the decision in 1.8b.

Each goes through the pipeline (DEV, review, QA, docs) on its own branch from `develop`, behind the
existing `invoice-inbox` flag, with the matching update of
`docs/generated-custom-windows/invoice-inbox.md`.
