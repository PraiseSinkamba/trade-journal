# Phase 21 — Performance, complete packaging and the CI release acceptance

Plan of record for T-021. Scope: the phase guide's Phase 21 row — "Remainder of Task 13" — with
schema allocation **None**. No migration, no `schema.ts` change, no registry or checksum change.
`0001`–`0007` stay byte-unchanged.

This is the release half of Task 13. Phase 20 shipped the storage and operations half under the
same Task 13 commit subject (`test: harden intelligence recovery packaging and operations`); this
phase ships the performance, packaging and release half.

## Objective

1. **The desktop package actually runs.** The two defects that blocked the desktop checks since
   Phase 10 are fixed, and the supervision defects found in the same code are fixed with them, so
   the packaged app starts, the journal opens, and quit leaves no orphan process.
2. **A measured benchmark.** 1k, 10k and 100k synthetic fills against the real HTTP path, with
   p50 and p95 recorded, in disposable scratch journals, with the SQLITE_BUSY and lost-effect
   counts read from the journal's own records.
3. **A package-content audit.** What the packaged tree contains, recorded as a result.
4. **CI and release workflows that carry this repository's gates** after twenty phases of change,
   without a weakened gate.
5. **A release acceptance record** that separates what passed from what was blocked.

## Ownership

| File                                                       | Change                                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `desktop/scripts/run-sidecar-setup.js`                     | fix: ESM dispatcher (the Phase 10 blocker)                                                               |
| `desktop/src-tauri/scripts/gen_icons/src/main.rs`          | fix: the ICO writer, plus its own header test                                                            |
| `desktop/src-tauri/src/server.rs`                          | fix: supervised child, explicit nonzero port, collision retry, structured readiness, tree termination    |
| `desktop/src-tauri/src/lib.rs`                             | fix: one managed `SharedServerState`, restart, quit                                                      |
| `desktop/src-tauri/src/paths.rs`                           | fix: its Windows-only path assertion, which failed `cargo test`                                          |
| `desktop/src-tauri/tauri.conf.json`                        | fix: the packaged tree the desktop actually launches                                                     |
| `desktop/package.json`                                     | fix: the workspace scripts the desktop build and the gates need                                          |
| `desktop/README.md`                                        | the truth about the packaged lifecycle                                                                   |
| `scripts/benchmark-intelligence.mjs`                       | new: the 1k/10k/100k benchmark and the paired baseline comparison                                        |
| `scripts/verify-features.py`                               | extend: the package-content and benchmark-result checks                                                  |
| `apps/web/tests/intelligence-packaging.test.ts`            | extend: the packaging and release assertions                                                             |
| `.github/workflows/ci.yml`                                 | extend: the desktop, benchmark, audit and Docker gates                                                   |
| `.github/workflows/release.yml`                            | extend: the release keeps its publish targets and gains the audit gate                                   |
| `Dockerfile`                                               | fix: the build-time data dir and the telemetry flag                                                      |
| `docs/intelligence-operations.md`                          | extend: the benchmark, the package audit and the release record                                          |
| `docs/orchestration/ai-native-journal/integration-plan.md` | extend: the Phase 21 row of the merged-feature run record (coordinator-granted in the Phase 21 dispatch) |
| `docs/superpowers/plans/ai-native-journal/phase-21.md`     | this plan                                                                                                |
| `docs/superpowers/reports/ai-native-journal-phase-21.md`   | the phase report                                                                                         |

No other file changes. `apps/web/src/**`, `packages/**`, `db/schema.ts`, `db/migrations.ts`, the
checksum artifact, the root and web `package.json`, and the lockfile are untouched: this phase
measures and packages what twenty phases built, it does not change what they built.

The integration plan is outside the packet's ownership list and the execution manifest marks it
coordinator-owned. The Phase 21 dispatch brief grants it to this phase explicitly, so this phase
adds one row to it and changes nothing else in it.

## The desktop defects

### 1. The sidecar dispatcher is CommonJS in an ESM package

`desktop/package.json` declares `"type": "module"`, and `desktop/scripts/run-sidecar-setup.js`
uses `require()` and `__dirname`. The dispatcher dies with
`ReferenceError: require is not defined in ES module scope` before it reaches the download, so the
Node sidecar binary never lands in `desktop/src-tauri/binaries/`, and every later Tauri build step
fails on the missing `externalBin`.

