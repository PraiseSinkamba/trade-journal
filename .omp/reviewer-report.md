## Verdict: PASS

## Repair round (Run 6) — the read guarantee and the card pairing

Scope: `apps/web/tests/intelligence-slice-b.test.ts` (modified),
`apps/web/tests/intelligence-insight-card.test.ts` (modified),
`docs/superpowers/reports/ai-native-journal-phase-24.md` (modified).
**No production code changed**: `git diff --stat -- apps/web/src` is empty on
this tree, and the two breaks below were temporary edits that were restored
and re-measured.

### What I measured myself

| Command | Measured |
| --- | --- |
| `pnpm exec vitest run apps/web/tests/intelligence-slice-b.test.ts apps/web/tests/intelligence-insight-card.test.ts apps/web/tests/intelligence-ui.test.ts apps/web/tests/intelligence-boundaries.test.ts` | 4 files, **51 passed** (boundaries 8, insight-card 5, ui 13, slice-b 25), exit 0, 16 s |
| `pnpm --filter web typecheck` | clean, exit 0, 19 s (95 s on the cold run) |

The whole-project `pnpm test` and `pnpm build` were NOT run in this round: the
destination gate runs them once, on the integrated feature.

### Finding 1 — the read guarantee is now pinned

The claim was "the GET stays a read: it never enqueues, never calls a provider
and never writes". Before this round nothing held it.

The three cases that read the inbox now count the runs, the jobs, the daily
attempt reservations and the provider calls BEFORE the read and compare all
four AFTER it:

- "serves each account its own question" reads twice, once per account, and
  compares after BOTH reads. The counts it compares are not empty: 2 runs,
  2 reservations, 2 provider calls before the reads.
- "stores no question without a provider and leaves the review usable" now
  READS the inbox, and asserts zero provider calls after the read.
- "stores no question for an account the policy does not list" now reads the
  inbox as well, with the same assertion.

Measured break (teeth break 12): the scoped GET was made to enqueue a run.

| Mutation | Result |
| --- | --- |
| the GET inserts a run (`apps/web/src/app/api/intelligence/observations/route.ts`, temporary) | slice-b **3 failed / 22 passed**: the two-account case goes from 2 runs to 4, each provider-free case from 0 to 1 |
| restored | slice-b **25 passed** |

The three failures are exactly the three cases that read the inbox. No other
case fails, because no other case reads it — the break is measured, not
assumed.

### Finding 3 — the pairing is now pinned

The claim was "the question appears on the correct card". Before this round
no test rendered two cards, so a swap of the pairing was invisible.

The fifth card case mounts the INBOX (`IntelligenceInbox`) with two
observations: one under review and carrying the question, one merely offered
for review. It asserts that exactly one card carries the question, that this
card shows the trade the question was made from ("trade-b") and not the other
one ("trade-42"), and that the other card carries no question.

Measured break (teeth break 13): the inbox was made to pick the observation
by position instead of by id (`apps/web/src/components/intelligence/inbox.tsx`,
temporary).

| Mutation | Result |
| --- | --- |
| `observationOf` returns `observationList[0]` | card suite **1 failed / 4 passed**: the card that carries the question shows "trade-42" instead of "trade-b" |
| restored | card suite **5 passed** |

The four other card cases do not notice the swap, because they render one
card at a time. That is why the pairing needed its own case.

### The counts of the earlier breaks that this round touched

The card suite grew from 4 cases to 5, so the two card-suite restore counts
were re-measured on this tree rather than remembered:

| Break | Report before | Measured now |
| --- | --- | --- |
| 3 the card renders the question unmasked | 1 case failed, 4 passed | 1 case failed, **5 passed** |
| 11 the question is rendered as a button | 1 case failed, 4 passed | 1 case failed, **5 passed** |

Every other count in the report's teeth table is unchanged: this round added
assertions to three existing slice-b cases and one new card case, and the
slice-b suite still holds 25 cases.

### What is still not claimed

The report's "What is not claimed" section keeps its claim about a
navigation ORDER between two cards: the pairing is not an order, and no order
is claimed. The read guarantee moved from an assertion to a measured one; no
claim was withdrawn.

### Cleanliness

