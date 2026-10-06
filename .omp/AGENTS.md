# trade-journal — `.omp/` Agent & Style Guide

> Local operating layer for AI agents working on this monorepo. The repo's
> human-facing rules live in `/AGENTS.md`. This directory is the index,
> the fleet, and the hooks — keep them aligned.

## How to use this folder

1. Load `.omp/AGENTS.md` (this file) to see the fleet.
2. Pick the specialist whose scope matches the change. Read its identity file.
3. Load the style guides it lists before writing any code.
4. Before claiming done, run the checks in `.omp/hooks/pre-commit.md`.
5. The reviewer (`.omp/agents/reviewer.md`) is read-only — it reports findings,
   never edits.

## Layout

```
.omp/
├── AGENTS.md            # this file (index)
├── style/               # 11 enforceable style guides
├── agents/              # 7 agent identities (6 specialists + 1 reviewer)
└── hooks/               # pre-commit behaviour gates
```

## Fleet

| Agent | Owns | Loads | Frontmatter (`name` · `description` first sentence · `tools`) |
| --- | --- | --- | --- |
| `core-engine` | `packages/core/src/`, `packages/core/tests/`, `docs/edge-score.md` | typescript, data-engineering | `core-engine` · Owns the round-trip engine, metrics, and Edge Score in packages/core. · `read, grep, glob, edit, write, bash` (scoped) |
| `importer-specialist` | `packages/importers/src/` | typescript, parsing | `importer-specialist` · Owns broker file parsers and history adapters in packages/importers. · `read, grep, glob, edit, write, bash` (scoped) |
| `schema-specialist` | `apps/web/src/db/` | typescript, sql-drizzle | `schema-specialist` · Owns Drizzle schema, BOOTSTRAP_SQL, and migration guardrails in apps/web/src/db. · `read, grep, glob, edit, write, bash` (scoped) |
| `api-specialist` | `apps/web/src/app/api/**` | typescript, api-routes, api-design | `api-specialist` · Owns Next.js route handlers, auth, error mapping, and input validation in apps/web/src/app/api. · `read, grep, glob, edit, write, bash` (scoped) |
| `react-ui` | `apps/web/src/components/`, `apps/web/src/app/<route>/page.tsx` | typescript, react-ui, react-next15, tailwind-v4 | `react-ui` · Owns Next.js 15 components, pages, and client-side state. · `read, grep, glob, edit, write` |
| `ai-specialist` | `apps/web/src/server/ai*.ts` | typescript, ai-integration | `ai-specialist` · Owns BYO-key AI reflection, recaps, and AI-assisted parsing in apps/web/src/server. · `read, grep, glob, edit, write` |
| `reviewer` | (read-only, all paths) | all style guides | `reviewer` · Read-only; never edits. Writes `.omp/reviewer-report.md` on every run. · `read, grep, glob` |

## Handoff graph

```
                   ┌──────────────┐
                   │ orchestrator │  (root session)
                   └──────┬───────┘
                          │
        ┌─────────┬───────┼───────┬─────────┬─────────┐
        ▼         ▼       ▼       ▼         ▼         ▼
   core-engine  importer schema api-specialist react-ui  ai-specialist
        │         │       │       │         │         │
        └────► react-ui ◄─┴───────┴─────────┴─────────┘
                    ▲
                    │ (findings only)
                    │
                reviewer
```

- `core-engine` hands off to `react-ui` when UI chart math is needed.
- `importer-specialist` hands off to `core-engine` for engine-side parsing
  logic.
- `schema-specialist` hands off to `api-specialist` for query patterns.
- `api-specialist` hands off to `ai-specialist` for prompt construction.
- Anyone can be reviewed by `reviewer`; nobody edits files on review findings
  except the original implementer.

## Style guides (11)

All guides end with a **Checklist before PR**. Treat a missed checklist
bullet as a review-block.

| File | Scope |
| --- | --- |
| `typescript.md` | Language-level rules (strict, ESM, naming, error handling) |
| `data-engineering.md` | Round-trips, metrics, Edge Score, importer contracts, DB |
| `react-ui.md` | Component patterns, hooks, accessibility, charts |
| `react-next15.md` | App router, server/client split, streaming, caching |
| `tailwind-v4.md` | v4 CSS-first config, primitives, dark + privacy |
| `api-routes.md` | Handler mechanics, auth, transactions, broker boundaries |
| `api-design.md` | HTTP contract, status codes, pagination, idempotency |
| `parsing.md` | Broker statement formats, dates, numbers, fixtures |
| `ai-integration.md` | BYO-key, prompt construction, output schemas, logging |
| `sql-drizzle.md` | Schema, BOOTSTRAP_SQL, migrations, transactions |
| `documentation.md` | Doc voice, structure, samples, ADR rule |

