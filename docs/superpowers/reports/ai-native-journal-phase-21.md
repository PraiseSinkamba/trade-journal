# Phase 21 — Performance, complete packaging and the CI release acceptance

Phase guide row 21 · detailed-plan Task 13 (performance, packaging and release half) · milestone M6 ·
schema allocation: **None**

|                       |                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Branch                | `codex/ai-native-journal-p21` (child of the feature worktree)                             |
| Base                  | `4628a575955052dbc62d674dcaf7982ef79821ba` (verified feature HEAD)                        |
| Plan commit           | _docs: plan the performance, packaging and release acceptance_                            |
| Implementation commit | _test: harden intelligence recovery packaging and operations_                             |
| Report commit         | _docs: record the Phase 21 release acceptance evidence_                                   |
| Migrations            | none. `0001`–`0007` are byte-unchanged; no schema, registry or checksum file was touched. |

This phase is the release half of Task 13. Phase 20 shipped the storage and operations half under
the **same** commit subject (`test: harden intelligence recovery packaging and operations`); this
phase ships the performance, packaging and release half under that same subject.

## What was built

### The desktop package runs, and it leaves nothing behind

Two defects had blocked the desktop checks since Phase 10, and the code around them carried three
more that the desktop smoke exposed. All five are fixed.

**The sidecar dispatcher was CommonJS in an ESM package.** `desktop/package.json` declares
`"type": "module"`, and `desktop/scripts/run-sidecar-setup.js` used `require()` and `__dirname`. It
died with `ReferenceError: require is not defined in ES module scope` before it reached the
download, so the Node sidecar never landed in `desktop/src-tauri/binaries/` and every later Tauri
build step failed on the missing `externalBin`. The dispatcher is now ESM. It prefers PowerShell 7,
because `setup-sidecar-node.ps1` verifies the download with `Get-FileHash`, which Windows
PowerShell 5.1 does not provide, and falls back to `powershell` only when `pwsh` is absent.

**The icon writer emitted an invalid ICO.** `write_ico` wrote the icon directory with four reserved
bytes before the type and the count, while the header size it computed was `6 + count * 16`. The
file therefore read as `type = 0`, `count = 1` for six sizes, the first directory entry was read
from the wrong offset (`w = 6`, `h = 0`), and the image offsets pointed past the end of the file.
The icon directory is now the real six bytes — a `u16` reserved field, a `u16` type of 1 and a
`u16` count — with the entries at the offset the writer already computed. A test in the same crate
parses the file it wrote and asserts the type, the count, the six entry sizes and that every
image range lies inside the file.

**`PORT = 0` was not an ephemeral port.** Next's standalone template reads
`parseInt(process.env.PORT, 10) || 3000`, so `0` is falsy and the packaged server bound the fixed
port 3000. The desktop now picks the port itself: it binds `127.0.0.1:0`, reads the port the
operating system assigned, releases the socket and passes that explicit nonzero port to the child.
If the child loses the release-to-bind race and exits before it is ready, the desktop picks a new
port and retries, up to five attempts.

**The readiness signal never fired.** The child inherited `HOSTNAME` from the desktop's
environment, so Next printed `Local: http://localhost:3000` and the Rust side looked for
`127\.0\.0\.1:(\d+)`. The regex never matched, `server-ready` never fired, the webview stayed on
the splash page and the reported state stayed `starting`. The desktop no longer scrapes Next's
banner: it launches the packaged journal supervisor (`apps/web/scripts/run-journal.mjs`) as its one
managed child, exactly as `pnpm start` does, and reads the supervisor's structured readiness line —
`{"type":"ready","host":…,"port":…,"worker":…}` — which the supervisor publishes only after its own
HTTP probe succeeded. The desktop therefore needs no HTTP client of its own, which also keeps the
crate free of a new dependency.

