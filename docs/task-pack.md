# Task Pack — several tasks, one review, one PR into develop

> Introduced with the first pack, ETP-6423 (2026-11-24). Related: `docs/branch-workflow.md` (branch
> model, daily cut).

A task pack joins two or more tasks that are ready (each with its own PR into `develop`) into one
branch. They are reviewed together, tested in one environment and merged into `develop` through
**one PR per repo**. It is meant above all for tasks **pre-worked by the bot** (Etendo Bot, Jira
author "Information Etendo", GitHub `etendobot` / `EtendoERP`): many small PRs, green CI, no human
review yet.

It is **not** the merge block. The merge block cuts `develop` and goes to `main` (production). A
pack goes to `develop` and reaches `main` later with the daily cut, like any other task.

```
feature/ETP-A ─┐
feature/ETP-B ─┼─ merge --no-ff ─▶ taskpack/ETP-P      one branch per repo, cut from origin/develop
feature/ETP-C ─┘                        │  one local-env environment with every task in it
                                        ▼  one PR per repo → develop (mini pipeline + human review)
                                     develop ──(daily cut, docs/branch-workflow.md)──▶ main
```

| | Merge block | Task pack |
|---|---|---|
| Target | `main` | `develop` |
| Built from | a cut of `develop` | `origin/develop` + the tasks' feature branches merged in |
| Content | everything `develop` carries | the tasks chosen for the pack |
| Pipeline | full (Jenkins, integration) | the mini pipeline of a PR into `develop` |
| Purpose | deploy window | review and test related tasks together, merge once |

## When to use it

- Two or more tasks with open PRs into `develop`, typically bot-worked, that are cheaper to review and
  test together: same area (for example several MCP fixes), same files, or one environment proves
  all of them.
- **Not** for a task that still needs development (no PR yet). A task whose CI is red can enter only
  with the FIX verdict of stage 1, once the cause is known.
- **Not** to bypass review: the pack's PR needs the same human review, and the review of each task
  happens in stage 1, before anything is merged.

## Naming

| Item | Name |
|---|---|
| Jira task | `Task Pack DD/MM - <Person>`, type Task, label `task-pack`, assigned to that person and linked ("relates to") to every task it carries. Each person may have their own pack on the same day, hence the name in the title |
| Branch, per repo | `taskpack/ETP-P`, where `ETP-P` is the pack's Jira task |
| Commits on the branch | `Feature ETP-P: ...` (Git Police: the pack is a feature branch) |
| PR title | `Feature ETP-P: Task pack DD-MM` — plain ASCII, no quotes |

One branch **per repo that has tasks in the pack**: a pack whose tasks touch `com.etendoerp.go` and
`etendo_schema_forge` has `taskpack/ETP-P` in both.

## Stage 1 — Review (before merging anything)

Every task is reviewed on its own, on its PR, before it enters the pack. For a bot-worked task:

1. **Ticket vs plan.** Read the Jira description and the bot's `BOT PROGRESS` comments. The plan
   comment ("plan approved by the review") states the problem, the current state and the approach.
   Check that the approach answers the acceptance criteria, and nothing else.
2. **The bot's history.** Read every status line, not only the last `done`:
   - `stopped, needs a person (...)` and how it was unblocked;
   - workarounds: a merge with `-s ours`, a squash or rebuilt branch, a waived gate step
     (`pw-mocked`, `pw-integration`), a compile error blamed on the environment;
   - **human commits the bot dropped** (for example a branch rebuilt as one commit): decide whether
     losing them is intended.
3. **Open questions the bot left.** Proposals it made without a decision in the ticket (a retention
   period, a default, a limit it documented instead of solving). Each one is answered before merge.
4. **The diff.** `gh pr diff`:
   - scope: files and behaviour beyond the ticket;
   - tests: they assert behaviour a consumer would see, not wiring or source text;
   - docs: window guides, `neo-headless.md`, `AGENT_PROMPT`s updated when behaviour changed;
   - generic code paths (`NeoSelectorService`, `NeoCrudHandler`, `NeoServlet`, ...) free of
     window-specific logic.
5. **The PR's state.** Open, base `develop`, no conflicts, CI green (Job A of `merge-block-helper`).
   A conflict with `develop` is resolved on the feature branch first.

