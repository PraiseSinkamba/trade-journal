## Verdict: PASS

## Reviewer Report — Phase 17 repair: the two claim findings

### PASS

Slice reviewed: the Phase 17 repair diff, uncommitted working tree against `HEAD` = `9fb76c7`
("docs: record the Phase 17 engagement evidence"). The coordinator's implementation-diff review
returned FAIL on two false claims in the phase plan and phase report (Finding 1 BLOCK, Finding 2
FAIL). The production policy was not wrong. This run judges whether the repair is honest and
correct.

Both findings are closed, honestly, in **both** documents. The policy is unchanged, the counted set
is unchanged, the `EXPLAIN QUERY PLAN` output quoted in the report is real and byte-for-byte
reproducible, and the two new test cases are load-bearing for the counted set. The phase owns no
migration and none was added. Three non-blocking notes follow (two P3 in the patch, one pre-existing).

Files in scope and actually touched (`git status --porcelain`, nothing else modified or added):

- `apps/web/src/server/intelligence/infrastructure/experience-store.ts` (modified)
- `apps/web/tests/intelligence-engagement.test.ts` (modified)
- `docs/superpowers/plans/ai-native-journal/phase-17.md` (modified)
- `docs/superpowers/reports/ai-native-journal-phase-17.md` (modified)
- `.omp/reviewer-report.md` (the review artifact the commit gate reads)

No schema, migration, migration registry, migration checksum, composition, package manifest or
lockfile change — `git status --porcelain` shows only the four files above, and
`git diff --stat` is `4 files changed, 235 insertions(+), 40 deletions(-)`.

### Checks run by the reviewer (evidence, not claims)

- `git status --porcelain` — exactly the four in-scope files modified. Exit 0.
- `pnpm exec vitest run apps/web/tests/intelligence-engagement.test.ts` — **38 passed (38)**,
  1 file, 3.56s. Exit 0.
- `pnpm exec vitest run apps/web/tests/intelligence-*.test.ts` — **17 files, 293 passed** (291 at
  HEAD + the 2 new cases). Exit 0.
- `pnpm --filter web typecheck` — `next typegen` ok, `tsc --noEmit` clean. Exit 0. (The
  repo-wide `pnpm typecheck` fails in `packages/desktop` on the missing local Tauri binary
  `binaries/node-x86_64-pc-windows-msvc.exe` — pre-existing, out of scope, not reported as a
  finding.)
- `pnpm exec prettier --check` on the four changed files — "All matched files use Prettier code
  style!". Exit 0.
- `EXPLAIN QUERY PLAN` reproduced against the journal's own schema with a throwaway vitest file
  under `apps/web/tests/` (journal module imported after `JOURNAL_DATA_DIR` pointed at an
  `mkdtempSync` directory, exactly as the engagement suite does). **All six plan blocks in the
  report reproduce character-for-character.** The throwaway file was deleted; the tree was
  verified clean afterwards.
- Mutation experiments on `experience-store.ts` (file backed up outside the repo, mutated, suite
  re-run, restored; md5 `207ddebf13b08fcc918fe3e2ace2d97e` matches the pre-mutation file and
  `git diff --stat` is unchanged).

### Findings

#### Finding 1 (BLOCK in the coordinator's review) — "a proactive push needs a matching context": CLOSED

- [PASS] `apps/web/src/server/intelligence/experience/engagement.ts:76` — `decideEngagement`
  returns `contextual` **only** when `input.context` is non-null and its subject matches. With no
  matching context the function falls through to `:79` (`not_opted_in`), `:82` (`daily_limit`),
  `:87-92` (`cooldown`) and finally `:94` (`proactive_allowed`). The code does exactly what the
  contract says: a matching context makes the offer _contextual_ instead; it is not a
  precondition of a proactive push.
- [PASS] `apps/web/src/server/intelligence/experience/engagement.ts` is **not in the diff** — the
  policy's behaviour is untouched. `git status` confirms it is unmodified.
- [PASS] `docs/superpowers/plans/ai-native-journal/phase-17.md:366-370` — "Proactive delivery needs
  the opt-in (rule 12), a _known_ idle operator (rules 9–10) and both interruption limits (rules
  13–14). A matching UI context is **not** one of the requirements: rule 11 decides only that a
  matching context is served _contextual_. Without a matching context the offer falls through to
  the opt-in, the daily allowance and the cooldown checks, and can still be delivered
  proactively." This matches `engagement.ts` line for line.
