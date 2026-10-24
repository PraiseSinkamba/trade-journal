# Reviewer Report — cleanup slice (docs + default OpenAI model)

Base `e45707b` → `f5899c9` ("Use gpt-6-luna as the default OpenAI model") plus the working tree.

## Verdict: PASS

The previous run of this report returned FAIL on 14 documentation-factual findings (the three
architecture-discovery synthesis documents contradicted the code they cite). Every one of those
findings has been corrected and re-verified against the source; the corrections below are
re-derived from the code, not copied from the previous report.

### Findings

- [PASS] format:check — prettier clean on every path in the slice (20 paths: the six
  `docs/architecture-discovery/*.md` files, the three ADRs, the four `docs/superpowers/` documents,
  `docs/LEARNINGS.md`, `docs/MISTAKES.md`, `README.md`, `CHANGELOG.md`,
  `apps/web/src/lib/ai-settings.ts`, `apps/web/tests/ai-settings.test.ts`). Repo-level note: 431
  pre-existing prettier violations exist outside this slice and are untouched by it.
- [PASS] typecheck — `apps/web` passes ("Route types generated successfully"). The `desktop`
  (Rust/Tauri) workspace fails on `resource path
  'binaries\node-x86_64-pc-windows-msvc.exe' doesn't exist` (missing local Tauri sidecar
  binary) — pre-existing, no desktop file is touched by this slice.
- [PASS] test invariant — full `pnpm test` = 84 files / 836 tests, 0 failed. No product
  invariant in `AGENTS.md` is touched by this slice.
- [PASS] commit message — "Use gpt-6-luna as the default OpenAI model" states the solved
  outcome, not a WIP marker.
- [PASS] hard block: new dependency without ADR — `node scripts/check-licenses.mjs` reports
  "Dependency licenses OK."; no package manifest changed; `xlsx` count in `pnpm-lock.yaml` = 0;
  no `from "xlsx"` / `require("xlsx")` anywhere in `apps/` or `packages/`.
- [PASS] hard block: raw fetch/axios/http in importers — 0 matches in `packages/importers/src`.
- [PASS] hard block: trade-key format — `packages/core/src/round-trips.ts` key construction is
  unchanged; the package is not touched by this slice.
- [PASS] hard block: P&L colour-only chart — no file under `apps/web/src/components/charts/` is
  touched.
- [PASS] production change consistency — `apps/web/src/lib/ai-settings.ts:7` →
  `openai: "gpt-6-luna"`; `apps/web/tests/ai-settings.test.ts:121,202,294,314` assert it;
  `README.md:82` matches. Remaining `gpt-4.1-mini` hits in `ai-import-ui.test.ts`,
  `ai-settings-ui.test.ts`, `xtb-import-ui.test.ts` are saved-model fixtures, not default
  assertions.
- [PASS] ADR format/status — `docs/decisions/0006-*.md:3`, `0007-*.md:3`, `0008-*.md:3` all
  carry `Status: Proposed` and follow `docs/decisions/0000-template.md`. No ADR claims Accepted.
