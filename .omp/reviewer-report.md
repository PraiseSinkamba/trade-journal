## Verdict: PASS

# Reviewer Report — Phase 18 implementation diff (authenticated interaction/control APIs)

Slice reviewed: the uncommitted Phase 18 working tree against `HEAD` = `3261798350`
("docs: plan the authenticated interaction APIs"). One review, per the phase budget.
Plan of record: `docs/superpowers/plans/ai-native-journal/phase-18.md`.

## PASS

Files in the slice (nothing outside the owned set):

- `apps/web/src/lib/intelligence-interactions.ts` (new) — the public DTOs and the strict request schemas.
- `apps/web/src/server/request-origin.ts` (new) — the origin policy.
- `apps/web/src/server/intelligence/experience/intents.ts` (new) — the intent builders.
- `apps/web/src/server/intelligence/experience/commands.ts` (new) — the command service.
- `apps/web/src/server/intelligence/experience/interactions.ts` (modified) — the Phase 17 `InteractionIntent` renamed to `EngagementIntent`, shape unchanged.
- `apps/web/src/server/intelligence/composition.ts` (modified) — the wiring, additive.
- `apps/web/src/server/api.ts` (modified) — the `origin` and `sanitize` handler options, additive.
- `apps/web/src/app/api/intelligence/{queries.ts,observations,opportunities,commands,conversations,status}/route.ts` (new).
- `apps/web/tests/intelligence-routes.test.ts` (new).

### What the review checked

- **The status codes are the fixed ones.** `400 invalid_request`, `401 Unauthorized`, `403 origin_denied`,
  `403 scope_denied`, `409 stale_revision` with `currentRevision`, `500 Internal error`. A `RequestError`
  keeps its `400` and its message; every other unexpected error is sanitized when the route asks for it.
  The unsanitized path is unchanged, so no existing route changes its contract.
- **The origin policy is explicit about a missing `Origin`.** A missing origin with no fetch site is the
  trusted nonbrowser case and is allowed; a missing origin that declares `Sec-Fetch-Site: cross-site` is
  refused; a foreign origin is refused; the origin of the request itself and `JOURNAL_ALLOWED_ORIGINS` are
  the allowed set. A browser always sends one of the two headers, so no cross-site browser request passes.
- **The server decides.** The action id is a handle. The service parses it, requires its revision to
  equal the requested `expectedRevision`, loads the workflow, compares the stored revision, compares the
  account with the resolved scope and only then calls the engine. A client cannot widen anything by
  putting an action in a payload: the action id alone authorizes nothing.
- **The scope is server-derived.** A named account must exist; a name that does not exist is a revoked
  scope and is `403`. A workflow whose account is outside the scope is `403`. The engine's own scope
  check stays in place as the second line.
- **A refused command writes nothing.** The stale and purge checks run before the engine opens its
  transaction, and the test asserts that the engine was never called.
- **The purge race leaves nothing half-applied.** The account is deleted through the real account route,
  the command that follows is `409`, and the journal holds no transition row and no command row.
- **The layering holds.** `lib/` imports no server and no database code; `request-origin.ts` imports no
  Next and reads no cookie; only `composition.ts` wires the concrete adapters; the routes import
  composition and composition imports no route. The existing import-guard suite is green.
- **No schema change.** No migration, no `db/schema.ts` change, no registry or checksum change.

### Findings

- **P3 — the workflow effect job survives an account purge.** `intelligence_jobs` carries no account
  foreign key and the Phase 07 purge helper does not delete those rows, so the job of a purged workflow
  stays in the table. The command itself writes nothing, so this phase's promise holds. The leak belongs
  to the Phase 07 purge helper and to the Phase 13 retention work; it is recorded in the phase report as
  a next-phase input, not fixed here (the purge helper is not in this phase's ownership).
- **P3 — `inputRequestIntent` has no route consumer yet.** The `input-request` member of the union is
  constructed by a builder that no route serves yet; the UI that would surface it is Phase 19.
  The builder is kept because the union member would otherwise be unconstructible.
- **P3 — `POST /api/intelligence/observations` is not named in the detailed plan.** The plan names the
  route family; without a way to start a review workflow no workflow would ever exist in production and
  the command route would be unreachable. It is backend-only, inside the named family, and recorded as a
  deviation.

### Not blocking, checked and accepted

- The origin check runs after the authentication gate: an unauthenticated request is refused as
  unauthenticated, whatever origin it claims.
- The command ledger is consulted before the revision check, so the retry of an applied command is
  answered `duplicate` instead of being refused as stale. The engine's own ledger keeps that answer
  correct.
- The opportunities route lists only live opportunities (pending, eligible, suppressed, not expired).
- The evidence dismissal of a revision that belongs to no observation needs an unrestricted scope.

## Evidence

- `pnpm exec vitest run apps/web/tests/intelligence-routes.test.ts` → 19 passed.
- `pnpm --filter web typecheck` → exit 0. The root `pnpm typecheck` fails only in the `desktop` Rust
  package (missing Tauri sidecar binary on this host); no desktop file is in the slice.
- `pnpm exec vitest run` over `ai-reports-route`, `api-auth`, `auth-gate.unit`, `intelligence-workflows`,
  `intelligence-engagement`, `intelligence-boundaries`, `account-mutation-routes`, `ai-ask-agent` →
  110 passed.
- Every behaviour was broken once and seen to fail, then restored and seen to pass; the results are in
  the phase report.
