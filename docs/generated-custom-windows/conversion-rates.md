# Currency Conversion (Conversión de divisas)

## Intent
Maintain the currency conversion rates the system uses when a document currency differs from the organization's base currency. Each rate defines, for an `organization currency → currency` pair over a validity range (date **and time**), the multiply rate; the server stores the inverse pair of the same range alongside it. These are the same rates the invoice completion guard (ETP-4030) looks up before allowing a foreign-currency invoice to be completed — see `purchase-invoice.md` and `sales-invoice.md`.

USD and GBP rates are downloaded daily by the conversion-rate downloader job (`com.smf.currency.conversionrate`) and are flagged **Synced** (origin *Automática*). Every other currency only takes **manual** rates (origin *Manual*). The audit trail for downloader runs lives in the companion window — see `conversion-rate-downloader-log.md`.

ETP-6365 renamed the window from *Conversion Rates* / *Rangos de conversión* to **Currency Conversion** / **Conversión de divisas** and replaced the generated read-only list with a hand-written page.

## Feature flag `currency-conversion-v2`
Everything below this section describes the redesign, which is **behind the per-account backend
flag `currency-conversion-v2`** (registry entry `currency-conversion-v2` in `flags-registry.json`;
backend: `com.etendoerp.go` `docs/feature-flags-and-tenant-upgrade.md`). The browser never evaluates
the flag: `SFWindowAccessMap` publishes it as `capabilities.currencyConversionV2` and the route
entry `custom/conversion-rates/index.jsx` → `CurrencyConversionRoute.jsx` chooses the page:
- **On:** the redesigned Currency Conversion page described in this guide.
- **Off** (the default, and also when an older backend does not publish the capability): the window
  as it was before ETP-6365 — a **frozen copy** of the generated list and form as they were at
  revision `0aa24ca6b^`, kept in `tools/app-shell/src/windows/custom/conversion-rates/legacy/`
  (owned by the flag, deleted with it) and rendered by `LegacyConversionRatesWindow.jsx`. It is NOT
  the current `artifacts/conversion-rates/generated/` window, which is regenerated from the
  redesign's `decisions.json` (Status column, date-time validity, DELETE). Columns: Currency, To
  Currency, Valid From Date and Valid To Date (type `date`: the day only, no time), Multiple Rate By,
  Divide Rate By, Synced — no Status. `api.window.readOnly` plus `hideCreate`, and `window.readOnly`
  forced on top: no Nuevo, no bulk delete, no print, no row edit/delete; the detail is the read-only
  form (titled *Conversion Rate*) with its *Adjuntos* tab. Titled with the old name *Conversion
  Rates* / *Rangos de conversión* (breadcrumb *Finance / Conversion Rates*). Every field it reads is
  still served by the `conversion-rates` spec. The backend
  refuses every manual rate write (`createManualCurrency`, `createManualRate`, `updateManualRate`,
  `previewManualRate`, DELETE) with 403 `feature_disabled` on every channel, and the MCP only sees
  the read actions.
- **While the access map loads:** a progress bar, so a reload never flashes the other page.
- **Menu:** two alternate entries open the same `/conversion-rates` route, decided by the same
  capability: on, *Currency Conversion* / *Conversión de divisas* in System › Settings
  (`conversion-rates`, `capability: "currencyConversionV2"`); off — and while the capability map is
  still loading —, the pre-ETP-6365 entry *Conversion Rates* / *Rangos de conversión* in Finance at
  its original place, after *Asientos manuales* (`conversion-rates-legacy`, `path: "conversion-rates"`,
  `hideWhenCapability: "currencyConversionV2"`). Exactly one is visible, in the sidebar and the
  command palette; a favorite of the route takes the label of the visible one; the Roles matrix
  lists window 116 once, under Settings. See `docs/feature-flags.md` → *Menu entries gated by a
  capability*.

## What this window should allow
- list the conversion rates of each currency pair with their validity range (date and time)
- review the multiply rate and the divide rate of a pair for a validity range

These bullets stay read-only on purpose: the public API manifest publishes them as the
`conversion-rates` capabilities, and the public API is still read-only. In the window itself
(ETP-6365) a user can also: see, per currency, the rate in force now and its origin; browse the
one list of currencies, each expanding into its rates filtered by currency, period and status; print it; add a
first manual rate for an active currency with no rates ("Nueva divisa"); add a new manual rate that
closes the one in force ("Nueva tasa"); edit or delete any manual rate.

