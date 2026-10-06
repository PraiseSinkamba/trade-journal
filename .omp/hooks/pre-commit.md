# Pre-commit behaviour gates — trade-journal

Human-readable companion to the TypeScript hooks that actually enforce these
rules. omp auto-discovers `.omp/hooks/pre/*.ts` (gates) and
`.omp/hooks/post/*.ts` (observers) at session start. This file documents
the *why*; the TypeScript modules are the *how*.

---

## Gates (block on violation)

- **`.omp/hooks/pre/block-importer-fetch.ts`** — no raw `fetch` / `axios` /
  `http.` in `packages/importers/src/`. All broker connectivity routes
  through `@luxalgo/broker-sdk` (ADR 0001).
- **`.omp/hooks/pre/protect-trade-key.ts`** — changing the trade-key
  format literal in `packages/core/src/round-trips.ts` (`accountId|symbol|
  direction|openedAt[|importGroup][|N]`) requires a matching ADR at
  `docs/decisions/NNNN-<topic>.md`.
- **`.omp/hooks/pre/telemetry-guard.ts`** — no telemetry URLs, no
  re-enabling `NEXT_TELEMETRY_DISABLED`, no vendor telemetry SDKs. The
  project ships with telemetry disabled.
- **`.omp/hooks/pre/reviewer-gate.ts`** — `git commit` requires
  `.omp/reviewer-report.md` with `## Verdict: PASS`.

## Observers (log only)

- **`.omp/hooks/post/reviewer-report.ts`** — appends one line per
  `pnpm format:check | typecheck | test | build` and
  `node scripts/check-licenses.mjs` invocation to `.omp/.reviewer-log`,
  for cross-referencing later reviewer findings with session activity.

## CI mirror

`.github/workflows/ci.yml` is the authoritative net; the local hooks
exist to catch violations before commit. Both layers encode the same
gates.

---

## Local equivalents (for humans reading this file)

The same checks that CI runs can be run by hand on the relevant scope:

```bash
# Format
pnpm format:check

# Type safety
pnpm typecheck

# Tests (scoped to the changed package, then full)
pnpm --filter @luxalgo/journal-core test --run

# License / dependency check
node scripts/check-licenses.mjs

# No new raw HTTP in importers
grep -rn "fetch\|axios\|http\." packages/importers/src --include="*.ts"

# No telemetry
grep -r "NEXT_TELEMETRY_DISABLED\|fetch.*telemetry\|fetch.*analytics" \
  --include="*.ts" --include="*.tsx"

# Trade-key format
git diff packages/core/src/round-trips.ts | grep "accountId|symbol|direction|openedAt"
```

All of these must return zero matches on a clean tree.

---

## Reviewer gate

Before `git commit`, the reviewer must have produced
`.omp/reviewer-report.md` with `## Verdict: PASS`. The
`.omp/hooks/pre/reviewer-gate.ts` hook enforces this at tool-call time and
refuses any `git commit` whose report is missing or whose verdict is FAIL or
BLOCK.

The reviewer subagent (`.omp/agents/reviewer.md`) writes the report; the
orchestrator commits once the report is on disk. Escape hatches (e.g.
`[skip-review]` in the commit message) are out of scope.

---

## Documentation check

If the change affects user-visible behaviour, confirm `docs/` has a
corresponding entry. See `documentation.md` § "New Feature Documentation
Requirement".

Specifically:

- Edge Score weight or threshold change → `docs/edge-score.md` updated.
- New broker format → `docs/importers.md` updated.
- New metric or score → documented in the relevant guide.
- New dependency → ADR at `docs/decisions/NNNN-<topic>.md` first
  (`AGENTS.md` hard block #1).

---

## Commit message rule

From `AGENTS.md`: commit subjects answer "what was solved, not what was
edited."

```
# Good
"Fixes two trades appearing when a fill crosses through flat"
"Adds gross-profit/gross-loss split to profit factor in Edge Score v2"

# Bad
"update round-trips.ts"
"fix bug"
"wip"
```

Subject line is imperative mood, present tense, no period.
Body explains why if non-obvious.

---

## ponytail check

Before claiming done, ask: does the same outcome fit in fewer files?

- Did you add a utility that already exists in the codebase?
- Can a helper shared across two packages live in `packages/core`?
- Is the new file genuinely new behaviour, or scaffolding that can be
  removed?

Simplify first. A smaller diff that does the same thing is always
preferred.

---

## When in doubt

- A test fails after a change → the invariant the test guards is broken.
  Fix the code, not the test. If the invariant itself changed, update
  both and file an ADR.
- A new dependency is needed → write the ADR first, then add the
  dependency. Dependencies without ADRs are rejected at license check.
- The reviewer verdict is FAIL → fix the slice, do not amend the report
  to PASS.
- The reviewer report is missing → the reviewer subagent did not run;
  invoke it before committing.
- `EDGE_SCORE_WEIGHTS` or full-marks thresholds changed → bump
  `EDGE_SCORE_VERSION` and update `docs/edge-score.md` in the same PR.
- The change affects how a user describes their edge → it is
  user-facing. Write or update the doc.