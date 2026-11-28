# Fiscal Models — Modelo 390 detail page (`FmModel390Page`)

> Split out of `fiscal-models.md` (ETP-5716) to keep each window guide under the PR review
> size limit. The rest of the Fiscal Models window — list, catalog, model registry, status
> lifecycle, the 303 and 349 detail pages, the presentation guard and the shared endpoints —
> stays in [fiscal-models.md](fiscal-models.md). A quoted section name below ("Model catalog",
> "Modelo 303 detail page", …) refers to that guide unless it is a heading of this file.

ETP-5716, phase "skeleton + boxes". The annual VAT summary, built on the classic module through
`/fiscal390/*` (backend contract: `{etendo_root}/modules/com.etendoerp.go/docs/aeat-390-endpoints.md`).
Everything 390-specific lives in `models/390/`; the shared surfaces only read the registry.
The invoices (Facturas) tab, the preload from the 303s with the cuadre, the presentation
(telematic filing, manual registration, substitute) and the incidents are described below.

### Registry entry and shared surfaces

| Surface | 390 behaviour | Driven by |
|---|---|---|
| Catalog | Card "390" with the single chip "Anual"; SII warning on activation (see "Model catalog") | `periodicities: ['annual']`, `siiWarningOnActivate` |
| Every surface | Hidden while the backend-only flag `fiscal-model-390` is off for the current user (the default; targeted per account email and per tenant): the catalog answer drops 390 and marks it `_unavailable` (see "Model catalog › Modelo 390 behind the backend-only flag") | `FiscalModel390Flag` (backend), `catalogAvailability.js` |
| Nueva declaración | Subtitle "Elige el modelo y el ejercicio que quieres declarar." (`fm.new_decl.subtitle_annual`; the others keep the "período" one). Year only (no Frecuencia / Período), the Año field full width (`.fm-newdecl-row--single`): under Año a grey "Anual" pill + "El Modelo 390 no tiene frecuencia ni periodo: se declara el ejercicio completo." (`fm.new_decl.annual_hint`); footer "Se creará como Modelo 390 · Anual <año>" (`fm.new_decl.preview_annual`); period sent is `'0A'` | `isAnnualOnlyModel` (`fiscalPeriods.js`) |
| Nueva declaración | An ordinary 390 of the selected year already in the list → inline notice "Ya existe el Modelo 390 de <año>" + **Abrir declaración** (`onOpenExisting`) and "Crear declaración" disabled. A substitute (`type: 'com'`) does not block | `singleOrdinaryPerYear` |
| Nueva declaración | Amber, non-blocking notice with a `TriangleAlert`: bold "Faltan Modelos 303 de <año> (T4)." (`fm.m390.new_decl.missing_303_lead`, the hook's `key`) + "El 390 se calculará igualmente, pero el resultado podría no cuadrar." (`…_body`, the hook's optional `bodyKey`) when 303s of the year are not in the list. The duplicate-ordinary notice has the same icon with its sentence in bold. Quarterly filer by default (T1-T4); once the year has a monthly 303, every month 01-12 is expected; any status counts | `newDeclWarning` → `newDeclWarning390.js` |
| Nueva declaración | Año offers **2026 and 2025** (most recent first; the current year pre-selected): the previous exercise's 390 is filed in January of the next one. 2025 is the exact `AEAT390_2025_Y` design (no layout fallback); the one-ordinary check and the missing-303 notice follow the selected year. 303/349 keep the shared `SELECTABLE_YEARS`; switching to a model that does not offer the selected year resets it to that model's default | `selectableYears` → `selectableYears390.js` |
| List | Period column "Anual" (`fm.period.annual`); sorts after December/T4; "Resultado" = `summary.annualResult` ([86], or [94] in territory mode) with the signed amount and the 390's own informative badge (`resultKind390`: "Resultado positivo" / "Resultado negativo" / "Resultado cero" / "Sin resultado", neutral colours — never the 303's "A ingresar" / "A compensar/devolver"; activity = [47] or [64] ≠ 0). The badge text travels as `labelKey`, which `ResultText` prefers over `fm.result.<kind>`; 303/349 send none and are unchanged. Draft polling through `/fiscal390/modified` | `listBehavior390.js` |
| List | A `POST` answered `409 DUPLICATE_ORDINARY` (e.g. the list was stale) shows a toast "Ya existe el Modelo 390 de <año>" with **Abrir declaración**, which opens `existingId` (from the list, or re-read with `fetchDeclaration`) | `duplicateOrdinaryId` in `FmListPage.jsx` |
| "Por vencer" | January 30 of year+1 | `annualDeadline` → `deadline390.js` |
| Detail title | "Modelo 390 - 2026" (no period) | `formatDeclPeriod` |
| Config drawer | No 390 section (nothing to configure) | optional `modelRegistryConfig.js` binding |
| Detail page | Receives `onSubmittedRemotely` (a telematic filing is persisted server-side) | `telematicFiling: true` |

### Header, cards and tabs

- **Action bar** (same chrome as 303/349): left Cancelar, status chip and **Tipo: Normal | Sustitutiva**;
  right **Calcular**, **Generar fichero 390**, **Guardar** and **Registrar/Presentar** (primary). Once
  presented, the right group is only **Crear declaración sustitutiva**. Like the 303, a blocked
  Generar stays clickable: with blocking RULE incidents a click shows the toast
  `fm.m390.blocked_by_incidents` and opens nothing, and the Generar download icon is red (see
  "Incidents"). Registrar/Presentar always opens the picker: there, the AEAT path is refused with
  the same toast, while **manual registration is deliberately ungated: the declaration was filed
  outside Etendo** ("Con / Sin acuse de recibo" always register, as in the 303). Both buttons are
  disabled only while nothing is computed or the page is busy.
- **Registrar/Presentar** opens the shared `PresentModal` exactly as the 303: the AEAT path and,
  as its left column, **Con acuse de recibo** (`submitted_ack`, the acuse PDF picked in the modal)
  / **Sin acuse de recibo** (`submitted`) — see "Presentation" below.
- **Sustitutiva** shows the amber banner (shared `.fm-substitutive-banner`, same as 349) with
  **Identificador declaración anterior** (digits only, `sanitizeFormerStatementInput`; inline error
  `fm.m390.substitutive.id_invalid` until it has exactly 13 digits, the shared
  `isValidFormerStatement` rule) and the checkbox **Sustitutiva por rectificación de cuotas** —
  shown only while "Declarado en concurso de acreedores" (`ConcursoAcr`) is marked: AEAT defines that
  case only for insolvency proceedings (art. 80.Tres LIVA). Unmarking `ConcursoAcr` clears
  `ConcursoUltPer` and `rectificacionCuotas`, and `substitutiveFlags` ignores
  `rectificacionCuotas` without `ConcursoAcr = 'Y'` (`isRectificationByQuotas`).
  Generar and Registrar/Presentar refuse an invalid identifier with a toast. Persisted as
  `manualData.identification.{sustitutiva, formerStatement, rectificacionCuotas}` — the list "Tipo"
  column reads `sustitutiva` like 349's. `rectificacionCuotas` is deliberately not named
  `rectificativa` (that one means "Rectificativa" in the list).
