## Verdict: PASS

## Reviewer Report — Phase 17: engagement and opportunity coordination

### PASS

Slice reviewed: Phase 17 implementation plus the amended phase plan, uncommitted working tree against
base `7120d77ad9` ("docs: plan the engagement and opportunity coordination"). Run 2 of 2; the two
defects reported by the previous implementation-diff review were re-checked by mutation.

Files in scope and actually touched (`git status --porcelain`, nothing else is modified or added):

- `apps/web/src/server/intelligence/contracts/experience.ts` (extended)
- `apps/web/src/server/intelligence/experience/engagement.ts` (new)
- `apps/web/src/server/intelligence/experience/interactions.ts` (new)
- `apps/web/src/server/intelligence/infrastructure/experience-store.ts` (extended)
- `apps/web/tests/intelligence-engagement.test.ts` (new)
- `docs/superpowers/plans/ai-native-journal/phase-17.md` (amended)
- `.omp/reviewer-report.md` (the review artifact the commit gate reads)

Bound against `docs/orchestration/ai-native-journal/tasks/T-017.md`,
`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md:77`,
`docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md:484-517`,
`docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-design.md:807-860`,
`docs/superpowers/plans/ai-native-journal/phase-17.md`.

Checks run by the reviewer (evidence, not claims):

- `pnpm exec vitest run apps/web/tests/intelligence-engagement.test.ts` — 34 passed, 0 failed.
- `pnpm exec vitest run apps/web/tests/intelligence-workflows.test.ts apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/intelligence-engagement.test.ts apps/web/tests/intelligence-migrations.test.ts apps/web/tests/intelligence-observations.test.ts` — 99 passed, 0 failed.
- `pnpm --filter web typecheck` — clean. Root `pnpm typecheck` fails only in `packages/desktop` (Tauri cargo build cannot find `binaries/node-x86_64-pc-windows-msvc.exe`) — a missing local build artifact, unrelated to this slice.
- `pnpm exec prettier --check` on the six slice files — 2 fail (see Notes). Repo-wide, 78 files already fail at base (e.g. `packages/importers/src/formats/ibkr.ts`, `PRODUCT.md`), so the format gate was already red independently of this slice.
- `git status --porcelain` / `git diff --stat 7120d77ad9` — no schema, migration, registry, checksum, composition, manifest or lockfile change.
- Mutation experiments (temporary copies of the coordinator and of the test file, both deleted afterwards; tree verified clean): three deliberate reversions, each re-run against the suite — results below.

### Findings

#### Defect 1 — "dismissal does not hold for a consolidated opportunity": fixed

- [PASS] `apps/web/src/server/intelligence/experience/interactions.ts:164-166` + `:198-211` — the
  consolidation candidate set is no longer filtered by a live-status list. The store query
  (`experience-store.ts:164-180`) filters only on the `opportunity/` namespace, and the coordinator
  picks between matching rows with `CONSOLIDATION_PRIORITY` (`interactions.ts:159-166`), where
  `dismissed` and `delivered` outrank the open rows and `expired` comes last. A dismissed row is
  therefore reused, not duplicated.
- [PASS] `apps/web/src/server/intelligence/experience/interactions.ts:230-233` — the dismissal lookup
  resolves the marker under the *reused* row's producer key
  (`producerKeyOf`, `interactions.ts:136-139`) as well as under the request's own dedup key, so a
  dismissal recorded for one producer key suppresses the same interaction when a second producer
  offers it.
- [PASS] `apps/web/src/server/intelligence/experience/interactions.ts:298-309` + `:237` — the delivery
  reservation is keyed by the opportunity row id
  (`deliveryKey`, `contracts/experience.ts:397`), and `alreadyDelivered` checks that same key, so a
  previously pushed interaction cannot be pushed again through another producer key.
- [PASS] `apps/web/tests/intelligence-engagement.test.ts:339-357` — the case that pins the behaviour
  ("holds a dismissal across a capability that offers the same interaction later"): the dismissal
  suppresses the second producer and writes no delivery row.