Fix: the dispatcher uses `import` and `import.meta.url`. Nothing else about it changes — it still
picks the platform script, still refuses a missing script, still exits with the child's code.

### 2. The ICO writer emits an invalid file

`desktop/src-tauri/scripts/gen_icons/src/main.rs` writes the icon directory with four reserved
bytes before the type and count, so the file is read as `type = 0`, `count = 1` for six sizes, the
first directory entry is read from the wrong offset (`w = 6`, `h = 0`), and the image offsets point
past the end of the file. Windows cannot load the tray icon or the bundle icon from it.

Fix: the icon directory is six bytes — a `u16` reserved field, a `u16` type of 1, and a `u16`
count — and the entries follow it at offset `6 + count * 16`, which is the offset the writer
already computes. The image payloads are unchanged.

A test in the same crate parses the file it wrote and asserts the type, the count, the six entry
sizes, and that every entry's image range lies inside the file.

### 3. `PORT = 0` is not an ephemeral port

Next's standalone template reads `parseInt(process.env.PORT, 10) || 3000`, so `PORT = 0` is falsy
and the packaged server binds the fixed port 3000. A second instance fails with `EADDRINUSE`.

Fix: the desktop picks the port itself. It binds `127.0.0.1:0`, reads the assigned port, releases
the socket, and passes that explicit nonzero port to the child. If the port is taken between the
release and the child's bind, the child exits and the desktop picks a new port, up to five
attempts, before it reports the failure.

### 4. The readiness signal never fires

The child inherits `HOSTNAME` from the desktop's environment, so Next prints
`Local: http://localhost:3000`, and the Rust side looked for `127\.0\.0\.1:(\d+)`. The regex never
matched, so `server-ready` never fired, the webview stayed on the splash page, and the reported
state stayed `starting`.

Fix: the desktop no longer scrapes Next's banner. It launches the packaged journal supervisor
(`apps/web/scripts/run-journal.mjs`) as its one managed child, exactly as `pnpm start` does. The
supervisor publishes its readiness as a structured JSON line on standard output
(`{"type":"ready","host":…,"port":…,"worker":…}`) and publishes it only after its own HTTP probe
against the child has returned a response (`run-journal.mjs:198-206`, `:204`). The desktop reads
that line, so the readiness it reports is already backed by a real HTTP response, and the desktop
needs no HTTP client of its own — which also keeps the crate free of a new dependency.

The supervisor binds the child to `127.0.0.1` on the explicit port it was given, so the packaged
journal listens on loopback only.

### 5. The managed state is not the state the child is in

`start_server` created its own `ServerState`, returned it, and `lib.rs` discarded the return value
and managed a second, empty state. The tray's restart and quit therefore killed nothing, restart
started a second child, and quit left the old `node.exe` running as an orphan.

Fix: one `SharedServerState` exists. `start_server` fills the state it is given, and `lib.rs`
manages that one state. Restart terminates the running child before it starts the next one; quit
terminates the child and then exits the application.

### 6. Termination covers the whole tree

The supervisor forks the web child and the worker child, so killing only the supervisor's direct
child leaves the grandchildren running. Termination uses the platform tree kill
(`taskkill /F /T /PID` on Windows) and then waits for the child to be gone.

### 7. The packaged tree launches the supervisor

`tauri.conf.json` maps the packaged resources today, but the desktop looked for
`apps/web/server.js` and started Next directly — which bypasses the supervisor, so the worker
never ran inside the desktop and the shutdown was never owned. The desktop now launches
`apps/web/scripts/run-journal.mjs`, which the packaged tree carries next to the server entry
point, and which owns the web child and the worker child.

## The benchmark

`scripts/benchmark-intelligence.mjs` measures the real path: synthetic fills are ingested over
HTTP into a disposable journal, and the read latency is measured over HTTP against the same
journal.

| Volume | Synthetic fills                         |
| ------ | --------------------------------------- |
| 1k     | one thousand fills, one account         |
| 10k    | ten thousand fills, one account         |
| 100k   | one hundred thousand fills, one account |

For each volume and for each worker mode (`idle` and `active`):