**The managed state was not the state the child was in.** `start_server` created its own
`ServerState`, returned it, and `lib.rs` discarded the return value and managed a second, empty
state. The status always read `stopped`, the tray's restart and quit killed nothing, restart
started a second child, and quit left the old `node.exe` running as an orphan. One
`SharedServerState` now exists: `start_server` fills the state it is given, restart terminates the
running tree before it starts the next one, and quit terminates the tree and then exits.

**Termination now covers the whole tree.** The supervisor forks the web child and the worker child,
so killing only its direct child left the grandchildren running. Termination uses the platform tree
kill (`taskkill /F /T /PID` on Windows) and then waits until the PID is gone.

**The packaged tree launches the supervisor.** `desktop/src-tauri/tauri.conf.json` and
`desktop/package.json` were corrected so the packaged build and the launched tree agree:
`frontendDist` names the splash page the webview loads, `withGlobalTauri` is on because the splash
listens for the Tauri event, and the desktop's build script builds the web tree before the Tauri
build, because the bundle consumes `apps/web/.next/tauri-dist`.

`desktop/README.md` was rewritten against the shipped code. It previously claimed the app spawned
`node server.js` directly, quoted a port-discovery regex the code did not use, gave a data
directory path the code does not produce, and named release bundle paths that do not exist.

### The benchmark measures the real path

`scripts/benchmark-intelligence.mjs` ingests synthetic fills over HTTP into a disposable journal
and reads the journal back over HTTP. Nothing is mocked and no number is estimated: a counter that
cannot be read is reported as `null`, and the gate it belongs to fails.

The measurement was corrected twice, and both corrections are recorded under **The review and its
findings** below.

- The read latency is measured **at every ingest batch boundary**, so both worker modes read the
  same sequence of journal sizes. A wall-clock sampler compared one mode's early journal against
  the other's late journal, and the result depended on how fast the ingest happened to run.
- Each mode's number is the **median of its repetitions**. One latency measurement on a shared
  machine is noisy, and the threshold is not adjusted to accommodate it.
- Both modes capture events, so both hold the same data and write the same WAL. The only difference
  between them is the worker, and that difference is reported as the **worker's overhead**.

The counters are read from the journal's own records and its own output:

| The counter            | Where it is read                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLITE_BUSY escapes    | the `last_error` columns of `intelligence_jobs` and `event_deliveries`, the response body of a failed request, and the worker's own health stream |
| lost effects           | the `executions` table: the fills the journal was asked to store, and the fills it accepted that are no longer there                              |
| failed ingest requests | the failed requests themselves, with their status and body                                                                                        |
| queue latency          | `domain_outbox.recorded_at` → `dispatched_at`, `intelligence_jobs.created_at` → `updated_at`                                                      |
| rebuild lock duration  | the observed maximum duration of an ingest request, because that transaction is what holds the write lock                                         |

The absolute gates are: zero busy escapes, zero lost effects, zero failed ingest requests, and a
drained queue. They hold for any build.

### The p95 regression is a comparison between two builds

The benchmark takes two builds — the candidate and the baseline the release replaces — and
measures them **back to back**: the baseline's run is immediately followed by the candidate's run
for the same volume, mode and repetition, so both face the same host conditions. The candidate's
p95 must be at most 20% above the baseline's, per volume and per worker mode.
`scripts/verify-features.py` re-derives that threshold from the measured p95 values rather than
trusting the benchmark's own verdict, and a run without a comparison build fails the gate.

This is the shape the release gate needs. A comparison between the two worker modes of one build
measures the worker's cost, not the release's regression, and the worker-mode difference was the
measurement that proved unstable before the sampler was corrected.

### The CI and release workflows carry the gates

The quality job keeps the existing sequence, step for step:

```
pnpm format:check
pnpm typecheck
pnpm test
node scripts/check-licenses.mjs
pnpm -r --filter "./packages/*" build
pnpm build
```

