# Phase 10 — Node supervisor, worker bundle and Docker startup

## Outcome and commit identity

Verified the committed Phase 10 implementation, repaired the packaging and supervisor defects it
still had, re-ran the phase gates, and packaged a real startup/shutdown smoke against the built
standalone tree. The Docker scratch-volume smoke stays blocked by the host, not by the code.

- Branch: `codex/ai-native-journal-p10`.
- Phase plan committed before implementation: `3c78961095f9c64a0d8b63948cb65592db90bc82`.
- Implementation commit under review: `a890700e31a3d4128825f6327bec31d7ff86913a`
  (`feat: supervise and package journal intelligence worker`).
- Repairs: `37f338a` (`Fix packaged journal startup: repair unresolvable links, restart
stopped workers`). This report is a documentation-only successor commit to the repairs. The
  coordinator owns the final local non-fast-forward integration and the integration report.
- Native task: `task_b00115dce3c4`; dispatch: `ctx_9850d5f78296`; stable packet: T-010.
- The previous attempt's dispatch was revoked by an Orca runtime restart at 2026-07-29T16:04Z and
  again at 2026-10-30T13:05:36Z (`capability_revoked_at`, `last_failure: The assigned worker
terminal is no longer live after orchestration recovery`). Both are infrastructure events, not
  worker failures: the implementation was committed by the first attempt, and this attempt
  verified, repaired and reported it in the same checkout.