- **Cards:** Incidencias (the 303 card: total + severity badge, click opens the tab — see
  "Incidents"), IVA devengado [47], IVA deducible [64], Resultado [86] — or [94] when filing to
  several administrations — with an informative badge: **Resultado positivo / negativo** (or
  "Resultado cero" / "Sin resultado"), neutral colours (`resultKind390` in `fm390Layouts.js`, NOT the
  shared `deriveResultKind`). AEAT writes [86]/[94] "con el signo que corresponda" and classic only
  signs them; the payment, offset or refund was settled by the last 303, repeated in [97]/[98].
  Between the cards and the tabs, a full-width banner with the "cuadre con los 303"
  (`Reconciliation390`, see "Preload from the 303s and cuadre"); its subtitle carries that
  "informative" note. The cards size on the width they really get, not on the viewport (GEN-02:
  a container query on `.fm-390-kpis-wrap`, so the app sidebar counts): four cards with icon from
  1240 px of width, four cards without the icon tile (`.fm-kpi__icon`, a class of the shared
  `KpiWidget`) from 1040 px, and 2 × 2 cards with icon below that. Each card's label and badge stay
  on one line and are never cut ("Resultado [86]" + "Resultado negativo" needs ~213 px); at
  1280×720 with the sidebar open the cards are 2 × 2.
- **Tabs:** Casillas, Facturas (`FmSources390.jsx`, see below; its badge is the unfiltered line
  count, known once the tab has loaded it — `onCountChange`; no badge on a presented declaration),
  Incidencias (`Incidents390Tab.jsx`,
  see "Incidents"), Justificante (shared `AttachmentsTab`).

### Notices of the 390 screen — the system `InfoBanner` (ETP-5716)

Every message of the 390 screen is the **system notice banner**, `InfoBanner`
(`tools/app-shell/src/components/InfoBanner.jsx` — the one fiscal-config, product, contacts,
`BlockingBpBanner`, `ListModalWindow`, `CloneOrderModal`, the OCR popups and payment entry use):
Tailwind `status-*` tokens (`bg-status-<tone>`, `border-status-<tone>-border`,
`text-status-<tone>-foreground`, i.e. the core `--status-*-bg/-fg/-border` variables, dark mode
included), a 2px left accent, the icon and the text in the tone's foreground. Tones: `info`,
`warning`, `success`, `danger`; the 390 passes `dismissible={false}` (the notices reflect state).
`InfoBanner` takes an optional `action` node (added for the 390, generic, absent for every older
caller). Consecutive banners are grouped in `.fm-390-notices` (8px apart; `--gutter` for the
tabs' 20px side gutter); a bold lead is `.fm-390-notice__lead`, a second line `.fm-390-notice__line`.

| Where | Notice | Tone |
|---|---|---|
| Under the KPI cards | cuadre with the 303s (match / difference / no 303 of the year) | success / warning / info |
| Casillas, before computing | why it could not be computed (incomplete fiscal year with "Ir a Calendario fiscal"; other errors) | warning / danger |
| Casillas, above the block | backend calculator warnings (`UNSUPPORTED_RATE`, `NO_BOX`), one banner each | warning |
| Identificación / Representante | names the file will cut, one banner each | warning |
| Tributación por territorio | percentages do not add up to 100 % | danger |
| Resultado de las liquidaciones | cross-input checks (DEVOLVER_12 with [97] → danger; [98] with [96]/[97] → warning) | danger / warning |
| Year's 303s (block 9) | "No hay Modelos 303 de <año>"; load error; territory preloaded; missing 303s (bold lead "Faltan Modelos 303 de <año> (…)." + rest); preload warnings | info; danger; info; warning; warning |
| Facturas | load error; box total matches / does not match the box | danger; success / warning |

Muted text is kept only for explanatory hints (block notes, the 303 table intro, empty cards)
and field-level validation under an input (`.fm-390-inline-error`). The fiscal-models
`FmCommon` `Banner` (`.fm-banner*`) uses the same `--status-*` palette (through `--fm-*` aliases)
but a different shape — full 1px border, 10px radius, the sub-line in muted grey — so it is not
used on the 390 screen.

### "Casillas" tab (`FmBoxes390.jsx` + `fm390Layouts.js`)

Declarative layout, one block at a time with a sticky index of the 11 blocks (folded into the
app `Select` at 1280 px and below — no native select, the ETP-5584 rule; GEN-02: at 1280×720 the
index left the cells too narrow for their amounts) and Anterior / Siguiente at the bottom. The
index items use the 303 section-nav metrics (8px 12px, 14/20, radius 8); it is 280 px wide so
every block name stays on one line.

**Cell width (GEN-02 / OBS-12).** `.fm-390-boxes__content` is a size container and the 390 cells
take `clamp(150px, (100cqw − 296px) / 2, 260px)` — the room the row really has, for the two
columns a 390 block has at most, keeping ~270 px for the concept — instead of the shared compact
150 px under 1440 px. Inside a 390 cell the box number column is 40 px (56 px in the 303) and the
pencil / Restore buttons are slimmer, so a 260 px cell shows a 12-integer-digit amount
("123.456.789.012,34 €") whole even on a modified box with both icons (the earlier 220 px cap cut a
9-digit "123.456.789,12 €": 142 px of text in 134 px — QA retest of OBS-12). At 1280×720, sidebar
open or collapsed, and at 1440 px the cells are 260 px and the page does not scroll horizontally.
The value span also carries the amount as its `title`, as a fallback for any narrower case. The block content has the 303 24px gutter;
the in-block tables (IAE activities, representatives, the year's 303s) are `.fm-dtable--plain`
like the 303 Facturas / Incidencias tables (header not sticky), and the block warnings have the 303
warning-banner metrics.

**Organization-sourced blocks (Identificación, Datos estadísticos, Representante)** share one card,
`OrgSyncedCard` in `FmBoxes390.jsx` (a flush `.fm-section-card` + `.fm-390-org-card*`): a bold title,
a muted subtitle "… · sincronizado con Organización" and, on the right, an outlined pill with a
pencil "Editar en Organización" (`FmBoxes390__editOrganization`, `onEditOrganization` →
`/organization`). The read-only org data goes inside; the user's own marks (devolución mensual,
concurso, operaciones con terceros) stay below the card, outside it, and the name-truncation
notices stay inside it, under the data.

- **Identificación** — "Sujeto pasivo" / "sincronizado con Organización": NIF (monospace) and
  "Apellidos y Nombre o Razón Social" as label-over-value data (`FmBoxes390__taxpayerCard`).
- **Datos estadísticos** — "Actividades declaradas" / "N actividad(es) · sincronizada(s) con
  Organización" (`fm.m390.org_card.activities_one|_many`): uppercase muted headers A · Actividad,
  B · Código de actividad, C · Epígrafe IAE, Tipo (right-aligned); the name semibold, the code a
  small blue-tinted monospace badge plus its description muted, the epigraph bold monospace, Tipo a
  dark pill with a star "Principal" for the main activity, an outlined pill "2ª"…"6ª" for the
  others, and a muted outlined "No se declara (…)" for one past the limit
  (`FmBoxes390__activitiesCard`).
- **Representante** — "Representantes legales" (legal entity) or "Representante" (natural person)
  / "N representante(s) · sincronizado(s) con Organización": table NIF (monospace) / Nombre /
  Fecha de poder / Notario — the natural person's table has NIF / Nombre only
  (`FmBoxes390__repNif` / `__repName`); the empty state is inside the card
  (`FmBoxes390__representativesCard`).

| # | Block | Content | Origin |
|---|---|---|---|
| 1 | Identificación | NIF and the name the file carries (legal entity: `AD_Org.socialName`, or `name` when empty; natural person `aeat390Isperson`: `aeat390Surname1` + `aeat390Surname2` + `aeat390Firstname` of the Organization information); marks "Inscrito en el registro de devolución mensual" (`ISMONTHLYRETURN`), "Declarado en concurso de acreedores en el ejercicio" (`ConcursoAcr`) and, under it, "… en el último periodo" (`ConcursoUltPer`) | NIF from `/session`, name from `organization/organization` + `organization/information`, read-only; marks manual |
| 2 | Devengo | Ejercicio, tipo, identificador anterior, "por rectificación de cuotas" | read-only reflection of the header Tipo |
| 3 | Datos estadísticos | IAE activities with the form's columns: **A · Actividad** (epigraph description), **B · Código de actividad** (e.g. `A03`, its description as secondary text/tooltip), **C · Epígrafe IAE** (AEAT format: the file's `6732` shown as `673.2` — `formatIaeEpigraph390`), **Tipo** ("Principal" first, then the others by line as `2ª…6ª` — the 1st…5th other activity, as classic `AEAT390Utility.getEpigraphOrgInfo` writes them; one past the 5th is listed as "No se declara"). The IAE type ("Actividades empresariales sujetas al IAE") is not a 2025 form column — only the epígrafe cell tooltip. Values are the raw epigraph / code fields, requested with `_extraProperties=epgrafeIAE.epigraph,epgrafeIAE.description,epiaeCode.code,epiaeCode.description` (`IAE_EXTRA_PROPERTIES`; NEO allowlists them, `neo-headless.md` §4.3.5) — no backend or decisions change; the selector identifiers are only split as a fallback when a field is missing (`toActivities` in `useOrg390Identity.js`). Mark "operaciones con terceras personas" (`YEARLY_BP_DECLARATION`) | `organization/actividadesDelIae`, read-only + "Editar en Organización" |
| 4 | Representante | Natural person: `information.aeat390RepNif/RepName`; otherwise the first 3 active `representanteLegal` rows by line, as classic reads them (OBCriteria filters on active) (NIF, name, power date, notary) | Organization, read-only + "Editar en Organización" |
| 5 | IVA devengado | Régimen ordinario and intra-EU goods/services by rate (0, 2, 4, 5, 7.5, 10, 21 %), [27]/[28], [29]/[30], [31]/[32], totals [33]/[34] and [47] | calculated |
| 6 | IVA deducible | Interior corrientes / bienes de inversión, importaciones, intra-EU (per rate + group totals [48]…[59], [597]/[598]), [639]/[62]; manual [63] (preloaded with Σ 303 [43]) and [660]/[661]; total [64] (deductible cuotas + [63] + [661], as the classic file writes it) | calculated; [63]/[660]/[661] manual |
| 7 | Resultado liquidación anual | [65] total (= [47] − [64]), [658] manual, [84] total (= [65] + [658]), [659] manual, [85] manual (disabled AND cleared in territory mode; refused while [93] has a value), [86] total | |
| 8 | Tributación por territorio | Toggle "Tributo a varias Administraciones"; % [87]–[91] (each 0–99), [92] total, [93] manual (refused while [85] has a value), [94] total; inline error when the percentages do not add up to 100 % | turning the toggle off clears the territory inputs |
| 9 | Resultado de las liquidaciones | Per month "A ingresar" / "A devolver" (`INGRESAR_xx` / `DEVOLVER_xx`; the "A devolver" column is disabled unless `ISMONTHLYRETURN = 'Y'`), totals [95] / [96], [97], [98], [662] manual; inline error when DEVOLVER_12 and [97] are both filled, amber warning when [98] is filled with [96] or [97] | preloaded from the 303s (see "Preload from the 303s and cuadre"); the year's 303s are listed under the block |
| 10 | Volumen de operaciones | [99] [103] [104] [105] [110] [125] [126] calculated, [127] [128] manual, [106] [107] (subtracted), total [108] | [112] is not shown: it is not in the 2025 model (AEAT DR390e2025) and classic never writes it from 2021 on; an old draft's `390OTHER_UEMENBER` is dropped on save |
| 11 | Operaciones específicas | [230] [109] [231] [523] calculated, [111] manual; [232] [113] have no source (always 0, blank cell — see below) | |