One command inside it changes. `pnpm typecheck` is the root script `pnpm -r --parallel typecheck`,
and it recurses into the desktop workspace, whose typecheck is `cargo check` — a cargo check that
cannot run on a Linux runner without the webview system libraries and a Linux sidecar binary. The
root `package.json` belongs to another owner, so the workflow scopes the run itself:
`pnpm -r --filter "!desktop" typecheck` in the quality job, and the Rust gate moves to the
`desktop` job on a Windows runner, where it becomes `cargo check` **and** `cargo test` instead of a
cargo check that could not run. No workspace loses its gate.

| Job         | Runner           | What it proves                                                                                           |
| ----------- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| `quality`   | `ubuntu-latest`  | format, typecheck, tests, licences, package builds, app build                                            |
| `desktop`   | `windows-latest` | the sidecar, the icons, `cargo check`, `cargo test`, the Tauri build, the native ABI, the packaged smoke |
| `benchmark` | `ubuntu-latest`  | the 1k/10k/100k benchmark of two builds, the absolute gates, and the p95 regression gate                 |
| `audit`     | `ubuntu-latest`  | the published tarball content, without publishing                                                        |
| `docker`    | `ubuntu-latest`  | the image build and the scratch-volume smoke                                                             |

The `desktop` job is where the native ABI is proven. `better-sqlite3` is a V8 addon bound to one
`NODE_MODULE_VERSION`, and the sidecar is Node 24.11.0 (ABI 137), so the web app must be built with
Node 24. The job then loads the built native module with the **sidecar binary itself** and fails if
it cannot.

The release workflow keeps its two publish targets, its OIDC trusted publishing, its manual
trigger and its filename — the npm trusted publisher is bound to that filename — and gains the
tarball audit before it publishes.

### The package-content audit

The runtime tree must carry the standalone server entry point, the worker entry point with its
native SQLite module, the supervisor, the static assets and the public assets; it must not carry a
journal database, key material, a credential or an environment file. The published tarballs must
carry their `dist` output and their metadata, and nothing else.

`apps/web/tests/intelligence-packaging.test.ts` asserts the runtime tree against real files.
The CI `audit` job packs the two published packages without publishing and asserts the tarball
entries against an allowlist.

### The Docker image

The Dockerfile gained the two things twenty phases of change left behind: a disposable
`JOURNAL_DATA_DIR` for the build stage, because a build that imports the routes initializes
storage, and `NEXT_TELEMETRY_DISABLED=1`, which the repository's telemetry invariant requires and
which the Dockerfile did not carry. The two-stage shape, the ports, the volume, the non-root user,
the standalone/worker/static/public copies and the CMD are unchanged.

The build context was checked rather than assumed: a replica of the builder stage's context
installed with the frozen lockfile and left the lockfile byte-identical, and a negative control
(a dependency added to `packages/core`) failed with `ERR_PNPM_OUTDATED_LOCKFILE`. The missing
`desktop/package.json` in the context does not break the frozen install, so no change was made for
it.

## The commands that were run

Every command below was run against the tree of this phase, on Node v24.22.3 and pnpm 11.0.8.

