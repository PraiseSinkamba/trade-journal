## Verdict: PASS

## Reviewer Report — Phase 20 boundary repair (the driver and the shared vocabulary)

Contract: `docs/orchestration/ai-native-journal/tasks/T-020.md`. Plan of record:
`docs/superpowers/plans/ai-native-journal/phase-20.md`.

This report covers the granted boundary repair of the committed candidate. The destination gate
failed on the repository's own architecture test — `apps/web/tests/intelligence-boundaries.test.ts`
reported 2 of 1372 tests failing — and both failures were import-graph rules this phase's own code
had broken. The repair moves code between layers and changes no behaviour.

### PASS / FAIL

PASS — the driver is wired only in the database layer, the shared vocabulary lives in the
contracts layer, and every phase behaviour is unchanged.

### The two findings and their resolutions

- **[PASS]** `apps/web/src/server/intelligence/infrastructure/retention.ts` — rule 4: only the
  infrastructure layer wires the concrete driver. The module no longer imports `"better-sqlite3"`,
  and no `Database` reference survives in it. Its four raw opens became three primitives in the
  granted `apps/web/src/db/journal-file.ts`: `readJournalFileFacts` (the encrypted-material and
  encrypted-settings probes), `copyJournalFile` (the `VACUUM INTO` snapshot with its worker-lease
  check) and `checkJournalFile` (the restored-file verification). No `better-sqlite3` import
  remains anywhere under `apps/web/src/server`, `app`, `lib` or `components`.
- **[PASS]** `apps/web/src/db/journal-file.ts` — the file is opened **without migrating it**: the
  primitives use the raw driver and never `openJournalDatabase` / `applyMigrations`, so the backup
  and the verification still judge the journal as it is.
- **[PASS]** `apps/web/src/server/intelligence/infrastructure/worker.ts` — rule 5: no domain
  imports a sibling's private file. The worker imports `WORKFLOW_EFFECT_HANDLER_ID` and
  `WORKFLOW_EFFECT_HANDLER_VERSION` from `../contracts/experience` and imports nothing from
  `../experience/workflows`.
- **[PASS]** `apps/web/src/server/intelligence/contracts/experience.ts` — the shared vocabulary
  lives in the contracts layer, declared once beside the workflow-effect job-key prefix that names
  the same handler.
- **[PASS]** `apps/web/src/server/intelligence/experience/workflows.ts` — imports the two constants
  from the contracts layer; no stale declaration, no stale re-export and no dangling import.
- **[PASS]** behaviour equivalence — the file-absent versus file-unreadable distinction, the
  fail-closed refusal on an unreadable journal, the `fileMustExist` and `readonly` open flags, the
  lease-liveness comparison, the `VACUUM INTO` destination quoting, the integrity and foreign-key
  verdicts and both error strings are unchanged.
- **[PASS]** `apps/web/src/db/schema.ts`, `apps/web/src/db/migrations.ts`,
  `apps/web/src/db/migration-checksums.json`, `apps/web/src/db/migrations/` — byte-unchanged. No
  schema change and no migration.
- **[PASS]** `apps/web/package.json`, `package.json`, `pnpm-lock.yaml` — unchanged. No new
  dependency.
- **[PASS]** `apps/web/tests/intelligence-boundaries.test.ts` — untouched. No assertion was
  weakened and no exemption was added.

### The one finding of the review, and its resolution

One reviewer run was spent on the implementation diff. It returned one P2 finding, which was real
and is fixed:

- **[PASS]** `apps/web/src/db/journal-file.ts` — the foreign-key check ran eagerly, before the
  caller could read the integrity verdict. The pre-move code threw the curated integrity message
  first and never reached the foreign-key pragma when the integrity check failed, so a corrupt
  restored journal could have surfaced a raw `SqliteError` instead of
  `The restored journal fails its integrity check: …`. The refusal itself was never lost, but the
  operator's message was. `checkJournalFile` now short-circuits: the foreign-key check runs only
  when the integrity check passed, so the original order is restored exactly.

### The proof of teeth

Each fix was broken deliberately, the boundary test was watched to fail, and the restoration was
watched to pass again.

- **[PASS]** the `better-sqlite3` import put back into the retention module → rule 4 **failed**
  (`1 failed | 7 passed (8)`); restored → 8 passed.
- **[PASS]** the two constants moved back into the experience domain's private file → rule 5
  **failed** (`1 failed | 7 passed (8)`); restored → 8 passed.

### Verification run

| Command                                                                                                                                       | Exit | Runtime | Result                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- | ------------------------ |
| `pnpm exec vitest run apps/web/tests/intelligence-retention.test.ts apps/web/tests/intelligence-backup.test.ts apps/web/tests/intelligence-acceptance.test.ts apps/web/tests/intelligence-boundaries.test.ts` | 0    | 27 s    | **81 passed** (4 files) |
| `pnpm --filter web typecheck`                                                                                                                 | 0    | 46 s    | no type errors          |
| `npx prettier --check` on every touched path                                                                                                 | 0    | 8 s     | clean                   |
| `pnpm exec vitest run apps/web/tests/intelligence-worker.test.ts apps/web/tests/intelligence-workflows.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-slice-a.test.ts apps/web/tests/intelligence-slice-b.test.ts apps/web/tests/intelligence-migrations.test.ts` | 0 | 24 s | **96 passed** (6 files) |

Node v24.22.3, pnpm 11.0.8. The whole-project `pnpm test` and the destination gate are the
coordinator's.

### Hard blocks

- **[PASS]** no new dependency, so no ADR is required.
- **[PASS]** no raw `fetch` / `axios` / `http.` in `packages/importers/src` — no importer file was
  touched.
- **[PASS]** the trade-key format in `packages/core/src/round-trips.ts` is unchanged.
- **[PASS]** no chart was touched.

### Summary

16 PASS, 0 FAIL, 0 BLOCK. The two import-graph violations that failed the destination gate are
fixed, the driver is behind the database layer, the shared vocabulary is in the contracts layer,
and no phase behaviour changed.
