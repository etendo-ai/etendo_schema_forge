# Retiring a Feature Flag

The manual for taking a flag out of the product, in both repos, without taking its debt out of
sight. Companion skill: `.claude/skills/retire-flag/SKILL.md`. Mechanical gate:
`make flag-retire-check FLAG=<key>`.

**The rule this document exists to enforce:** a flag is not retired while its technical debt is
unresolved, unless a human explicitly accepts each remaining item. An agent may resolve an item
(do the work, link the evidence). An agent may never accept one, and a bot with no human in the
conversation stops and reports.

Related: [technical-debt-playbook.md](technical-debt-playbook.md) §4.4–4.5 (why ship/kill and why
the entry survives), [flag-debt.md](flag-debt.md) (the scorer and the registry schema),
[feature-flags.md](feature-flags.md) (the flag system and the Datadog control plane).

---

## 1. Why there is a gate: ETP-6425, the counter-example

ETP-6425 asked to promote the accounting-process monitor (`acct-process-monitor`) to GA and
retire its flag. The ticket carried two lists:

- **Debt before GA** — Datadog evidence of 40 days at 100%; a manual QA run, with pending
  documents, in two companies; live denial checks; closing the deferred item
  `manual-trigger-runtime-verification`; publishing a help.etendo.ai guide.
- **Acceptance criteria** — `make flag-debt` clean for the feature, a production smoke test, the
  flag archived in Datadog.

The registry agreed with the ticket. The flag's `ttlNote` read *"Removal target once the manual
trigger has been exercised against a real accounting backlog and the page is accepted as
permanent"*, and the feature still carried `manual-trigger-runtime-verification` (kind `open`:
*no manual run has been executed against a deployed build yet*).

An automated pipeline implemented only the code removal: unwrapped the toggle points, deleted the
key from `flag-keys.js`, deleted the `flag` object. Unit tests, e2e, review and the commit hooks
all went green, the PRs merged, and the ticket reached QA with every debt item and every
acceptance criterion still open. Nothing was wrong with the code. Every gate checked the code and
nothing checked the debt.

`make flag-retire-check FLAG=acct-process-monitor`, run on develop after that merge, reports what
was skipped:

```text
flag-retire-check [gate] — flag (none) · feature acct-process-monitor · ETP-5269 · owner sebastianbarrozo
  BLOCK [deferred-item-open] manual-trigger-runtime-verification (open): The trigger mechanism is verified …
  BLOCK [no-retirement-record] the feature has no "retirement" record — every field below is missing
  BLOCK [branch-missing] …   BLOCK [ticket-missing] …   BLOCK [evidence-datadog] …
  BLOCK [evidence-user-docs] …   BLOCK [ticket-items-missing] …   BLOCK [signoff-missing] …
  INFO  [flag-already-removed] the flag object is already gone and no retirement record exists — this retirement skipped the gate
  RESULT: BLOCKED — 8 item(s). Do NOT edit code. …
```

Had it run first, the pipeline would have stopped before editing a file and listed exactly the
work the ticket asked for. That ordering is the whole point: **the gate runs before the code
change, not after it.**

---

## 2. When a flag is eligible

Eligibility says the flag *may* be retired. It does not say the debt is paid; that is the gate
(§3). All of these must hold, and each is evidence for the retirement record:

| Check | Ship (feature stays) | Kill (feature goes) | Where to look |
|---|---|---|---|
| Decision | The owner decided to ship | The owner decided to kill | Ticket, owner |
| Production rollout | `ENABLED`, one allocation serving `true` to **everyone**, unchanged for **≥ 14 days** (the rollout panel's GA window) or the period the ticket names, if longer (ETP-6425: 40) | Serving **nobody** (default `false`, no rules, no emails) for **≥ 30 days** | Datadog Feature Flags → the flag → Production allocations and history (or the panel's Release tab) |
| Other environments | Experimental agrees with Production (no environment still pins the old value on purpose) | Same | Datadog, every environment |
| TTL | Reached or deliberately early; the `ttlNote` (the team's written terms for removal) becomes a gate item | Same | `flags-registry.json` |
| Usage | Exposure/usage events show the feature in use (`feature_flag_evaluated`, the flag's usage event) | No meaningful usage | Mixpanel, Datadog RUM |

An early retirement (TTL in the future) is allowed. A retirement without rollout evidence is not:
"it has been on for a while" is a claim, the allocation history is evidence.

---

## 3. The pre-retirement gate

Run it first, before touching code:

```bash
make flag-retire-check FLAG=<key>             # gate: exit 0 clear, non-zero blocked
make flag-retire-check FLAG=<key> JSON=1      # same, machine-readable
make flag-retire-check FLAG=<key> GO_MODULE=../modules/com.etendoerp.go   # point at the backend checkout
```

It reads **both registries**: this repo's `flags-registry.json` (the feature header: flag, paths,
specs, deferred items) and `com.etendoerp.go/flags-registry.json` (the backend contribution:
`flagKey` or `contribution: true`, its own paths and specs). The module is found through
`GO_MODULE`, `ETENDO_GO_MODULE`, `<repo>/etendo_core/modules/com.etendoerp.go`, the main checkout,
or the epic-worktree sibling `../modules/com.etendoerp.go`. A feature with backend parts **blocks**
when the module cannot be found: its backend half would go unverified.

### 3.1 The checklist — every line must pass

| # | Item | Blocks when | Resolved by |
|---|---|---|---|
| 1 | Deferred items | Any `deferredItems` entry on the feature, **any kind** (precondition, open, scope, cosmetic, a typo) | Closing it — the work is done; remove the item and record the closure in a `$deferredItemsClosedComment` with the evidence — or a human acceptance in `retirement.accepted` |
| 2 | Test specs | A spec in either registry that is not on disk and is marked `expected: true` (agreed, unwritten) or carries no marker | Writing it, or a human acceptance (`item` = the spec path). Specs already marked `acceptedDebt: true` are a standing human decision and are reported, not blocked |
| 3 | `ttlNote` | The flag has (or had, copied into `retirement.ttlNote`) a `ttlNote` and `retirement.evidence.ttlNote` has no link. Every note blocks, not only conditional ones: it is the team's own written terms for removal ("once…", "permanent, no retirement planned"), written to be read now | Linking evidence that what it states holds |
| 4 | Ticket debt | `retirement.ticketItems` missing, or an item with neither an `evidence` link nor a human `accepted` record | Copying **every** pre-GA / debt / acceptance-criteria line of the ticket into `ticketItems`, each done with a link or accepted |
| 5 | User docs | `retirement.evidence.userDocs` is neither a link nor `not-user-visible: <reason>` | Publishing the help.etendo.ai page and linking it, or stating why nobody outside the team sees the feature |
| 6 | Datadog evidence | `retirement.evidence.datadog` has no link | Linking the allocation history that proves §2 |
| 7 | Owner sign-off | `retirement.signOff` missing, malformed, or by an automated account | The owner (or whoever the ticket names) approves in writing; record `{ by, date, ref }` |
| 8 | Branch and ticket | `retirement.branch` not `ship`/`kill`; `retirement.ticket` missing | Deciding with the human |

The script cannot read Jira. Item 4 is therefore only as complete as the copy: whoever runs the
retirement reads the ticket's debt and acceptance sections and copies every line. The skill makes
that the first step; the reviewer compares the list with the ticket.

### 3.2 The retirement record

A `retirement` object on the feature entry in this repo's registry. It is read by the gate, not
scored by `sf-flag-debt`, and it stays on the entry after the flag is gone as the record of how
the retirement was authorised (the same reason the entry itself survives, playbook §4.4).

```jsonc
"retirement": {
  "branch": "ship",                         // ship | kill — decided with the human
  "ticket": "ETP-6425",
  "key": "acct-process-monitor",            // copied from flag.key when the flag object is deleted
  "symbols": ["acct-process-monitor", "ACCT_PROCESS_MONITOR", "…"],   // copied from flag.symbols
  "ttlNote": "Removal target once …",       // copied from flag.ttlNote, if it had one
  "evidence": {
    "datadog": "https://app.datadoghq.eu/… — everyone in Production since 2026-10-01, no changes",
    "userDocs": "https://help.etendo.ai/…",                 // or "not-user-visible: <reason>"
    "ttlNote": "https://…/ETP-6425?focusedCommentId=…"      // required whenever the flag had a ttlNote
  },
  "ticketItems": [
    { "id": "qa-two-companies", "note": "QA manual run with pending docs in two companies",
      "evidence": "https://…/ETP-6425?focusedCommentId=…" },
    { "id": "prod-smoke", "note": "Production smoke",
      "accepted": { "by": "<github user>", "date": "2026-11-26", "ref": "https://…" } }
  ],
  "accepted": [
    { "item": "manual-trigger-runtime-verification", "by": "<github user>", "date": "2026-11-26",
      "ref": "https://…/ETP-6425?focusedCommentId=…", "rehomedTo": "ETP-6500" }
  ],
  "signOff": { "by": "<github user>", "date": "2026-11-26", "ref": "https://…" }
}
```

### 3.3 How a human accepts a remaining item

Accepting is the playbook's existing rule (§3.1, *accepted debt is ALWAYS a human decision*)
applied at retirement. The record is the minimum that makes the decision traceable:

1. **The agent proposes.** It lists the unresolved item, what it costs to leave it open after the
   flag is gone, and what closing it would take. Then it waits.
2. **The human decides in writing**, somewhere linkable: a Jira comment on the retirement ticket
   or a PR review comment. "Accept `<item>`: <reason>". A chat message is not enough on its own;
   copy it to the ticket.
3. **The record** `{ "item", "by", "date", "ref" }` goes into `retirement.accepted` (for a
   deferred item or a spec) or into the ticket item's `accepted` (for a ticket line). `by` is
   the human's GitHub username; `ref` is the link from step 2. The gate rejects a `by` that names
   an automated account (`bot`, `claude`, `codex`, `dagu`, `agent`, …) and a `ref` that is not a
   link.
4. **On the kill branch** the entry is deleted at the end, so an accepted item also needs
   `rehomedTo`: the ticket or the other feature entry that now carries it (playbook §4.5,
   *deletion is never closure*).

The script checks that the record is well formed. Whether a human really said yes is checked by
the reviewer opening `ref`. A retirement PR that adds an acceptance or an `acceptedDebt: true`
whose `ref` does not show a human decision is rejected (`.claude/agents/reviewer.md`).

Accepting does not delete anything. On the ship branch an accepted deferred item **stays** in
`deferredItems` and keeps scoring on the shipped feature; accepting it only stops it from
blocking the retirement. Re-homing it to a ticket is the way to stop it scoring here.

---

## 4. The mechanics

Only after the gate reports `RESULT: CLEAR`. Order matters: code first, control plane last.

### 4.1 Ship — the feature becomes unconditional

**schema_forge (frontend):**

1. `git grep` each `flag.symbols` entry; unwrap every toggle point outside `paths` and
   `conventions.frameworkPaths`. The guarded code becomes plain code.
2. Delete the key's constant and its default from `tools/app-shell/src/lib/flags/flag-keys.js`
   and its re-export from `lib/flags/index.js`.
3. Update tests: delete the flag-off cases, keep the flag-on ones as the normal behaviour,
   drop flag mocks (`MY_FLAG: 'my-flag'` in `vi.mock` factories).
4. In `flags-registry.json`: copy `key`, `symbols` and `ttlNote` into `retirement`, then delete
   the **`flag` object** — never the entry. Add a `$flagRetiredComment` saying what was retired,
   when, by which ticket, and what the re-grep found (see `paid-second-tenant`, `mcp-dual-era`).

**com.etendoerp.go (backend), when the flag has a backend end:**

5. Remove every `GoFeatureFlags.isEnabled(FLAG_<KEY>, …)` evaluation; the gated path becomes
   the only path.
6. Delete the `FLAG_<KEY>` constant from `featureflags/GoFeatureFlags.java`, the
   `etendo.go.flags.<key>` / `ETGO_FLAG_<KEY>` defaults, and the flag's own helper class if it
   had one (`<Name>Flag.java`) with its test.
7. In `com.etendoerp.go/flags-registry.json`: replace `"flagKey": "<key>"` with
   `"contribution": true` on the entry (`GoFeatureFlagsRegistrySyncTest` enforces that
   `flagKey` exists exactly when the constant does).

### 4.2 Kill — the feature goes with the flag

1. Re-home every accepted item first (`rehomedTo`), per playbook §4.5.
2. Delete the owned `paths` in both repos and every toggle point; delete the flag constants and
   defaults as in 4.1 steps 2 and 6; delete the tests of the feature.
3. Delete the backend contribution entry from `com.etendoerp.go/flags-registry.json`.
4. Run the verification (§5) while the schema_forge entry still exists, then delete the entry
   as the **last** change, recording in the commit message which items were re-homed where.

### 4.3 Docs in both repos

- schema_forge: the flag's row in [feature-flags.md](feature-flags.md) (backend-only table, or
  remove the web-key mention), the feature's topic doc, and `docs/index.md` if a row names the flag.