- [PASS] `docs/superpowers/reports/ai-native-journal-phase-17.md:25-27` — the Outcome section now
  reads "a proactive push needs the opt-in, a known idle operator and an unspent day — a matching
  UI context is not a precondition of a push, it makes the offer contextual instead".
- [PASS] The plan's rule table (`phase-17.md:344-357`) is unchanged and was re-checked against
  `engagement.ts`: rules 1–15 in the table are in exactly the order the function evaluates them,
  with rule 11 (`contextual`) before rules 12–14 (`inbox`) and rule 15 (`proactive`). No
  contradiction remains between the table and the prose.
- [PASS] `docs/superpowers/reports/ai-native-journal-phase-17.md:230` quotes the umbrella detailed
  plan correctly. Verified at
  `docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md:515` — "Contextual
  requires matching UI context; unknown activity uses inbox" — which constrains the _contextual_
  outcome only and never claimed proactive needs a context. That file is outside the repair's
  four-file scope and correctly left alone.
- [PASS] Repo-wide grep of both documents for `context` / `matching context`: every occurrence is
  either the corrected statement, the rule-11 table row, or a correct description of the
  `contextual` outcome. **No remaining instance of the false claim.**

#### Finding 2 (FAIL in the coordinator's review) — "the scan was bounded by a handful of rows": CLOSED

- [PASS] The claim is corrected in the plan (`phase-17.md:90-101`) and in the report
  (`ai-native-journal-phase-17.md:55-80`, `:237-258`), both stating the real bound: the table
  grows by a row per opportunity, per dismissal and per delivery, forever; the namespace prefix
  `like 'delivery/proactive/%'` cannot seek the `dedup_key` index; the cost of those queries grows
  with the table.
- [PASS] The premise is verified, not asserted. `apps/web/src/db/bootstrap.ts:251-252` sets only
  `journal_mode = WAL` and `foreign_keys = ON`; a repo-wide grep finds `case_sensitive_like` in
  exactly one place — the new comment in `experience-store.ts` — so it is never set. The journal's
  pragmas read back at runtime: `journal_mode = wal`, `foreign_keys = 1`,
  `case_sensitive_like = undefined` (off), SQLite 3.53.2.
- [PASS] `apps/web/src/db/schema.ts:1120-1123` — the four indexes are
  `intelligence_opportunities_dedup_unique (dedup_key)`,
  `intelligence_opportunities_eligibility_idx (status, eligible_at)`,
  `intelligence_opportunities_expiry_idx (expires_at)` and
  `intelligence_opportunities_account_idx (account_id)`. The eligibility index the repair relies
  on **already exists** — no migration, no schema change.
- [PASS] The report states plainly what it could **not** fix and hands it on: `findOpportunitiesBySubject`
  still scans the table (no index covers `subject_type`/`subject_id`), and the cooldown read still
  walks the delivered rows (`ai-native-journal-phase-17.md:73-79`). The next-phase handoff
  (`:365-370`) carries both to the next migration, which owns the schema. The phase adds no
  migration, index or schema change — confirmed by `git status`.

##### The `EXPLAIN QUERY PLAN` output is real

Reproduced against the journal's own schema (real journal database, real drizzle-built SQL from
the same schema object and the same operators the store uses). Every line of every block in the
report's "Query plans" section (`ai-native-journal-phase-17.md:260-291`) matches exactly:

```
### countProactiveDeliveriesSince — before
select count(*) from "intelligence_opportunities" where ("intelligence_opportunities"."dedup_key" like ? and "intelligence_opportunities"."eligible_at" >= ?)
SCAN intelligence_opportunities

### countProactiveDeliveriesSince — after
select count(*) from "intelligence_opportunities" where ("intelligence_opportunities"."status" = ? and "intelligence_opportunities"."dedup_key" like ? and "intelligence_opportunities"."eligible_at" >= ?)
SEARCH intelligence_opportunities USING INDEX intelligence_opportunities_eligibility_idx (status=? AND eligible_at>?)

### lastProactiveDeliveryAt — before
select max("eligible_at") from "intelligence_opportunities" where ("intelligence_opportunities"."dedup_key" like ? and "intelligence_opportunities"."subject_type" = ? and "intelligence_opportunities"."subject_id" = ?)
SEARCH intelligence_opportunities

### lastProactiveDeliveryAt — after
select max("eligible_at") from "intelligence_opportunities" where ("intelligence_opportunities"."status" = ? and "intelligence_opportunities"."dedup_key" like ? and "intelligence_opportunities"."subject_type" = ? and "intelligence_opportunities"."subject_id" = ?)
SEARCH intelligence_opportunities USING INDEX intelligence_opportunities_eligibility_idx (status=?)

### findOpportunitiesBySubject — unchanged, handed to the next migration
select "id", "dedup_key", ... from "intelligence_opportunities" where ("intelligence_opportunities"."subject_type" = ? and "intelligence_opportunities"."subject_id" = ? and "intelligence_opportunities"."dedup_key" like ?)
SCAN intelligence_opportunities

### the namespace prefix on its own — why the dedup_key index cannot seek it
select count(*) from "intelligence_opportunities" where "intelligence_opportunities"."dedup_key" like ?
SCAN intelligence_opportunities USING COVERING INDEX intelligence_opportunities_dedup_unique
```

The index list read back from `sqlite_master` matches the report's "its four indexes" exactly.
The report's honest caveats are also accurate: the cooldown read's plan constrains only
`status=?` (so it walks the delivered rows), and the subject lookup is a plain `SCAN`.

##### The counted set is unchanged by the status filter

- [PASS] Code path. `apps/web/src/server/intelligence/experience/interactions.ts:288-298` — a
  delivery row is inserted with `dedupKey: deliveryKey(opportunity.id)` and `status: "delivered"`.
  `contracts/experience.ts:397` — `deliveryKey` is the **only** producer of the
  `delivery/proactive/` namespace; opportunity rows use `opportunityKey` and dismissal rows use
  `dismissalKey`. `interactions.ts:148` — `ENGAGEABLE_STATUSES = ["pending", "eligible",
  "suppressed"]`, and every status move goes through `advanceOpportunity(..., ENGAGEABLE_STATUSES,
  to, ...)` (`:278` and `:408`), so `delivered` is terminal and no row ever leaves it. The filter
  therefore adds no row and removes none.
- [PASS] Empirically, on a journal populated with every row kind the journal writes — opportunity
  rows in all six statuses (`pending`, `eligible`, `delivered`, `dismissed`, `expired`,
  `suppressed`), two `delivery/proactive/` rows and one `dismissal/` row — the counted set is
  identical with and without the filter: `count with status filter = 2`,
  `count without status filter = 2`; `cooldown with filter ids = ["r7"]`,
  `cooldown without filter ids = ["r7"]`.

#### The two new test cases are load-bearing for the counted set