Out of scope and not shown (the backend may still return them): criterio de caja, recargo de
equivalencia, régimen simplificado, REAGYP, bienes usados, agencias de viajes, grupo de entidades,
prorrata. A layout for another design year plugs in through `getLayout390(layoutYear)`.

**Boxes with no source (ETP-5716 OBS-9 audit).** [31]/[32] (modificación de bases y cuotas por
concurso de acreedores), [232] (bases imponibles del IVA soportado no deducible) and [113]
(entregas interiores devengadas por ISP en operaciones triangulares) have no tax-report parameter in
the classic `AEAT390_2025_Y` report and no input: classic writes them as zero in the file (a null
bean value is formatted as zeros), so GO receives no box and the cell renders blank, with no pencil.
Making them editable needs new classic tax-report input parameters (a classic dataset change) —
deliberately out of scope of ETP-5716, pending a product decision; until then the file always
carries 0 for them.

- **Cells:** calculated = grey, read-only; totals in bold with the formula. **Manual cells behave
  exactly as the 303's editable boxes** (ETP-5716, `InputCell` mirrors `FmBoxes303`
  `renderBoxCell` / `renderCellInput`): the value is shown formatted with a pencil button
  (`FmBoxes390__edit_<key>`, reached with Tab, Enter / Space or a click opens it); the editor is
  the 303's canonical `MaskedAmountInput` (instance separators, grouping on amounts and off on
  percentages, the clean value reported outward; amounts get the 303's keystroke hard stop — 15
  integer digits, 14 when negative, 2 decimals — percentages are exempt), autofocused, starting
  from the stored value; blur or Enter commits, Escape
  discards, an editor closed without typing commits nothing. Nothing is saved on commit: the
  change waits for Guardar / Calcular / Generar / Presentar, as the 303's overrides do (no
  autosave). Kept from the 390: the origin styles (calculado / manual / modificado) and ↺
  Restaurar beside the pencil, percent cells, and locked cells (no pencil, with the reason as
  title). Amounts with `formatAmount`, percentages with `formatPercent`; stored normalised
  (`"40.50"`); a negative [85]/[93] or a percentage outside 0–99 (`TERRITORY_PERCENT_MAX`) is
  refused with a toast. As in the 303, the masked input takes no non-numeric text (the page's
  "invalid number" toast stays as a guard). A draft with no number in it (a lone "-" or decimal
  separator — `isUnparseableDraft`, fiscalModelsUtils.js) is dropped on commit instead of clearing
  the stored value, in the 390 and the 303 cell alike (review W3); an emptied cell still clears it.
- **Classic consistency checks (ETP-5716 verification against Classic).** The classic generator
  rejects some input combinations at "Generar" with a raw error; the page prevents them first:

  | Rule | Classic | GO |
  |---|---|---|
  | Each % [87]–[91] ≤ 99, sum = 100 | `AEAT390Report` | toast above 99; inline sum error |
  | [85] with any territory % | `BothTerritoryAndLiqAnual` | a territory % > 0 removes [85] from `aeatInputs` (not just disables the cell) |
  | [85] with [93] | `BothAmtPrevious` | typing one while the other has a value is refused (`fm.m390.input.compensation_conflict`) |
  | DEVOLVER_xx without ISMONTHLYRETURN | `AEAT390_MonthlyReturn_Check` | "A devolver" cells disabled (`monthlyReturnOnly`); unmarking the flag clears them |
  | DEVOLVER_12 with [97] | `AEAT390_TotalLastPeriod_Check` | inline error in block 9 (`inputMessages390`) and the blocking incident `LAST_PERIOD_REFUND_CONFLICT` (disables Generar / Presentar) |
  | [98] with [96] or [97] | AEAT instructions ("no cumplimente la 98") | amber, non-blocking warning in block 9 |
  | ConcursoUltPer without ConcursoAcr | rejected | unmarking ConcursoAcr sets ConcursoUltPer to `N` |

  All the "drop" rules live in one place, `sanitizeAeatInputs390`, applied after every edit and on
  every save (`buildManualData390`), so stored data never carries the rejected combinations. The
  backend checks every one of them again as a blocking incident (see "Incidents"), so a value that
  reached the stored inputs another way still blocks the file.
