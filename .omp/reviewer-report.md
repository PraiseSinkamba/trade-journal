## Verdict: PASS

### Reviewer report — Phase 21 repair diff, fourth pass (final verification of the third review's findings)

**Base commit:** `757e3c6` ("docs: record the Phase 21 release acceptance evidence"), branch
`codex/ai-native-journal-p21`.
**Reviewed:** `git diff HEAD` — `.github/workflows/ci.yml`,
`apps/web/scripts/build-worker.mjs`, `apps/web/tests/intelligence-packaging.test.ts`,
`desktop/src-tauri/src/server.rs`, `docs/intelligence-operations.md`,
`docs/orchestration/ai-native-journal/integration-plan.md`,
`docs/superpowers/plans/ai-native-journal/phase-21.md`,
`docs/superpowers/reports/ai-native-journal-phase-21.md`, `scripts/benchmark-intelligence.mjs`,
`.omp/reviewer-report.md` — plus the untracked `desktop/scripts/packaged-smoke.ps1`.
Read-only review. The only file written is this report.

**Result:** the third review's blocking item is genuinely closed. The release record no longer
claims the phase changed exactly one `apps/web` file; it now states that the two compared builds
carry the same application code (`apps/web/src`, `packages/**`, every migration) and names the one
packaged difference — the worker artifact, where the phase removed the install-time-only
dependency chain. That claim is true and independently verifiable: the candidate's standalone
worker tree is a strict subset of the baseline's, differing by exactly the `prebuild-install`
chain. Every corrected number now traces to the artifact it names, the CI delta weakens nothing,
and the `--self-check` steps are ordered so the reporting rules are enforced even when the
benchmark step fails.

One non-blocking wording defect survives the repair (finding 1 below): a leftover sentence still
calls the two compared builds "byte-identical". It is not load-bearing — the p95 section now
states the difference plainly — but it is false for the recorded pair and should be corrected
before the destination gate.

---

## Verified items (each claim traced to its artifact)