- [PASS] plans & specs framing — every `docs/superpowers/` document frames the work as future
  work ("Ready for review; not approved for production implementation", "No production
  implementation is approved yet", "production approval pending"). No unimplemented feature is
  presented as shipped.

### Corrections verified after the previous FAIL

- [PASS] entity list — `ARCHITECTURE_CONTEXT.md` now lists exactly the 23 tables that exist;
  `grep -c "sqliteTable(" apps/web/src/db/schema.ts` = 23. The four nonexistent tables
  (`playbook_templates`, `prop_phases`, `attachment_links`, `note_folders`) are gone, and
  `folders`, `import_sources` and `import_batches` are included.
- [PASS] migration location — `grep -c "ALTER TABLE" apps/web/src/db/index.ts` = 0;
  `grep -c "ALTER TABLE" apps/web/src/db/bootstrap.ts` = 5. The documents now point at
  `db/bootstrap.ts`.
- [PASS] transaction semantics — `insertExecutions` is a plain `db.transaction((tx) => {` at
  `apps/web/src/server/executions.ts:124` (the only `{ behavior: "immediate" }` is
  `apps/web/src/server/sync.ts:93`), and `rebuildAccount` reads before its write transaction
  (`apps/web/src/server/rebuild.ts:14-44` reads, `:46` transaction). Both statements now match.
- [PASS] XTB dependency — no `xlsx` dependency exists in any manifest or in `pnpm-lock.yaml`
  (0 matches); `packages/importers/src/xlsx.ts:132` implements the ZIP/XML reader in-house. The
  false "added in this merge" claim is removed.
- [PASS] AI tool count — `apps/web/src/server/ai.ts` defines four tools (`get_journal_summary:102`,
  `find_trades:120`, `get_trade_detail:160`, `switch_report_mode:202`, the last only for the
  reports feature). The documents now say three common tools plus the reports-only fourth.
- [PASS] `prop_phases` — `grep -c "prop_phases" apps/web/src/db/schema.ts` = 0; removed from the
  schema row.
- [PASS] desktop spawn — `desktop/src-tauri/src/server.rs:56-63` uses
  `tauri::async_runtime::spawn` with `app.shell().sidecar("node")` and `.env("PORT", "0")`.
- [PASS] port fallback — `server.rs` contains no `3000`; the fallback is in the generated
  standalone server (`desktop/src-tauri/target/debug/apps/web/server.js:13`).
- [PASS] dangling reference — `grep -rc "ARCH-EVIDENCE-FULL" docs/architecture-discovery/*.md`
  → 0 remaining references; the file never existed in the base tree or the working tree.
- [PASS] `providerOptions` citations — the occurrences are at `apps/web/src/server/ai-runtime.ts`
  `:181`, `:232`, `:292`, `:331`; every citation in the slice now names those lines, including
  `EVIDENCE_REGISTER.md` ARCH-002, which previously inherited a range ~45 lines wide against the
  register's own ±3 tolerance.
- [PASS] merge-conflict claim — `docs/architecture-discovery/10-testing-and-quality.md:259` now
  states that the report was written mid-merge, that the conflicts were resolved and the merge
  landed as `e45707b`, and that the tree is clean now (no `.git/MERGE_HEAD`, empty
  `--diff-filter=U`).
- [PASS] evidence counts — `grep -c "Finding ID:    ARCH-9" EVIDENCE_REGISTER.md` = 20, i.e.
  `ARCH-901..ARCH-920`. `docs/architecture-discovery/README.md` now counts 20 evidence IDs and
  matches the register; the `ARCH-900 – 999` band row now reads "Post-merge delta" instead of
  claiming the band belongs to the domain and data reports, whose findings actually live in
  `ARCH-050..ARCH-064` inside the `ARCH-001 – 099` band.
- [PASS] dependency citations — the dependency table now cites the real
  `apps/web/package.json` lines (`:13` anthropic, `:14` mcp, `:15` openai, `:16`
  openai-compatible) and `@ai-sdk/mcp` is filed as the MCP client it is, consistent with
  `ARCHITECTURE_CONTEXT.md` §O.5.
- [PASS] secrets — no key, token or credential literal appears in any added document.

### Notes for the orchestrator

- The remaining `tokio::spawn` mention lives in `docs/architecture-discovery/05-events-and-background-processing.md:18`
  and describes `desktop/src-tauri/src/lib.rs:95`, not the server spawn this slice corrected. That
  file is unmodified by this slice, so it stays as it is.
- Repo-level debt outside this slice: 431 prettier violations, and a desktop typecheck that needs
  the Tauri Node sidecar binary present. Neither is introduced nor worsened here.

### Summary

30 PASS, 0 FAIL, 0 BLOCK