- [PASS] Mutation evidence: reverting the consolidation filter *and* the cross-producer dismissal
  lookup (status filter re-added, marker lookups reduced to the request's own dedup key) makes
  `intelligence-engagement.test.ts:329-337` and `:339-357` fail, the second with
  `expected 'proactive' to be 'suppress'` — the exact reported symptom. The fix is load-bearing and
  test-pinned.

#### Defect 2 — "`advance` reports a status it never persisted": fixed

- [PASS] `apps/web/src/server/intelligence/experience/interactions.ts:271-280` — `advance` uses the
  boolean returned by the store
  (`experience-store.ts:144-162`, `result.changes > 0`) and returns the *unchanged* row when the move
  did not happen, so the reported status is the persisted one.
- [PASS] `apps/web/src/server/intelligence/experience/interactions.ts:148` — `ENGAGEABLE_STATUSES` is
  `["pending", "eligible", "suppressed"]`, so `dismissed`, `expired` and `delivered` are terminal and
  nothing moves a row out of them; the suppress branch (`interactions.ts:324-340`) advances only to
  `dismissed`/`expired` and otherwise hands back the stored row.
- [PASS] `apps/web/tests/intelligence-engagement.test.ts:359-370` and `:372-384` — the cases that pin
  it: the reported status of a terminal opportunity is the stored one, and a delivered opportunity
  keeps `delivered` when it expires.
- [PASS] Mutation evidence: (a) reverting `advance` to fabricate the requested status fails
  `intelligence-engagement.test.ts:372-384` with `expected 'expired' to be 'delivered'`;
  (b) adding `dismissed`/`expired`/`delivered` to `ENGAGEABLE_STATUSES` fails the same case with the
  same message. Both reverting experiments confirm the terminal-status rule and the persisted-status
  rule are genuinely enforced by the suite.

#### Contract, policy and defaults

- [PASS] `apps/web/src/server/intelligence/experience/engagement.ts:1-5`, `:39-95` — the policy is pure:
  its only import is the contract module, and it reads `EngagementInput` and nothing else (no
  `Date.now()`, no `Math.random`, no `fetch`, no `process.env`, no database). The same input always
  yields the same decision.
- [PASS] `apps/web/src/server/intelligence/experience/engagement.ts:41-94` — the rule order matches
  the plan's authoritative table (`phase-17.md:330-344`) exactly: dismissed opportunity → dismissed
  evidence → expired → already delivered → historical → baseline → not actionable → defer → unknown
  activity → busy → contextual → opt-in → daily limit → cooldown → proactive. The packet's outcomes
  (`observe | inbox | contextual | proactive | defer | suppress`) are all reachable.
- [PASS] `apps/web/src/server/intelligence/contracts/experience.ts:382-391` — the defaults are the
  contract's: 24-hour per-subject cooldown, one proactive delivery per day, seven-day expiry,
  `neverExpires` for records that do not expire.
- [PASS] `apps/web/src/server/intelligence/experience/engagement.ts:30`, `:81-92` — the daily-limit
  and cooldown branches report the next eligibility the plan's table names (start of the next UTC
  day; end of the cooldown).
- [PASS] `apps/web/src/server/intelligence/experience/interactions.ts:238-244`,
  `apps/web/src/server/intelligence/infrastructure/experience-store.ts:182-208` — the daily allowance
  and the per-subject cooldown read the delivery rows by namespace, and delivery rows are written once
  and never rewritten, so both counters read immutable history.

#### Domain boundary, storage and scope

- [PASS] `apps/web/src/server/intelligence/contracts/experience.ts:1-8`,
  `apps/web/src/server/intelligence/experience/engagement.ts:1-5`,
  `apps/web/src/server/intelligence/experience/interactions.ts:1-15` — the domain layer imports
  nothing that opens the journal: the only runtime imports are `zod` and `@/server/ids`
  (`node:crypto`); the `@/db/schema` and `@/db/transaction` imports are type-only.
