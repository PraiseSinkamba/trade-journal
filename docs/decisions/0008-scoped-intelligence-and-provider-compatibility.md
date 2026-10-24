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
