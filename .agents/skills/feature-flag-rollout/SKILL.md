---
name: feature-flag-rollout
description: >
  Move a feature flag through its rollout stages (off → alpha → beta → ga → retired) in the
  flags panel, with the checklist of each transition, the tester communication (standard
  email templates, drafted, previewed, test-sent and sent through the panel) and how to
  measure real usage of the feature behind the flag. Use when a flag changes stage, when
  testers must be told about a feature, when a release note is needed at GA, when a feature
  is rolled back, or when asked who uses a flagged feature. Code-side registration, debt and
  retirement belong to the feature-debt skill. Triggers on: "pasar a beta", "pasar a alfa",
  "salida a beta", "lanzamiento", "rollout", "GA", "avisar a los testers", "mail a testers",
  "correo de beta", "notificar", "novedades", "release notes", "comunicación del flag",
  "rollback del flag", "apagar el flag", "quién usa", "métrica de uso", "evento de uso".
---

<!-- GENERATED MIRROR - DO NOT EDIT. Source: .claude/skills/feature-flag-rollout/SKILL.md - Regenerate: make sync-agents -->

# /feature-flag-rollout — Stage transitions, tester communication and usage

The panel (`https://flags.jc.proxy.vpn.etendo.cloud`) owns each flag's stage, rings, messages
and Datadog sync. Drive it with the CLI (`make flags ARGS="..."`, `cli/src/flags-panel.js`; see
`docs/feature-flags.md` → *Flags panel CLI*). Registering the flag, its debt and removing it from
the code is the `feature-debt` skill.

```mermaid
stateDiagram-v2
  [*] --> Off: flag registered (feature-debt)
  Off --> Alpha: internal team
  Alpha --> Beta: pilot customers (beta includes alpha)
  Beta --> GA: everyone
  GA --> Retired: code unconditional, flag deleted (feature-debt)
  Alpha --> Off: rollback
  Beta --> Alpha: rollback
  GA --> Beta: rollback
```

## Rules