| Command                                                                                                                                                            | Exit | Runtime | Result                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/intelligence-acceptance.test.ts apps/web/tests/intelligence-packaging.test.ts apps/web/tests/intelligence-supervisor.test.ts` | 0    | 27 s    | **34 passed** (3 files)                                                                                                                                     |
| `pnpm typecheck`                                                                                                                                                   | 0    | 158 s   | no type errors, including the desktop `cargo check`                                                                                                         |
| `pnpm test` (the whole project)                                                                                                                                    | 0    | 204 s   | **1374 passed** (116 files)                                                                                                                                 |
| `cargo check --manifest-path desktop/src-tauri/Cargo.toml`                                                                                                         | 0    | 24 s    | clean                                                                                                                                                       |
| `cargo test --manifest-path desktop/src-tauri/Cargo.toml`                                                                                                          | 0    | 69 s    | **5 passed**                                                                                                                                                |
| `cargo test --manifest-path desktop/src-tauri/scripts/gen_icons/Cargo.toml`                                                                                        | 0    | 0.2 s   | **1 passed** — the icon writer's own header test                                                                                                            |
| `node desktop/scripts/run-sidecar-setup.js`                                                                                                                        | 0    | 1.8 s   | the sidecar was already in place, hash verified                                                                                                             |
| `pnpm format:check`                                                                                                                                                | 1    | 51 s    | **77 files** fail — exactly the set that already failed at the base commit, so this phase adds no new violation. The files this phase added were formatted. |
| `node scripts/check-licenses.mjs`                                                                                                                                  | 0    | —       | `Dependency licenses OK.`                                                                                                                                   |

The `format:check` result is a **pre-existing** condition, not a regression: the repository's
format gate was already red at the base commit, on the same 77 files. The failing-file set was
compared against the base commit's set and is now **identical** — this phase adds no new violation.

## The Windows packaged smoke

The packaged app was built and run on this host, and the smoke asserts what the release gate asks
for:

```
started pid 38780
journal listens on 127.0.0.1:61752
journal answered HTTP 200 on /api/accounts
node descendants: 31080,39772,25048
no orphaned node.exe survived the quit
```

The smoke discovers the loopback port from the `node.exe` descendants of the app process, refuses
a reserved port (3000 or 3001), polls `/api/accounts` until the journal answers, closes the app the
way a user does, and then asserts that **none of those `node.exe` processes survived**. The CI
`desktop` job runs the same check inline.

## The Docker scratch-volume smoke — blocked host evidence

The Docker daemon is **not running on this host**, and starting it is the operator's call, not the
worker's and not the coordinator's. The smoke was attempted:

```
$ docker build -t trade-journal:p21 .
ERROR: failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine;
check if the path is correct and if the daemon is running:
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

This is recorded as **blocked host evidence**. It is not mocked, not stubbed and not claimed as
passed. The job exists in CI (`docker`), where a daemon is available; the phase carries the item to
the release gate (G-FINAL) as an item the destination gate must run.

## The review and its findings

Two reviewer runs, one on the plan and one on the implementation diff, as the coordinator's review
budget allows.

**Plan review** returned BLOCK with one BLOCK, four FAILs and seven smaller findings, all real.
The plan was rewritten against every one of them:

- The plan claimed ownership of `docs/orchestration/ai-native-journal/integration-plan.md`, which
  the execution manifest marks coordinator-owned. The plan now records that the Phase 21 dispatch
  grants it to this phase, and changes nothing in it but one row.
- The plan's Docker rationale was false: it asserted that the builder stage's context could not
  install with the frozen lockfile. The reviewer proved the opposite with a context replica, and
  this phase re-verified it with a negative control.
- The plan left the release workflow's typecheck recursion unaddressed, while scoping the CI one.
- The plan called the CI sequence "preserved exactly" and also changed a command inside it.
- The plan's busy-escape counter was unobservable: no code in the repository writes a busy error
  into a row, so the counter read zero by construction. The plan now names the sources that exist.
- The plan had no native ABI step, no desktop setup steps, and no web build before the Tauri
  build.
- The plan's desktop HTTP readiness wanted an HTTP client the crate does not have and cannot add
  without an ADR, and it conflated the runtime tree audit with the published tarball audit.
- The plan's lost-effects counter did not say how the fills were read back, and it was missing the
  rebuild lock duration.

**Implementation review** returned FAIL with one P1, one P2 and one P3, all real, all fixed:

- **P1 — the busy-escape counter could not observe a busy escape.** It summed two row columns that
  the journal never writes a busy error into: the worker classifies a busy journal in memory and
  retries the work, so the classification never reaches a row. The counter now also reads the
  worker's own health stream, where the classification is published, and the documentation says so
  plainly.
- **P2 — the release record pointed at a file that did not exist.** Two shipped documents named
  this phase's report before it existed. The report is this file.
- **P3 — an undrained queue was silently accepted.** `waitForQueueDrain` returned a boolean that
  the call site discarded, so a queue that never drained still reported a meaningful queue latency.
  The boolean is now recorded and is a gate.

