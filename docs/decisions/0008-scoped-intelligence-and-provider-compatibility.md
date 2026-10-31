# 0008 — Keep intelligence evidence-backed, scoped and provider-compatible

- Status: Proposed
- Date: 2026-10-22
- Deciders: Maintainer approval pending; proposed by Codex

## Context

The journal already has scoped AI queries and multiple provider categories. Replacing them
wholesale would risk both privacy and established behavior. Durable intelligence must also
distinguish observable data, reconstructed estimates, user reports and tentative interpretations.

Future conversations and interactive views need shared operations without coupling reasoning
to a particular UI or allowing models to bypass application authorization.

## Decision

Keep intelligence modules inside the private web application and connect domains through typed
ports at an explicit composition root. Retain the current AI runtime behind adapters. Reauthorize
interactive and background contexts; validate tool inputs/outputs and enforce access/budgets.
Background AI MUST be opt-in and bound to its approved provider, model and endpoint. Preserve the
existing hosted-only statement-import policy as a narrow compatibility exception; never turn it
into generic provider fallback. cTrader MCP remains a broker integration under ADR 0002.

Persist observations with versioned evidence and invalidation, keep hypotheses separate, and
persist workflows independently of model calls. Generate typed interaction intents for native
UI; do not execute generated components. Enforce with boundary, scope, routing, correction and
stale-command tests in [the implementation plan](../superpowers/plans/2026-10-22-ai-native-journal-modernization.md).

## Consequences

- Positive: deterministic intelligence needs no model, existing AI routes remain compatible,
  and native UI can later gain another renderer without changing business commands.
- Negative: provenance, policy reservations and invalidation add state that needs retention tooling.
- Forbidden: unrestricted SQL/HTTP tools, automatic broker-tool exposure, silent local-to-hosted
  routing, raw prompt logging, and publishing intelligence through the public package workflow.

Alternatives rejected: a new public intelligence package (premature publishing contract), raw
chat as authoritative memory (no evidence lifecycle), and wholesale AI replacement (unnecessary
compatibility risk). Adapter migration is reversible; persisted workflow/knowledge versions
require explicit migration once released. This ADR does not supersede UI ADRs 0003–0005.

## Implementation note (Phase 12)

Phase 12 implements the scoped part of this ADR:

- The pure runtime contracts (`ExecutionContext`, `Capability`, `Eligibility`, `Outcome`,
  `ToolDefinition`) live in the intelligence contracts module and hold no database, no Next and no
  AI SDK reference. The runtime reaches the journal only through typed query ports that a
  composition supplies.
- The capability registry registers capabilities explicitly and answers in a stable order;
  eligibility is deterministic and never asks a model which capability to run.
- The tool gateway is the only path to a registered tool. It checks the tool allowlist of the
  execution, the access category, the tool-call budget and cancellation, validates the input
  before the call and validates the output before it leaves the gateway. Write access stays with
  the trusted system principal.
- The Ask and Reports tools now run through that gateway. Their results are unchanged, including
  the budget path: the execution context owns the tool-call ceiling and always notifies the runtime
  hook, so a model that exceeds the ceiling still gets the request-level limit error instead of a
  normal answer. The existing provider policy is untouched: hosted OpenAI keeps `store:false`, a
  compatible endpoint keeps its own key, and no prompt or credential diagnostic is exposed.

Background execution, provider policy and budget reservations remain unimplemented and stay with
Phase 13; they are not authorised by this note.