- a fresh scratch `JOURNAL_DATA_DIR`, absolute and disposable;
- a fresh journal on a loopback port that is neither 3000 nor 3001;
- the fills are ingested through `POST /api/executions`, in batches, with distinct prices and
  timestamps so the journal's own deduplication does not silently discard the fixture;
- the read latency is measured against `GET /api/trades?view=list&accounts=<id>` — the endpoint
  that filters and computes the metrics over every trade of the account — **at every ingest batch
  boundary**, so both modes read the same sequence of journal sizes;
- p50 and p95 are reported per volume and per worker mode, as the **median of the repetitions**,
  because one latency measurement on a shared machine is noisy.

**Idle** is the supervisor with the worker disabled; **active** is the supervisor with the worker
enabled. Both capture events, so both hold the same data and write the same WAL: the only
difference between them is the worker. The difference between the two modes is reported as the
**worker's overhead**, and it is not the release gate.

The gate counters are read from the journal's own records, not from a log line that does not
exist:

- **SQLITE_BUSY escapes** — the busy errors the journal itself records: the `last_error` columns
  of `intelligence_jobs` and `event_deliveries`, the response body of a failed request, and the
  worker's own health stream, where a busy journal is classified in memory and retried rather than
  written to a row. The gate is zero.
- **Lost effects** — the fills the journal was asked to store, read back from the journal's own
  `executions` table, and the fills it accepted that are no longer there. The gate is zero for
  both.
- **Failed ingest requests** — a batch that failed is a failure, not a rounding error. The gate
  is zero.
- **Queue drained** — the active worker consumed its own backlog. The gate is that it did.
- **Rebuild lock duration** — the wall-clock duration of the ingest request that carries the
  insert-and-rebuild transaction, reported as the observed maximum, because that transaction is
  what holds the write lock.

The **p95 regression** is a comparison between two **builds**: the baseline build the release
replaces and the candidate build being released. The two are measured **back to back** — the
baseline's run is immediately followed by the candidate's run for the same volume, mode and
repetition — so both face the same host conditions and the difference is the build's rather than
the machine's. Two builds measured hours apart on a shared machine differ by the machine.

The candidate's p95 must be at most 20% above the baseline's, per volume and per worker mode.
`scripts/benchmark-intelligence.mjs` writes both builds' numbers and the verdict into one JSON
result; `scripts/verify-features.py` fails when the absolute gates or the comparison miss.

The benchmark's verdict is therefore a gate in CI rather than a number in a document.

## The package-content audit

The audit answers one question with a result: does the packaged tree contain what the run needs,
and does it avoid what it must not? The two trees are audited separately, because their rules
differ.

**The runtime tree** — the web image and the desktop bundle:

| The runtime tree must contain                | The runtime tree must not contain   |
| -------------------------------------------- | ----------------------------------- |
| the standalone server entry point            | a journal database                  |
| the worker entry point and its native SQLite | key material or a secret            |
| the supervisor                               | an intelligence source file         |
| the static assets and the public assets      | a credential or an environment file |

**The published tarballs** — `@luxalgo/journal-core` and `@luxalgo/journal-importers`, inspected
with `pnpm pack` and never published: each tarball carries its `dist` output and its metadata, and
nothing else. No `src`, no database, no credential, no runtime asset.

## The CI and release workflows

The quality job keeps the existing sequence, step for step:

```
pnpm format:check
pnpm typecheck
pnpm test
node scripts/check-licenses.mjs
pnpm -r --filter "./packages/*" build
pnpm build
```

The sequence's _steps_ are unchanged; one command inside it changes. `pnpm typecheck` is the root
script `pnpm -r --parallel typecheck`, and the root script is reserved to one phase owner, so the
workflow itself scopes the run: the quality job runs the typecheck of the TypeScript workspaces
(`pnpm -r --filter "!desktop" typecheck`), and the Rust workspace's typecheck is `cargo check`,
which moves to the `desktop` job below. No workspace loses its gate — the desktop's gate becomes
`cargo check` **and** `cargo test` on a runner that can satisfy them, instead of a cargo check
that cannot run on Linux without the webview system libraries and a Linux sidecar binary.