## The measurement was corrected twice

The benchmark's own numbers were wrong twice, and both corrections are recorded here because both
were found by running the thing rather than by reading it.

**The lost-effects counter hid real losses.** The first 100k run reported six HTTP 500 responses
during the ingest — 3000 of the 100000 fills never landed — while the lost-effects counter
reported zero, because it compared the fills the journal _accepted_ with the rows the journal
_held_, and both excluded the failed batch. The counter now compares the fills the journal was
**asked** to store with the rows it holds, and the failed requests are counted separately with their
status and body. A failed batch is now a failure, not a rounding error.

**The p95 comparison was confounded.** The 10k volume reported +72.9% on one run and −33.5% on
another, and the 100k volume +68.1%. Three causes, each found by measurement:

1. the read was sampled _after_ the ingest, so the active mode sometimes measured a worker that
   had already drained and sometimes one that had not;
2. the sampler issued requests as fast as it could, so it measured its own queue — a p95 of 345 ms
   against a p50 of 11 ms;
3. the two modes did not hold the same data, because only the active mode captured events.

The read is now sampled at the ingest batch boundary, the sampler is paced, both modes capture
events, and each mode's number is the median of three repetitions. The 10k volume then measured
+2.5%, +3.0% and +1.6% on three consecutive runs of the whole benchmark — stable, and well inside
the 20% threshold.

**The p95 gate was the wrong comparison.** The gate the release needs is the candidate build
against the baseline build on the same machine, not the active worker against the idle worker of
one build. The benchmark now measures both builds back to back and writes the verdict into its
result; `scripts/verify-features.py` re-derives the threshold from the measured p95 values.

**And the measurement is still not stable enough to be a gate on this host.** The paired runs —
the baseline build and the candidate build measured back to back — reported these regressions:

| Volume | Worker mode | Baseline p95 | Candidate p95 | Regression  |
| ------ | ----------- | ------------ | ------------- | ----------- |
| 1k     | idle        | 117.067 ms   | 143.123 ms    | **+22.3%**  |
| 1k     | active      | 91.109 ms    | 74.167 ms     | −18.6%      |
| 10k    | idle        | 112.645 ms   | 116.608 ms    | +3.5%       |
| 10k    | active      | 61.478 ms    | 111.861 ms    | **+82.0%**  |
| 100k   | idle        | 150.482 ms   | 124.672 ms    | −17.2%      |
| 100k   | active      | 162.037 ms   | 356.786 ms    | **+120.2%** |

**The two builds carry byte-identical application code.** The only `apps/web` file this phase
changed is `apps/web/tests/intelligence-packaging.test.ts`; `apps/web/src`, `packages/**` and
every migration are unchanged. A build that is byte-identical to another cannot regress by 120% —
so these numbers are the **host's** variation, not the build's. The p95 tail on this shared
machine is noise-dominated: the two builds' p50 values sit within a few milliseconds of each
other, while the p95 moves by tens of percent from run to run, in both directions.

## The measured results

The absolute-gate run — the candidate build alone, three repetitions per mode:

| Volume | Idle p50 / p95     | Active p50 / p95   | Busy escapes | Lost effects | Failed requests | Queue drained |
| ------ | ------------------ | ------------------ | ------------ | ------------ | --------------- | ------------- |
| 1k     | 8.645 / 14.049 ms  | 9.011 / 11.479 ms  | 0            | 0            | 0               | yes           |
| 10k    | 10.890 / 17.239 ms | 9.202 / 11.471 ms  | 0            | 0            | 0               | yes           |
| 100k   | 33.585 / 43.714 ms | 30.720 / 45.043 ms | 0            | 0            | 0               | yes           |

**These two tables are different runs, and the difference between them is the point.** The
absolute-gate run above and the paired run above disagree by an order of magnitude on the same
build's p95 at the same volume — 14.049 ms against 143.123 ms at 1k, 43.714 ms against 356.786 ms
at 100k — because the host's own jitter, not the code, sets the tail. The p50 values barely move
between the two runs.