- **Nothing is sent without the human's explicit OK, asked for every send.** That covers
  `notify --yes`, `notify --test` (even to the human's own address) and publishing a release
  note. Before asking, show the final subject and body and the exact recipients (the `notify`
  dry run). An OK for one send does not cover the next one: draft, test and real send are three
  separate questions. Saving a version (`comms <key> save`) sends nothing and needs no OK.
- **Nothing reaches Datadog without the human's yes either.** Show the plan before
  `apply --yes`; a plan where someone loses access or an unmanaged rule is deleted needs an
  explicit OK even with `--force` available.
- **Apply, verify, then announce.** `apply --yes` runs `check`; notify only when Datadog
  matches the panel. `notify` refuses a pending flag on purpose.
- **Test-send to the human first** (`notify <key> --test`, one copy to the signed-in user like
  the panel's test button; `--test <email>` for someone else), after their OK, and wait until
  they have read it in their inbox before asking for the real send.
- Emails follow the templates below. The panel's AI draft (`comms <key> draft`) is a starting
  point only: rewrite it into the template before saving.
- One message version per stage. Testers added later get the same version: `notify` sends only
  to people not notified yet.
- **Every invitation teaches how to use the feature**: numbered steps the tester can follow
  without help. For an MCP tool there is no screen, so the steps are example phrases to ask the
  agent (quoted with `>`), one per thing the tool does, read from the tool's description in
  `com.etendoerp.go`. Add an "Antes de empezar" block when the feature writes real records or
  is not atomic. Worked example: the `mcp-routines` alpha email (Cómo usarlas: exec, save, run,
  list/describe/update/delete as four asks to the agent).
- **An invitation to a new MCP tool starts with "Primero, refresca tu agente"** (block below).
  The Etendo MCP declares `tools.listChanged: false` (`McpModernResults`), and Claude clients
  cache the tool list per connection anyway, so a tester who just entered the ring does not see
  the tool until they refresh. Also close the email asking for feedback through the agent itself
  (`etendo_feedback`): it reaches the team with the session attached and is triaged
  automatically (skill `mcp-audit`); at most 10 reports per session per hour.

### MCP blocks for invitations

Paste these into the template when the feature is an MCP tool. Sources: Claude Code docs
(`/mcp` reconnect, code.claude.com/docs/en/mcp-quickstart), and the stale-tool-list reports
anthropics/claude-ai-mcp#1182 (Desktop and web refresh only after reconnecting, and only in a
new conversation) and anthropics/claude-code#108596 (claude.ai connectors inside Claude Code).

```markdown
**Primero, refresca tu agente (una sola vez)**

{{Nombre}} es una herramienta nueva del MCP de Etendo y tu agente no se entera solo de que existe: guarda la lista de herramientas de la última vez que se conectó.

- **Claude (web, escritorio o móvil):** en Ajustes › Conectores, abre el conector de Etendo y actualiza sus herramientas, o desconéctalo y vuelve a conectarlo. Después **abre una conversación nueva**: las que ya tenías abiertas siguen con las herramientas de antes.
- **Claude Code:** dentro de la sesión escribe `/mcp`, elige el servidor de Etendo y pulsa «Reconnect», o empieza una sesión nueva. Si en Claude Code usas Etendo a través de tu cuenta de claude.ai, actualiza primero el conector en claude.ai y abre una sesión nueva.
- **Otro cliente (Cursor u otros):** reconecta el servidor MCP de Etendo o reinicia el cliente.

Para comprobarlo, pregúntale: «¿Tienes la herramienta {{nombre de la tool, p. ej. etendo_routine}}?».
```

```markdown
**Cómo darnos feedback**

Lo más fácil es pedírselo al propio agente, sin salir de la conversación:
> Envía feedback a Etendo sobre {{la funcionalidad}}: esperaba que…, pero pasó…

El agente lo manda por el MCP junto con lo que intentó, y nos llega directamente al equipo. Mejor un informe por tarea que uno por cada paso.

También puedes pulsar «Dar mi opinión» en este email o responderlo directamente.
```

## Transitions

Every transition is the same loop; the checklists say what must be true before it.

```bash
make flags ARGS="show <key>"                 # current stage, rings, sync
make flags ARGS="stage <key> <stage>"        # or: ring <key> <alpha|beta> add|rm <email|@group>
make flags ARGS="plan <key>"                 # show the human who gains / loses
make flags ARGS="apply <key> --yes"          # pushes to Datadog and runs check
make flags ARGS="comms <key> save --subject '…' --body-file /tmp/<key>-<stage>.md"
make flags ARGS="comms <key> preview"        # HTML file to open
make flags ARGS="notify <key> --test"        # one copy to the signed-in user
make flags ARGS="notify <key>"               # dry run: recipient list for the human
make flags ARGS="notify <key> --yes"
```

### Off → Alpha (internal team)

- [ ] Flag registered in `flags-registry.json` with owner, Jira and TTL (`feature-debt`).
- [ ] Owner and team set in the panel; type confirmed (`type <key> <type>`): it sets the TTL target.
- [ ] Usage measurement decided (table below) and, for a front-end feature, the event name saved
      in the panel's "Evento de uso" field.
- [ ] Alpha ring: internal people or groups only (`@comite`, named teammates).
- [ ] Email: **Alpha invitation** template.

### Alpha → Beta (pilot customers)

- [ ] Alpha feedback read (`raw GET /api/flags/<key>/feedback`); no open "algo falla" or
      "quiero desactivarla" left unanswered.
- [ ] Usage seen during alpha (table below): someone used it and it worked.
- [ ] Help page in help.etendo.ai exists, or the human accepts its absence (the beta email links it).
- [ ] Beta ring defined with groups (`@etendo-ai`, a customer group). Beta always includes alpha.
- [ ] Email: **Beta invitation** template. Alpha testers already notified are not emailed again.

### Beta → GA (everyone)

- [ ] Beta usage and feedback reviewed with the owner; the decision is recorded in the panel's
      meeting notes or the Jira ticket.
- [ ] `plan` shows `gain: EVERYONE` and no unmanaged rule lost.
- [ ] No email at GA: publish a **GA release note** (`comms <key> save --channel release-notes …`,
      then `notify <key> --yes` publishes it in Novedades).
- [ ] Open the retirement: TTL set to a near date and a ticket to remove the flag (`feature-debt`,
      Step 6). Datadog keys are archived only after the release without the flag is deployed
      everywhere.

### Rollback (any stage back, or off)

- [ ] Move the stage back (`stage <key> <previous>`), `plan`, `apply --yes`.
- [ ] Email the affected testers with the **Rollback** template the same day.
- [ ] Record the reason in the Jira ticket.

## Measuring real usage

Datadog only tells who has the flag on (exposure). Who actually uses the feature depends on
where the feature runs; decide it at Off → Alpha.

| Feature runs in | How usage is measured | Where to read it |
|---|---|---|
| The SPA (something the user does on screen) | An event in `tools/app-shell/src/lib/observability/events.js` (`defineEvent`, channel Mixpanel), tracked where the real use happens; its name in the panel's "Evento de uso" field | Panel → KPIs; Mixpanel |
| An MCP tool | Nothing to add: every call is a row of `ETGO_MCP_USAGE` (`tool_name`) | `scripts/mcp-usage-dump.sh --include-reviewed --since <date> production` (skill `mcp-audit`) |
| A backend process or service | `com.etendoerp.go` `usageevents/UsageEventRecorder` (`ETGO_USAGE_EVENT`), or the business table it writes | Read-only SQL on the host (`scripts/lib/remote-etendo-psql.sh`) |
| A kill switch or an operational lever | Not usage: watch that it stays at its normal value | `check <key>` |

## Email templates

Recipients read Spanish: the templates are Spanish, in the voice of the panel's existing
messages (tú, short paragraphs, **bold** section titles, signed "Equipo Etendo"). The panel adds
the layout and the feedback link. Fill every `{{…}}`; remove a line rather than leave it empty.

### Alpha invitation — channel `email`

```markdown
Asunto: Prueba {{nombre de la funcionalidad}} en Etendo (fase alfa)

Hola:

Ya puedes probar {{nombre de la funcionalidad}} en Etendo. Está en fase alfa: la ve solo el equipo interno y necesitamos tu ojo crítico antes de abrirla a clientes.

{{Qué es, en una o dos frases, desde lo que ve el usuario.}}

**Dónde está**

{{Menú o pantalla. Para una herramienta del MCP: «se lo pides al agente desde el cliente que ya usas con el MCP de Etendo».}}

**Cómo usarla**

1. {{Primer uso, paso a paso. Para el MCP, la frase exacta que hay que pedirle al agente:}}
   > {{Frase de ejemplo}}
2. {{Segundo uso}}
3. {{Tercer uso}}

**Qué te pedimos**

- {{Tarea concreta 1: repetir los pasos de arriba con un caso real del día a día}}
- {{Tarea concreta 2}}
- Cuéntanos qué te ha resultado confuso, lento o poco intuitivo.

**Antes de empezar, ten en cuenta**

- {{Qué crea o cambia de verdad (usa datos de prueba), límites y lo que todavía no hace}}

**Cómo darnos feedback**

Responde directamente a este email. Una captura de pantalla y lo que estabas haciendo nos ayudan mucho.

Gracias por probarlo.

Equipo Etendo
```

### Beta invitation — channel `email`

```markdown
Asunto: Novedad en Etendo: {{nombre de la funcionalidad}} (beta)

Hola:

Te hemos elegido para probar antes que nadie {{nombre de la funcionalidad}}. Está en fase beta: funciona y la estamos abriendo a un grupo reducido de clientes para ajustarla con vuestra experiencia.

{{Qué es y qué problema resuelve, en dos o tres frases.}}

**Cómo empezar**

1. {{Paso 1: dónde entrar}}
2. {{Paso 2}}
3. {{Paso 3}}

Tienes la guía completa en {{enlace a help.etendo.ai}}.

**Qué esperamos de ti**

Úsala en tu trabajo real durante {{las próximas semanas}} y cuéntanos qué te sobra, qué te falta y si algo falla.

**Cómo darnos feedback**

Responde a este email o usa el enlace «Dar mi opinión». Si prefieres no seguir en la beta, dínoslo y la desactivamos.

Gracias por ayudarnos a mejorar Etendo.

Equipo Etendo
```

### GA release note — channel `release-notes`

```markdown
Asunto: {{Nombre de la funcionalidad}}

{{Qué puedes hacer ahora, en una frase que empiece por un verbo.}}

{{Para qué sirve y a quién le ahorra trabajo, en dos o tres frases.}}

**Dónde está:** {{menú o pantalla}}.

Más detalles en {{enlace a help.etendo.ai}}.
```

### Rollback — channel `email`

```markdown
Asunto: Pausamos {{nombre de la funcionalidad}} en Etendo

Hola:

Hemos desactivado temporalmente {{nombre de la funcionalidad}} mientras corregimos {{motivo, sin tecnicismos}}.

**Qué significa para ti**

- {{Qué deja de ver o hacer}}
- {{Qué pasa con lo que ya creó: se conserva / no se pierde nada}}

Te avisaremos en cuanto vuelva a estar disponible. Gracias por tu paciencia y por el feedback que nos ayudó a detectarlo.

Equipo Etendo
```

### Feedback reminder — channel `email`, optional, about two weeks into a stage

```markdown
Asunto: ¿Qué tal con {{nombre de la funcionalidad}}?

Hola:

Hace {{dos semanas}} activamos {{nombre de la funcionalidad}} en tu cuenta. Nos ayudaría mucho saber cómo te ha ido.

- ¿La has usado? Si no, ¿qué te lo impidió?
- ¿Qué cambiarías?

Basta con responder a este email con un par de líneas.

Gracias,

Equipo Etendo
```

## Known panel issues

- Applying a change to a flag that is already in **beta** fails with
  `Datadog 409: allocation with this key already exists` (reported to the panel team on
  2026-11-26). Until it is fixed, a beta flag cannot be edited from the panel. The workaround
  (beta → alpha, apply, back to beta, apply) briefly removes access from every beta tester: ask
  the human first.
- Rings take emails and `@groups` only, not domains; `apply` deletes Datadog rules the panel does
  not manage (shown as `rules removed` in `plan`).

## Do not

- Notify before `apply` has been verified with `check`.
- Send a message the human has not read in its final form, or skip the `--test` send.
- Email customers at GA: publish the release note instead.
- Archive a Datadog flag before the release without it is deployed everywhere.