`decisions.json` declares `entities.header.methods: ["GET", "GETBYID", "DELETE"]` (with
`window.readOnly: false`, which would otherwise also drop DELETE), so `make regen … PUSH_TO_NEO=1`
writes `ISGET/ISGETBYID/ISDELETE = Y` and `ISPOST/ISPUT/ISPATCH = N` on `ETGO_SF_ENTITY`. Every
write goes through the actions under *One process with the MCP*; the handler also answers a
generic POST/PUT/PATCH with `405 ETGO_ConvRateUseActions`. The **public API
stays read-only** (`entities.header.publicApi.readOnly: true` is kept): opening it to writes is a
separate decision.

## Interaction model
- **Route:** `/conversion-rates` and `/conversion-rates/:recordId` (unchanged). Both render the same page; there is no drill-in detail since the redesign.
- **Menu:** (flag on; off, see *Feature flag* above) **Settings** group (section **System**, *Sistema → Configuración*) in `tools/app-shell/src/menu.json`, last item (`windowId: "116"`, `capability: "currencyConversionV2"`, label `Currency Conversion`, translated through the `menus` / `windows` entries of the locale files). Breadcrumb *Configuración / Conversión de divisas*. It was in the **Finance** group until the ETP-6365 QA. The Roles window (*Configuración → Roles*, access matrix) groups its rows by the same `menu.json` entry (matched by `windowId`), so it lists the window under Configuración too; there is no second source to keep in sync.
- **Implementation type:** custom window — `layoutType: "custom"` in `artifacts/conversion-rates/decisions.json`; code in `tools/app-shell/src/windows/custom/conversion-rates/`, registered in `customLoaders` (`windows/registry.js`), which wins over the generated loader. The pipeline never overwrites these files (a regeneration writes `index.jsx.new` next to them at most).
- **Toolbar (design v3):** on the left the quick filters, always shown — there is no Filtros button to show / hide them, by design request of the reporter: **Divisa** (Todas las divisas + every currency with rates), **Periodo** (Últimos 30 días — default —, Este mes, Este año, Personalizado… with two date fields) and **Estado** (Todos los estados / Vigente / Histórico); on the right Copiar enlace (the filters live in the URL: `currency`, `period`, `from`, `to`, `status`), Ordenar (orders the rates inside each currency by valid from, valid to or rate), Actualizar, **Imprimir** and the primary **Nueva divisa**. There is no Origen filter.
- **Divisas y tasas — one accordion list** (shared `Table` primitives and `RowExpandToggle`, inside the shared `Card`). One row per currency that has rates: every currency with a rate in force (`currentRates`, in its order) plus any other currency with rates in the period, narrowed by Divisa. A row shows chevron, symbol chip, ISO, name, origin badge (Automática / Manual) and, on the right, the forward rate in force `1 EUR = X <symbol>` in bold with a second line: *Descargada hoy HH:mm* (automatic, from `lastDownloadAt`; *Descargada el dd/MM/yyyy HH:mm* when not today) or *Desde dd/MM/yyyy HH:mm* (manual, start of the range in force). Manual currencies show **+ Nueva tasa**. Currencies start collapsed; filtering by one currency opens it. Names and symbols are always the server's (the translated `C_Currency_Trl` name the GO currency selectors show): from `currentRates` for a currency with a rate in force, else from one `manualCurrencyOptions {withoutRates: false}` read on page load (every active manual currency, by id); `Intl` only when the server gives neither (e.g. a downloaded currency with no rate in force).
- **Expanded currency:** its own header row (Válido desde (fecha y hora), Válido hasta (fecha y hora), `1 EUR =`, `1 <ISO> = EUR`, Estado, Acciones) and every rate of the period (no "3 most recent" limit): rate + currency symbol, `divideRateBy` + €, the Vigente / Histórico tag, and the hover actions. *No hay tasas en el periodo seleccionado.* when the filters leave it empty. There is no legend, footer note or "Vigentes hoy" block any more.
- **Imprimir:** the app's list print drawer (`contract-ui/ReportDrawer.jsx`: preview, PDF, Excel, CSV, the organization's list-print design), the one `ListView` opens. The page passes it the rows to print (`rows` prop): every rate of the listed currencies, with Divisa, Origen, Válido desde, Válido hasta, `1 EUR =`, `1 [moneda] = EUR` and Estado, and the active filters in the header.
- **Row hover:** every rate row lifts on hover like the app's other lists and the document lines (the shared "Fila" tokens of `contract-ui/rowVisuals.js`: card background, `ROW_LIFT_SHADOW`, its own bottom separator hidden and the grey line above it kept by `ROW_LIFT_HOVER_BORDERS`, ETP-6209), automatic or manual.
- **Row actions:** hovering **any manual** rate (`sMFCRSynced = false`), whatever its state, shows **Modificar** (pencil, *Modificar tasa*) and **Eliminar** (trash, *Eliminar tasa*) — the shared `ListModalRowActions` hover buttons, the ones of Condiciones de pago. Automatic rows lift the same way but show no actions. Eliminar asks for confirmation (`DeleteConfirmDialog` with this window's impersonal title and question, plus the note on deleting the rate in force) and DELETEs the row — the server removes both directions.

**Synced** is shown only as the *Automática* / *Manual* tag (currency row) and as the Origen column of the printout; no other place shows the flag.

## States
`etgoRateStatus`, served by `com.etendoerp.go`, is a real, filterable list column (reference `ETGO_ConvRate_Status`, read-only AD field *Status* on tab 198) with two values:
- `CURRENT` → **Vigente**: the rate that rules now (its range contains the current date and time);
- `HISTORIC` → **Histórico**: a rate that no longer rules.

The former lock (`etgoUsedInAccounting`) is gone: editing or deleting a rate never touches documents already posted (see *Edit rules*).

## Dialogs
- **Nueva divisa** (*Manual* badge): Moneda origen = organization currency, read-only (`EUR · Euro`); Moneda destino = action `manualCurrencyOptions {withoutRates: true}` (active currencies with no rates; never USD/GBP); Tasa `1 EUR = [X] ARS`; Válido desde (date + time) with *Por defecto, ahora. Puede cambiarlo.* Summary *Se añadirá ARS como divisa manual con dos tasas* plus the two lines from `previewManualRate`. Buttons Cancelar / Crear divisa.
- **Nueva tasa · CHF:** destination fixed; *Tasa vigente: 1 EUR = 0,9420 CHF desde …* (from `currentRates`); Tasa; Válido desde with the same hint; summary *Se crearán dos tasas*, the two lines and *La tasa vigente de CHF (desde 18/11/2026 14:30) pasará a tener Válido hasta 19/11/2026 14:19, en los dos sentidos.* (from the preview's `closes`). No error box while there is no error. Buttons Cancelar / Crear tasa.
- **Refusal of the start (overlap, future start).** When `previewManualRate` answers an `error`, the summary is hidden, the error box shows the refusal and the confirm button is **disabled**. Every refusal is shown as the server words it, **except the overlap** (QA CP-13): the server words it in ITS zone (*… posterior al 26/11/2026 12:00. Las horas están en la zona horaria del servidor (UTC).*, which is what the MCP reads), so the dialog words it itself (`convRateOverlapError`, `overlapMessage` in `conversionRatesModel.js`, through `describeRefusal` in `ManualRateDialog.jsx`) from the structured instants the server sends with it — `errorDetails` of the preview, `error.details` of a refused create: `{conflictFrom, conflictTo, conflictOpen, suggestedFrom, timeZone}` —, converted to the browser's zone like every other datetime and naming that zone once, after the suggested start: *Ya existe una tasa de conversión para EUR → CHF en las fechas indicadas (26/11/2026 09:00 – sin fecha de fin). Elija una fecha de inicio posterior al 26/11/2026 09:00 (hora estándar de Argentina).* Both paths (preview and create) use the same wording. Without a known server zone the times stay server time and the server's zone id is named. A refusal with no details (an older backend) keeps the server text. The field a refusal belongs to is marked in error (red border, `aria-invalid`): `errorField` of the preview answer, `error.field` of a refused write action, or `errorField` of an in-band `data.error` (`toCurrency` | `multipleRateBy` | `validFromDate`); when none is present, `ETGO_ConvRateOverlap` / `ETGO_ConvRateFutureStart` / `ETGO_ConvRateInvalidValidFrom` mark Válido desde.
- **Modificar tasa · CHF** (*Manual* badge): origin and destination read-only; **only the rate is editable** (the Tasa box has no grey background on hover / focus: its wrapper draws the border and the focus ring, the inner input is transparent — the same in Nueva divisa and Nueva tasa); Válido desde and Válido hasta are read-only (`— (sin fecha de fin)` for an open range); *Solo se puede cambiar la tasa. Para cambiar el periodo, elimine la tasa y cree una nueva.*; summary *Se actualizará la tasa* with **only the rate being modified**, `EUR → CHF · old → new` (organization currency → the other one), taken from the server's proposal (`updateManualRate` without `confirm`, debounced while typing; the typed rate until the proposal arrives). The inverse row is still saved with it by the server, it is just not listed; the amber note *Al guardar se le pedirá que confirme el cambio.*; **Guardar cambios** saves nothing: it asks for a fresh proposal and opens the confirmation. An unchanged rate closes the dialog without a request.
- **¿Confirma el cambio de tasa?** (design *PopupEditarConfirmar*; the shared `Dialog` with `role="alertdialog"`, over the edit dialog): warning icon, the box `EUR → CHF · old → **new**` (only the modified rate, as in the edit summary), *Periodo: desde …* (*… hasta …* for a closed range), and *El cambio solo se aplica a los documentos en los que se seleccione la divisa a partir de ahora.* / *Los documentos ya creados conservan el tipo de cambio que copiaron al seleccionar la divisa, y su contabilidad sigue usando ese tipo de cambio.* **Volver** returns to the edit dialog with its values and saves nothing; **Confirmar cambio** is the only step that saves (`updateManualRate` with `confirm: true`). A refusal closes the confirmation and shows the message in the edit dialog.
- **Validation:** Tasa (> 0) and, when creating, Válido desde (valid date and time, **not later than now**) are required: the confirm button stays disabled and the field shows its error until both are valid. The create preview is requested again (debounced, 350 ms) whenever an input changes. **Enter** in any field of Nueva divisa / Nueva tasa / Modificar tasa runs the primary action (Crear divisa / Crear tasa / Guardar cambios) once the field has committed its value, and only when that action is enabled; Enter inside the Válido desde calendar popover or on the destination picker while its list is open keeps its own meaning (pick the day / the option). Esc and the corner X close, the tab order follows the fields. On success the dialog closes and the list reloads.
- **One request per click.** Crear divisa, Crear tasa, Guardar cambios, Confirmar cambio and the Eliminar confirmation each send a single request however fast they are clicked: a synchronous in-flight guard drops a second click before the button has re-rendered disabled.
- **"Now" comes from the server.** The create dialogs read action `serverClock` (`{now: "yyyy-MM-ddTHH:mm:00", timeZone}`) when they open: that minute, converted to the browser's zone, is the default of Válido desde and the upper bound of the start (aged by the time the dialog has stayed open). The browser clock is only the placeholder until the answer arrives, or the fallback when the action cannot be read — the server refuses a future start anyway.
- **Times in the browser's zone.** The server stores and answers wall clock of ITS zone (production runs in `UTC`). The page reads `serverClock.timeZone` once on load and shows and takes every datetime of a rate range in the browser's zone, 24h: the Válido desde / Válido hasta columns, the currency subtitles (*Desde …*, *Descargada hoy …*), the dialog fields, their default and *Ahora*, the preview, edit and confirmation texts, the delete question and the Imprimir columns. A value is converted server → browser for display and browser → server before it is sent (`previewManualRate`, `createManualCurrency`, `createManualRate`, and the period bounds of the list), through `Intl` with both zone ids (`createZoneView` in `conversionRatesModel.js`), so a DST change is handled. The no-future check compares the typed start with the server minute converted to the browser's zone. **Zone label (QA CP-2/7/11; no offsets for end users):** a readable region name in the UI language, `zoneName` in `conversionRatesModel.js` — never a `GMT±n` offset while a name exists: a UTC zone id reads `UTC`; otherwise `Intl` `timeZoneName: 'longGeneric'` (*hora estándar de Argentina*, *hora de Europa central*, *Argentina Standard Time*), else `Intl` `'long'`; the GMT offset (`GMT-3`) only as a last resort, when `Intl` gives no readable name at all (only an abbreviation such as `CET` / `ART`, or no support). The name goes, through the i18n key `convRateWithZone` (`{text} ({zone})`), after the label of a list or print column (*Válido desde (fecha y hora) (hora estándar de Argentina)*) and after the time inside a sentence (the list subtitle *Desde 18/11/2026 11:30 (…)*, *Descargada hoy 07:00 (…)*, the delete question, the dialog's *Tasa vigente …* hint and the overlap refusal). The dialog date fields (Válido desde of Nueva divisa / Nueva tasa, Válido desde and Válido hasta of Modificar tasa, read-only included) hold **date and time only**; the same name, capitalised (*Hora estándar de Argentina*, `zone.fieldHint` / `capitalizeZoneName`), is the small helper text right below each field, in the form's helper style (`text-xs text-muted-foreground`, like *Por defecto, ahora. Puede cambiarlo.*). An open Válido hasta shows no zone. The shared `DateTimeField` keeps its generic `suffix` prop; this window no longer uses it. The MCP and backend messages keep the IANA zone id. The dialog's summary lines — the create preview lines, the *… pasará a tener Válido hasta …* sentence and the confirmation's *Periodo: …* — show the converted times WITHOUT the zone: the date field above already names it, and the label made those lines wrap. When the server and the browser share the zone nothing changes but the label. When `serverClock` fails, or answers no / an unknown zone, nothing is converted and no label is shown (the behaviour before). The list waits for that answer, so its times never jump. The MCP is unchanged: its values stay server wall clock, and the action descriptions point to `serverClock` for the zone.
- **Every rate is shown in the browser's zone, downloaded ones included.** The downloader stores a day's range at `00:00` of the server's day; for a viewer west of the server that is the previous evening (`26/11/2026 00:00` Europe/Madrid reads *25/11/2026 20:00 (hora estándar de Argentina)*), and the window shows it so in the columns, the printout, the *Desde* subtitle, the *Tasa vigente* hint, the delete question and the read-only Modificar fields (with the zone line under them). It is the same instant, not a shift: QA reviewed it in ETP-6365 (QA pass 2, CP-3) and decided it is correct, so there is no date-only treatment.
- **"Last rate of the day" stays on the server's day.** The lookup documents use (`ConversionRateLookup`: the latest range starting on the accounting date) works on the server's calendar day, not the viewer's: a rate shown at `22:00 (hora estándar de Argentina)` on the 18th started on the 19th for the server (`01:00 UTC`) and is the 19th's rate.
- **Time in the Válido desde popover:** a 24h `HH:mm` text box (digits only, the colon is inserted; a complete time applies as it is typed, anything else reverts on blur / Enter), never the native time input, which shows a.m./p.m. under a 12h OS or browser locale.

## Edit rules
- Every manual rate can be edited or deleted, current or historic. Automatic (USD/GBP) rates cannot.
- **Automatic rates are System rows.** The downloader writes USD/GBP at client `0` (System); the server reads them next to the tenant's own rows (the list header *1 EUR = …* / *Descargada hoy HH:mm*, `currentRates`, the "has rates" check of Nueva divisa, the download time from the System `SMFCR_SYNC_LOG`), the tenant's row winning for the same currency. They are never writable: `updateManualRate` or a delete on one answers 409 `ETGO_ConvRateSyncedLocked` (*Las tasas descargadas automáticamente no se pueden modificar ni eliminar*), on the UI and on the MCP alike.
- Editing changes the rate only; the range of an existing rate is never moved (delete it and create a new one).
- A start can never be later than now: a rate is never created or moved into the future (server-enforced, mirrored in the dialog).
- Changing a rate only applies to documents in which the currency is selected from then on; documents already created keep the exchange rate they copied when the currency was selected, and their accounting keeps using it. The change is saved only after the explicit confirmation.
- Deleting the rate in force leaves the currency without a rate from that date.

## Reactive behavior and dependencies
- **One process with the MCP.** Every write goes through the actions the MCP uses — `createManualCurrency` (Nueva divisa), `createManualRate` (Nueva tasa), `updateManualRate` (Modificar: proposal, then `confirm: true`) — and `previewManualRate` takes `mode: "newCurrency" | "newRate"`. Delete stays `DELETE /conversionRate/{id}`. The server creates the inverse rate, closes the previous open range at `start − 1 minute` in both directions, refuses overlapping ranges (`ETGO_ConvRateOverlap`), refuses a future start, refuses any write on a synced rate, a first rate for a currency that already has rates (`ETGO_ConvRateCurrencyHasRates`) and a new range for one that has none (`ETGO_ConvRateCurrencyNoRates`), both bound to `toCurrency`. `updateManualRate` is a record action (`POST /conversionRate/{id}/action/updateManualRate`, body `{multipleRateBy, confirm?}`, the forward rate) and changes nothing but the rate. The UI shows the preview, the proposal and the messages; it only mirrors the required/positive/no-future checks.
- **Writes run with the database triggers off.** Create (including closing the previous range), rate update and delete run inside core's `TriggerHandler` (`ConversionRateTriggerBypass`): disabled for the writes of the request's transaction and enabled again before the operation returns. Every trigger reads that switch, so those rows are also not recorded by trigger-based auditing (the audit trail); the rules the triggers enforced are re-checked in Java.
- **Overlap planning is conservative.** The ranges a create is checked and planned against (`ConversionRateStore.rangesOfPair`) are every active row of the tenant for the pair, in both directions, whatever its organization or conversion rate type — not only the `*` organization and spot rows the window writes. Inactive rows are left out (the DAL query's default active filter).
- **Forward rows only.** The list only the rows whose `currency` is the organization currency (criteria `currency = <org currency id>`). The inverse rows exist but are never listed; the inverse value of a period is the forward row's `divideRateBy`.
- **Period filter = Válido desde within the period.** Criteria `periodStart <= validFromDate < periodEnd` (story: *Solo se muestran tasas con Válido desde dentro de los últimos 30 días*). A day is `[D 00:00, D+1 00:00)` of the browser's zone, sent as the server's wall clock; *Últimos 30 días* (default) is today and the 29 days before it. A rate that started before the period is not listed, even if it is still in force; the currency row still shows it in its header line.
- **Datetimes are server-local wall clock on the wire.** NEO answers `validFromDate` / `validToDate` as `yyyy-MM-ddTHH:mm:ss` with no offset (NeoDateFormat, ETP-5100). The page reads and writes them as text (`conversionRatesModel.js`), never through `new Date(string)`, converts them to the browser's zone (see *Times in the browser's zone*), shows them as `dd/MM/yyyy HH:mm` and sends `validFromDate` as `yyyy-MM-ddTHH:mm:00` server wall clock.
- **Open range.** A `validToDate` that is null (NEO answers null for an open range) or in year 2999 or later (stored as `2999-12-31`) is shown as «—» (*sin fecha de fin*).
- **Display rule for automatic daily ranges.** The downloader stores each daily range closing at `00:00` of the same day (`17/11/2026 00:00 → 17/11/2026 00:00`). For a synced row whose `validToDate` is at `00:00` on or after its `validFromDate` day, the page shows that (server) day at `23:59` (`17/11/2026 23:59`), converted to the browser's zone like every other datetime. Manual ranges are shown as stored (`18/11/2026 14:29`).
- **Numbers.** Rates are shown with 4 decimals through `formatGroupedNumber` (instance separators); the rate is typed in the shared `MaskedAmountInput` (ungrouped, instance decimal separator) and parsed with `parseLocaleNumber`.
- **Downstream consumer:** these records are read at invoice completion by `InvoiceExchangeRateValidator.checkRateForCompletion()` (`com.etendoerp.go`) through the AD general-rate lookup. A missing rate for the needed pair is what triggers the `SMFCR_NoRateOnComplete` block on the invoice windows.
- **Invoices generated from shipments and receipts store their rate.** Like the invoices generated from orders and quotations, an invoice generated from one or several goods shipments (or receipts), with or without an order, takes the last range of its accounting day and keeps it; a foreign-currency one with no range for that day is refused with GO's message and nothing is created.
- **Residual: documents without a stored rate.** Documents that do not store their own rate are resolved by core at posting with its midnight rule (the range open at 00:00 of the accounting date): standalone payments, financial account movements, manual GL journals, invoices generated from returns, and costing. On the day a timed range is created (e.g. 14:30), those documents still use the range that was open at 00:00 that day. Today this is practically unreachable for manual currencies: they can only be chosen in documents that store their rate (the Currency selectors elsewhere, e.g. financial accounts and GL journals, are limited to EUR/USD/GBP by `CurrencyIsoAllowlistSelectorPolicy`), and the downloaded USD/GBP ranges start at 00:00. To revisit if manual currencies are ever enabled in those documents.

## Shared components behind each control
| Control | Shared component |
|---|---|
| Toolbar filters Divisa / Periodo / Estado | `DistinctValuesFilter` (app-shell-core, the list filter of Not Posted Documents; opens on the committed value) |
| Custom period from / to | `DateField` |
| Válido desde (create dialogs) and Válido desde / hasta (Modificar, read-only) | `DateTimeField` (`components/ui/date-time-field.jsx`, built for ETP-6365 on `DateField`'s pieces: one field `19/11/2026 14:20`, `max` = server clock, generic optional `suffix`, not used here: the zone is the helper text below) |
| Moneda destino (Nueva divisa) | `CreatableSearchSelect` with `staticOptions` (`value` + `displayValue`) |
| Rate | `MaskedAmountInput` (`bare`, `grouping={false}`), as the payment modal's conversion rate |
| Read-only origin / destination / edit range | shared `Input` (`readOnly`, `disabled`) inside `Field` |
| Dialogs | `Dialog` / `DialogContent`; delete: `DeleteConfirmDialog` (`title` / `message` overrides) |
| Badges | `StatusTag` (tones `info` / `warning` / `success` / `neutral`) |
| Buttons and links | `Button` (`outline`, `ghost`, `link`, default), `RefreshButton`, `ListSortPopover` |
| Accordion list (currency rows, per-currency column header row, rate rows) | `Table` / `TableBody` / `TableRow` / `TableHead` / `TableCell` from `@/components/ui/table`, laid out like `MovementsTable` (leading 40px toggle column, parent row lifted on hover, sub-rows as plain `TableRow`s, header row 40px / 12px semibold) |
| Expand / collapse | `RowExpandToggle` (vertical, as MovementsTable / StatementsTable); the whole currency row also toggles |
| Currency symbol | `Badge` (`variant="outline"`) |
| Refresh indicator | `ListProgressBar` |
| Row hover actions | `ListModalRowActions` |
| Print | `ReportDrawer` (`rows` prop) |
| Toasts | `sonner` `toast` |

Nothing in the window is hand-drawn any more: the former symbol chip and accordion header button were replaced by `Badge` and `RowExpandToggle`, and the hand-made `<section>` / `<table>` by the shared table primitives inside the shared `Card` (`@/components/ui/card`, only `overflow-hidden` added so the table follows its radius).

## Gap assessment
- The organization currency name in *Moneda origen* comes from `Intl.DisplayNames` (no action used here serves the AD currency name).
- Dates are always `dd/MM/yyyy HH:mm` (story ETP-6365), whatever the UI locale.
- Válido desde is ONE field (`DateTimeField`), as in the design.

## Manual verification
1. Open `/conversion-rates` from **Sistema → Configuración**: the menu, the title and the breadcrumb read *Conversión de divisas*; *Configuración → Roles* lists it under Configuración too.
2. The list shows one row per currency with its rate in force and *Descargada hoy HH:mm* (USD/GBP) or *Desde …* plus *+ Nueva tasa* (manual).
3. Expand a currency: its header row reads `1 <ISO> = EUR`; every rate of the period is listed; a synced row closed at `00:00` shows `23:59` of that (server) day, converted to the browser's zone like every other time; an open range shows «—».
4. Change Divisa / Periodo / Estado: the request carries `toCurrency`, `validFromDate >=` start and `validFromDate <` end, `etgoRateStatus`, and only `currency = EUR` rows; the URL keeps the filters.
5. *Nueva divisa*: only currencies without rates are offered; Válido desde starts at the server's minute with the hint; a start later than now is refused in the field.
6. *+ Nueva tasa*: the summary says which range is closed and when; an overlapping start puts Válido desde in error, shows the overlap message with the times in the browser's zone (named once, after the suggested start) and disables *Crear tasa*.
7. Hover any manual rate: Modificar / Eliminar appear; automatic rows show none. *Modificar tasa*: only the rate is editable, the range is read-only, the summary shows the server's old → new of `EUR → <ISO>` only (also in the confirmation); *Guardar cambios* opens *¿Confirma el cambio de tasa?*; *Volver* keeps the values and saves nothing; *Confirmar cambio* saves.
8. *Imprimir*: the preview lists the rates of the listed currencies with the filters in the header.
9. With the browser in another zone than the server (e.g. `America/Argentina/Buenos_Aires` against a `UTC` server): the columns read *(hora estándar de Argentina)* (under the Válido desde field: *Hora estándar de Argentina*) and the times are 3 h earlier than the stored ones (4 h against a Madrid server in winter), downloaded rows included; a rate created at *Ahora* is stored at the server's minute; the popover's time box is 24h.

## Automated evidence
- `artifacts/conversion-rates/decisions.json` — `layoutType: "custom"`, `readOnly: false`, `etgoRateStatus` exposed read-only, `currency` / `divideRateBy` / `validToDate` / `organization` / `conversionRateType` read-only or hidden. `toCurrency` and `validFromDate` carry `readOnlyLogicJs: "!!record.id || record.sMFCRSynced === true"` (set on create only, matching the rate-only edit rule) next to the AD `readOnlyLogic: "@sMFCRSynced@='Y'"`: the JS variant drives the generated form, the AD string is the one `contract.mcp.json` carries (it has no JS variant). The backend enforces the rule on every channel anyway: an existing rate only changes through `updateManualRate`, which takes the rate alone.
- `tools/app-shell/src/windows/custom/conversion-rates/` — `ConversionRatesPage.jsx` (toolbar, filters in the URL, print, dialogs), `CurrencyRatesList.jsx` (the accordion list), `ManualRateDialog.jsx`, `ConversionRateBadges.jsx`, `conversionRatesApi.js` (requests), `conversionRatesFormat.js` (`formatRate`), `conversionRatesModel.js` (pure helpers: wall clock, display rule, server ↔ browser zone conversion and zone label, period bounds, criteria, currency list, no-future check).
- Shared: `contract-ui/ListModalRowActions.jsx`, `ReportDrawer.jsx` (`rows`), `DeleteConfirmDialog.jsx` (`title` / `message`).
- Backend: `com.etendoerp.go` (actions `currentRates`, `manualCurrencyOptions`, `previewManualRate`, `serverClock`, the write validation and `etgoRateStatus`); `com.smf.currency.conversionrate` owns the downloader.

## Public API — read-only `conversion-rates` — ETP-6174

The public API publishes the window as `GET`/`LIST` only (`/api/v1/conversion-rates`), declared with
`publicApi.readOnly: true` on `entities.header` in `decisions.json` (the entry renamed to the
contract entity `conversionRate`; the manifest generator finds it by that name). ETP-6365 keeps it
read-only although the window itself now writes. The window's category (`finance`) is excluded by
default; the window is published because it is listed in the generator's V1 allowlist. Every field
is read-only (`out`); a write answers `404`.

The entity is curated (`publicApi.exposed: true`) on `currency`, `toCurrency`, `validFromDate`,
`validToDate`, `multipleRateBy` and `divideRateBy`, so the downloader's `sMFCRSynced` flag and the
ETP-6365 status column stay out of the public API.

The public API publishes `multipleRateBy` and `divideRateBy` as `number`/`double`, the type NEO
answers (the default CRUD serializes the `BigDecimal` as is). ETP-6174 declared `"type": "number"`
on both in `decisions.json` while AD reference 800019 (Rate) was extracted as `string`. Core 0.3.110
extracts it as `decimal` (see the ETP-6342 section below), which the manifest generator also maps
to `number`/`double`, so ETP-6385 removed the override; the published type did not change.
Regenerated with `make regen ONLY=conversion-rates FROM_CACHE=1` (contract `0.8.0`).
Contract: `docs/public-api.md` §3.

## Rate and cost fields are numeric — ETP-6342

Schema Forge core 0.3.110 maps AD reference `800019` (General Quantity: rates and costs) to `decimal` instead of the `string` fallback. **Multiple Rate By** (`multipleRateBy`, `MultiplyRate`) and **Divide Rate By** (`divideRateBy`, `DivideRate`) are now `decimal` in the contract (`tsType: number`): the form renders them as number inputs and the list as numeric columns, without the former 22-character `maxLength`. The contract keeps the DB-derived `validation.maxLength: 22`, which the generator ignores for numeric fields; the public API type is `number`/`double`.
