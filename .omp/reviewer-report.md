## Verdict: PASS

# Reviewer Report — Phase 18 plan (`docs/superpowers/plans/ai-native-journal/phase-18.md`)

Reviewed against the committed packet `docs/orchestration/ai-native-journal/tasks/T-018.md`,
the phase guide row 18, detailed-plan Task 12 and contract review §2–§6.

## PASS

- Scope matches the packet: server side only, no `apps/web/src/components/intelligence/`, no
  shell or settings page, no schema change, migrations 0001–0007 untouched.
- The required contracts are bound: `InteractionIntent` as a strict union of observation-review,
  status and input-request; `WorkflowResult` from the command route; 400 invalid, 401 auth,
  403 scope/origin, 409 stale.
- The origin policy is explicit for the missing-`Origin` case (trusted nonbrowser, refused when a
  fetch site is declared), so a missing header is not "any cross-site request is fine".
- The server decides: the action id is a handle, resolved against stored state (workflow exists,
  in scope, revision matches, transition legal) before the engine runs.
- The purge race has a defined outcome (409, nothing written) and the command decision happens
  before the engine transaction opens.
- The public DTO module is free of server and database imports, as the rule-3 import guard
  requires.

## Non-blocking notes

- The Phase 17 `InteractionIntent` in `experience/interactions.ts` is renamed to
  `EngagementIntent`; the shape is unchanged and the name is used nowhere else.
- `POST /api/intelligence/observations` (start the review workflow) is the one route the detailed
  plan does not name explicitly. Without it no workflow can exist in production, and the command
  route would be unreachable. It is backend-only and stays inside the named route family.
