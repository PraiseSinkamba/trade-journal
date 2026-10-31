# Phase 10 integration - Node supervisor, worker bundle and Docker startup

## Outcome

Phase 10 (T-010) is integrated into `codex/ai-native-journal` at `aaf8212a504fda17654a8ca99ef4b790e904de06`.
Merge: `54463d7800f4e72d2b7f109e02c0f02c76458383` (`--no-ff`), parents `dc54222` and `28c663d`.
The p10 branch is an ancestor of the feature branch.

- Phase plan: `3c78961` - docs: plan supervised worker startup and packaging
- Implementation: `a890700` - feat: supervise and package journal intelligence worker
- Repairs: `37f338a` - Fix packaged journal startup: repair unresolvable links, restart stopped workers
- Phase report: `28c663d` - docs: record the Phase 10 verification results and the blocked Docker deployment gate

## What landed

The supervised journal startup. One resolved configuration is handed to both children, so the HTTP
child and the worker never disagree about mode, host, port, data directory or worker enablement.
Readiness is published only after a real HTTP answer, never after the HTTP child's own ready claim.
Shutdown uses one shared ten-second deadline: SIGTERM over IPC, then SIGKILL. A worker crash keeps
HTTP alive and restarts under a bounded exponential policy, reporting `unhealthy` after five
crashes in ten minutes. The worker entry is bundled independently by the repository's own tsup, with
`better-sqlite3` externalised and its native module copied, and it contains no Next, route or
React code.

The repair commit fixes three defects the first attempt left:

- Next copies pnpm package links with relative targets that Windows cannot follow, so the packaged
  server died with `EPERM` before serving. `apps/web/scripts/repair-links.mjs` re-points every
  unresolvable link at the target it already names.
- Next never copies `.next/static` or `public` into the standalone output, so the packaged server
  served HTML without CSS or JS. Both are now copied next to the standalone `server.js`.
- A worker whose poll loop stopped while its process stayed alive was never terminated, so it idled
  forever instead of restarting under the bounded policy. The supervisor now terminates it.

Two worker-default corrections came with it: the packaged worker path is preferred over the build
output, and the default data directory follows the working directory so a rebuild cannot wipe it.

## Schema and boundary check

No schema allocation. No table, migration, bootstrap, registry or checksum change. No dependency,
lockfile, payload contract, execution hash, trade key, financial methodology, provider endpoint or
credential changed. The merge touched 14 files: the supervisor scripts, the worker entry, the
composition factory, the Docker shape, two test files, the phase plan, the phase report and the
generated reviewer report.

## Verification on the destination branch

One CI sequence, run on `codex/ai-native-journal` after the merge. Not run against the candidate.

| Command                                                                             | Exit | Result                                                    |
| ----------------------------------------------------------------------------------- | ---- | --------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                    | 0    | lockfile unchanged                                        |
| `pnpm --filter web typecheck`                                                       | 0    | passed                                                    |
| `pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck` | 0    | passed                                                    |
| `pnpm --filter web migrations:check`                                                | 0    | checksums current                                         |
| `node scripts/check-licenses.mjs`                                                   | 0    | licenses OK                                               |
| `prettier --check` on every changed file                                            | 0    | all matched files use Prettier code style                 |
| `pnpm build`                                                                        | 0    | production build, worker bundle and static copy completed |
| `pnpm test`                                                                         | 0    | 103 files, 1074 tests passed                              |

Root `pnpm typecheck` was not used: it fails in the `desktop` workspace on two pre-existing
repository defects that are outside this phase's scope and are recorded as a hard prerequisite for
Phase 11.

The format gate checks the files this phase changed. The repository-wide `pnpm format:check` was
also run and fails on **74 files**, none of which this phase touched: the overlap between that list
and this phase's fourteen changed files is zero. Those files are pre-existing drift tracked in the
base commit `4ae868d`, mostly under `.superpowers/`, `.planning/`, `.backup/` and `docs/`.
Formatting them is a repository-wide cleanup outside this phase's scope. The changed-file check is
the gate the packet specifies. An explicit `prettier --check Dockerfile` is not valid because
Prettier has no parser for it.

The worker's own runtime smoke, on the branch before the merge: the packaged standalone supervisor
started on a disposable port and printed
`{"type":"ready","host":"127.0.0.1","port":34567,"worker":"idle"}` after Next reported
`Ready in 8.5s`, the worker held its lease, and terminating the supervisor left no `run-journal`,
`http-child` or `worker-entry` process behind. Before the repair the same command failed with
`EPERM: operation not permitted, stat ... styled-jsx` and the tree carried six unresolvable
links; after it, zero.

## Blocked: Docker scratch-volume deployment gate