## Hooks

omp discovers TypeScript hook modules under `.omp/hooks/pre/` (block-on-violation)
and `.omp/hooks/post/` (observers) at session start. The accompanying
human-readable companion is `.omp/hooks/pre-commit.md`.

Gates (return `{ block: true, reason }` to deny the tool call):

- `.omp/hooks/pre/block-importer-fetch.ts` — no raw `fetch` / `axios` /
  `http.` in `packages/importers/src/` (hard block #2; ADR 0001).
- `.omp/hooks/pre/protect-trade-key.ts` — `packages/core/src/round-trips.ts`
  trade-key format change requires an ADR at `docs/decisions/NNNN-*.md`
  (hard block #3).
- `.omp/hooks/pre/telemetry-guard.ts` — no telemetry endpoints, no
  re-enabling `NEXT_TELEMETRY_DISABLED` (hard block #5).
- `.omp/hooks/pre/reviewer-gate.ts` — `git commit` requires
  `.omp/reviewer-report.md` with `## Verdict: PASS`.

Observers (log only):

- `.omp/hooks/post/reviewer-report.ts` — appends one line per
  `pnpm format:check|typecheck|test|build` and license check to
  `.omp/.reviewer-log`.

Hard blocks (any one stops the PR; the gates above enforce these):

1. New dependency without an ADR (`docs/decisions/NNNN-<topic>.md`).
2. Raw `fetch` / `axios` / `http.` in `packages/importers/src/`.
3. Trade key format change without a migration.
4. P&L colour as the sole signal in a chart.
5. New telemetry endpoint.

## Decisions

Reversible choices live in code; irreversible ones live in
`docs/decisions/NNNN-<topic>.md`. The format is `docs/decisions/0000-template.md`
(MADR-lite: Status, Date, Context, Decision, Consequences). Hard block #1
rejects any new dependency without a corresponding ADR.

Seeded with `0001-broker-connectivity-via-broker-sdk.md` (Accepted).
Supersede by adding a new ADR that names the old one explicitly.

## Workflow

End-to-end loop the orchestrator runs for every slice:

1. Decompose the task into slices; pick a specialist per slice using the
   `description` in the frontmatter (omp routes by description).
2. The specialist loads its scope (Step 1 in the Fleet table) and the
   style guides it lists.
3. The specialist edits files. Pre-hooks block on hard-block violations
   before the write lands (`tool_call` event).
4. The specialist finishes and signals done. The orchestrator invokes
   `.omp/agents/reviewer.md`.
5. The reviewer writes `.omp/reviewer-report.md` overwriting any prior
   report, with `## Verdict: PASS|FAIL|BLOCK` and per-bullet findings.
6. The orchestrator commits. The pre-hook `reviewer-gate.ts` refuses any
   `git commit` whose report is missing or not `PASS`.
7. CI runs (`.github/workflows/ci.yml`). The post-hook
   `reviewer-report.ts` has already appended one line per important
   command to `.omp/.reviewer-log`; that log is the cross-reference when
   reviewing a failed CI run.

## Dependency direction

```
packages/core  ─────► (zero deps; everyone imports from it)
packages/importers ──► packages/core (only)
apps/web ────────────► packages/core, packages/importers, @luxalgo/broker-sdk
```

`packages/core` and `packages/importers` never import from `apps/web`.
`packages/core` never imports from `packages/importers`. Crossing these
boundaries is a review-block.

## Boundary tests

The reviewer enforces these on every slice that touches the relevant area:

- `packages/core` has no imports from `apps/web` or `packages/importers`.
- `packages/importers` has no imports from `apps/web` and no raw HTTP calls.
- `apps/web` is the only place that imports from `@luxalgo/broker-sdk`.

Run:

```bash
# packages/core purity
grep -rn "from ['\"]apps/web\|from ['\"]@luxalgo/journal-importers" packages/core/src --include="*.ts"

# importer purity
grep -rn "from ['\"]apps/web\|fetch(\|axios\|http\." packages/importers/src --include="*.ts"
```

Both must return zero matches.

## When in doubt

- A change crosses boundaries → split into separate slices per specialist.
- A new dependency is needed → write the ADR first, then add the dep.
- A formula changes (Edge Score, metrics) → bump the version constant AND
  update the docs in the same PR.
- An invariant test fails → the invariant is broken; fix the code, not the test.
- The right specialist isn't clear → start with `core-engine` (most general)
  and follow the handoff graph.