- com.etendoerp.go: the flag's section in `docs/feature-flags-and-tenant-upgrade.md` becomes a
  short "`<key>` — retired (ETP-xxxx)" note, as `demo-data-transfer` did.
- Any `refs` in either registry that pointed at a removed section.

---

## 5. Verification

```bash
make flag-retire-check FLAG=<key> VERIFY=1     # gate + post-removal checks, both repos
make flag-debt FLAG=<feature-id>               # feature now scores as shipped: no touch points, no lifecycle
```

`VERIFY=1` adds, on top of the gate:

| Check | Blocks when |
|---|---|
| Flag object | Ship: the `flag` object is still in the registry |
| Key kept | Neither `flag.key` nor `retirement.key` exists to verify against |
| Backend registry | The contribution still has `flagKey`; ship: it lacks `contribution: true` |
| Declarations and evaluations | `git grep` (code only; `*.md` and the registries excluded) in both repos finds the `UPPER_SNAKE` constant, `FLAG_` / `ETGO_FLAG_` forms, `etendo.go.flags.<key>`, the key inside a framework path, or the key on a line that mentions a flag API |
| Kill only | Any owned path still on disk; any hit of any `symbol` |

Other hits of the key on the ship branch (a menu item name, an e2e file named after the key) are
reported as warnings to confirm by eye, because the feature's own names legitimately stay.