- **[63] (regularización de bienes de inversión) is a manual input** (`390INVESTMENT_REGULARIZATION`,
  ETP-5716 QA CAL-F2). It is never calculated — it depends on the prorrata of the acquisition years
  (arts. 107–110 LIVA), which Etendo does not keep — and may be negative. It is **preloaded with
  Σ [43] of the year's 303s** (the same manual box of the self-assessments, already inside their
  [45]), so it gets the usual "Modificado" + Restaurar when the user changes it, and the 390 result
  keeps matching the 303s. It is a deduction: [64] = deductible cuotas + [63] + [661], and since the
  classic engine puts it on the bean (`AEAT390Report2014.generateOperacionesRegimenGeneral`:
  `RegularizInversiones` + `SumDeducciones`) it also reaches [65], [84]–[86] and, unlike [661], the
  territory [84] with no quirk. The file prints it on page 4 ([63]; position 625 of the 2025/2026
  design), the same code for the 2025 and 2026 reports. The classic launcher still has no parameter
  for it (no `TaxReportParameter` in the reference data), so Classic keeps writing 0; [522]
  (prorrata) stays out of scope.
- **Rates without operations** are folded behind "Sin operaciones (N tipos) · Mostrar".
- **Live derivation:** the input-dependent boxes ([64]/[65] through [63] and [661], [84]–[86], [92]–[94],
  [95]/[96], echoed inputs, [108]) are recomputed on screen by `deriveInputBoxes`, a mirror of the
  backend's `Fiscal390DerivedBoxes` (same formulas, cents arithmetic). The backend stays
  authoritative: Calcular and the generated file recompute server-side.
- **[661] and screen = file.** Classic adds [661] to [64] and takes it off [65] only while writing
  the TXT (page 4), so the screen does the same; in liquidation mode [84] = [65] + [658] (no second
  [661]). In territory mode the classic file prints the territory [84] (and so [92]/[94]) WITHOUT
  taking [661] off — [84] = [65] + [661] + [658] — a classic inconsistency the screen reproduces so
  every box shown equals the file. Detail: `com.etendoerp.go/docs/aeat-390-endpoints.md`.
- **Name truncation notice.** Classic cuts the identity texts in the file (`AEAT390String`): razón
  social 37 characters; a natural person's first name and each surname 15; the natural-person
  representative name 37; each legal representative name 36. Lengths are measured on what the file
  keeps (upper case, accents folded, characters outside `[A-Z0-9. ]` — Ñ included — dropped). The
  backend reports a longer text as the warning `NAME_TRUNCATED` (moved server-side in the incidents
  phase so the rule lives once); the page shows those incidents as a non-blocking amber notice in
  Identificación / Representante ("La razón social se recortará a 37 caracteres en el fichero.",
  `nameWarningsFromIncidents390`) and in the Incidencias tab; Generar is not blocked.
- **Box search:** "Buscar casilla" + Enter — a number (`86`, `[86]`, `086`) or a concept fragment
  (accent/case-insensitive) — opens the block, scrolls to the cell, focuses its pencil if editable and
  highlights it for 2.5 s; "No se encontró la casilla" otherwise. A box that is not on screen is
  revealed first: a rate folded behind "Sin operaciones (N tipos) · Mostrar" unfolds its group
  (and the group stays unfolded once the highlight fades — e.g. [21] in "Adquisiciones
  intracomunitarias de bienes" with no operations), and a box of the territory block opens the
  "Tributo a varias Administraciones" toggle (only shown; no input is written). "Ir a la casilla"
  of an incident goes through the same path.
- **Box origin styling** (no legend in the toolbar): calculated cells grey,
  manual or preloaded inputs white with a pencil, totals in bold; "Modificado" (amber border +
  ↺ "Restaurar valor calculado") applies to an input whose value differs from
  `manualData.aeatPreloaded[key]` (the value the 303 preload put in); an input with no preloaded
  value reads "Manual o precargado". Restaurar puts the preloaded value back (a preloaded zero
  empties the input — `restorePreloaded390`).
- **No design-year note:** `taxReport.fallback` / `layoutYear` stay in the boxes payload (the
  layout is picked from `layoutYear`), but the toolbar no longer shows a "Diseño de registro
  <year>" note.
- **Backend warnings** (`UNSUPPORTED_RATE`, `NO_BOX`) are listed as warning banners above the block
  (they make the classic file fail or differ) and are also incidents: `UNSUPPORTED_RATE` blocking,
  `NO_BOX` a warning.
- **"Ver facturas":** a calculated cell whose box is in the payload's `invoiceBoxes` (the boxes
  filled from invoices — never a derived total like [47]/[64]/[86]/[108]) carries a small receipt
  button that opens the Facturas tab filtered by that box. It overlays the right edge of the cell
  only on hover or keyboard focus (always visible on touch screens, `hover: none`), so at rest the
  value shows whole like any 303 cell — it used to take 32 px for good and truncate the amounts
  at 1280 px. Not shown on a presented declaration
  nor for a payload without `invoiceBoxes` (snapshot taken before the field existed).

### "Facturas" tab (`FmSources390.jsx` + `sources390.js`)

The invoice-tax lines behind the invoice boxes, from `GET /fiscal390/sources`
(`fetchSources390`). The backend builds them from the same box computation, so **for each box
the sum of the lines filtered by it equals the box value** (contract and inclusion rules in
`aeat-390-endpoints.md`, "GET /fiscal390/sources"). Differences from the shared 303 `SourcesTab`
(not reused: the 303 tab is client-side over an inline `sources` array, the 390 one is server-side
filtered and paged):

- **Columns:** the 303 ones (Fecha factura, Fecha contable, N° documento, Tipo, Contacto, Base,
  Cuota, Total, Casillas) plus **Impuesto**; **Tipo** is, as in the 303, the side of the
  declaration the row's boxes belong to — "IVA Devengado" / "IVA Deducible" (the 303 keys
  `fm.sources.type.accrued|deductible`, from the row's backend `sides`; an intra-EU acquisition
  feeds both and shows "IVA Devengado · IVA Deducible" in one row; `rowSides` / `rowTypeLabel` of
  `sources390.js`, falling back to the invoice side when `sides` is absent). The Tipo filter uses
  the same values (`accrued` / `deductible`, matched server-side against `sides`). With a
  box filter a last column "Importe casilla [nn]" shows each line's contribution to that box (the
  base for a base box, the cuota for a cuota box).
- **Narrow tab (GEN-02).** The table fits its width, with no horizontal scroll hiding Total.
  `.fm-390-sources` is a size container: under 1200 px of tab width the cell gutters drop to 8 px
  and, with a box filter, "Casillas" gives way to "Importe casilla [nn]"
  (`.fm-390-sources__col--boxes-filtered`); under 1100 px "Fecha contable" is hidden too
  (`.fm-390-sources__col--secondary`; the CSV keeps every column). The totals row keeps the
  accounting-date slot as its own cell so its label spans the right columns either way.
- **Filters:** Tipo and Impuesto selects (Impuesto options from the payload's unfiltered
  `taxes`), search (document number, contact or tax; debounced 300 ms, Enter sends at once), "Limpiar filtros". All filtering
  and paging is done by the backend (25 rows per page).