- The completion signal could not be sent from this terminal. The runtime rejects
  `worker_done` and `escalation` for this dispatch with `worker_identity_changed` ("not the exact
  process that owns Dispatch ctx_9850d5f78296"), and a plain orchestration check answers
  `consumer_fenced`. The coordinator was told over the message thread and has to settle the Task
  and integrate the branch; no lifecycle message was forged from another terminal.

## Changed files and ownership

The implementation commit added ten files. This dispatch changed five of them, added one new
script inside the phase-owned scripts directory, and added this report. Outside those, the only
other file touched was the generated `.omp/reviewer-report.md` that the pre-commit gate reads. No
schema, migration, lockfile, dependency, provider, financial, trade-key or UI file changed.

Implementation (already committed in `a890700`, reviewed and retained):

- `apps/web/scripts/run-journal.mjs` — supervisor CLI, IPC lifecycle, readiness gate, restart policy.
- `apps/web/scripts/http-child.mjs` — the HTTP child; production uses the standalone `../server.js`.
- `apps/web/scripts/build-worker.mjs` — independent worker bundle via the already-installed tsup esbuild.
- `apps/web/scripts/copy-static-build.js` — ships worker and lifecycle scripts into both server trees.
- `apps/web/src/server/intelligence/composition.ts` — `createIntelligenceWorker` factory.
- `apps/web/src/server/intelligence/worker-entry.ts` — the worker's only consumer start site.
- `apps/web/package.json` — `dev:journal`, `build:worker`, supervisor-based `start`.
- `apps/web/next.config.ts` — `output: "standalone"`.
- `Dockerfile` — single container, single volume, nonroot user, supervisor entry point.
- `apps/web/tests/intelligence-supervisor.test.ts`, `apps/web/tests/intelligence-packaging.test.ts`.

Repairs in this dispatch:

- `apps/web/scripts/run-journal.mjs` — a worker whose poll loop stops while its process stays
  alive is now terminated by the supervisor, so the bounded restart policy applies instead of the
  worker silently idling forever. The default worker path prefers the packaged
  `../worker/worker-entry.cjs` and falls back to the build output. The default data directory
  follows the working directory instead of the app root, so it is not wiped by a rebuild.
- `apps/web/src/server/intelligence/worker-entry.ts` — honours `JOURNAL_WORKER_ENABLED`.
- `apps/web/scripts/copy-static-build.js` — copies `.next/static` and `public` next to the
  standalone `server.js`, and calls the new link repair before materialising `node_modules`.
- `apps/web/scripts/repair-links.mjs` (new) — re-points links the host cannot follow at the target
  they already name.
- `apps/web/tests/intelligence-supervisor.test.ts` — proves the stopped-worker restart; asserts
  readiness by ordering instead of a timing window.
- `apps/web/tests/intelligence-packaging.test.ts` — proves the link repair behaviour.

## Delivered behavior

- The supervisor owns both children. It resolves one set of settings and gives both the same
  explicit mode, host, port, absolute data directory and worker enablement. A relative data
  directory is rejected.
- Readiness is published only after a real HTTP answer, never after the HTTP child's own ready
  claim. The ready record carries the host, port and worker state.
- Shutdown has one shared ten-second deadline. SIGTERM over IPC first, SIGKILL after the deadline.
  A parent disconnect, SIGINT or SIGTERM drains both children.
- An HTTP child failure stops the worker and fails the supervisor. A worker crash keeps HTTP
  alive, restarts at exponential bounded delays and stops restarting after five crashes within ten
  minutes, reporting `unhealthy`.
- A worker whose poll loop stops without exiting is terminated, so it restarts under the same
  bounded policy instead of idling.
- The worker bundle contains no Next, route or React code; only the worker entry starts the
  consumer; importing the composition starts no consumer; every opened handle closes on shutdown.
- Docker keeps one container, one volume, a nonroot user, the supervisor entry point and explicit
  worker asset copies.
- The packaged standalone tree now starts on this host: Next copies pnpm's package links with
  relative targets that Windows cannot follow, `stat` failed with EPERM and the packaged server
  died before serving. The packaging step re-points every unresolvable link at the same absolute
  target, and the packaged supervisor then reaches `ready` and answers HTTP.

## Runtime smoke evidence

All data was synthetic in disposable absolute directories; no live trader data or keys were read.

1. Packaged supervisor startup: `node .next/standalone/apps/web/scripts/run-journal.mjs --mode
production --host 127.0.0.1 --port 34567 --data-dir <absolute disposable dir> --worker enabled`
   printed `{"type":"ready","host":"127.0.0.1","port":34567,"worker":"idle"}` after Next reported
   `Ready in 8.5s`. The worker reported `state: "idle"` with a held lease throughout. Terminating
   the supervisor left no `run-journal`, `http-child` or `worker-entry` process behind.
2. Before the repair the same command failed with `EPERM: operation not permitted, stat ...
styled-jsx` inside `next/dist/server/require-hook.js`, and the packaged tree carried six
   unresolvable links. After the repair the tree carries zero.
3. The independent worker bundle starts from a clean directory whose path contains spaces, writes
   a non-empty `journal.db`, and shuts down over IPC with exit code 0.
4. After the final production rebuild, the packaged supervisor was started again on port 34571
   from the regenerated standalone tree: Next reported `Ready in 8.7s` and the supervisor printed
   `{"type":"ready","host":"127.0.0.1","port":34571,"worker":"idle"}` with the worker holding its
   lease. Stopping the supervisor left no `run-journal`, `http-child` or `worker-entry` process
   behind.

## Executed gates

Node v24.20.0, pnpm 11.0.8, Vitest 3.2.7. No installation or lockfile change was needed.

| Command                                                                                                             | Exit | Result                                                    | Runtime                 |
| ------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------- | ----------------------- |
| `pnpm --filter web typecheck`                                                                                       | 0    | Web route type generation and TypeScript passed           | 45.31 s wall (combined) |
| `pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck`                                 | 0    | Core and importers passed                                 | earlier run, exit 0     |
| `pnpm exec vitest run apps/web/tests/intelligence-supervisor.test.ts apps/web/tests/intelligence-packaging.test.ts` | 0    | 2 files, 22 tests passed                                  | 18.39 s Vitest          |
| `node scripts/check-licenses.mjs`                                                                                   | 0    | Dependency licenses OK                                    | 45.31 s wall (combined) |
| `pnpm --filter web migrations:check`                                                                                | 0    | Migration checksums current                               | earlier run, exit 0     |
| `pnpm build` (root)                                                                                                 | 0    | Production build, worker bundle and static copy completed | 345.04 s wall           |
| `pnpm --filter web build` (re-run after the link repair)                                                            | 0    | Build green with zero skipped packages                    | 173 s wall              |
| `pnpm test` (root, full suite)                                                                                      | 0    | 103 files, 1074 tests passed                              | 102.85 s Vitest         |
| `pnpm exec prettier --check` on every changed file                                                                  | 0    | All matched files use Prettier code style                 | 3.26 s wall             |

Earlier failures, retained transparently:

- First full-suite run: exit 1, one failure. `restarts workers that stop replying to IPC health`
  exceeded its 25 s allowance while five crash cycles of a 2 s liveness window ran under a loaded
  machine.
- Second full-suite run: exit 1, one failure. `gates ready on actual HTTP` asserted the absence of
  a ready message inside a fixed window, which a slow machine can pass over.
- Third full-suite run: exit 1, one failure. The silent-worker test counted fixture start events
  and saw four instead of five, because a worker killed on liveness can die before its start event
  reaches the event log.
- All three were test-fixture timing defects, now replaced by assertions on observable outcomes:
  readiness is checked by ordering against the HTTP child's own listening record, and the
  silent-worker test asserts the published crash sequence and that HTTP still answers. No
  production deadline moved: `probeHttp` is still 1000 ms and the shared shutdown deadline is still
  exactly 10 000 ms.

## Review findings and resolutions

Two independent read-only reviews ran against the change set. Both returned PASS; the second
covered only the delta after the first.

- The supervisor/worker/packaging implementation passed with nine invariant rows verified: the
  10 000 ms shared deadline, the bounded exponential restart with `unhealthy` after five crashes
  per ten minutes, identical explicit child settings, a bundle free of Next and React, the single
  consumer start site, closed handles, the Docker shape, and tests that fail without their repair.
- The link-repair delta passed as well. The reviewer confirmed by read-only probe that an
  unfollowable link is re-created at the same absolute target, that a resolvable link is left
  untouched, that a link whose target is gone is left alone rather than replaced, that the walk
  never leaves the tree it was given, and that the repair changes no package content.
- Reviewer coverage gaps were closed in this dispatch: the missing-target branch and the file-link
  branch now have tests, the untouched-link test asserts the link is still a link, and the
  readiness assertion became ordering-based.
- Three full-suite runs then exposed fixture defects in the supervisor tests themselves: two
  timing-window assertions and one fixture-event count that a worker killed on liveness could
  undershoot. All three were replaced by assertions on observable outcomes. The suite is green.
- Reviewer non-blocking notes are recorded as next inputs rather than code changes: the repair
  does not check that a resolved target stays inside the tree it was given (no such link exists
  today), and the replace is not atomic (a failure aborts the build loudly).

## Deviations and unresolved risks

- The Docker scratch-volume smoke is blocked by the host. Evidence: `docker --version` reports
  `29.6.1`; `docker info` reports `failed to connect to the docker API at
npipe:////./pipe/dockerDesktopLinuxEngine`; the `com.docker.service` Windows service is
  `Status: Stopped`, `StartType: Manual`. The daemon was not started, per the coordinator's
  instruction. No Docker result is claimed. The Dockerfile itself was reviewed for shape only.
- The worker entry still imports the hot-reload singleton module (`@/db/connection`) to reach
  `openConnection`, because that module exports both the singleton and the factory. The singleton
  therefore opens a second handle to the same `journal.db` inside the worker process. No WAL or
  SHM sidecar is ever removed anywhere in `apps/web/src` or `packages`, so the risk the contract
  registers for that import is not realised. Splitting the factory out of the singleton module
  touches `apps/web/src/db/connection.ts` and `apps/web/src/db/transaction.ts`, which belong to the
  schema phases, so this is recorded as the next input rather than changed here.
- The production HTTP child keeps its own ten-second drain timer and relies on Next's installed
  SIGTERM cleanup to acknowledge production shutdown; it deliberately does not report a `stopped`
  message for an open server. The committed test asserts that behaviour.
- The link repair is a host workaround for a packaging defect in the Next standalone output. It is
  idempotent for links that already resolve, and the repaired tree is regenerated by the next
  build.

## Schema, compatibility and next inputs

- Migration allocation: none. No schema, bootstrap, registry or checksum change.
- No dependencies, payload contracts, execution hashes, trade keys, financial methodology,
  annotations, provider endpoints, encrypted credentials or cTrader connectivity changed.
- Rollback: revert the repair commits. The supervisor, worker bundle and Docker startup are new
  artifacts and no persisted data format changes with them.
- Next inputs:
  - Split `openConnection` out of the hot-reload singleton module so the worker bundle never
    loads the singleton.
  - Run the Docker scratch-volume smoke on a host with a running daemon; the packaged supervisor
    and worker must be started from the image with a disposable volume.
  - Consider a containment check in the link repair if a future standalone tree ever ships a link
    pointing outside itself.
  - The coordinator verifies the destination and records `ai-native-journal-integration-10.md`.
