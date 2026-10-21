# Architecture Discovery — Progress Tracker

> Read-only investigation of the trade-journal monorepo for downstream AI-architecture redesign.

| Phase | Report | Status | Subagent | Notes |
|---|---|---|---|---|
| 1 | `01-project-overview.md` | pending | orchestrator | synthesized after prerequisites |
| 2 | `02-ai-architecture.md` | in-progress | scout A | **most detail** — existing AI is a tool-driven bounded agent |
| 3 | `03-domain-model.md` | in-progress | scout B | trade lifecycle, playbooks, analytics |
| 4 | `04-data-architecture.md` | in-progress | scout B | Drizzle schema, BOOTSTRAP_SQL, ownership |
| 5 | `05-events-and-background-processing.md` | in-progress | scout C | expect short, possibly empty |
| 6 | `06-frontend-architecture.md` | in-progress | scout C | chat, recap, critique surfaces |
| 7 | `07-authentication-and-security.md` | in-progress | scout D | middleware, password-gate, key encryption |
| 8 | `08-runtime-and-operations.md` | in-progress | scout D | Docker, env, telemetry, limits |
| 9 | `09-dependencies-and-coupling.md` | pending | orchestrator | cross-system synthesis |
| 10 | `10-testing-and-quality.md` | in-progress | scout D | Vitest, fixture coverage |
| 11 | `11-architectural-readiness.md` | pending | orchestrator | matrix vs Section 1 categories |
| — | `ARCHITECTURE_CONTEXT.md` | pending | orchestrator | final consolidated package |
| — | `CODE_NAVIGATION.md` | pending | orchestrator | focused file map |
| — | `EVIDENCE_REGISTER.md` | pending | orchestrator | finding ↔ source cross-ref |

## Evidence conventions

Every architectural claim uses an evidence ID `ARCH-NNN` referenced from one or more reports.

Status tags:

- `VERIFIED` — directly traceable to code, schema, or config as cited
- `INFERRED` — reasonable conclusion from code; indirect support
- `UNVERIFIED` — requires runtime / infrastructure not available
- `UNKNOWN` — cannot determine from repo material

## Working rules

- Only modify `docs/architecture-discovery/`.
- Do not edit application code, configuration, or data.
- No new dependencies; no schema changes; no telemetry endpoints.
- Never quote secret values or live provider keys.