**The absolute gates passed at every volume**: zero SQLITE_BUSY escapes, zero lost effects, zero
failed ingest requests, and a drained queue at the active worker.

**The p95 regression gate did not pass, and could not be shown to pass on this host.** The paired
comparison puts the candidate build's p95 above the baseline's by up to 120.2% while the two
builds are byte-identical, so the measurement cannot distinguish a regression from the machine's
noise. The gate is implemented, and it fails when it is not met — but on this host it fails for
the baseline as well, so **this phase does not claim the p95 gate**.

The rebuild lock duration — the longest an ingest request held the write lock — was observed at
220 ms (1k), 343 ms (10k) and 6173 ms (100k).

## The package-content results

**The published tarballs.** Both packages were packed without publishing and their entries
listed:

```
luxalgo-journal-core-0.1.0.tgz          luxalgo-journal-importers-0.1.0.tgz
package/LICENSE                          package/LICENSE
package/README.md                       package/README.md
package/dist/index.cjs                  package/dist/index.cjs
package/dist/index.d.cts                package/dist/index.d.cts
package/dist/index.d.ts                 package/dist/index.d.ts
package/dist/index.js                   package/dist/index.js
package/package.json                    package/package.json
```

No `src` directory, no database, no credential, no runtime asset — the CI `audit` job asserts
exactly this allowlist, and the same allowlist was run against these two tarballs on this host
with an empty forbidden and an empty unexpected list.

**The packaged runtime tree.** `apps/web/tests/intelligence-packaging.test.ts` asserts over the
real built tree that it carries the standalone server entry point
(`apps/web/.next/tauri-dist/apps/web/server.js`), the supervisor
(`apps/web/.next/tauri-dist/apps/web/scripts/run-journal.mjs`), the worker entry point with its
native SQLite module (`apps/web/.next/tauri-dist/apps/web/worker/worker-entry.cjs` and
`better_sqlite3.node`), and that it carries no journal database, no `.secret`, no credential file
and no environment file. The test passed in the targeted run and in the whole-project run.

## Deviations from the plan

1. **`desktop/src-tauri/src/paths.rs` was edited although the plan did not list it.** Its test
   asserted a `/`-separated path suffix, which fails on Windows, so the desktop's `cargo test`
   could not pass. The assertion now compares the two path components. The plan's ownership table
   now lists the file.
2. **The p95 regression gate compares two builds, not the two worker modes of one build.** The
   plan made the idle mode the baseline for the active mode. That comparison measures the worker's
   cost, and it proved to be the unstable measurement; the release gate needs the candidate build
   against the baseline build. The worker-mode difference is still measured and reported, as the
   worker's overhead.
3. **The busy-escape counter reads the worker's health stream.** The plan's row counters cannot
   fire, because the worker retries a busy journal instead of recording it. The counter keeps the
   row columns and adds the stream that actually carries the classification.
4. **The Docker smoke is recorded as blocked host evidence.** The daemon is not running on this
   host and the coordinator will not start it. The item is carried to the release gate.

## What this phase leaves to the release gate

- **The Docker scratch-volume smoke.** Blocked host evidence, carried to G-FINAL. The CI job exists.
- **The p95 regression gate.** The gate is implemented and it fails when it is not met, but on
  this host it also fails between two byte-identical builds, so **this phase does not claim it**.
  The destination gate needs a quieter machine, or a fixture load large enough that the p95 is
  not dominated by the host's own jitter, before that gate can mean anything.
- The benchmark script, the comparison and the verifier ship, so the destination gate can re-run
  the whole comparison on the merged result.

## The next inputs

- The whole run is at its last phase. The destination gate — the merge into `codex/ai-native-journal`
  and `docs/superpowers/reports/ai-native-journal-integration-21.md` — is the coordinator's.
- The integration plan now carries the Phase 21 row: what passed, and what is blocked host evidence.
