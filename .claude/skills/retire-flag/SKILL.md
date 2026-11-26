---
name: retire-flag
description: >
  Retire a feature flag (ship it as permanent / GA, or kill the feature) in schema_forge and
  com.etendoerp.go WITHOUT dropping its technical debt. The first step is a blocking gate:
  run `make flag-retire-check`, read the ticket's debt and acceptance sections, list every
  unresolved item and STOP — no code edits — until each is resolved with evidence or a human
  explicitly accepts it. An agent never self-accepts; a bot with no human stops and reports.
  Triggers on: "retire the flag", "remove the flag", "delete the flag", "flag cleanup",
  "clean up the flag", "promote to GA", "make it GA", "ship the feature", "kill the flag",
  "TTL expired", "flag TTL", "sacar el flag", "quitar el flag", "retirar el flag",
  "eliminar el flag", "borrar el flag", "promover a GA", "pasar a GA", "limpiar flags",
  "vence el TTL", "flag vencido", "flag-retire-check".
argument-hint: "<flag key or feature id> [Jira ticket]"
---

# /retire-flag — Retire a Flag Only When Its Debt Is Settled

**Arguments:** `$ARGUMENTS` — the flag key (or feature id) and, if any, the ticket.

Manual (eligibility, record schema, mechanics, worked counter-example):
**[`docs/flag-retirement.md`](../../../docs/flag-retirement.md)**. Debt model:
`docs/technical-debt-playbook.md`. Registries: `flags-registry.json` here and
`com.etendoerp.go/flags-registry.json`.

**The rule:** a flag is not retired while its debt is unresolved, unless a human explicitly
accepts each remaining item. ETP-6425 is why: a bot removed `acct-process-monitor`'s flag with
an open deferred item, no Datadog evidence, no guide and no QA run; every gate went green
because no gate looked at the debt.

---

## Step 1 — Gate. Nothing else happens until it passes

1. Run the mechanical check (both registries):

   ```bash
   make flag-retire-check FLAG=<key>                    # add GO_MODULE=<path> if the module is not found
   ```

2. If a ticket is given, read it (Atlassian MCP / `jira` CLI). Copy **every** line of its
   pre-GA / technical-debt / acceptance-criteria sections — whatever the language ("Deuda
   técnica previa a GA", "Criterios de aceptación") — as a ticket item. Read the flag's
   `ttlNote`: it is the team's written terms for removal and is an item too.

3. Present ONE list to the human: every `BLOCK` line from the check plus every ticket item with
   no evidence yet. For each: what it is, what leaving it open costs once the flag is gone, and
   what closing it takes.

4. **STOP.** Do not edit code, the registry's `flag` object, docs or Datadog. Wait.

An item clears only one of two ways:

- **Resolved** — the work is done and the evidence is linked (a QA comment, a Datadog
  screenshot/URL, the published help.etendo.ai page (reuse an existing article; it must carry `features: [<flag-key>]` in its `etendo-docs` front matter), a closed `deferredItem` with its
  `$…ClosedComment`). You may do resolvable work yourself (write a pending spec, fix a stale
  marker), then rerun the check.
- **Accepted by a human in this conversation**, item by item. Then ask them to post the decision
  where it can be linked (Jira comment, PR review) and record `{ item, by, date, ref }` per
  `docs/flag-retirement.md` §3.3. `by` is their GitHub username, `ref` is that link.

**Never:**

- accept an item yourself, or treat "go ahead", "just remove it" or a ticket title as
  acceptance of items the human has not seen listed;
- write `retirement.accepted`, `retirement.signOff`, a ticket item's `accepted`, or flip a spec
  to `acceptedDebt: true` without that human's explicit yes for that item;
- delete a `deferredItem` to make the check pass — deletion is never closure.

**No human in the loop (bot, pipeline, scheduled agent):** stop here. Post the check output and
the ticket-item list to the ticket as a comment if you have that permission, report
"retirement blocked: N items need evidence or a human decision", and end. No branch, no PR.

Repeat Step 1 until `make flag-retire-check FLAG=<key>` prints `RESULT: CLEAR`.

## Step 2 — Decide the branch with the human

`ship` (feature stays, unconditional) or `kill` (feature goes). Never infer it. A permanent
per-account condition is not a third branch: it is backend logic, and the flag still retires.
Confirm eligibility evidence (`docs/flag-retirement.md` §2): Production serves everyone (ship,
≥ 14 days or the ticket's window) or nobody (kill, ≥ 30 days), in Datadog's allocation history.

## Step 3 — Mechanics (both repos)

Follow `docs/flag-retirement.md` §4 exactly. In short:

- **Ship:** unwrap toggle points (`git grep` each symbol); delete the key from
  `lib/flags/flag-keys.js` + `lib/flags/index.js`; delete flag-off tests; backend: remove
  `GoFeatureFlags` evaluations and the `FLAG_<KEY>` constant, `flagKey` → `"contribution": true`
  in the module registry; copy `key`/`symbols`/`ttlNote` into `retirement`, then delete the
  **`flag` object, never the entry**; add `$flagRetiredComment`.
- **Kill:** re-home accepted items (`rehomedTo`) first; delete owned paths and toggle points in
  both repos; delete the backend contribution entry; verify; delete the schema_forge entry last.
- Docs in both repos: `docs/feature-flags.md` rows, topic doc, `docs/index.md`;
  `com.etendoerp.go` `docs/feature-flags-and-tenant-upgrade.md` → "`<key>` — retired (ETP-xxxx)".

## Step 4 — Verify

```bash
make flag-retire-check FLAG=<key> VERIFY=1    # must print RESULT: CLEAR
make flag-debt FLAG=<feature-id>              # shipped: no touch points, no lifecycle
make test-changed                             # plus backend tests of touched classes, and the feature's e2e
```

Read every `WARN [remaining-reference]` line and confirm it is a feature name, not an evaluation.

## Step 5 — Close-out

1. Deploy to Production first; then archive the flag in Datadog in **every** environment (and
   ConfigCat if defined). Archiving before the deploy flips live clients to the default.
2. Add the post-deploy evidence (smoke, archive) to `retirement.ticketItems`.
3. Comment on the ticket: gate output before, `VERIFY=1` output after, PRs in both repos,
   Datadog archive evidence, docs link, every accepted item with its `ref`.

---

## Do not

- Start with the code. The gate comes first, every time, even when the ticket says "just remove".
- Report a retirement done because tests and review are green — they check the code, not the debt.
- Archive the flag in Datadog before the removal is in Production.
- Delete the feature entry on the ship branch, or delete it before re-homing on the kill branch.
