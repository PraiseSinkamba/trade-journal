# Phase 11 — Slice A integrated gate and financial regression

Re-scoped by `docs/decisions/0009-defer-tauri-packaging-to-release-acceptance.md`. This phase delivers
the Slice A integrated gate only. The Tauri desktop packaging and lifecycle subset moved to Phase 21
(T-021). The Phase 11 row in `docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md` still
names the Tauri subset; ADR 0009 supersedes it for this phase.

## Objective and outcome

Prove the ten design §18 Vertical Slice A scenarios pass as ONE coherent no-provider slice, run the
targeted financial regression and the full suite, record the packaged Node smoke result, and write
measured evidence.

Outcome: `docs/superpowers/reports/ai-native-journal-phase-11.md` and
`docs/superpowers/reports/ai-native-journal-integration-11.md` record the Slice A gate evidence with
commands, exit codes, runtimes, fixtures and the exact code SHA.

This phase makes NO production code change. It is a verification phase.

The coordinator is the designated phase verification owner for this phase: it executes this plan,
schedules the checks and writes both reports.

## Scope in

Owned files. Only these four may be edited:

- `apps/web/tests/intelligence-slice-a.test.ts`
- `apps/web/tests/intelligence-recovery.test.ts`
- `apps/web/tests/intelligence-supervisor.test.ts`
- `apps/web/tests/intelligence-packaging.test.ts`

Plus this plan, the phase report and the integration report.

Schema allocation: None. No new migration, no schema change, no new dependency. Financial
calculation, hash, key and annotation behaviour must not change.

## Scope out

- `desktop/`, `desktop/src-tauri/` — Phase 21 under ADR 0009.
- `apps/web/scripts/`, `Dockerfile` — Phase 21 under ADR 0009.
- All production source, DB schema, migrations, package manifests and lockfile.
- Any other phase, financial engine/key/hash redesign, book methodology, broker-server edits,
  model-driven financial writes, external queues, public intelligence package, unrelated UI.

## Scenario to existing coverage map

The coverage already exists from phases 3 to 10. Do not invent new test names; confirm the named
tests still exist and run.

| #   | §18 scenario                              | Existing coverage                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Repeated identical broker synchronization | `intelligence-outbox.test.ts` — "keeps one row when the same aggregate revision is appended twice"                                                                                                                                                                  |
| 2   | Historical import                         | `intelligence-slice-a.test.ts` — "discovers closed and open historical trades without financial or annotation writes"                                                                                                                                               |
| 3   | Newly closed trade                        | `intelligence-observations.test.ts` — "writes one observation and one evidence link, and the observation stays active"                                                                                                                                              |
| 4   | Corrected execution                       | `intelligence-observations.test.ts` — "corrects the projection and the observation exactly once"                                                                                                                                                                    |
| 5   | Unavailable opening-time evidence         | `intelligence-observations.test.ts` — "stays unknown and is never guessed from a duration"; `intelligence-slice-a.test.ts` — "retains reconstructed timing provenance without asserting source-reported duration"                                                   |
| 6   | Database transaction failure              | `intelligence-outbox.test.ts` — "leaves no event behind when the surrounding transaction rolls back"; `intelligence-jobs.test.ts` — "rolls the effect back when the acknowledgement is refused"                                                                     |
| 7   | Crash after event persistence             | `intelligence-recovery.test.ts` — "recovers a committed trade event after killing the worker before dispatch commits"                                                                                                                                               |
| 8   | Duplicate event delivery                  | `intelligence-outbox.test.ts` — "dispatches the same event exactly once when the fanout is repeated"                                                                                                                                                                |
| 9   | Interrupted worker execution              | `intelligence-recovery.test.ts` — "rolls back a real observation before acknowledgement and reclaims the same job after SIGKILL"                                                                                                                                    |
| 10  | Reconciliation and identity ambiguity     | `intelligence-observations.test.ts` — describe "a reversed event order" > "refuses the old event, so the old truth is never revived"; `intelligence-slice-a.test.ts` — "keeps real mutation event and current revision unchanged when mutation arrives before seed" |

The pipeline under test: trade changed, reconciliation, durable domain event, worker processing,
deterministic observation, persistent evidence — with no AI provider configured.

## Steps

1. Confirm each of the ten scenarios has the coverage listed above and that every named test runs in
   one invocation. Do not create parallel or renamed duplicates.
2. If a scenario has no adequate coverage, ADD it to one of the four owned test files only. Keep the
   no-provider condition; never weaken an assertion to make a check pass.
3. Run the phase gate (below).
4. Run the targeted financial regression (below).
5. Run typecheck of the TypeScript workspaces (below).
6. Run the full suite (below).
7. Record the packaged Node smoke result: packaged native SQLite artifact started from a clean path
   containing spaces and shut down over IPC.
8. Record blocked host evidence (Docker scratch-volume smoke, root `pnpm typecheck` desktop
   `cargo check`).
9. Write the phase report `docs/superpowers/reports/ai-native-journal-phase-11.md` with the evidence
   below, then the integration report `docs/superpowers/reports/ai-native-journal-integration-11.md`.

## Verification commands

Phase gate:

```
pnpm exec vitest run apps/web/tests/intelligence-slice-a.test.ts apps/web/tests/intelligence-recovery.test.ts apps/web/tests/intelligence-supervisor.test.ts apps/web/tests/intelligence-packaging.test.ts
```

Targeted financial regression:

```
pnpm exec vitest run packages/core/tests apps/web/tests/execution-storage.test.ts apps/web/tests/import-formats-regression.test.ts apps/web/tests/history-import.test.ts
```

Typecheck of the TypeScript workspaces:

```
pnpm --filter web typecheck
pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck
```

Full suite:

```
pnpm test
```

## Blocked-evidence rule

Two checks cannot pass on this host. Record them as explicitly blocked host evidence, never mocked,
never claimed as passed, and carry them to the release gate (G-FINAL).

- Docker scratch-volume smoke — the Docker daemon is stopped on this host. The packaged Node smoke
  satisfies the gate and does run.
- Root `pnpm typecheck` also runs the `desktop` workspace, whose `cargo check` fails on a
  PRE-EXISTING repo defect: the Tauri sidecar resource
  `binaries/node-x86_64-pc-windows-msvc.exe` does not exist because the sidecar setup script uses
  CommonJS `require()` inside an ESM package. That defect is Phase 21 scope under ADR 0009 and is
  not this phase's to fix. The TypeScript workspace typechecks in step 5 are the phase evidence.

## Evidence to record

For every command: exact command, exit code, runtime, fixture used, and the exact code SHA it ran
against. Also record the packaged Node smoke result, the two blocked items with the reason and the
carried-forward gate, and the ten-scenario map with the observed pass state of each named test.

## Stop condition

Stop when the phase gate, the targeted financial regression, the TypeScript workspace typechecks and
the full suite have all been run and recorded, the packaged Node smoke result is recorded, blocked
host evidence is recorded as blocked, and both reports are written. Any real failure in the gate,
the regression, the typechecks or the full suite stops the phase: report the failure honestly, do not
weaken tests, do not widen scope, do not start general AI execution without this recorded gate.

## Out of scope

The coordinator owns the reviewed, non-fast-forward merge into `codex/ai-native-journal`. No push, no
PR, no merge to `main`. Retain worktrees and branches.