- [PASS] `apps/web/tests/intelligence-engagement.test.ts:275-288` — "counts a proactive delivery
  once and never counts the opportunity it came from". Mutation: drop the namespace predicate
  `like(dedupKey, "delivery/proactive/%")` from `countProactiveDeliveriesSince` →
  **1 failed, 37 passed** — `AssertionError: expected 2 to be 1` at
  `intelligence-engagement.test.ts:285`. This is exactly what the report claims at
  `ai-native-journal-phase-17.md:303-305` ("Dropping the namespace predicate from the count makes
  this case fail with 2 instead of 1") — reproduced.
- [PASS] `apps/web/tests/intelligence-engagement.test.ts:290-303` — "reads the last proactive
  delivery of a subject and of no other". Mutation: drop the subject filters from
  `lastProactiveDeliveryAt` → **2 failed, 36 passed**, including this case (it fails because
  `other` is no longer `null`) and the pre-existing "keeps a subject inside its cooldown and lets
  another subject through".
- [PASS] Restored after each mutation; the full suite is green again (38 passed) and the store file
  is byte-identical to the pre-review state (md5 `207ddebf13b08fcc918fe3e2ace2d97e`).
- [PASS] No existing case was weakened. The diff adds 30 lines to the test file and changes no
  existing assertion.

### Notes (non-blocking, none of them a defect)

- [NOTE] `apps/web/src/server/intelligence/infrastructure/experience-store.ts:205-207` — the new
  comment says "only delivery rows carry the `delivery/proactive/` namespace, **and only delivery
  rows carry the status**". The second clause is false: an opportunity row also carries the status
  `delivered` after a proactive delivery (`interactions.ts:315`, `advance("delivered")`), and the
  patch's own new test asserts exactly that
  (`intelligence-engagement.test.ts:287`, `expect(opportunityRows()[0]?.status).toBe("delivered")`),
  as does the report at `ai-native-journal-phase-17.md:302-303`. The conclusion the comment draws
  is still correct — it rests on the namespace, not on the status — and the report states it
  correctly, so the code is right and only the comment's supporting clause is imprecise.
  Priority: P3. Actionable: drop the clause; the namespace sentence already carries the reason.
- [NOTE] The two new tests do **not** detect removal of the status filter. Mutation: drop
  `eq(status, "delivered")` from `countProactiveDeliveriesSince` → 38 passed; drop it from
  `lastProactiveDeliveryAt` → 38 passed. This is expected and correct: the filter is
  set-preserving by design, so no behavioural test can fail on it, and the new cases pin the
  counted set, which is what the contract asked for ("two added cases pinning the counted set").
  The report does not claim otherwise. The consequence is that the only reason the filter exists —
  making the eligibility index serve the query — is pinned solely by the `EXPLAIN QUERY PLAN`
  output quoted in the report, which no test asserts. Coverage gap for the orchestrator's
  decision, not a defect in this patch. Priority: P3.
- [NOTE] Pre-existing, not introduced by this patch, recorded for completeness:
  `ai-native-journal-phase-17.md:121` says "The `ExperienceStore` port gained six methods" and then
  lists seven (`loadEngagement`, `loadOpportunityById`, `insertEngagement`, `advanceOpportunity`,
  `findOpportunitiesBySubject`, `countProactiveDeliveriesSince`, `lastProactiveDeliveryAt`). The
  same text is present at `HEAD` (`git show HEAD:docs/superpowers/reports/ai-native-journal-phase-17.md`,
  line 98), so the repair did not introduce it.

### Summary

N PASS, 0 FAIL, 0 BLOCK (hard blocks prevent further review)

- Finding 1 (BLOCK) — closed honestly in the plan and the report; the policy is unchanged and the
  documents now say what `decideEngagement` actually does.
- Finding 2 (FAIL) — closed honestly: the real bound is stated in both documents, the daily count
  is served by the **existing** `intelligence_opportunities_eligibility_idx` with no migration, the
  remaining scans are stated plainly and handed to the next migration, and the quoted query plans
  reproduce byte-for-byte against the journal's own schema.
- The counted set is provably unchanged; the two new cases are load-bearing for it; the tree is
  clean apart from `.omp/reviewer-report.md`.

### Addendum — post-review amendments

The review's notes were closed after this PASS. The review budget for this repair was one run, so
no second run was spent; the amendments below were re-verified by the commands listed.

- **NOTE — the store comment claimed "only delivery rows carry the status".** False: an opportunity
  row that was delivered also carries `delivered`
  (`apps/web/src/server/intelligence/infrastructure/experience-store.ts:203-211`). The conclusion
  the comment supports is still correct — the counted set is decided by the namespace, and every row
  that carries the `delivery/proactive/` namespace carries the status — so the clause was rewritten
  to say exactly that. No behaviour changed.
- **NOTE — the phase report said the port gained "six methods" and listed seven.** Corrected to
  "seven methods" (`docs/superpowers/reports/ai-native-journal-phase-17.md:121`). The text was
  pre-existing at `HEAD`; the repair corrects it because it rewrites that report anyway.
- **NOTE — the new cases cannot detect the removal of the status filter.** By design: the filter is
  set-preserving, so no behavioural case can fail on it, and the two new cases pin the counted set,
  which is what the contract asked for. The reason the filter exists — the `EXPLAIN QUERY PLAN`
  output quoted in the report — is pinned by those plans, not by a test. The report does not claim
  otherwise and no test was weakened to hide the gap.

Re-verified after the amendments:

| Command                                                               | Exit | Result             |
| --------------------------------------------------------------------- | ---- | ------------------ |
| `pnpm exec vitest run apps/web/tests/intelligence-engagement.test.ts` | 0    | 38 passed (38)     |
| `pnpm --filter web typecheck`                                         | 0    | clean              |
| `pnpm exec prettier --check <the four changed files and this report>` | 0    | clean              |