Then the tests of every file you touched in both repos (`make test-changed`, the backend
module's tests for the touched classes), and the e2e spec of the feature.

---

## 6. Close-out

Not done until each of these is linked from the ticket:

1. **Deploy, then archive.** Archive the flag in Datadog in **every** environment (Production,
   Experimental, Staging, Development) and in ConfigCat if it was defined there — **only after
   the removal is deployed to Production** and its evaluations have stopped. Archiving first makes
   every still-deployed client fall back to the default; on the ship branch that hides the
   feature from everyone.
2. **Panel.** If the flag was managed in the rollout panel, mark it retired there so it leaves
   the retirement queue.
3. **Registry.** `$flagRetiredComment` written; the `retirement` record complete; ticket items
   that were "after deploy" (smoke, archive) get their evidence links added in a follow-up commit.
4. **Docs.** §4.3 rows updated in both repos; the help.etendo.ai page no longer says "beta".
5. **Jira.** A comment on the ticket with: the gate output (before), the `VERIFY=1` output (after),
   the PRs in both repos, the Datadog archive evidence, the docs link, and every accepted item with
   its `ref`.

---

## 7. For bots and pipelines

An automated agent (Dagu pipeline, `schema-forge-developer`, any CLI agent) that receives a
retirement task runs `make flag-retire-check FLAG=<key>` before editing anything. Non-zero means
**stop and report the blocking items to the ticket**: it does not edit code, does not open a PR,
does not write acceptances, sign-offs or `acceptedDebt` markers. It may do resolvable work
(write a pending spec, fix a stale marker) and rerun the gate. Only a human in the loop can
clear what remains.