Only the four files of this round were changed. Every mutation experiment was
a temporary edit in this worktree, restored immediately and re-measured;
`git diff --stat -- apps/web/src` is empty.

## Reviewer Report — Phase 24 final re-review (after the three findings were fixed)

Scope reviewed: `apps/web/tests/intelligence-slice-b.test.ts` (modified),
`apps/web/tests/intelligence-insight-card.test.ts` (modified),
`apps/web/tests/intelligence-insight-smoke.test.ts` (new, untracked),
`docs/superpowers/reports/ai-native-journal-phase-24.md` (modified).
Production code under `apps/web/src` is UNCHANGED in this diff — I read it for
context only and did not modify it. `git diff --stat -- apps/web/src` is empty
after this review.

The three findings of the previous run are re-checked against the tree as it
stands. **All three fixes are confirmed real, by measurement.** No new defect
was found in the fixes, so the verdict is PASS.

### What I measured myself (repo root, branch `codex/ai-native-journal-p24`, HEAD `728af87`)

| Command | Measured |
| --- | --- |
| `npx vitest run` on the six intelligence suites (boundaries, insight-card, insight-smoke, ui, review-insight, slice-b) | 6 files, **82 passed** (boundaries 8, insight-card 4, insight-smoke 1, ui 13, review-insight 31, slice-b 25) |
| `pnpm test` (the whole suite) | **120 files, 1433 tests passed**, 113 s |
| `pnpm --filter web typecheck` | clean, exit 0 (`next typegen` then `tsc --noEmit`) |
| `pnpm --filter web migrations:check` | `migration-checksums.json is up to date.` |
| `npx prettier --check` on the four diff files | "All matched files use Prettier code style!" |
| `pnpm format:check` (working tree) | **78 files** fail: **73 tracked** + **5 untracked** (`desktop/src-tauri/gen/schemas/{acl-manifests,capabilities,desktop-schema,windows-schema}.json`, `local-phase-c-brief.md`) |
| `prettier --check .` on a pristine worktree at HEAD (`728af87`) | **73** files fail; the failing SET is **identical** to the working tree's tracked set (sorted diff: no differences) |
| web + worker production build | not run — outside the permitted command list; the worker half is corroborated because the smoke builds the same artifact with `scripts/build-worker.mjs` and it ran green |

### The three fixes, one by one

**1. The stale-command case now isolates the revision check — CONFIRMED.**
`apps/web/tests/intelligence-slice-b.test.ts:1231-1290`. The case DEFERS the
review (the workflow leaves for `scheduled`, its revision moves on), applies
the workflow effect so the workflow is back in `waiting_for_user` — a status
where `acknowledge` is legal again — and only then sends the card's stale
command. Measured in an out-of-repo copy of the repo (`E:/4004/Temp/p24-final`,
this worktree untouched):

| Mutation | Result | Verdict |
| --- | --- | --- |
| both revision checks disabled (`experience/commands.ts:111` **and** `experience/workflows.ts:261`) | slice-b **1 failed / 24 passed**; the stale case fails with "expected 200 to be 409" | the case bites |
| only the service's check disabled (`commands.ts:111`) | slice-b **25/25 passed** | defence in depth, as the report says |
| only the engine's check disabled (`workflows.ts:261`) | slice-b **25/25 passed** | defence in depth, as the report says |

