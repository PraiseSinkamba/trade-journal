## Verdict: PASS
## Reviewer Report — Phase 24 — the review question on the card

### PASS

Third and final reviewer run. The three defects of the previous run are
confirmed fixed against the code, no new operator-visible claim is wrong, and
every row of the teeth bar was re-measured on the current tree.

### Findings

- [PASS] defect 1 fixed — `docs/intelligence-operations.md:219` ("Where the
  question appears") and `docs/intelligence-operations.md:460` (the
  troubleshooting list) now say only what the code does. The serve path
  (`apps/web/src/server/intelligence/infrastructure/insight-store.ts:95`,
  `readCurrentInsightInTx`: current projection revision, current capability
  version, observation `active`, account filter) never reads the policy, so
  "Turning the policy off does NOT hide a stored question"
  (`docs/intelligence-operations.md:472`) is true. The prune
  (`apps/web/src/server/intelligence/infrastructure/insight-store.ts:143`)
  removes a row only when `isSuperseded`
  (`apps/web/src/server/intelligence/infrastructure/insight-store.ts:187`) is
  true — the observation is gone or no longer `active`, or the source
  revision is no longer the subject's current projection revision — and the
  capability version is not among its checks. The three reasons at
  `docs/intelligence-operations.md:463`, `:466` and `:469` match that: the
  correction does not delete the row, the status change does not delete the
  row, and a capability-stale row is never served and never pruned. The
  Retention section (`docs/intelligence-operations.md:490` and `:500`) states
  the same three conditions and no capability condition — consistent.

- [PASS] defect 2 fixed — the teeth table
  (`docs/superpowers/reports/ai-native-journal-phase-24.md:112` and `:113`)
  now records the two breaks separately: row 5 "the reader compares the
  observation id with a wrong constant | 5 cases failed" and row 5b "the
  reader drops the observation id comparison | 1 case failed". Re-measured on
  a copy of the tree outside the repository (`E:/4004/review-p24copy`; the
  repository itself was not modified): wrong constant → `Tests 5 failed | 18
  passed (23)`; comparison dropped → `Tests 1 failed | 22 passed (23)`. Both
  match the table and the prose at
  `docs/superpowers/reports/ai-native-journal-phase-24.md:122`.

