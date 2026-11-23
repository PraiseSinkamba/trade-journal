## Verdict: PASS

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