- **[PASS] BLOCK — the release record no longer claims a single `apps/web` file, and the
  enumeration it now makes is true.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:452-457`:

  > "**No row exceeded the 20 % regression limit, so the gate passed and the run exited 0.** The
  > two builds carry the same application code: `apps/web/src`, `packages/**` and every migration
  > are unchanged by this phase. The one packaged difference is the worker artifact, where this
  > phase removed the install-time-only dependency chain — a packaging change that does not touch
  > the runtime path the benchmark measures."

  The old clause is gone: `rg "apps/web file" docs/` returns no hit in the phase report. The
  deviations list names the second file at
  `docs/superpowers/reports/ai-native-journal-phase-21.md:548-551`
  ("**`apps/web/scripts/build-worker.mjs` was edited although the plan did not list it**"), so the
  document no longer contradicts itself 90 lines apart.
  `git diff --name-only 4628a575 -- apps/web` lists two files —
  `apps/web/scripts/build-worker.mjs` and `apps/web/tests/intelligence-packaging.test.ts` — and
  the report names both, in the two places they belong.

  Each half of the new claim is verified against the tree, not read off:
  `git diff --name-only 4628a575 -- apps/web/src` → empty; `-- packages` → empty;
  `-- apps/web/src/db` → empty. The "one packaged difference" half is verified on disk: the
  candidate's benchmark tree (`apps/web/.next/standalone/apps/web/worker`) holds **65** files and
  the baseline tree
  (`E:/4004/orca/tmp-p21/baseline-tree/apps/web/.next/standalone/apps/web/worker`) holds **524**;
  the 459-file difference is exactly the `prebuild-install` chain
  (`node_modules/better-sqlite3/node_modules/prebuild-install/**`), and **0** files exist only in
  the candidate — the candidate is a strict subset, i.e. the packaging change the record describes
  and nothing else.

- **[PASS] P2 — the 1k rebuild-lock figure is now the artifact's maximum across both modes.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:492-493` — "314 ms (1k), 874 ms (10k)
  and 6131 ms (100k)". Against `E:/4004/orca/tmp-p21/bench-repair.json`
  (`modes.<mode>.rebuildLockDuration.observedMaximumMs`): 1k → idle 287.434 / active **314.506**
  (max 314) ✓; 10k → idle **873.918** / active 526.180 (max 874) ✓; 100k → idle **6131.01** /
  active 3946.871 (max 6131) ✓. All three figures are the maximum across the two modes of the
  absolute-gate run the sentence belongs to.

- **[PASS] P2 — the whole-project row now records the post-repair run.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:195` — "`pnpm test` (the whole project) …
  **1375 passed** (116 files)", 153 s. Against
  `E:/4004/orca/tmp-p21/full-test-repair.log` (Nov 18 10:45–10:47, the only whole-suite log that
  postdates the ninth packaging case): `Test Files 116 passed (116)` and
  `Tests 1375 passed (1375)` ✓. The log's own vitest duration is 146.80 s; the row's 153 s is the
  command's wall clock, the same convention the pre-repair row used (195.55 s vitest → 204 s
  claimed). The 1374 figure is gone from the report.

- **[PASS] P2 — the typecheck row records the post-repair run.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:194` — `pnpm typecheck`, exit 0,
  53 s, "no type errors, including the desktop `cargo check`". No artifact file for this run
  exists in the evidence directory and none contradicts it; the tree's Rust gate was re-verified
  in this review (`cargo test --manifest-path desktop/src-tauri/Cargo.toml` → exit 0, 5 passed).

- **[PASS] P3 — the targeted-test count is 35 in both records, and 35 is what the tree runs.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:193` ("**35 passed** (3 files)") and
  `docs/intelligence-operations.md:631` ("passed: 3 files, 35 tests"). Re-ran the row's command:
  `pnpm exec vitest run apps/web/tests/intelligence-acceptance.test.ts
  apps/web/tests/intelligence-packaging.test.ts apps/web/tests/intelligence-supervisor.test.ts` →
  exit 0, `Test Files 3 passed (3)`, `Tests 35 passed (35)` ✓. The whole-suite log agrees:
  packaging 9 + supervisor 16 + acceptance 10 = 35 ✓.

- **[PASS] P3 — the stale "eight" is gone.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:321-322` now reads "**skipped** that one
  case and passed the rest. With the tree restored, the switched run passed every case." No
  count survives that the artifacts contradict.

- **[PASS] P3 — the quoted self-check rule names are the shipped ones.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:355-360` quotes seven rules by name.
  `node scripts/benchmark-intelligence.mjs --self-check` → exit 0, `passed: true`, and the seven
  printed names are exactly: `the idle queue is not applicable`, `the active queue is a boolean`,
  `an undrained active queue is false`, `the idle mode reports the capture flag of its run`, `an
  uncaptured run is not reported as captured`, `capture enabled by 1`, `capture disabled by 0` ✓.
  The report's "four more per volume" is also exact:
  `node scripts/benchmark-intelligence.mjs --self-check
  E:/4004/orca/tmp-p21/bench-paired-final.json` → exit 0, 19 checks = 7 + 4 × 3 volumes ✓.

- **[PASS] P3 — the CI now checks the produced result, and the ordering is right.**
  `.github/workflows/ci.yml:151-152` runs `node scripts/benchmark-intelligence.mjs --self-check`
  (pathless) **before** the benchmark step at `:153-160`, which is the step that can exit 1; the
  produced result is then checked at `.github/workflows/ci.yml:161-162`
  (`--self-check "$RUNNER_TEMP/ai-native-journal-benchmark.json"`), and
  `scripts/verify-features.py --benchmark-result` still runs last at `:163-164`. So the reporting
  rules are enforced even when the benchmark step fails, and the produced result is checked when
  the run succeeded — exactly the gap the third review raised.

- **[PASS] P3 — the smoke command row is now self-sufficient on this host, and the explanation
  holds.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:203` records
  `pwsh -NoProfile -File desktop/scripts/packaged-smoke.ps1 -Exe <release exe> -DataDir <scratch>`,
  and `:230-236` explains that the script's default is the CI path
  (`desktop/src-tauri/target/release/trade-journal-desktop.exe`,
  `desktop/scripts/packaged-smoke.ps1:117-119`) while this host redirects the Cargo target
  directory. Corroborated by the recorded runs: `smoke-nomarker.log` embeds
  `supervisor = E:\build-cache\target\release\apps\web\scripts\run-journal.mjs`, and
  `E:/4004/Temp/journal-packaged-smoke-stderr.log` carries the final run's
  `[server] ready url=http://127.0.0.1:54893` ✓. The script's default path is still correct for
  `windows-latest`, where no `CARGO_TARGET_DIR` is set.

- **[PASS] P3 — the two-sided threshold reading is gone.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:452` — "**No row exceeded the 20 %
  regression limit**" — and `docs/intelligence-operations.md:638` — "worst row +8.6 %, no row over
  the 20 % limit". Both are one-sided and true of the artifact.

- **[PASS] The p95 table matches `volumes[].comparison.rows` cell for cell.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:441-447` against
  `E:/4004/orca/tmp-p21/bench-paired-final.json`:

  | Volume | Mode | Report baseline | Artifact | Report candidate | Artifact | Report regression | Artifact `regressionPercent` |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 1k | idle | 10.457 | 10.457 | 11.352 | 11.352 | +8.6 % | 8.559 |
  | 1k | active | 12.685 | 12.685 | 12.950 | 12.95 | +2.1 % | 2.089 |
  | 10k | idle | 15.749 | 15.749 | 16.157 | 16.157 | +2.6 % | 2.591 |
  | 10k | active | 24.816 | 24.816 | 16.515 | 16.515 | −33.5 % | −33.45 |
  | 100k | idle | 34.201 | 34.201 | 34.538 | 34.538 | +1.0 % | 0.985 |
  | 100k | active | 57.060 | 57.06 | 38.384 | 38.384 | −32.7 % | −32.73 |

  All six rows agree on baseline p95, candidate p95 and regression; the largest positive row is
  the artifact's own 8.559 → "+8.6 %" ✓ (`…phase-21.md:205` and `:486-489`). Every row satisfies
  the one-sided gate. Re-derived independently: `python scripts/verify-features.py
  --benchmark-result E:/4004/orca/tmp-p21/bench-paired-final.json` → exit 0, all 30 gates pass,
  including "volume 1000 idle p95 regression at most 20% against the baseline build" ✓.

- **[PASS] The measured-results table matches the absolute-gate artifact.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:474-479` against
  `E:/4004/orca/tmp-p21/bench-repair.json`: 1k idle 9.069 / 15.883, active 9.800 / 13.735; 10k idle
  12.461 / 18.825, active 11.985 / 19.282; 100k idle 20.266 / 40.199, active 24.338 / 58.111 —
  every cell matches ✓; capture `true` in both modes at every volume ✓; busy escapes, lost effects
  and failed requests 0 ✓; idle `queueDrained: null`, active `true` ✓.

- **[PASS] The two benchmark command-table rows match their runs.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:205` — the paired run, exit 0, 1301 s:
  `bench-paired-final.json` has `startedAt 2026-11-18T05:29:20.847Z`,
  `finishedAt 2026-11-18T05:51:01.052Z` (1300.2 s internal span), `passed: true`,
  `gates.p95Regression.passed: true` with `failedVolumes: []`, and
  `scripts/benchmark-intelligence.mjs:1047` sets the exit code from that verdict ✓.
  `…phase-21.md:204` — the absolute-gate run, exit 1, 2288 s: `bench-repair.json` has
  `03:43:16.962Z → 04:21:24.800Z` (2287.8 s) and `passed: false`, because the run carried no
  comparison build — the report says exactly that ✓.

- **[PASS] CI delta — no gate was weakened, removed or reordered around.**
  `git diff HEAD -- .github/workflows/ci.yml` adds the packaged-tree audit at
  `.github/workflows/ci.yml:86-92`, **after** the build step at `:78-85`, with
  `JOURNAL_REQUIRE_PACKAGED_TREE: "1"` ✓; the `quality` job keeps `pnpm format:check`,
  `pnpm -r --filter "!desktop" typecheck`, `pnpm test`, licences and both builds
  (`.github/workflows/ci.yml:26-45`) ✓; the `desktop` job keeps both cargo gates, the sidecar, the
  icons, the build and the native-ABI proof ✓; the `audit` and `docker` jobs are untouched ✓. The
  smoke step (`:108-111`) now calls the committed script, which keeps every assertion the inline
  block had — loopback discovery, reserved-port refusal (3000/3001), the `/api/accounts` HTTP
  poll, node-children capture, `CloseMainWindow` and the orphan assertion
  (`desktop/scripts/packaged-smoke.ps1:127-206`) — and adds the readiness assertion
  (`:170-186`). The inline block is removed, not weakened.

- **[PASS] The teeth are still real.**
  Readiness: `smoke-nomarker.log` — "packaged smoke failed: The packaged app never published the
  readiness signal", the journal having answered HTTP on `127.0.0.1:54628` in the same run;
  `smoke-final.log` and `smoke-restored.log` — exit 0 with the readiness line matching the
  discovered port (54893 / 53737) and no orphan ✓.
  Packaging audit: `audit-required-missing.log` — "The packaged runtime tree is required but
  missing: …\tauri-dist\apps\web", 1 failed / 7 passed with the switch set; the tree restored →
  `audit-required-present.log`, 8 passed (8) ✓.
  Self-check: `before-selfcheck.json` records the pre-fix logic failing `the idle queue is not
  applicable` and `volume 1000: the idle queue is not applicable`; the current script passes all
  seven rules and every per-volume rule ✓.

- **[PASS] No new dependency, schema, migration or lockfile change.**
  `git diff HEAD --stat` touches no `package.json`, no `pnpm-lock.yaml`, no `apps/web/src/db/**`
  ✓.

- **[PASS] The failing prettier set is unchanged: 77 files, identical to the base commit's set.**
  `pnpm exec prettier --check .` → exit 1, "Code style issues found in 77 files"; the failing-file
  list is byte-identical to `E:/4004/orca/tmp-p21/base.sorted` (sorted diff empty) ✓, and none of
  the ten files this delta touches is in that set ✓.

- **[PASS] The packaged-tree path figure reproduces.**
  `docs/superpowers/reports/ai-native-journal-phase-21.md:403-404` — 208 characters, 2 363 files,
  0 over 260. Independent measurement over `apps/web/.next/tauri-dist` on this host: **2 363**
  regular files, longest absolute path **208** characters, **0** paths over 260 ✓.

- **[PASS] Toolchain sanity re-run in this review.**
  `cargo test --manifest-path desktop/src-tauri/Cargo.toml` → exit 0, 5 passed ✓;
  `cargo test --manifest-path desktop/src-tauri/scripts/gen_icons/Cargo.toml` → exit 0, 1 passed ✓;
  `node scripts/benchmark-intelligence.mjs --self-check` → exit 0, 7 checks ✓;
  `… --self-check E:/4004/orca/tmp-p21/bench-paired-final.json` → exit 0, 19 checks ✓;
  `python scripts/verify-features.py --benchmark-result
  E:/4004/orca/tmp-p21/bench-paired-final.json` → exit 0, 30 gates ✓;
  the packaged installers exist (`E:/build-cache/target/release/bundle/msi/Trade Journal_0.1.0_x64_en-US.msi`,
  Nov 18 07:00 and the NSIS `.exe`, Nov 18 07:04) ✓.

---

## New findings (not raised by the third review)

1. **[P2] A leftover sentence still calls the two compared builds "byte-identical".**
   `docs/superpowers/reports/ai-native-journal-phase-21.md:557-560` — "an earlier paired run on
   the same host, taken under load, produced far larger swings between the same two byte-identical
   builds." The corrected p95 paragraph at `:452-457` says the two builds differ in the worker
   artifact, so the document contradicts itself once more, 100 lines apart: the recorded pair is
   not byte-identical — the candidate's standalone worker tree has 459 fewer files than the
   baseline's (the `prebuild-install` chain). The swings themselves are real and traceable
   (`bench-paired-small.json`: +22.257 %, −18.595 %, +81.953 %; `bench-paired-100k.json`:
   +120.188 %), so only the adjective is wrong. Fix: drop "byte-identical" (the paragraph at
   `:452-457` already states what is and is not identical), e.g. "between the same two builds".

2. **[P3] The smoke's data-directory parameter does not isolate the journal.**
   `desktop/scripts/packaged-smoke.ps1:16-18` presents `-DataDir` as "The disposable journal data
   directory", and `:121-125` exports it as `JOURNAL_DATA_DIR`. The packaged desktop never reads
   that variable: `desktop/src-tauri/src/lib.rs:59-62` and `:101-116` use the Tauri
   `app_data_dir()` unconditionally, which is what the recorded runs show
   (`E:/4004/Temp/journal-packaged-smoke-stderr.log`: "data_dir =
   C:\Users\4004\AppData\Roaming\com.luxalgo.tradejournal\TradeJournal\data"). The smoke therefore
   runs the app against the operator's real profile, not the scratch directory the report's
   command row names. No claim in the report is false because of this, and the pre-repair inline
   block behaved the same way, so it is not a regression — but the parameter's comment overstates
   what it does.

3. **[P3] The "skipped that one case" half of the packaging proof has no recorded artifact.**
   `docs/superpowers/reports/ai-native-journal-phase-21.md:320-322` asserts that without the
   switch "the same run **skipped** that one case and passed the rest". No log in
   `E:/4004/orca/tmp-p21/` records a skipped case; the recorded runs are
   `audit-required-missing.log` (1 failed / 7 passed, switch set) and `audit-required-present.log`
   (8 passed (8), switch set) — both from when the packaging file still had eight cases, so they
   predate the ninth. The switch's behaviour is provable from the code
   (`apps/web/tests/intelligence-packaging.test.ts:179-190`), but the observation is not recorded.

4. **[P3] The readiness replay negatives are quoted from the script, not from a recorded run.**
   `docs/superpowers/reports/ai-native-journal-phase-21.md:344-347` — "the real file passed, the
   file with the marker removed failed (`no readiness marker in …`), and a file whose marker
   carries the wrong port failed (`readiness marker port 9999 does not match the expected port
   …`)". Both strings are the script's own messages
   (`desktop/scripts/packaged-smoke.ps1:113-119`), and the mode exists
   (`-VerifyReadinessFile`, `:107-118`), but no transcript of those two replays is in the evidence
   directory; only the real stderr file (`E:/4004/Temp/journal-packaged-smoke-stderr.log`) is.

5. **[Observation] Two runtimes are wall-clock figures with no artifact of their own.** The
   whole-suite row's 153 s against the log's 146.80 s vitest duration
   (`…phase-21.md:195`) and the typecheck row's 53 s (`:194`, no log in the evidence directory)
   follow the report's existing convention of quoting the command's elapsed time; neither
   contradicts an artifact.

---

## Verification run

| Command | Exit | Result |
| --- | --- | --- |
| `git diff HEAD`, `git status --short`, `git diff --name-only 4628a575 -- apps/web` | 0 | 10 modified files + untracked `desktop/scripts/packaged-smoke.ps1`; two `apps/web` files vs the base |
| `pnpm exec vitest run apps/web/tests/intelligence-acceptance.test.ts apps/web/tests/intelligence-packaging.test.ts apps/web/tests/intelligence-supervisor.test.ts` | 0 | 35 passed (3 files) |
| `cargo test --manifest-path desktop/src-tauri/Cargo.toml` | 0 | 5 passed |
| `cargo test --manifest-path desktop/src-tauri/scripts/gen_icons/Cargo.toml` | 0 | 1 passed |
| `node scripts/benchmark-intelligence.mjs --self-check` | 0 | `passed: true`, 7 checks |
| `node scripts/benchmark-intelligence.mjs --self-check E:/4004/orca/tmp-p21/bench-paired-final.json` | 0 | 19 checks, all pass |
| `python scripts/verify-features.py --benchmark-result E:/4004/orca/tmp-p21/bench-paired-final.json` | 0 | 30 gates passed |
| `pnpm exec prettier --check .` | 1 | 77 files — set byte-identical to the base commit's set |
| worker-tree comparison (candidate `standalone` vs `baseline-tree`) | 0 | 65 vs 524 files; the 459-file difference is the `prebuild-install` chain |
| path-length measurement over `apps/web/.next/tauri-dist` | 0 | 2 363 files, longest 208 chars, 0 over 260 |

`pnpm test` (whole project), `cargo build --release` and `pnpm --filter desktop build:app` were not
run; the coordinator owns the destination gate. Evidence was read from `E:/4004/orca/tmp-p21/`
(`bench-paired-final.json`, `bench-paired-final.log`, `bench-repair.json`, `bench-paired-small.json`,
`bench-paired-100k.json`, `smoke-final.log`, `smoke-nomarker.log`, `smoke-restored.log`,
`audit-required-missing.log`, `audit-required-present.log`, `before-selfcheck.json`,
`full-test-repair.log`, `base.sorted`, `baseline-tree/`) and `E:/4004/Temp/journal-packaged-smoke-stderr.log`.

---

### Summary

The third review's blocking item is closed, and closed properly: the release record no longer
claims the phase touched a single `apps/web` file, it states that the compared builds carry the
same application code and names the one packaged difference — the worker artifact — and that
enumeration is true against `git diff` and against the two trees on disk, where the candidate's
standalone worker tree is a strict subset of the baseline's by exactly the `prebuild-install`
chain the record says was removed. Every number the repair touched now traces to the artifact it
names: the rebuild-lock figures are the maxima across both modes of `bench-repair.json`
(314 / 874 / 6131 ms), the whole-project row records the post-repair suite (1 375 passed, 116
files, in `full-test-repair.log`), the targeted count is 35 in both records and 35 is what the
tree runs, the "eight" is gone, the seven quoted self-check rule names are the names the shipped
script prints, the smoke row names the `-Exe`/`-DataDir` invocation this host actually used, and
the threshold is now stated one-sidedly. The CI delta weakens nothing: the packaged-tree audit
runs after the build in the job that has the tree, the pathless `--self-check` runs before the
step that can exit 1, the produced result is checked after it, and the verifier still runs last.
The only defect worth carrying forward is wording: the release-gate bullet still calls the two
compared builds "byte-identical", which the corrected p95 paragraph contradicts and the trees
refute — a one-word fix, non-blocking because nothing else in the record rests on it, plus two
smaller traceability gaps (the smoke's `-DataDir` does not isolate the journal, and the
"skipped" and readiness-replay runs are quoted but not recorded). The delta is fit to merge once
finding 1's sentence is corrected.

### Carry-forward fixes applied after this review

This review returned PASS and named one carry-forward wording defect and two traceability gaps.
They are fixed; the delta is listed here so the report covers the committed tree.

- **"byte-identical builds"** — the wording contradicted this report's own earlier paragraph and the
  two trees on disk. The release-gate handover now says "the same two builds", and the p95 section
  states the one packaged difference (the worker artifact's install-time-only dependency chain).
- **Audit teeth against the current tree** — the packaging test now has nine cases, so the earlier
  audit logs no longer matched it. The switch was re-exercised against the current tree: with the
  tree moved aside and `JOURNAL_REQUIRE_PACKAGED_TREE=1` the run **failed** (exit 1, one failed
  test, `The packaged runtime tree is required but missing: …`, the other eight passed); with the
  tree restored the switched run **passed all 9 cases** (exit 0). The report quotes those results.
- **Readiness replay transcript** — the three replay outcomes (real file passes, marker removed
  fails, wrong port fails) are now quoted from the captured stderr of the recorded run, and the
  report names the port the real file carries.
- **`desktop/scripts/packaged-smoke.ps1`** — the `-DataDir` help text said "disposable journal data
  directory". The desktop resolves its own data directory from the OS profile
  (`app_data_dir/TradeJournal/data`), so the parameter only sets the environment the supervisor
  inherits; the help text now says that.

No code behaviour, gate, threshold or recorded number changed with this delta.