Explicitly blocked by host evidence, not by the code. Docker client `29.6.1` is present with the
`desktop-linux` context; `com.docker.service` is `Stopped` with `StartType: Manual`; the
`dockerDesktopLinuxEngine` named pipe is absent; `docker info` cannot connect. The daemon was not
started, by instruction. No Docker result is claimed and nothing was mocked. The Dockerfile was
reviewed for shape only.

Carried forward as an open deployment item for the release gate: start the packaged supervisor and
worker from the image against a disposable volume on a host with a running daemon.

## Deviations and open risks

- The worker entry still imports the hot-reload singleton module to reach `openConnection`, so the
  singleton opens a second handle to the same `journal.db` inside the worker process. No WAL or SHM
  sidecar is removed anywhere in the codebase, so the risk the contract registers for that import is
  not realised. Splitting the factory out touches schema-phase files, so it is recorded as a next
  input rather than changed here.
- The production HTTP child keeps its own ten-second drain timer and relies on Next's installed
  SIGTERM cleanup; it deliberately does not report `stopped` for an open server.
- The link repair does not check that a resolved target stays inside the tree it was given. No such
  link exists today. The replace is not atomic: a failure aborts the build loudly.
- The worker corrected three of its own fixture defects rather than weakening a production
  deadline. Two timing-window assertions became ordering-based assertions against the HTTP child's
  own listening record, and one fixture-event count became an assertion on the published crash
  sequence. `probeHttp` stays at 1000 ms and the shared shutdown deadline stays at exactly 10 000 ms.

## A coordinator-caused failure, and the real defect underneath it

The first destination gate attempt failed with one test: `caps worker crashes at five while HTTP
remains available` timed out awaiting subprocess behavior. The immediate cause was the
coordinator's own mistake: two gate runs were executing at the same time, each running its own
`pnpm build` and full `pnpm test`, so two production builds and two full suites competed for
the host.

A second attempt then overlapped a third, and two `next build` processes wrote the same
`.next` directory at once. The second build failed with `ENOENT` on a generated static manifest
and left the build output incomplete, with no `BUILD_ID`. The coordinator stopped both jobs,
wiped `apps/web/.next` and re-ran the gate alone on an idle host.

That isolated run still failed, with four tests. The load was therefore not the whole story, and
the honest conclusion was that the tests were themselves fragile. Three distinct defects were
reproduced deterministically by running the supervisor file under six competing CPU processes:

- The await helper had a six-second default budget, shorter than the very timings the tests
  exercise, so a loaded host exhausted it before the supervisor could publish readiness.
- The fixture compressed the supervisor's startup budget to four seconds, well below the
  production sixty, so a slow fork aborted the supervisor before it could ever become ready.
- One test read the worker's recorded start event without waiting for it, so it could observe
  `undefined` for a process that had simply not written its line yet. That was a genuine race in
  the test, not a timing allowance.

The fix is in the test file only, committed as `aaf8212`. The await budget now covers the real
cost of forking a child and delivering IPC, the fixture's startup and liveness budgets are no
longer tighter than production, the worker start event is awaited rather than assumed, and the
tests that cross process boundaries carry explicit ninety-second test budgets. **No production
deadline, timeout or assertion was changed.** `probeHttp` remains 1000 ms, the shared shutdown
deadline remains exactly 10 000 ms, the production startup budget remains 60 s and the production
liveness budget remains 30 s.

Verification of the fix: the supervisor file passed 16 of 16 in isolation, and 16 of 16 again under
the same six-process load that had produced three failures. The table above is the final gate,
run alone on an idle host after the fix.

## Dispatch anomaly

The first attempt (`ctx_f76b5d0b58d3`) was revoked by an Orca runtime restart and left ten files
uncommitted. They were relocated into the p10 worktree as plan `3c78961` and implementation
`a890700`, preserving the plan-before-implementation ordering and the plan's byte-identical
content. The replacement attempt (`ctx_9850d5f78296`) was revoked again by orchestration recovery
at 2026-10-30T13:05:36Z after it had verified, repaired, committed and reported the work. The
runtime rejected its `worker_done` and `escalation` with `worker_identity_changed` because the
terminal no longer owned the dispatch. No lifecycle message was forged from another terminal; the
coordinator settled `task_b00115dce3c4` directly against the committed evidence.

This is the fourth dispatch revocation on this host, after Phase 01 attempt 1, Phase 08 and Phase 10. Each cost a phase's wall clock. The MiniMax balance separately hit zero during the repair, with
repeated HTTP 402 `insufficient_balance_error` responses.

## Next inputs

- Split `openConnection` out of the hot-reload singleton module so the worker bundle never loads
  the singleton.
- Run the Docker scratch-volume smoke on a host with a running daemon.
- Fix the two pre-existing desktop tooling defects before Phase 11, whose Tauri gate requires the
  actual sidecar ABI and a working `cargo check`.
- Phase 11 needs explicit authorisation.