- **Box filter:** there is no Casilla select nor box chips. The only way in is "Ver facturas" (a
  box of the Casillas tab, or an incident's `sources` action). While it is set, the toolbar shows a
  removable tag "Casilla [nn] ×" (`fm.m390.sources.box_tag`, `FmSources390__boxTag`) that clears
  only the box (Tipo / Impuesto / search stay); "Limpiar filtros" clears everything.
- **Foreign-currency invoices:** each line's base and cuota are converted to euros separately by
  the classic engine (the invoice's own rate, else the general one) and **rounded to the nearest
  cent** (`AEAT390Utility.roundLineAmount`, HALF_UP). Until ETP-5716 QA (CAL-F1) they were rounded
  UP, which put a converted cuota one cent above base × rate and above the 303 for the same
  invoice — a false 0,02 € "Diferencia con los 303" and a blocking `BLOCK9_MISMATCH`.
- **Totals:** a sticky footer with base/cuota/total of every filtered line (not just the page) and,
  with a box filter, the box total plus a "Cuadra con la casilla [nn]" check against the box value
  (amber "No cuadra" otherwise — should never happen).
- **Exportar CSV:** re-requests every filtered row (`pageSize=0`) and downloads
  `facturas_390_<year>[_casilla_<nn>].csv` (`buildSources390Csv`): UTF-8 BOM, comma separator,
  ISO dates, plain 2-decimal amounts, every header and cell through the canonical `csvField`
  (formula neutralization — a negative amount comes out as `'-100.00`, per the CSV policy).
- **Filter ownership:** `FmModel390Page` holds the filter, so "Ver facturas" (Casillas tab, and an
  incident with a `sources` action) opens the tab pre-filtered with `sourcesFilterForBox(box)` from
  `sources390.js`.
- **Presented declaration:** like the 303, the per-invoice detail is not kept — the tab shows
  `fm.snapshot.invoice_detail_not_kept` and makes no request (the backend answers
  `submitted: true` with no rows anyway).
- Rows reload after a recompute (`refreshKey` = the boxes payload).

### Preload from the 303s and cuadre (`preload390.js`, ETP-5716)

Data: `GET /fiscal390/preload` (`fetchPreload390`, hook `usePreload390`). The backend contract —
which 303 counts per period (latest submitted, else latest draft), the boxes it uses (snapshot or
live + `manualOverrides`, period figure = [69]) and the full **303 → 390 mapping table with its
AEAT justification** — is in `com.etendoerp.go/docs/aeat-390-endpoints.md`, "GET
/fiscal390/preload". In short: [69] > 0 → `INGRESAR_<closing month>` ([95]); refunds →
`DEVOLVER_xx` ([96], monthly register only) or, last period, [98]; last-period credit → [97];
prior-year credits applied (Σ[78], oldest first against the first 303's [110]) → [85] (or [93] in
territory mode); in-year credits never applied → [662]; last 303 [65]/[89]–[92] → [87]–[91] when it
files to several administrations; Σ [43] → [63] (regularización de bienes de inversión).

- **When it applies:** on opening a draft whose `manualData.aeatPreloaded` is absent or empty
  (never preloaded — `hasPreloadedValues`; an empty `{}` is what a save records while the year had
  no 303 yet, so it does not count; nothing happens while the year has no 303) and on every
  **Calcular**, which re-reads
  the 303s first, applies them and then computes the boxes with the result. Never on a presented
  declaration (the 303 table and the cuadre are still shown).
- **Only unmodified inputs** (`applyPreload390` / `isUnmodified`): an input takes the new value when
  it is absent / blank or still equals the previously preloaded one; an explicit value — a zero
  included — with no preloaded entry is the user's edit (same rule as the backend). A value the
  user changed is kept and shows "Modificado" against the new preloaded value. A preloaded zero
  empties the input. A key the 303s no longer determine (e.g. the last 303 was deleted) keeps its
  input and leaves `aeatPreloaded`. The on-screen `ISMONTHLYRETURN` is sent (`monthlyReturn`),
  so refunds land in the right box.
- **Persistence:** `aeatPreloaded` is saved with the inputs (`buildManualData390(previous,
  identification, aeatInputs, aeatPreloaded)`); a preload applied on opening marks the page
  dirty and goes out with the next Guardar / Calcular / Generar / Presentar. Reloading keeps the
  manual values and the origin marks (acceptance criterion).
- **Server-side too (ETP-5716, AEAT PAR016):** the backend applies the same rule to everything it
  computes — the boxes (screen and the list's auto-compute), the file, the submission and the
  incidents — so the 390 never depends on the user having pressed Calcular or saved, as the 303 /
  349 compute from live data (`aeat-390-endpoints.md`, "Server-side 303 preload"). Precedent: a
  draft saved before the 303s existed kept an empty block 9, and the AEAT rejected the filing with
  PAR016 (block 9 ≠ [86]/[94]).
- **Safety net:** block 9 of the stored inputs that does not add up to [86] / [94] is the blocking
  incident `BLOCK9_MISMATCH`, and an empty block 9 while the year has 303s is `BLOCK9_NOT_PRELOADED`
  ("pulsa Calcular para precargar los 303"); both offer **Ver detalle por trimestre** (block 9 and
  the year's 303s, `onViewSettlements`) and stop Generar / Presentar before the AEAT does.
- **303 table** (`Settlements303Table390`, under block 9 through the `blockExtras` slot of
  `FmBoxes390`): period, status chip, result [71], result type (A ingresar / A compensar / A
  devolver / Sin resultado), "calculado ahora" for a draft computed live, "sustituye a N" when a
  later declaration replaced others, and **Abrir**, which saves pending changes and opens that 303
  (`fetchDeclaration` → `onOpenDeclaration` → FiscalModelsPage's one-shot `declAdded`). Below it:
  the territory note, the non-blocking "Faltan Modelos 303 de <año> (…)" (same key as the
  Nueva declaración notice's full sentence, `fm.m390.new_decl.missing_303`) and the preload warnings (draft 303s,
  unknown [110] carry, refund without monthly register, compute failed, last period missing).
- **Cuadre** (`Reconciliation390`, a full-width banner between the KPI cards and the tabs, with
  the cards' 20px gutter — the system notice banner `InfoBanner`, see "Notices of the 390 screen"):
  `reconcile390(result on screen,
  preload)` — the result shown on the Resultado card ([86], or [94] in territory mode) against
  `expectedResult` = [95] − [96] − [97] − [98] − [662] of the 303s.
  - Equal at cent precision (both sides rounded to cents — **no tolerance**: the AEAT publishes
    none, ETP-5716 decision; the backend `reconcile` and the `BLOCK9_MISMATCH` / `DIFF_303`
    incidents compare the same way): `InfoBanner tone="success"` with `CircleCheck`, "El resultado coincide
    con la suma de tus Modelos 303" and the muted "Es informativo: el ingreso o la devolución ya se
    gestionaron en el último 303 (casillas 97 y 98)." (`Reconciliation390__ok`).
  - Any difference, even a cent: non-blocking `InfoBanner tone="warning"` with `TriangleAlert`,
    "El resultado no coincide con la suma de tus Modelos 303" and "Diferencia con los 303: ±D
    (según los 303: X)" (`Reconciliation390__difference`).
  - Both: the missing-303 notice as a second subtitle line when periods are missing, and the
    outlined pill "Ver detalle por trimestre →" in the banner's `action` slot
    (`Reconciliation390__viewDetail`), which opens the
    Casillas tab at block 9 and scrolls to / highlights the year's 303s for 2.5 s (`FmBoxes390`
    `goToBlock` → `FmBoxes390__extra_<blockId>`, `.fm-390-block-extra--highlight`).
  - No 303 of the year (preload loaded, `reconcile390` → `no303`):
    `InfoBanner tone="info"` "Sin Modelos 303 de <año> con los que cuadrar"
    (`Reconciliation390__no303`), without the action. Nothing is rendered while the preload
    loads or before the boxes are computed. Neither state blocks Generar nor Presentar. Why these boxes: backend doc,
    "Cuadre".
- **Incidents:** the backend raises the same two findings as the warnings `MISSING_303` and
  `DIFF_303` (from the stored inputs, `Fiscal390PreloadAggregator.reconcile`); the page does not
  compute them (`preloadIncidents390` is the same comparison on the live screen, kept for the
  cuadre banner).

### Save flow

`manualData` = previous manualData (unknown keys kept) + `identification` + `aeatInputs` + `aeatPreloaded`
(`buildManualData390`). The classic substitute flags are written into `aeatInputs` on every save so
the backend forwards them to the classic generator: ordinary → `ISSUPPLEMENTARY: 'N'`,
`ISRECTIFICATION: 'N'`; substitute → `ISSUPPLEMENTARY: 'Y'` (or `ISRECTIFICATION: 'Y'` with
"por rectificación de cuotas" and `ConcursoAcr = 'Y'` — classic treats them as exclusive) and
`SUPPLEMENTARYNO` = identifier. The inputs are passed through `sanitizeAeatInputs390` first (see
"Classic consistency checks").

| Action | Requests |
|---|---|
| Guardar | `PUT manualData` |
| Calcular | `GET /fiscal390/preload` (applied to the unmodified inputs), then `GET /fiscal390/boxes` with the on-screen inputs as query params (the backend overrides the stored ones with them), then `PUT manualData` when dirty |
| Generar fichero 390 | `PUT manualData` when dirty (a failed save aborts) → `POST /fiscal390/generate-validated` (reads the STORED inputs; the file comes as base64 of its ISO-8859-1 bytes and becomes a Blob untouched; default name `390_0A_<año>.txt`, editable in `FileGenModal390`). The backend has the AEAT validator check the file first; the file downloads whatever it says — see "390 file validated before download" |
| Presentar a la AEAT | `PUT manualData` when dirty (a failed save aborts) → `AeatSubmitFlow` → `POST /fiscal390/submit` (the backend files the STORED inputs and freezes the snapshot from them) |
| Con / Sin acuse de recibo | `PUT manualData` with `submission` (and the pending inputs) → upload of the acuse (con acuse) → a SEPARATE `PUT status` (`submitted_ack`/`manual_ack` con acuse, `submitted`/`manual_no_receipt` sin acuse) — never the same PUT: the backend freezes the submission snapshot from the stored inputs before applying a same-request manualData |

**390 file validated before download (ETP-5716).** "Generar fichero 390" sends the generated file
to the AEAT validation service (ServValiDos — the one "Validar sin presentar" uses; no
certificate) and downloads it in every case. The validation is a warning, never a block:

| Validator | What the user gets |
|---|---|
| no errors, no warnings (`accepted`) | the file; the popup closes and the system success toast says "Fichero validado por la AEAT sin errores." |
| accepted with AEAT warnings (`avisos`) | the file; the popup moves to its result step: amber banner "Fichero validado por la AEAT con advertencias" listing each warning, "Ver incidencias" and "Cerrar". The warnings are stored as warning-severity AEAT incidents |
| errors (`rejected`) | the file; result step with the red banner of the direct presentation listing each error with its AEAT code, a line saying the file was downloaded anyway and the errors are in Incidencias, any AEAT warning below, "Ver incidencias" and "Cerrar". The errors are stored as blocking-severity AEAT incidents (`AEAT-<code>`), like after a direct presentation, and the page re-reads them |
| no answer (`connection_failure` / `not_validated`) | the file; result step with an amber banner saying it could not be validated and was downloaded without validation; the stored incidents are left as they were |

The AEAT validator answering `EV0 … No existe información del modelo: 390, <year>` (it has not
loaded that exercise yet) is shown as **not validated** too, never as "La AEAT ha detectado errores":
no incident is stored. Only an answer whose errors are ALL that `EV0` counts: an `EV0` with another
text, or that `EV0` next to any other error, stays a rejection (red banner, incidents stored). In the direct presentation popup, a "Validar sin presentar" with that answer
(`errorCode: NOT_VALIDATED`, 303 and 390) shows an amber banner with `fm.aeat.error.notValidated`;
any result of a test-mode submit is titled `fm.aeat.result.test_error.title` ("No se pudo completar la
validación") instead of "…la presentación" (`submitErrorTitle` in `AeatSubmitFlow.jsx`). The presenter
name/NIF stay optional in test mode: the ServValiDos body carries no presenter (only `MODELO`,
`EJERCICIO`, `PERIODO`, `FIC`/`F01`, `IDI`). Contract: `com.etendoerp.go/docs/aeat-390-endpoints.md`.

An accepted validation (with or without warnings) also attaches the validator's draft PDF to the
declaration as `VALIDACION-390-<año>-0A.pdf`: it shows in the Justificante tab (the
page refreshes its list and counter) as proof that the file was validated, and each accepted
validation replaces the previous one. It is not a filing receipt: the declaration stays a draft
and nothing reads attachments to decide a status.

The result step reuses the banner of the direct presentation's result (`models/303/AeatResultBanner.jsx`,
extracted from `AeatSubmitFlow`); there is no page banner (the former `FileValidationNotice390`
was removed).

**Incidencias banner (shared `IncidentsTab`).** Its colour follows the severity of the rows: red
when at least one row is blocking-severity (a model rule or an AEAT error), amber when there are
only warnings. Only the red TEXT depends on what really gates the file: `gatingBlocking` (default:
every blocking row) > 0 keeps "Resuélvelas antes de generar el fichero"; when the blocking rows gate
nothing (390 passes `ruleBlockingCount`, so AEAT errors alone) it reads "Revísalas antes de presentar
la declaración." (`fm.incidents.review_sub`). 303 and 349 do not pass the prop and are unchanged. The
Incidencias card chip and tab badge use the same severity counts.
The "Severidad" column of a stored AEAT error (`AEAT-<code>`, blocking severity) reads **"Error AEAT"**
(`fm.incidents.severity.aeatError`) in the 390, not "Bloqueante": it never gates Generar / Presentar
(ETP-5716 OBS-14). Wiring: `IncidentsTab` takes an optional `getSeverityLabel(inc)` (null keeps the
generic label); the 390 passes `incidentSeverityLabel390`. The colour stays red.

While the file is generated and validated, `FileGenModal390` stays open on the loading state of
the fiscal certificate upload (`fiscal-config/CircularProgress.jsx`, shared with `CertModal`) with
"Validando fichero con la AEAT…"; its buttons, close and overlay are disabled until the request
settles. The backend bounds the wait (10 s to connect + 30 s to read). An AEAT answer REPLACES the
declaration's previous AEAT incidents (same rule as every AEAT attempt); these never gate Generar
or Presentar (`ruleBlockingCount` counts the model's own rules only). Pieces:
`fileValidation390.js` (outcomes + `fileValidationOf`), `fm390Api.generate390File`,
`FileGenModal390.jsx` (loading + result step), `FmModel390Page.handleGenerate` (resolves the
validation to the popup). 303 and 349 generate exactly as
before. Contract: `{etendo_root}/modules/com.etendoerp.go/docs/aeat-390-endpoints.md`.

**Validation before a real presentation (ETP-5716, 303 and 390).** When the user presents WITHOUT
"Validar sin presentar", the server first has the AEAT validator check the very file it is about to
send, in the same request (`FiscalAeatSubmissionSupport.validateBeforeSubmission`, after every
guard): no errors (warnings allowed) → the presentation goes ahead as before; errors → nothing is
presented, the declaration stays a draft, the errors go to Incidencias and `AeatSubmitFlow` shows its
error result titled "Declaración no presentada: la AEAT ha detectado errores al validarla"
(`stage: "validation"` in the answer); no answer from the validator — or only the `EV0` "No existe
información del modelo" (mixed with any other error it is still a rejection) → the presentation goes ahead
(server constant `PRESENT_WHEN_VALIDATOR_UNANSWERED`; when false, `VALIDATION_UNAVAILABLE`). While it
runs the button reads "Validando y presentando en la AEAT…" (one request, so one text). The check
"Validar sin presentar" itself is unchanged. No PDF is attached for this implicit validation.

**Presented without that validation (ETP-5716).** When the validation got no verdict — no answer,
or EV0 "No existe información del modelo" — and the presentation went ahead anyway, the server's
answer carries `preValidation: "NOT_VALIDATED"` (success and failure alike; an accepted validation
leaves it out). `AeatSubmitFlow` (303 and 390, the same component) then adds an info note under the
result (`AeatResultBanner` tone `info`, `data-testid="Banner__aeatPreValidationSkipped"`):
`fm.aeat.result.pre_validation_skipped.success` under "Declaración presentada correctamente" ("La AEAT
no pudo validar el fichero antes de presentarlo (el servicio de validación no estaba disponible). La
presentación se hizo igualmente y la AEAT la aceptó.") or `…failure` under the error result. A failed
real presentation is now titled `fm.aeat.result.error.title` "La declaración no se ha presentado"
(was "No se pudo completar la presentación"), so the error list reads as "not presented"; an
unexpected `status` gets the neutral `fm.aeat.result.unknown.title` ("No se pudo confirmar el
resultado de la presentación") instead, since nothing says it was not presented.

**AEAT attempt log (ETP-5716).** Every attempt against the AEAT — a direct presentation, a
"Validar sin presentar" and this pre-download validation, for 303 and 390 — leaves a row in the
backend's append-only `ETGO_Fiscal_AEAT_Attempt` table, whatever happens to the incidents
(which each attempt still replaces). It has no UI: it is read by SQL. Reference:
`{etendo_root}/modules/com.etendoerp.go/docs/aeat-attempt-log.md`.

**Manual test.** The stub-based procedure for every validator outcome (download, pre-presentation
validation, attempt rows) — never against the real AEAT, never a real presentation — is in
"Manual test against a stub" of `{etendo_root}/modules/com.etendoerp.go/docs/aeat-390-endpoints.md`.

Every successful save invalidates the list's session cache for the declaration
(`invalidateFiscalComputeCache`), patches the list (`onManualDataSaved`) and recomputes the
incidents (`POST /fiscal390/validate`, see "Incidents"); Calcular with nothing to save recomputes
them too (the invoices may have changed).

### Presentation (`submission390.js`, `SubmissionCard390.jsx`)

Backend contract: `aeat-390-endpoints.md`, "POST /fiscal390/submit". Both paths start from
`PresentModal` (opened only without blocking RULE incidents and with a valid substitute identifier),
save pending changes first (a failed save stops) and require the check **"Declaro que los datos de
esta declaración son conformes"** (`fm.present.conformity`).

- **Presentar a la AEAT** — `AeatSubmitFlow` with the 390 adapter `AEAT_SUBMIT_390`
  (`submission390.js`): `POST /fiscal390/submit?year&period=0A&id` with only the presenter data
  (pre-filled from the organization: NIF and the file's taxpayer name), no NRC, the conformity
  check required, "Validar sin presentar" available (ServValiDos). The flow itself is shared with
  303 (see "AeatSubmitFlow model adapters" below). On `SUCCESS` the backend has already stored
  `submitted_ack`, `aeat_telematic`, the snapshot, `manualData.submission` and the justificante
  PDF; the page mirrors them (`onResult` → `submissionFromResponse`, `onManualDataSaved`) and calls
  `onSubmittedRemotely`, which re-reads the declaration — no status `PUT` (it would be a 409). On
  `ERROR` the AEAT messages (with their code) are listed in the flow and the declaration stays a
  draft. `BLOCKING_INCIDENTS` has its own text.
- **AEAT incidents.** Like 303, every attempt that reaches the AEAT (validation or filing) replaces
  the declaration's AEAT incidents with the answer's errors / warnings (backend, `AEAT-<code>`
  codes); the page re-reads the incidents after each attempt (`onIncidentsChanged`). They show in
  the Incidencias tab and on the card, but **never gate Generar / Presentar**: the gate is
  `ruleBlockingCount` (`submission390.js`, the model's own blocking rules only), and the backend
  `BLOCKING_INCIDENTS` guard evaluates the rules, not the stored rows — so a stored AEAT error never
  blocks the retry that fixes it, as in 303 (which does not gate its filing on stored incidents at
  all).
- **Con / Sin acuse de recibo** (ETP-5716: aligned to the 303, the former 390-only "Registrar
  como presentada" step with justificante number / date / conformity was removed) — the shared
  `PresentModal` paths; "Con acuse" requires the acuse PDF in the modal. Then `PUT manualData` with
  `submission = { method: 'manual', justificante: '', presentationDate: <today>, user,
  submittedAt }`, upload of the acuse, and the SAME status and method as the 303/349
  (`manualRegistrationStatus(path)`): `submitted_ack` + `manual_ack` / `submitted` +
  `manual_no_receipt` — chip "Presentado" with the method sub-label; both reactivatable (only a
  telematic filing is not). A failed status PUT rolls the chip back. No justificante number is
  asked any more, so a substitute created from a manual registration asks for the former
  identifier itself (`formerStatementFrom` leaves it empty).

### Presented declaration

Read-only, like 303/349: the boxes come from `decl.submittedSnapshot` (the backend also answers
`/fiscal390/boxes` from it and refuses `generate` with 409), Tipo and every input are disabled,
and no compute runs on mount. Above the cards, the **Presentación en la AEAT** card
(`SubmissionCard390`) shows date and time, justificante number, CSV and user from
`manualData.submission` (`method: 'aeat_telematic' | 'manual'`; a date-only value is formatted with `formatCalendarDate`, the AEAT's own
timestamp text is shown verbatim; a declaration presented before this data existed shows "—").
A date-only value (manual registration) also shows the time of `submittedAt` when the registration
was recorded that same local day (`formatDateTime`, `dd/MM/yyyy HH:mm`); recorded on a later day the
time is not the presentation's, so only the date is shown (ETP-5716 OBS-16).

**Crear declaración sustitutiva** (`createSubstitute390`): `POST /declarations` with
`type: 'com'` (allowed next to the ordinary — the single-ordinary rule only counts ordinaries),
then `PUT manualData` = the same inputs and 303 preload, `identification = { sustitutiva: true,
formerStatement: <justificante> }` (prefilled only when the justificante has 13 digits) and the
classic flags already applied (`buildManualData390`, so the file can be generated without a first
Guardar), without `submission`. The new declaration is pushed to the list and opened
(`onDeclarationCreated` → `FiscalModelsPage` `declAdded` → `FmListPage`, which inserts and selects
it; the detail page is keyed by declaration id so it remounts). A draft of the exercise already
existing answers 409 → toast `fm.m390.substitute.draft_exists`.

Reactivation follows the shared rule: a manually registered 390 (`submitted`/`submitted_ack`,
manual method) can be reactivated from the list ("Reactivar declaración"); a telematic one
(`aeat_telematic`) cannot (`canReactivate` + backend `rejectTelematicReactivation`).

### Incidents (`incidents390.js`, `Incidents390Tab.jsx`, ETP-5716)

The rules are computed by the **backend** (`Fiscal390IncidentRules` in com.etendoerp.go — the
rule table with each rule's classic source, severity and action is in
`com.etendoerp.go/docs/aeat-390-endpoints.md`, "Incidents"). Anything classic rejects while
generating the file is blocking; the rest are warnings. The page never decides a rule; it shows
what the backend stored.

- **When they are recomputed:** `POST /fiscal390/validate` (`validate390`, fm390Api.js) on
  opening a draft (the organization or the invoices may have changed since the last save) and
  after every successful save — Guardar, Calcular (also with nothing to save), and the saves
  before Generar / Presentar / leaving the page. It answers every incident of the declaration
  (rule + AEAT ones). A presented declaration's incidents are frozen: the page only reads them
  (`GET /fiscal390/incidents`), and the backend refuses to recompute them. When `validate` fails
  the page falls back to the stored incidents.
- **Gate:** Generar and the AEAT telematic filing are refused while a blocking RULE incident
  exists (`ruleBlockingCount`; `AEAT-…` rows never gate): like the 303 gates, the buttons stay
  clickable, a click shows the toast `fm.m390.blocked_by_incidents`, and the Generar icon is red.
  **Manual registration ("Con / Sin acuse de recibo") is deliberately ungated: the declaration was
  filed outside Etendo** (review W1, user decision; the 303 does not gate it either). The backend enforces the same server-side with
  a fresh evaluation: `GET /fiscal390/generate` answers `409 BLOCKING_INCIDENTS` with the
  incidents (`generate390File` → `{ error: 'blocking_incidents' }`: toast
  `fm.m390.blocked_by_incidents`, recompute, Incidencias tab opened) and `POST /fiscal390/submit`
  its `BLOCKING_INCIDENTS` failure.
- **Legal representative (AEAT PAR012):** a legal entity whose representatives the file carries
  (first 3 active by line) have no NIF raises the **blocking** `NO_LEGAL_REPRESENTATIVE` ("Editar
  en Organización" → `org-section-390`): the AEAT rejects such a declaration, so Generar /
  Presentar are blocked until one is added. A natural person is unaffected.
- **Card:** the 303 Incidencias card — the total and the severity badge ("Requiere revisión" with
  any blocking, "Advertencia" with warnings only), from `incidentKpiVariants` (`incidentSeverity.js`,
  the 303 page's `buildIncidentVariants` body, now shared). A click opens the tab.
- **Tab** (`Incidents390Tab`): the shared 303 table (`IncidentsTab`, `FmTabContent.jsx`) — severity
  banner (destructive "Resuélvelas antes de generar el fichero" with any blocking, amber
  `fm.incidents.warn_sub` otherwise, dismissible) and the columns Severidad · Origen · Mensaje ·
  Acción, blocking first. `IncidentsTab` takes three optional resolvers the 390 passes and the
  303/349 do not (so they are unchanged): `getMessage` (`incidentText390`), `getOrigin`
  (`incidentOrigin390`: "Casilla 87" for a `box`/`sources` action, "Organización", "Facturas",
  "Declaración" for a rule with no action, the `AEAT-<code>` of an AEAT answer —
  `fm.m390.incidents.origin.*`) and `renderAction` (the action links below, 303 link style
  `.fm-incident-action`). `normalizeIncidents390` maps every item to `block` / `warn` (anything not
  `warn` blocks) and recounts them. Empty: "Sin incidencias".
- **Text:** translated by code, `fm.m390.incident.<CODE>` with the incident's params
  (`incidentText390`: amounts with `formatAmount`, rates with `formatPercent`, `NAME_TRUNCATED`'s
  field with `fm.m390.ident.field.*`); a code with no translation shows the backend's English
  fallback. Keys exist in es_ES, en_US and es_AR (guarded by `incidents390.vitest.js`).
- **Actions** (`incidentActions390`):

  | `action.type` | Button | Does |
  |---|---|---|
  | `box` | Ir a la casilla N | Casillas tab, opens the block and highlights the box (`FmBoxes390` `goToBox`, same jump as the box search) |
  | `sources` | Ver facturas | Facturas tab filtered by the box (`sourcesFilterForBox`); not on a presented declaration |
  | `organization` | Editar en Organización | saves pending changes, then `/organization#<section>` — `org-section-fiscal` (NIF, razón social), `org-section-iae`, `org-section-390`; the Organization page scrolls to it (see `organization.md`) |
  | `invoices` | Ver facturas de venta / de compra | saves pending changes, then the Sales / Purchase invoice list (one link per side with unposted invoices) |

- **Tests:** `incidents390.vitest.js` (grouping, text, actions, origin, normalisation, i18n of every
  code, the two requests), `FmModel390Page.vitest.jsx` "incidents" (recompute on open / save /
  Calcular, frozen when presented, gate toast, shared table, actions, 409 on Generar).

### Exercise without fiscal-calendar periods (`incompleteYear390.js`, ETP-5716)

An annual 390 needs one calendar period per month of the exercise. When some are missing the
backend answers `422 INCOMPLETE_FISCAL_YEAR` `{ error: { code, year, missingPeriods } }` on
`boxes` / `sources` / `generate`, stores the blocking incident `INCOMPLETE_FISCAL_YEAR` (action
`fiscalCalendar`) and, on `submit`, `errorCode = INCOMPLETE_FISCAL_YEAR` (contract:
`com.etendoerp.go/docs/aeat-390-endpoints.md`, "Annual period"). The page **never shows the
backend text** for it (that text names the organization id):

- `fm390Api.js` carries `code` / `year` / `missingPeriods` on the thrown error (`requestError`);
  `generate390File` resolves `{ ok: false, error: 'incomplete_fiscal_year', year, missingPeriods }`.
- `incompleteFiscalYearText` explains it in the UI language: "El ejercicio 2025 no tiene creados sus
  periodos en el calendario fiscal (faltan: Noviembre, Diciembre). Créalos antes de calcular el
  Modelo 390." (`fm.m390.incomplete_year.months`, month names from `fm.m390.month.NN`), or
  "… (faltan todos los meses) …" (`fm.m390.incomplete_year.all`) when the 12 are missing.
- **Casillas empty state:** that text in a warning `InfoBanner` above the empty state
  (`FmModel390Page__computeError`; any other compute error is a danger one) with **Ir a
  Calendario fiscal** (`FmModel390Page__goToFiscalCalendar`) in its action slot. **Calcular / Generar:** the same text
  as an error toast with the "Ir a Calendario fiscal" action. **Facturas tab:** the same text as
  its error. **Incidencias:** the incident reads the same text and offers the same action.
  **Presentar** (AEAT flow): `fm.aeat.error.incompleteFiscalYear` (`resolveErrorCodeKey`).
- The link goes to `/calendar` (`FISCAL_CALENDAR_ROUTE`): the `fiscal-calendar` artifact was merged
  into the unified Calendar window (ETP-4478) and its own route only redirects there.
- "Nueva declaración" does not warn about it beforehand: no existing endpoint returns the periods
  of a fiscal year (`/fiscal-calendar/year` lists years only), so it would need a new one.

### AeatSubmitFlow model adapters (ETP-5716)

`AeatSubmitFlow` (in `models/303/`) takes an optional `adapter` prop with the per-model rules:
`buildLocalData`, `showNrc`, `declTypeLabel`, `preflight`, `submitPath`, `pdfName` and
`requireConformity`. The default `AEAT_SUBMIT_303` holds exactly the logic the flow always had
inline (IAE / IBAN / NRC pre-flight guards, identification + box-override params, `303_*` file
names, no conformity check), so the 303 page passes nothing and is unchanged. A new optional
`onResult(data)` callback receives every structured response. **"Enviar a la AEAT"** looks
disabled whenever it is (`submitDisabled`: submitting, or the conformity check unticked — the
`fm-btn--save-pill--active` modifier only when enabled, as "Crear declaración") and its `title`
says what is missing (`fm.aeat.submit_hint.conformity`, "Marca la declaración de conformidad para
enviar"); same component and look for the 303. With `requireConformity` (390) the conformity
check comes first, right after the presenter fields, then "Validar sin presentar" and its warning,
whose slot collapses while unchecked (`.fm-aeat-testmode-slot--collapsible`); the 303 keeps the
reserved slot (ETP-5584 P7). `PresentModal` has the same two manual paths for
every model; the AEAT path confirms with "Continuar".

