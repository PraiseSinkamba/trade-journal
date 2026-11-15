## Verdict: PASS

# Reviewer Report — Phase 19 repair: the observations pairing fix

Slice reviewed: the Phase 19 observations pairing repair on top of `b3ed0a14a6` ("docs: report the web
suite run against the committed tree"), the coordinator's option-A grant of
`apps/web/src/app/api/intelligence/observations/route.ts` and
`apps/web/src/app/api/intelligence/queries.ts`.

The finding this repair closes is the MAJOR of the implementation review (see the report above, kept for
the record): the observation surface paired the FIRST workflow of an observation instead of the
ACTIONABLE one, so after an acknowledgement the served intent vanished, the still-active observation was
offered a review again, the newly started workflow was never rendered because the stale completed one won
the pairing, and every cycle leaked a workflow row. The coordinator confirmed the finding and granted
the ownership to fix it server-side.

## What the repair does

1. **The actionable workflow is paired.** `listObservationReviews` returns the review workflows of the
   given observations, oldest first, and only the review definition counts. The route pairs the review
   that WAITS for the operator (`waiting_for_user`), not the first one, so a review the operator already
   gave no longer hides the review that is due.
2. **The review state is served.** Every observation answers with a `reviewState`: `unreviewed` (no
   review), `live` (a review waits, runs or is deferred) or `reviewed` (the operator gave the review).
   The client reads it and never offers a review of an observation that already carries one, so the
   answer survives a reload.
3. **A second review is refused.** `POST /api/intelligence/observations` answers `409
   review_already_started` when the observation carries a review that is live or already given, and
   writes nothing. An ABANDONED review (cancelled or failed) holds nothing: the observation may be
   reviewed again.

Nothing else changed. The same-origin validation, the authentication gate, the status codes, the
sanitised unexpected errors, the scope checks and the active-observation filter that refuses a
superseded or invalidated observation with `400` are exactly as they were; the client-side mitigation
(the session's list of the observations it put up for review, and the intent the POST answered with) is
kept, and the two agree.

## The test that pins it

`apps/web/tests/intelligence-slice-b.test.ts` — "the observation reviews > pairs the review that waits,
refuses a second one and leaks no row" — takes one observation through repeated review cycles:

- the inbox starts the review; the surface serves that review's intent and the observation reports
  `live`; exactly one workflow row exists and it waits for the operator;
- a second start is refused with `409 review_already_started` and writes nothing;
- the operator gives the review; the surface then serves no intent, the observation reports `reviewed`,
  and the start is refused again — no row leaked;
- an abandoned review holds nothing: a fresh review starts, the surface serves the NEW review rather
  than the abandoned one, exactly one live workflow remains, and the abandoned row is the only other one.

`apps/web/tests/intelligence-ui.test.ts` — the client half: an observation the server says carries a
review is never offered a review again, and a `409` refusal is reported as "already under review" with
the list refreshed.

### The proof that the test has teeth

The pairing was broken deliberately — `ofRow.filter((review) => review.status ===
"waiting_for_user").at(-1)` became `ofRow[0]`, the defect itself — and the gate was run:

| Run | Result |
| --- | --- |
| The pairing broken | **exit 1** — the gate fails |
| The pairing restored | **exit 0** — the gate passes |

The file was restored byte-for-byte and the restore was verified before the second run.

## Commands run

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm exec vitest run apps/web/tests/intelligence-ui.test.ts apps/web/tests/intelligence-slice-b.test.ts` | **0** | 2 files, 27 tests passed |
| `pnpm --filter web typecheck` | **0** | `next typegen` + `tsc --noEmit` clean |
| `pnpm exec vitest run apps/web/tests/intelligence-routes.test.ts` | **0** | 1 file, 21 tests passed — the Phase 18 route contract still holds |

## Verified as correct (no action)

- **The Phase 18 contract is intact.** The route keeps its same-origin validation, its authentication
  gate, its `400 invalid_request`, its `403 scope_denied`, its sanitised `500` and its refusal to
  review a superseded or invalidated observation. The Phase 18 route suite passes unchanged apart from
  one fixture line: the authentication gate now starts its review on an observation that carries no
  review, because an observation that already carries one is refused by the new rule.
- **Boundaries.** The client layer imports no `@/server` and no `@/db`; the new `reviewState` is a
  public DTO in `apps/web/src/lib/intelligence-interactions.ts`. No schema change, no migration, no new
  dependency, no change to the Phase 13 background policy.
- **The review state is truthful.** `live` covers a review that waits, runs or is deferred;
  `reviewed` means the operator gave the review; a cancelled or failed review is `unreviewed`, so the
  observation may be reviewed again.