- [PASS] `apps/web/tests/intelligence-engagement.test.ts:471-495` — the domain-boundary case is real,
  not vacuous: it re-imports the domain modules against an empty `JOURNAL_DATA_DIR` and asserts no
  file was written, which is what a runtime `@/db` import would do.
- [PASS] `apps/web/src/server/intelligence/experience/interactions.ts:104-111`, `:190` — the
  transaction seam is injected (`deps.runInTransaction`); the coordinator opens no connection.
  `intelligence-engagement.test.ts:497-514` pins it.
- [PASS] `apps/web/src/server/intelligence/infrastructure/experience-store.ts:122-142` — the opportunity
  reservation keeps the first row: `onConflictDoNothing` on the unique `dedup_key`, then the stored
  row is read back and `created` is false when the key already existed.
- [PASS] `git status --porcelain` — no schema, migration, registry, checksum, composition, manifest
  or lockfile change; the phase adds no migration, exactly as the phase guide allocates it
  (`2026-10-23-ai-native-journal-phases.md:77`, "Uses opportunities in 0007"). The six opportunity
  statuses in `apps/web/src/db/schema.ts:1108` already cover everything the phase writes.
- [PASS] `apps/web/src/server/intelligence/experience/interactions.ts:387-399` — the coordinator writes
  engagement rows only; `intelligence-engagement.test.ts:452-468` asserts accounts, notes, trades and
  executions are byte-identical after an engagement and a dismissal.

#### Plan ↔ implementation agreement

- [PASS] `docs/superpowers/plans/ai-native-journal/phase-17.md:64-68` (status table) —
  `apps/web/src/db/schema.ts:1108` and the code agree: opportunity rows use
  `pending | eligible | delivered | dismissed | expired | suppressed`, delivery rows `delivered`
  (`interactions.ts:291`), dismissal rows `dismissed` (`interactions.ts:393`).
- [PASS] `docs/superpowers/plans/ai-native-journal/phase-17.md:376-383` (consolidation rule) ==
  `interactions.ts:150-166` + `:198-211`: same subject and same evidence set resolve to one row, a
  dismissed or delivered row is reused, and an expired row comes last.
- [PASS] `docs/superpowers/plans/ai-native-journal/phase-17.md:384-386` (terminal-status rule) ==
  `interactions.ts:141-148` + `:271-280`: `dismissed`, `expired` and `delivered` never move, and the
  coordinator reports the status the store holds.
- [PASS] `docs/superpowers/plans/ai-native-journal/phase-17.md:419-450` (test table) — every one of the
  31 planned cases has a case in `apps/web/tests/intelligence-engagement.test.ts` (policy cases at
  `:130-236`, coordinator cases at `:239-468`, boundary/seam cases at `:471-514`, row-kind cases at
  `:517-589`), and the file adds two more (`:329-338`, `:530-561`). The plan's demand that each case
  "must be seen to fail when the production behaviour is deliberately broken"
  (`phase-17.md:419-421`) is met for the three behaviours this review mutates — the three
  reverting experiments above each produced a failing case.

### Notes (non-blocking)

- [NOTE] `apps/web/src/server/intelligence/experience/interactions.ts:193`, `:202-206`, `:229`,
  `:234-236` — when the dedup key already has a row, the request's evidence revisions are dropped and
  the row keeps the evidence it was first recorded with, so a dismissed revision the request *newly*
  cites is not honoured. Reproduction: engage `producer-1` with evidence `["e1"]` →
  `dismiss("evidence", "e2")` → engage `producer-1` with evidence `["e1","e2"]` → decision `proactive`,
  `delivered: true`, and the intent reports `["e1"]`. This is the one place where the plan's wording
  admits two readings (`phase-17.md:373-375` "a repeated producer key returns the original row"
  versus `:397-398` "a dismissal of an evidence revision suppresses every opportunity that rests on
  it"), so it is reported as a clarification for the author rather than a contract breach: the fix is
  to refresh the row's evidence list (or evaluate the dismissal against the union of stored and
  requested revisions) when a repeated key is re-engaged.
