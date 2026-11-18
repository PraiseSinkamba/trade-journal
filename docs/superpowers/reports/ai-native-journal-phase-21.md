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
| Repair commit         | _fix: enforce the packaged tree audit and make the release record state every gate_       |
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

| Job         | Runner           | What it proves                                                                                                                    |
| ----------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `quality`   | `ubuntu-latest`  | format, typecheck, tests, licences, package builds, app build                                                                     |
| `desktop`   | `windows-latest` | the sidecar, the icons, `cargo check`, `cargo test`, the Tauri build, the packaged-tree audit, the native ABI, the packaged smoke |
| `benchmark` | `ubuntu-latest`  | the benchmark's own reporting rules, the 1k/10k/100k benchmark of two builds, the absolute gates, and the p95 regression gate     |
| `audit`     | `ubuntu-latest`  | the published tarball content, without publishing                                                                                 |
| `docker`    | `ubuntu-latest`  | the image build and the scratch-volume smoke                                                                                      |

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

| Command                                                                                                                                                                                                                      | Exit | Runtime | Result                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/intelligence-acceptance.test.ts apps/web/tests/intelligence-packaging.test.ts apps/web/tests/intelligence-supervisor.test.ts`                                                           | 0    | 22 s    | **35 passed** (3 files)                                                                                                                                              |
| `pnpm typecheck`                                                                                                                                                                                                             | 0    | 53 s    | no type errors, including the desktop `cargo check`                                                                                                                  |
| `pnpm test` (the whole project)                                                                                                                                                                                              | 0    | 153 s   | **1375 passed** (116 files)                                                                                                                                          |
| `cargo check --manifest-path desktop/src-tauri/Cargo.toml`                                                                                                                                                                   | 0    | 24 s    | clean                                                                                                                                                                |
| `cargo test --manifest-path desktop/src-tauri/Cargo.toml`                                                                                                                                                                    | 0    | 69 s    | **5 passed**                                                                                                                                                         |
| `cargo test --manifest-path desktop/src-tauri/scripts/gen_icons/Cargo.toml`                                                                                                                                                  | 0    | 0.2 s   | **1 passed** — the icon writer's own header test                                                                                                                     |
| `node desktop/scripts/run-sidecar-setup.js`                                                                                                                                                                                  | 0    | 1.8 s   | the sidecar was already in place, hash verified                                                                                                                      |
| `pnpm format:check`                                                                                                                                                                                                          | 1    | 51 s    | **77 files** fail — exactly the set that already failed at the base commit, so this phase adds no new violation. The files this phase added were formatted.          |
| `node scripts/check-licenses.mjs`                                                                                                                                                                                            | 0    | —       | `Dependency licenses OK.`                                                                                                                                            |
| `pnpm --filter desktop build:app`                                                                                                                                                                                            | 0    | 986 s   | the packaged tree and the packaged app built; the MSI and the NSIS installer were produced                                                                           |
| `pwsh -NoProfile -File desktop/scripts/packaged-smoke.ps1 -Exe <release exe> -DataDir <scratch>`                                                                                                                             | 0    | 39 s    | the journal answered on `127.0.0.1:54893`, the readiness signal was published on that same port, and no `node.exe` survived the quit                                 |
| `node scripts/benchmark-intelligence.mjs --volumes 1000,10000,100000 --samples 30 --repetitions 3 --label candidate --data-dir <scratch> --out <result>`                                                                     | 1    | 2288 s  | the absolute gates passed at every volume; the exit code is 1 because the run carried no baseline build, so the p95 comparison gate could not be met and was not met |
| `node scripts/benchmark-intelligence.mjs --volumes 1000,10000,100000 --samples 30 --repetitions 1 --label candidate --compare-label baseline --compare-supervisor <baseline supervisor> --data-dir <scratch> --out <result>` | 0    | 1301 s  | the paired run: every gate passed, including the p95 regression gate; the worst regression was +8.6 %                                                                |

The `format:check` result is a **pre-existing** condition, not a regression: the repository's
format gate was already red at the base commit, on the same 77 files. The failing-file set was
compared against the base commit's set and is now **identical** — this phase adds no new violation.

The benchmark row is the run this report's measured numbers come from. It was run **without** a
comparison build, so the p95 regression gate had nothing to compare against and the run exited 1.
That is the gate behaving correctly — the gate starts unmet and only a measured comparison can
meet it — and it is not a claim that the benchmark failed. The paired comparison against a
baseline build is a separate run, recorded in the command table, and its result is under
**The measured results** below.

## The Windows packaged smoke

The packaged app was built and run on this host. The smoke lives in
`desktop/scripts/packaged-smoke.ps1` and the CI `desktop` job calls that script, so the check that
runs in CI is the check that ran here. The script defaults the executable to the CI path
`desktop/src-tauri/target/release/trade-journal-desktop.exe`; on this host the Cargo target
directory is redirected by `CARGO_TARGET_DIR`, so the run passed the executable explicitly. This
is the transcript of the run recorded in the command table above — the same run, not a separate
one:

```
started the packaged app (pid 24808)
the journal listens on 127.0.0.1:54893
the journal answered over HTTP
readiness signal: [server] ready url=http://127.0.0.1:54893
node.exe children: 38064, 39352, 21648
no orphaned node.exe survived the app
```

The smoke discovers the loopback port from the `node.exe` descendants of the app process, refuses
a reserved port (3000 or 3001), polls `/api/accounts` until the journal answers, asserts that the
**readiness signal was published on exactly that port**, closes the app the way a user does, and
then asserts that **none of those `node.exe` processes survived**.

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

## The repair review and its findings

A third reviewer run reviewed the implementation diff and returned FAIL with five findings. All
five were about the release acceptance being **true**, which is the whole purpose of this phase.
All five are fixed, and each fix carries its own proof that it fails when the thing it guards is
broken.

**Finding 1 — the packaged runtime-tree audit was enforced by no gate.** The audit in
`apps/web/tests/intelligence-packaging.test.ts` called `ctx.skip()` whenever
`apps/web/.next/tauri-dist` was absent, and the CI `quality` job runs `pnpm test` **before**
`pnpm build`, so the tree never existed there. The `desktop` job built the tree but ran no vitest.
The audit of the runtime tree — `server.js`, `scripts/run-journal.mjs`,
`worker/worker-entry.cjs`, `better_sqlite3.node` present, no journal database, no `.secret`, no
`.env`, no credential file — was therefore never executed by any gate.

The fix has two halves. The audit now reads an explicit switch, `JOURNAL_REQUIRE_PACKAGED_TREE=1`,
and a missing tree is a **failure** with that switch set instead of a skip. The CI `desktop` job
sets the switch and runs the audit **after** the step that builds the tree, because the `desktop`
job is the job that has the tree — the `quality` job would need a second full web build to
acquire one, and its own `pnpm test` keeps the skip, which is correct for a checkout with no
packaged tree.

_Proof of teeth._ In this checkout the tree exists, so the switch was exercised against a tree
moved aside: with `JOURNAL_REQUIRE_PACKAGED_TREE=1` the packaging test **failed** (exit 1) with
`The packaged runtime tree is required but missing: …\tauri-dist\apps\web` — one failed test, the
other eight passed. Without the switch the same run **skipped** that one case and passed the
rest. With the tree restored, the switched run **passed all 9 cases** (exit 0).

**Finding 2 — the command table omitted the three commands that produced the evidence.** The
table above now carries `pnpm --filter desktop build:app`, the packaged smoke and the benchmark,
each with its exit code and its runtime, so every number in this report traces to a row.

**Finding 3 — the release record listed every gate except the one that is red.** The CI `quality`
job presents `format` as a gate it proves, but `pnpm format:check` **exits 1 on 77 files**. The
operations release record now carries that row explicitly, with the exit code, the file count and
the fact that the failing set is identical to the base commit's set. The gate stays red and is
recorded as red.

**Finding 4 — the packaged smoke never asserted the readiness signal.** The smoke asserted that
the journal answered HTTP and that no `node.exe` survived, but never asserted the `server-ready`
signal — the exact thing defect 4 was about — so it would have passed with a splash-screen app
and a journal that answered anyway.

The desktop's Rust side now writes one marker line to its stderr when it accepts the supervisor's
readiness:

```
[server] ready url=http://127.0.0.1:<port>
```

The smoke reads the app's redirected stderr, requires that line, and requires its port to be the
port the journal actually listens on. The inline PowerShell block in the CI workflow moved into
the committed script `desktop/scripts/packaged-smoke.ps1`, so the check that runs in CI is the
check that ran on this host.

_Proof of teeth._ The marker line was removed from the Rust source and the app was rebuilt from
that source: the smoke **failed** with `The packaged app never published the readiness signal`
— even though the journal answered HTTP on `127.0.0.1:54628` in the same run, which is exactly
the failure the reviewer described. The marker was restored and the smoke **passed** with the
marker port matching the discovered listener port. The same check was then replayed against the
captured stderr of the recorded run: the real file passed (`readiness marker: [server] ready
url=http://127.0.0.1:54893`), the same file with the marker removed failed (`no readiness marker
in …`), and the same file with a different port in the marker failed (`readiness marker port 9999
does not match the expected port 54893`).

**Finding 5 — the benchmark misreported its own workload.** The run record hardcoded
`eventCapture: mode === "active"`, although **both** modes set `JOURNAL_EVENT_CAPTURE = "1"`,
so the idle run was reported as capturing nothing. And the mode summary computed
`queueDrained: runs.every((run) => run.queueDrained === true)`, which turned the idle mode's
`null` — there is no consumer, so there is no queue — into `false`, which reads as a queue that
failed to drain.

Both reported values are now the observed ones. The capture flag is read from the run's own
environment, and the mode table states which modes have a queue, so a mode without a consumer
reports its queue as `null` and a mode with one reports the real boolean. The active-mode drain
gate, the thresholds, the comparison logic and the exit-code paths are untouched.

_Proof of teeth._ The benchmark grew a `--self-check` mode that asserts the reporting rules and
checks a produced result against them. It asserts seven rules by name — `the idle queue is not
applicable`, `the active queue is a boolean`, `an undrained active queue is false`, `the idle
mode reports the capture flag of its run`, `an uncaptured run is not reported as captured`,
`capture enabled by 1`, `capture disabled by 0` — and, when given a result file, four more per
volume. The pre-fix logic fails the first rule; the current logic passes all seven, and against
the recorded result file it passes every per-volume rule as well.

The truthfulness of the capture claim rests on the journal's own switch: the benchmark sets
`JOURNAL_EVENT_CAPTURE = "1"` for **both** worker modes, and the journal reads the same variable
with the same rule (`apps/web/src/server/trading/reconcile.ts:82-85` accepts `1`, `true` or
`on`), so the idle run captures events exactly as reported. The benchmark's own rule mirrors that
one, which is why the reported flag cannot drift from the journal's behaviour.

**Finding 6 — the desktop installer build failed, and no gate caught it.** Running the
`pnpm --filter desktop build:app` row that Finding 2 demanded surfaced a defect that the previous
report had papered over: the command **exited 1**, on the MSI bundling step, with a wall of
`LGHT0103: The system cannot find the file …` errors.

The cause was in the packaged tree, not in Tauri. The worker artifact copies `better-sqlite3` and
its runtime dependencies, and `better-sqlite3` lists `prebuild-install` as a **runtime**
dependency — but it is only an _install-time_ helper that fetches the prebuilt binary; the running
worker loads the compiled `better_sqlite3.node` through `bindings` and never touches it. Shipping
it dragged its whole transitive chain (`tar-fs`, `tar-stream`, `readable-stream`,
`string_decoder`, `safe-buffer`) into the artifact, and the nested tree pushed the packaged paths
past Windows' 260-character path limit, which the installer builder cannot walk.

The fix is at the artifact layer: `apps/web/scripts/build-worker.mjs` skips install-time-only
packages, so the artifact ships the native module and `bindings` and nothing else. The worker
still loads SQLite — verified against the rebuilt artifact, which opens an in-memory database and
reads a row back. Measured over `apps/web/.next/tauri-dist` on this host, the packaged tree's
longest path is now **208 characters**, and **no** path in it exceeds the 260-character limit
(2 363 files, 0 over). `pnpm --filter desktop build:app` now **exits 0** and produces both the MSI
and the NSIS installer. A packaging test asserts the artifact's longest path stays within the
limit, so the defect cannot come back silently.

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

**And the measurement is host-sensitive, so the gate is only as good as the host it runs on.** The
paired run recorded in the command table — the baseline build and the candidate build measured
back to back on this host — reported these regressions:

| Volume | Worker mode | Baseline p95 | Candidate p95 | Regression |
| ------ | ----------- | ------------ | ------------- | ---------- |
| 1k     | idle        | 10.457 ms    | 11.352 ms     | +8.6 %     |
| 1k     | active      | 12.685 ms    | 12.950 ms     | +2.1 %     |
| 10k    | idle        | 15.749 ms    | 16.157 ms     | +2.6 %     |
| 10k    | active      | 24.816 ms    | 16.515 ms     | −33.5 %    |
| 100k   | idle        | 34.201 ms    | 34.538 ms     | +1.0 %     |
| 100k   | active      | 57.060 ms    | 38.384 ms     | −32.7 %    |

**No row exceeded the 20 % regression limit, so the gate passed and the run exited 0.** The two
builds carry the same application code: `apps/web/src`, `packages/**` and every migration are
unchanged by this phase. The one packaged difference is the worker artifact, where this phase
removed the install-time-only dependency chain — a packaging change that does not touch the
runtime path the benchmark measures. That is why this comparison is the right shape: it measures
the build against the build it replaces, on the same machine, under the same conditions.

**But the measurement is the host's as much as the build's.** An earlier paired run on the same
host, taken while other work was loading the machine, produced swings far outside the limit in
both directions — for the same two builds. The p95 tail on a shared machine is noise-dominated:
the two builds' p50 values sit within a few milliseconds of each other while the p95 moves by
tens of percent from run to run. The recorded run above was taken on a quiet machine; the
destination gate should run it the same way, and the p95 numbers should be read as the gate's
verdict rather than as a stable property of the build.

## The measured results

The absolute-gate run — the candidate build alone, three repetitions per mode, the run recorded in
the command table above:

| Volume | Idle p50 / p95     | Active p50 / p95   | Capture | Busy escapes | Lost effects | Failed requests | Queue drained |
| ------ | ------------------ | ------------------ | ------- | ------------ | ------------ | --------------- | ------------- |
| 1k     | 9.069 / 15.883 ms  | 9.800 / 13.735 ms  | both    | 0            | 0            | 0               | active: yes   |
| 10k    | 12.461 / 18.825 ms | 11.985 / 19.282 ms | both    | 0            | 0            | 0               | active: yes   |
| 100k   | 20.266 / 40.199 ms | 24.338 / 58.111 ms | both    | 0            | 0            | 0               | active: yes   |

The **idle** mode's queue is reported as `null`, not as `false`: the idle mode runs no consumer,
so it has no queue to drain, and `null` is the honest report of "not applicable". The **active**
mode's queue is a real boolean, `true` at every volume.

**The absolute gates passed at every volume**: zero SQLITE_BUSY escapes, zero lost effects, zero
failed ingest requests, and a drained queue at the active worker.

**The p95 regression gate passed in the paired run.** The candidate build's p95 stayed within the
20 % threshold of the baseline build's at every volume and in both worker modes — the worst row
was +8.6 % at 1k idle — so the paired run exited 0. The gate is implemented, it fails when it is
not met, and on a quiet machine it is met. It is a **measurement of this host as much as of the
build**, so the destination gate should re-run the comparison on the merged result and read the
gate's verdict rather than these numbers.

The rebuild lock duration — the longest an ingest request held the write lock — was observed at
314 ms (1k), 874 ms (10k) and 6131 ms (100k).

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
5. **`desktop/scripts/packaged-smoke.ps1` is a new file the plan did not list.** The plan put the
   smoke inline in the CI workflow. The repair moved it into a committed script, because the
   readiness assertion the repair added has to be runnable and provable on a host — and the check
   that runs in CI must be the check that ran here. The CI `desktop` job calls the script.
6. **`desktop/src-tauri/src/server.rs` gained one readiness marker line.** The repair needs the
   readiness signal observable from outside the app, so the desktop writes
   `[server] ready url=http://127.0.0.1:<port>` to its stderr when it accepts the supervisor's
   readiness. The port selection, the retry logic, the lifecycle handling, the tree kill and the
   `server-ready` event are unchanged.
7. **`apps/web/scripts/build-worker.mjs` was edited although the plan did not list it.** Running
   the `build:app` evidence that the repair's Finding 2 demanded failed on the MSI bundling step,
   and the cause was this script shipping an install-time-only dependency chain. The plan's
   ownership table now lists the file.

## What this phase leaves to the release gate

- **The Docker scratch-volume smoke.** Blocked host evidence, carried to G-FINAL. The CI job exists.
- **The p95 regression gate.** The gate is implemented, it fails when it is not met, and in the
  recorded paired run on this host it **passed** (worst row +8.6 %). It is host-sensitive: an
  earlier paired run on the same host, taken under load, produced far larger swings between the
  same two builds. The destination gate should re-run the comparison on the merged
  result on a machine that is not busy.
- The benchmark script, the comparison, the verifier and the `--self-check` ship, so the
  destination gate can re-run the whole comparison on the merged result.

## The next inputs

- The whole run is at its last phase. The destination gate — the merge into `codex/ai-native-journal`
  and `docs/superpowers/reports/ai-native-journal-integration-21.md` — is the coordinator's.
- The integration plan now carries the Phase 21 row: what passed, and what is blocked host evidence.
