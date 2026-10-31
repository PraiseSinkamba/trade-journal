# Phase 11 — Slice A integrated gate and financial regression

Phase 11 delivered the Slice A integrated gate: the ten design §18 Vertical Slice A scenarios proven
as one coherent no-provider slice, the targeted financial regression, and the full suite, all recorded
with measured commands, exit codes and runtimes.

This phase made **no production code change**. It is a verification phase. The coordinator is the
designated phase verification owner: it executed the plan, scheduled the checks and wrote both
reports.

The phase was re-scoped by `docs/decisions/0009-defer-tauri-packaging-to-release-acceptance.md`:
Phase 11 delivers the Slice A integrated gate only, and the Tauri desktop packaging subset moved to
Phase 21 (T-021). The frozen phase guide still names that subset at Phase 11; ADR 0009 supersedes
it for this phase. This packet plus ADR 0009 govern this phase.

## Environment and identity

- Node v24.20.0, pnpm 11.0.8, Vitest 3.2.7.
- Host: Windows 11.
- Worktree: `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal`.
- Branch: `codex/ai-native-journal`.
- Base SHA the gate ran against: `8648412` (the verified feature HEAD).

## Scenario proof map

The pipeline under test: trade changed, reconciliation, durable domain event, worker processing,
deterministic observation, persistent evidence — with no AI provider configured.

| Scenario                                  | Proof                                                                                                                                                                             | Test file                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Repeated identical broker synchronization | "keeps one row when the same aggregate revision is appended twice"                                                                                                                | `intelligence-outbox.test.ts`                                       |
| Historical import                         | "discovers closed and open historical trades without financial or annotation writes"                                                                                              | `intelligence-slice-a.test.ts`                                      |
| Newly closed trade                        | "writes one observation and one evidence link, and the observation stays active"                                                                                                  | `intelligence-observations.test.ts`                                 |
| Corrected execution                       | "corrects the projection and the observation exactly once"                                                                                                                        | `intelligence-observations.test.ts`                                 |
| Unavailable opening-time evidence         | "stays unknown and is never guessed from a duration"                                                                                                                              | `intelligence-observations.test.ts`                                 |
| Database transaction failure              | "leaves no event behind when the surrounding transaction rolls back"; "rolls the effect back when the acknowledgement is refused"                                                 | `intelligence-outbox.test.ts`; `intelligence-jobs.test.ts`          |
| Crash after event persistence             | "recovers a committed trade event after killing the worker before dispatch commits"                                                                                               | `intelligence-recovery.test.ts`                                     |
| Duplicate event delivery                  | "dispatches the same event exactly once when the fanout is repeated"                                                                                                              | `intelligence-outbox.test.ts`                                       |
| Interrupted worker execution              | "rolls back a real observation before acknowledgement and reclaims the same job after SIGKILL"                                                                                    | `intelligence-recovery.test.ts`                                     |
| Reconciliation and identity ambiguity     | "a reversed event order > refuses the old event, so the old truth is never revived"; "keeps real mutation event and current revision unchanged when mutation arrives before seed" | `intelligence-observations.test.ts`; `intelligence-slice-a.test.ts` |

The pipeline holds with no AI provider configured. No financial calculation, hash, key or annotation
behaviour changed in this phase, and no production source file was touched.

## Executed gates

| Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Exit | Result                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-migrations.test.ts apps/web/tests/intelligence-observations.test.ts apps/web/tests/intelligence-outbox.test.ts apps/web/tests/intelligence-packaging.test.ts apps/web/tests/intelligence-recovery.test.ts apps/web/tests/intelligence-slice-a.test.ts apps/web/tests/intelligence-supervisor.test.ts apps/web/tests/intelligence-worker.test.ts` | 0    | 10 test files passed, 118 tests passed, 35.60 s wall — the full integrated no-provider slice across every Slice A test file                                                                                                                                                                                                              |
| `pnpm test`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 0    | 103 test files passed, 1074 tests passed, Duration 197.93 s                                                                                                                                                                                                                                                                              |
| `pnpm typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 101  | TypeScript workspaces passed (`packages/core` Done, `packages/importers` Done, `apps/web` route types generated successfully); the failure is the `desktop` workspace `cargo check`: `resource path 'binaries\node-x86_64-pc-windows-msvc.exe' doesn't exist` — a pre-existing repo defect, not a regression (see Blocked host evidence) |
| `pnpm exec vitest run apps/web/tests/intelligence-slice-a.test.ts apps/web/tests/intelligence-recovery.test.ts apps/web/tests/intelligence-supervisor.test.ts apps/web/tests/intelligence-packaging.test.ts`                                                                                                                                                                                                                                                                               | 0    | 4 test files passed, 37 tests passed, 26.65 s wall — the phase gate command from the plan                                                                                                                                                                                                                                                |
| `pnpm exec vitest run packages/core/tests apps/web/tests/execution-storage.test.ts apps/web/tests/import-formats-regression.test.ts apps/web/tests/history-import.test.ts`                                                                                                                                                                                                                                                                                                                 | 0    | 8 test files passed, 89 tests passed, 10.01 s wall — targeted financial regression                                                                                                                                                                                                                                                       |

### Host-load note on the first attempt

During the FIRST attempt of the ten-file integrated slice, one test failed because three documentation
agents were editing files concurrently on the same host. The re-run on an otherwise idle host
produced the clean exit-0 result recorded above. This was host load, not a code failure; the first
attempt is not presented as a code failure.

## Blocked host evidence

Both items below are blocked. Neither was mocked, and neither is claimed as passed.

- **Docker scratch-volume smoke.** The Docker daemon is stopped on this host: client `29.6.1`,
  `desktop-linux` context, `com.docker.service` `Stopped`/`Manual`, the `dockerDesktopLinuxEngine`
  pipe absent, and `docker info` cannot connect. Carried to the release gate (G-FINAL).
- **`desktop` workspace `cargo check`.** `pnpm typecheck` fails at exit 101 on the `desktop`
  workspace: `resource path 'binaries\node-x86_64-pc-windows-msvc.exe' doesn't exist`. This is a
  PRE-EXISTING repo defect, not a regression: the Tauri sidecar setup script
  `desktop/scripts/run-sidecar-setup.js` uses CommonJS `require()` inside an ESM package
  (`desktop/package.json` has `"type": "module"`), so the sidecar binary is never downloaded and the
  Tauri build script fails. It is Phase 21 scope under ADR 0009 and is carried forward as blocked
  host evidence, never as a pass.

## Coverage origin

The ten scenarios' coverage already existed from phases 03 to 10. This phase recorded it as one
coherent slice. No new test was required, and no test file was modified.

## Deviations and next inputs

- **ADR 0009 re-sequencing.** Phase 11 delivers the Slice A integrated gate only; the Tauri desktop
  packaging subset moved to Phase 21 (T-021). The frozen phase guide still names it at Phase 11.
- **Desktop defect deferred to Phase 21.** The `desktop` `cargo check` failure is recorded as
  blocked host evidence and fixed in Phase 21, not here.
- **Docker carried to the release gate.** The scratch-volume smoke is not run on this host and is
  carried to G-FINAL.
- **Next input:** Phase 12 — execution contexts, deterministic capability registry and tool gateway.