- [NOTE] `apps/web/src/server/intelligence/experience/interactions.ts:377-399` — `dismiss` resolves a
  target to a producer key only through `loadEngagement(target)` (the dedup key) or
  `opportunityKey(target)`; a target that is the opportunity row id (exposed as `opportunity.id` on
  `EngagementOutcome.opportunity`, `contracts/experience.ts:275`) or a stored key with no recorded row
  is recorded under an unreachable marker key and moves nothing, so the dismissal is silently
  ignored: engage `producer-a` → `dismiss("opportunity", <row id>)` → engage `producer-a` → outcome
  `proactive`, `delivered: true`. Both forms are outside the documented target vocabulary
  (`interactions.ts:380-381`), so this is a robustness trap for Phase 18 rather than a breach — worth
  resolving by normalising the target (or rejecting an unresolvable target) before the API lands.
- [NOTE] `apps/web/tests/intelligence-engagement.test.ts:367-369` and
  `docs/superpowers/plans/ai-native-journal/phase-17.md:422-450` — these two slice files fail
  `prettier --check` (a hand-wrapped `expect` chain and a misaligned markdown table). The repository
  already fails `pnpm format:check` on 78 files at base, so the gate was red before this slice and
  this slice does not change that; the two touched files should still be normalised
  (`pnpm exec prettier --write` on those two paths).
- [NOTE] `docs/superpowers/reports/ai-native-journal-phase-17.md` still does not exist. The packet
  requires it for delivery (`T-017.md:73`: changed files, migrations, tests, review findings and
  resolutions, deviations, next inputs, source/base/tip SHAs), and it is where the plan's
  deliberate-break evidence (`phase-17.md:419-421`) belongs. The three reversals performed in this
  review are recorded above and can be transferred into that report.
- [NOTE] Nothing is committed yet, so the commit-message audit does not apply; the phase plan's
  conventional subject is the Task 11 suggestion in
  `2026-10-22-ai-native-journal-modernization.md:515`.

### Summary

30 PASS, 0 FAIL, 0 BLOCK, 5 notes. Both defects reported by the previous implementation-diff review
are genuinely fixed and each fix is pinned by a test that fails when the fix is reverted: a dismissal
now holds across producer keys for the same interaction
(`interactions.ts:164-211`, `:230-233`) and the coordinator reports the persisted status while
`dismissed`, `expired` and `delivered` stay terminal (`interactions.ts:148`, `:271-280`). The pure
policy reproduces the plan's rule order and every contract default, the domain layer opens no
journal, the transaction seam is injected, the phase adds no schema or migration, the storage
namespaces keep the three row kinds apart, and every planned acceptance-evidence case has a test. The
remaining items are a clarification of the evidence-list semantics on a repeated producer key, a
robustness trap in `dismiss`'s target resolution, two prettier deviations, and the phase report that
the packet requires at delivery.

### Addendum — post-review amendments

The two robustness notes above were fixed after this PASS, together with the two prettier deviations
and the missing phase report. Each fix is pinned by a case that fails when the fix is reverted:

- **Evidence-list semantics.** `dismissedEvidence` now evaluates the dismissal against the union of
  the row's recorded revisions and the revisions the request cites
  (`apps/web/src/server/intelligence/experience/interactions.ts:234-241`). Reverting the union fails
  "honours a dismissal of a revision a later request cites" (1 failed, 35 passed).
- **`dismiss` target resolution.** An opportunity is now resolved by its stored key, its producer key
  or its row id (`interactions.ts:383-395`); the row-id form reads through the new
  `loadOpportunityById` store method. Reverting it fails "honours a dismissal made against the
  opportunity's row id" (1 failed, 35 passed).
- The suite is now 36 cases, and `docs/superpowers/reports/ai-native-journal-phase-17.md` exists.

These amendments were made after the review budget was spent, so the final diff carries no fresh
review verdict beyond this PASS.
