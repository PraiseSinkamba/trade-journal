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

1. **The actionable workflow is paired.** `listObservationWorkflows` reads the workflows of the given
   observations, ordered by the creation instant and the id — a total order, so two reads pair the same
   review. The route keeps the review rules: only the review definition counts, and the review that is
   paired is the one that WAITS for the operator (`waiting_for_user`), not the first one. A review the
   operator already gave no longer hides the review that is due.
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

`apps/web/tests/intelligence-slice-b.test.ts` — "the observation reviews" — takes one observation
through repeated review cycles:

- "pairs the review that waits, refuses a second one and leaks no row": the inbox starts the review;
  the surface serves that review's intent and the observation reports `live`; exactly one workflow row
  exists and it waits for the operator; a second start is refused with `409 review_already_started` and
  writes nothing; the operator gives the review; the surface then serves no intent, the observation
  reports `reviewed`, and the start is refused again — no row leaked.
- "serves the review that waits after an abandoned one was replaced": the first review is abandoned, a
  fresh review starts, and the surface serves the NEW review rather than the abandoned one. Exactly one
  live workflow remains; the abandoned row is the only other one.

`apps/web/tests/intelligence-ui.test.ts` — the client half: an observation the server says is under
review or already reviewed is never offered a review again, and a `409` refusal is reported as "already
under review" with the list refreshed.

### The proof that the test has teeth

Each break was made deliberately, the gate was run, and the file was restored before the next run:

| Break | Result |
| --- | --- |
| The pairing — `ofRow.filter((review) => review.status === "waiting_for_user").at(-1)` became `ofRow[0]`, the defect itself | **exit 1** — "expected [] to have a length of 1 but got +0": the surface served no intent |
| The refusal — the `409` guard was removed | **exit 1** — "expected 200 to be 409": a second review was started |
| Both restored | **exit 0** — 15 tests passed |

## The review of this repair and its findings

An independent review of the diff (read-only, against the contract of the repair) reported five MINOR
findings. Four are fixed in `8ac2572229` ("fix: make the observation review pairing deterministic and
keep its rules in the route"):

1. **The client test could not fail for the "reviewed" state.** The two states were asserted in one
   loop, and the second render reused the first read (the hook's deps are the url and the tick), so the
   "reviewed" half asserted the "live" payload. The loop is split into two cases, each with its own
   read.
2. **The read model decided scope policy.** The query dropped the account filter and stated in its own
   comment that a scope may not hide a review. The module's rule is that the queries decide nothing, so
   the query reads rows by the ids the caller resolved and the route says why: the GET reads the reviews
   of the scope's own observations, and the POST reads the reviews of an observation whose account the
   scope already admits.
3. **The read model re-encoded a domain rule.** The query filtered on the review definition key, a rule
   the intent builder owns. The query is definition-agnostic now; the route keeps the rule.
4. **The order was not a total one.** The sort key was the creation instant alone, so two reviews
   created in the same millisecond were ordered by whatever the database returned. The order is
   `ORDER BY created_at, id` now.

The fifth finding is recorded, not fixed:

5. **The refusal is read outside the write transaction.** Two overlapping requests on two web processes
   against one journal file could both read "unreviewed" and both write a workflow row. The journal
   transactions are synchronous by contract (`apps/web/src/db/transaction.ts`) and there is no `await`
   between the check and the write, so one web process cannot interleave them; the deployed shape is one
   web process. A guard inside the transaction that starts the workflow needs an in-transaction variant
   of `startWorkflow` — a Phase 20 input.

## Commands run

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm exec vitest run apps/web/tests/intelligence-ui.test.ts apps/web/tests/intelligence-slice-b.test.ts` | **0** | 2 files, 28 tests passed |
| `pnpm --filter web typecheck` | **0** | `next typegen` + `tsc --noEmit` clean |
| `pnpm exec vitest run apps/web/tests/intelligence-routes.test.ts` | **0** | 1 file, 21 tests passed — the Phase 18 route contract still holds |
| `pnpm exec vitest run apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/intelligence-observations.test.ts apps/web/tests/intelligence-workflows.test.ts apps/web/tests/intelligence-engagement.test.ts apps/web/tests/intelligence-jobs.test.ts` | **0** | 5 files, 103 tests passed |
| `pnpm exec prettier --check <the changed files>` | **0** | every changed file is Prettier-clean |

The whole-project `pnpm test` suite was not run: the coordinator runs the destination gate once, alone,
after the merge.

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
- **The refusal leaves no trace.** The check runs before the workflow is started, so a refused start
  writes no workflow row, no transition and no command.