- [PASS] defect 3 fixed — the account-comparison break is its own row 6a
  (`docs/superpowers/reports/ai-native-journal-phase-24.md:115`, "0 cases
  failed"), and the prose
  (`docs/superpowers/reports/ai-native-journal-phase-24.md:129`) and "What is
  not claimed" (`docs/superpowers/reports/ai-native-journal-phase-24.md:186`)
  cite 6a, not 5. Re-measured: dropping `row.accountId !== observation.accountId`
  (`apps/web/src/app/api/intelligence/queries.ts:167`) → `Tests 23 passed
  (23)`, i.e. 0 failures — the store's own account filter
  (`apps/web/src/server/intelligence/infrastructure/insight-store.ts:109`)
  already refuses a foreign question. The table has rows 1, 2, 3, 4, 5, 5b, 6
  and 6a, and no row is cited for two experiments.

- [PASS] the teeth bar is honest — every row re-measured in the copy outside
  the repository, all matching
  `docs/superpowers/reports/ai-native-journal-phase-24.md:106`: row 1 (the
  route stops attaching the insight) 4 failed; row 2 (the evidence-revision
  check dropped) 1 failed; row 3 (the card renders the question unmasked) 1
  failed of the card file's 3; row 4 (the reader returns the raw store row) 4
  failed; row 5 5 failed; row 5b 1 failed; row 6 (the route reads the insight
  for another account) 4 failed; row 6a 0 failed. Every restored run is 23
  passed (slice B) or 3 passed (the card file), as the table records. The
  break descriptions match what the code does: row 6a is a reader comparison
  (`apps/web/src/app/api/intelligence/queries.ts:167`), row 6 is a route
  scope change (`apps/web/src/app/api/intelligence/observations/route.ts:102`),
  row 5b is a dropped reader comparison
  (`apps/web/src/app/api/intelligence/queries.ts:166`).

- [PASS] no new wrong operator-visible claim — every sentence this phase added
  to `docs/intelligence-operations.md:219-234` and `:460-478` was read against
  the code it describes: the question is served only where a review waits
  (`apps/web/src/app/api/intelligence/observations/route.ts:96` picks the
  workflow whose status is `waiting_for_user`); the card shows it under the
  label **AI question**
  (`apps/web/src/components/intelligence/interaction-card.tsx:209`); the
  privacy mask and its accessible name
  (`apps/web/src/components/intelligence/interaction-card.tsx:211-217`); the
  inbox renders that card (`apps/web/src/components/intelligence/inbox.tsx:166`);
  the GET stays a read (`apps/web/src/app/api/intelligence/queries.ts:157-169`
  is one deferred read transaction — no write, no enqueue, no provider call).
  The "three things can hide a stored question" list covers the real hiding
  causes: the observation's evidence link is the revision the observation was
  made from
  (`apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:187`),
  so the evidence-revision check coincides with the current-revision check
  rather than adding a fourth cause.

- [PASS] union narrowing in the route —
  `apps/web/src/app/api/intelligence/observations/route.ts:101` narrows
  `built` to the `observation-review` variant before the spread at `:106`.
  `observationReviewIntent` returns that kind or null
  (`apps/web/src/server/intelligence/experience/intents.ts:73-90`), so no
  intent served before is dropped by the narrowing.

- [PASS] one deferred transaction —
  `apps/web/src/app/api/intelligence/queries.ts:157-164`: a single
  `db.transaction(..., { behavior: "deferred" })` on the app's own handle. No
  write lock, so reading the inbox never blocks the writer.

- [PASS] non-nullable account —
  `apps/web/src/db/schema.ts:640-642` (`intelligence_observations.account_id`
  is NOT NULL); the reader takes a non-nullable `accountId`
  (`apps/web/src/app/api/intelligence/queries.ts:153-157`), passes it to the
  store and compares the returned row
  (`apps/web/src/app/api/intelligence/queries.ts:167`).

- [PASS] two-field projection —
  `apps/web/src/app/api/intelligence/queries.ts:169` returns only `question`
  and `sourceRevision`; the store row's business key, account, subject,
  observation, capability version and run never cross the wire. The mutation
  that returns the raw row fails 4 cases (teeth row 4), so the projection is
  held by a test.

- [PASS] the privacy mask's accessible name —
  `apps/web/src/components/intelligence/interaction-card.tsx:211-217` renders
  `aria-label="AI question hidden"` inside the same `HoverHint` overlay the
  money uses (`apps/web/src/components/privacy.tsx:95-102`). The card test
  asserts the name and the absence of the question text under privacy
  (`apps/web/tests/intelligence-insight-card.test.ts:106`).

- [PASS] the inbox and `components/privacy.tsx` are untouched — `git status`
  shows no change to `apps/web/src/components/intelligence/inbox.tsx` or
  `apps/web/src/components/privacy.tsx`; the mask lives in the card because
  the privacy module offers only `MonetaryValue` and `MonetaryField`, whose
  accessible name is "Monetary value hidden"
  (`apps/web/src/components/privacy.tsx:95-99`).

- [PASS] the app-layer store access follows the retention-route precedent —
  `apps/web/src/app/api/intelligence/queries.ts:14` imports the store's public
  factory, exactly as `apps/web/src/app/api/intelligence/retention/route.ts:12`
  reaches `server/intelligence/infrastructure/retention`. No server module
  gained an import, `composition.ts` is unchanged, and the store still owns
  the current-revision rule.

- [PASS] no new dependency, migration, prompt or stored provider response —
  `git status` shows no change to `package.json`, `pnpm-lock.yaml`, any
  migration or any prompt file; `pnpm --filter web migrations:check` prints
  `migration-checksums.json is up to date`. The journal keeps the question and
  no provider response: the insight row holds the question only
  (`apps/web/src/server/intelligence/infrastructure/insight-store.ts:95-133`).

- [PASS] format:check on the touched files — `npx prettier --check` over the
  seven modified and three new files reports "All matched files use Prettier
  code style!". The repository-wide run still shows exactly 79 warnings and
  none of them is a file this phase touched, as
  `docs/superpowers/reports/ai-native-journal-phase-24.md:142` records.

- [PASS] typecheck — `pnpm --filter web typecheck` exits 0.

- [PASS] the intelligence tests —
  `pnpm vitest run apps/web/tests/intelligence-slice-b.test.ts apps/web/tests/intelligence-insight-card.test.ts`
  → 26 passed (23 + 3). All 26 intelligence suites → 472 passed.

- [PASS] the report's case table matches the tests —
  `docs/superpowers/reports/ai-native-journal-phase-24.md:85-96` lists eight
  cases; the eight matching cases are
  `apps/web/tests/intelligence-slice-b.test.ts:915`, `:964`, `:983`,
  `:1016`, `:1045`, `:1097`, `:1135` and `:1163`, and the card's three claims
  are `apps/web/tests/intelligence-insight-card.test.ts:90`, `:100` and
  `:106`. Every claimed assertion exists in the named test.

- [NOTE] the report's "five intelligence suites" row
  (`docs/superpowers/reports/ai-native-journal-phase-24.md:138`) cites "77
  passed" without naming the suites, so the number cannot be checked from the
  document; the orchestrator's brief records 78 for the same phrase. The
  counts I measured are slice B 23, the card file 3, boundaries 8 and
  review-insight 31 — which reach 77 or 78 depending on the fifth suite (a
  12-test suite gives 77, `intelligence-ui` with 13 gives 78). Naming the
  five suites would settle it; no false claim is proven, so this is not a
  FAIL.

- [NOTE] the plan lists the privacy-mask case among the slice B cases
  (`docs/superpowers/plans/ai-native-journal/phase-24.md:214`) while the
  implementation keeps it in `apps/web/tests/intelligence-insight-card.test.ts`;
  the plan also names that file as its own run
  (`docs/superpowers/plans/ai-native-journal/phase-24.md:225`) and the report
  states the split
  (`docs/superpowers/reports/ai-native-journal-phase-24.md:98`). A plan and
  implementation divergence, documented, not a defect.

- [NOTE] the whole-suite row (`docs/superpowers/reports/ai-native-journal-phase-24.md:139`),
  the production build row (`:143`) and the bundled-worker smoke (`:144`)
  were not re-run here; the brief forbids the full `pnpm test` run. They are
  the earlier run's reported evidence, not claims this review re-verified.

- [NOTE] commit message — the slice is uncommitted in the working tree, so
  there is no commit subject to audit; the orchestrator owns it.

### Summary

17 PASS, 0 FAIL, 0 BLOCK. The three defects of the previous run are fixed and
verified against `readCurrentInsightInTx`, `isSuperseded` and
`pruneInsightsInTx`; the teeth bar was re-measured row by row in a copy of
the tree outside the repository and every count matches the report; no new
operator-visible claim contradicts the code. Four notes are recorded above
(one unverifiable test count, one plan/implementation divergence, the evidence
this run did not re-run, and the absent commit subject).