This is the decisive measurement, and it differs from the previous run's: with
BOTH checks gone the stale command is **accepted (200)**, not merely refused
for a different reason. The refusal the case asserts therefore comes from a
revision check and from nothing else — the status guard no longer
short-circuits it, because the workflow is back in `waiting_for_user`. The
report's prose at `docs/superpowers/reports/ai-native-journal-phase-24.md:161-176`
and its teeth row 10 ("both revision checks are disabled | 1 case failed |
restored | 25 passed") reproduce exactly.

**2. The focusable selector now covers links — CONFIRMED.**
`apps/web/tests/intelligence-insight-card.test.ts:133` selects
`"button, input, textarea, select, a[href], [tabindex]"`. Measured in the
out-of-repo copy: injecting `<a href="/question">Open the question</a>` into the
insight block of `apps/web/src/components/intelligence/interaction-card.tsx`
makes the keyboard case fail ("expected [ <a href="/question"></a>, …(1) ] to
have a length of 1 but got 2"). With the OLD selector (no `a[href]`) the same
injection leaves the card suite 4/4 green — so the selector change, not the
injection, is what closes the gap.

**3. The keyboard case now renders both privacy states on their own mounts —
CONFIRMED.**
`apps/web/tests/intelligence-insight-card.test.ts:120-127` loops over
`["true", "false"]` and gives each state its OWN mount, because
`PrivacyProvider` reads the saved preference in a mount effect
(`apps/web/src/components/privacy.tsx:17-37`). Measured in the out-of-repo
copy:

| Injection | Result |
| --- | --- |
| a `<button>` into the UNMASKED branch (`interaction-card.tsx:215-217`) | card case fails (focusable count 2) — the unmasked branch is exercised |
| a `<button>` into the MASKED branch | card case fails (focusable count 2) — the masked branch is exercised |
| a probe assertion that the masked iteration really contains `••••` and the unmasked one really contains the question text | passes — each iteration renders ITS OWN state, not the same state twice |
| a single mount (remount removed) + a link in the unmasked branch | 4/4 green — the remount is load-bearing; without it the second iteration renders the first state again |

The last row is the load-bearing one: the remount is not cosmetic. The report's
teeth row 11 ("the question is rendered as a button | 1 case failed | restored |
4 passed") reproduces exactly.

### New findings

None. The restructured stale case, the card case's remount loop and the two
selectors were re-read line by line against the production code they exercise:

- The stale case's defer path is sound: `defer` carries a `deferUntil`
  (`NOW`), the schema requires it for a defer (`contracts/experience.ts:118`),
  the transition `waiting_for_user → scheduled` is legal
  (`contracts/experience.ts:170-176`), the effect then takes
  `scheduled → waiting_for_user` (`contracts/experience.ts:207-211`), and
  `applyWorkflowEffect` is the same call the observation route makes
  (`api/intelligence/observations/route.ts:168`). The status/revision
  assertions are exact (`toBe`, not only `toBeGreaterThan`), and the refusal's
  `currentRevision` is compared to the workflow's own revision.
- The card case's remount loop leaks nothing: a probe showed
  `document.body.children.length === 1` after the loop (the loop's own
  `container.remove()` plus `afterEach`'s removal), no React `act` warnings or
  console output, and the four card cases pass unchanged.
- The `ServedScope` type change to `InteractionIntent[]` and the `insightOf` /
  `reviewOf` helpers narrow the previous structural type, and `typecheck` is
  clean.

### The report's own claims, re-measured

Every teeth row of `docs/superpowers/reports/ai-native-journal-phase-24.md`
reproduces on this tree (mutations run in the out-of-repo copy, then restored):

| Break | Report | Measured |
| --- | --- | --- |
| 1 route stops attaching the insight | 6 cases failed | 6 |
| 2 reader drops the evidence-revision check | 1 | 1 |
| 3 card renders the question unmasked | 1 | 1 |
| 4 reader returns the raw store row | 4 | 4 |
| 5 wrong observation-id constant | 7 | 7 |
| 5b observation-id comparison dropped | 1 | 1 |
| 6 route reads another account's insight | 6 | 6 |
| 6a account comparison dropped | 0 | 0 |
| 7 command body builder carries the question as a correction | 1 | 1 |
| 8 observation list ignores the scope | 2 | 2 |
| 9 production registration drops the capability handler | the smoke failed | the smoke failed ("no question was stored", worker `processed:1 leaseHeld:true`) |
| 10 both revision checks disabled | 1 | 1 |
| 11 the question is rendered as a button | 1 | 1 |

Restores: slice-b **25 passed**, card **4 passed**, smoke **1 passed** — the
sizes the report states.

### Cleanliness

Only `.omp/reviewer-report.md` was written. Every mutation experiment ran in
the out-of-repo copy `E:/4004/Temp/p24-final` (deleted afterwards); this
worktree's `apps/web/src` and the three test files were never edited, and
`git status --porcelain` shows the same four entries as before this review.
The pristine worktree used for the format comparison was removed with
`git worktree remove --force`.