The gates this phase adds are separate jobs, because a job that needs a Rust toolchain, a Windows
runner or a Docker daemon must not take the serial quality job down with it:

| Job         | Runner           | What it proves                                                                           |
| ----------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `quality`   | `ubuntu-latest`  | the existing sequence, with the desktop's Rust gate moved out                            |
| `desktop`   | `windows-latest` | the sidecar, the icons, `cargo check`, `cargo test`, the Tauri build, the packaged smoke |
| `benchmark` | `ubuntu-latest`  | the 1k/10k/100k benchmark and its gate counters                                          |
| `audit`     | `ubuntu-latest`  | the published tarball content, without publishing                                        |
| `docker`    | `ubuntu-latest`  | the image build and the scratch-volume smoke                                             |

The `desktop` job is where the native ABI is proven. `better-sqlite3` is not a Node-API addon in
this repository's version — it is a V8 addon bound to one `NODE_MODULE_VERSION` — so the module
must be built with the same Node major as the sidecar that loads it. The sidecar is Node 24.11.0
(ABI 137), so the desktop job builds the web app on Node 24 and then loads the built native module
with the sidecar binary itself. The job fails if the sidecar cannot load the module, which is the
ABI evidence the release gate asks for.

The `desktop` job also runs the two setup steps the build needs and the repository does not carry:
`pnpm --filter desktop setup:sidecar` (the sidecar binary is gitignored) and
`pnpm --filter desktop setup:icons` (the icons are gitignored and reproducible from the icon
generator). It builds the web app before the Tauri build, because the Tauri build consumes the
built web tree.

The release workflow keeps its two publish targets, its OIDC trusted publishing and its manual
trigger. Its typecheck step is scoped the same way as the quality job's, so it cannot fail on a
Rust gate that belongs to another job, and it gains the tarball audit before it publishes.

## The Docker image

The Dockerfile is fixed where twenty phases of change left it behind:

- the build has its own disposable `JOURNAL_DATA_DIR`, because a build that imports the routes
  initializes storage;
- the image sets `NEXT_TELEMETRY_DISABLED=1`, which the repository's telemetry invariant requires
  and which the Dockerfile did not carry.

The image's build context is already sufficient: the workspace install in the builder stage
completes with the frozen lockfile, and the runner stage already carries the standalone server,
the worker bundle with its native SQLite, the supervisor scripts, the static assets and the public
assets.

## The release acceptance record

`docs/intelligence-operations.md` gains the release section: the benchmark and how to reproduce
it, the package audit and how to read it, the CI gates, and the release record itself — every
result, with the blocked items stated separately from the passed ones.

## Test-first steps

1. the icon header — the crate's own test parses the file it wrote — `desktop/src-tauri/scripts/gen_icons`;
2. the dispatcher — it resolves the platform script and refuses a missing one;
3. the port choice and the readiness line — the desktop crate's tests;
4. the tree termination — the desktop crate's test spawns a real child tree;
5. the benchmark — it refuses a non-absolute data directory and a reserved port;
6. the package audit — the audit asserts presence and absence over a real built tree;
7. the packaging test — `apps/web/tests/intelligence-packaging.test.ts`;
8. the CI and release workflows — the gates above.

## Verification

```
pnpm exec vitest run apps/web/tests/intelligence-acceptance.test.ts \
  apps/web/tests/intelligence-packaging.test.ts \
  apps/web/tests/intelligence-supervisor.test.ts
pnpm typecheck
cargo check --manifest-path desktop/src-tauri/Cargo.toml
cargo test --manifest-path desktop/src-tauri/Cargo.toml
cargo test --manifest-path desktop/src-tauri/scripts/gen_icons/Cargo.toml
pnpm --filter desktop build:app
node scripts/benchmark-intelligence.mjs --volumes 1000,10000,100000
```

The whole-project `pnpm test` runs once, for this phase's release evidence.

## Stop condition

The plan is implemented, the targeted tests and the typecheck are green, `cargo check` and
`cargo test` pass, the desktop build and the packaged smoke have a recorded result, the benchmark
has recorded numbers, the Docker smoke has a recorded result or a recorded block, one
implementation review has passed, and the phase report is committed. The candidate stops there;
the merge into `codex/ai-native-journal` is the coordinator's job.