Verdict per task, recorded in the pack's Jira task:

| Verdict | Meaning |
|---|---|
| **In** | enters the pack as it is |
| **Fix** | enters after a fix (see § Fixes) |
| **Out** | stays out of this pack; its own PR follows the normal flow or waits |

## Stage 2 — Build the branch

Per repo, after a fresh fetch:

```bash
git -C <repo> fetch origin develop feature/ETP-A feature/ETP-B ...
git -C <repo> branch --no-track taskpack/ETP-P origin/develop
git -C <repo> checkout taskpack/ETP-P
git -C <repo> merge --no-ff --no-edit origin/feature/ETP-A
git -C <repo> merge --no-ff --no-edit origin/feature/ETP-B
```

- `--no-track`: a branch made from `origin/develop` must not track it, or a stray push lands there.
- **Order:** oldest PR first, unless one task depends on another.
- **Merge commits only.** Never squash or rebase: each task's commits keep their history and their
  `Hooks-Verified` trailer (merge commits do not need it).
- **A conflict between two tasks** is resolved on the pack branch, in the merge commit. When the
  resolution is more than mechanical (both sides changed behaviour), stop and ask both authors.
- Record each merge (task, PR, merged sha) in the pack's Jira task: Stage 5 and reverts need it.

## Stage 3 — Test in one environment

One `local-env` environment with the pack branches (skill `local-env`):

```bash
cd /Users/futit/Workspace/etendo_develop
local-env worktree ETP-P --module com.etendoerp.go=taskpack/ETP-P --repo schema_forge=taskpack/ETP-P --dry-run
```

- `up` only after the user's OK (install, update.database, smartbuild).
- Run each task's acceptance criteria on the environment, and the bot's own verification steps when
  it listed them. Record the result per task (pass / fail + evidence) in the pack's Jira task.
- Run the narrow automated tests the tasks touched (`./gradlew test --tests ...` inside the
  environment; Vitest for schema_forge).

## Fixes

Where a fix goes depends on whose problem it is:

- **A problem of the task itself** (found in the review or the test, and it would exist without the
  pack): fix it on the **task's feature branch**, with its own `Feature ETP-X:` commit, and merge
  that branch into the pack again (`git merge --no-ff origin/feature/ETP-X`). Authorship stays clear
  and the task's own PR stays coherent.
- **A clash between tasks** (a conflict when merging them, or two tasks that only break together):
  resolve it **on the pack branch**, in the merge commit or a `Feature ETP-P:` commit right after it.

## Stage 4 — Taking a task out

- **Before the pack's PR is open:** rebuild the branch without the task (Stage 2 again) and force-push
  it with `--force-with-lease`. The pack branch is the only branch of the flow ever force-pushed.
- **After the PR is open:** `git revert -m 1 <task's merge sha>` on the pack branch, commit
  `Feature ETP-P: Revert ETP-X from the pack`.

## Stage 5 — The PR and the merge

- One PR per repo, `taskpack/ETP-P → develop`, assigned to the pack's owner. Body: a table with each
  task, its Jira link, its own PR, the stage 1 verdict and the stage 3 result.
- Same gates as any PR into `develop`: mini pipeline, `verify`, Sonar, review, code-owner gate.
- **A human merges it**, in GitHub, with a merge commit. Agents never merge into `develop`.
- When a pack spans two repos, merge both PRs together, `com.etendoerp.go` first (as the cut does).

**The tasks' own PRs** stay open while the pack is reviewed and are not closed by hand. When the
pack's PR merges, each task's head commit reaches `develop` and GitHub marks its PR as merged on its
own. Check it after the first pack; a PR that is still open then is closed with a comment pointing at
the pack's PR.

**Jira.** Once the pack is in `develop`, each task and the pack's task move on as any merged task.

## Who does what

| Step | Who |
|---|---|
| Choose the tasks, stage 1 verdicts | Human (an agent prepares the review) |
| Build the branch, resolve mechanical conflicts | Agent, on explicit OK |
| Push the branch | Human, or an agent on explicit OK |
| `local-env up` | Agent after the user's OK |
| Open the PR | Clerk (`workflow` agent) |
| Approve and merge | **Human only** |
