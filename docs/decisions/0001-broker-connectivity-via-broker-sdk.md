# 0001 — Broker connectivity routes through `@luxalgo/broker-sdk`

- Status: Accepted
- Date: 2026-09-30
- Deciders: trade-journal maintainers

## Context

The journal needs to talk to a dozen-plus brokers today (sync positions,
OAuth, market data, statement pulls) and brokers keep arriving. Writing
direct HTTP or vendor SDK code into the importer package or the web server
has already produced three concrete problems:

- credentials split across N independent code paths, each with its own
  refresh, rotation, and revocation story;
- the open-source repository becomes a single point of legal liability for
  broker terms it does not control;
- new broker features stall on this repo's release cadence even when the
  upstream SDK already supports them.

The hard block on raw fetch, axios, and `http.` inside
`packages/importers/src/` was introduced to push back against the first
two problems, but without a positive path it was enforced by absence.

## Decision

All broker connectivity in this repository MUST route through
`@luxalgo/broker-sdk`. The two entry points we depend on are `connect`
(returns a typed broker handle) and `listBrokers` (returns the supported
set).

The following MUST NOT appear anywhere in this repository outside
`@luxalgo/broker-sdk` itself:

- direct broker HTTP calls (raw `fetch`, `axios`, `http.get`, `http.post`,
  `node-fetch`, vendor SDKs);
- broker API credentials held in repo-local code paths — they live in the
  encrypted settings store or the SDK's own credential vault;
- new broker features that the SDK does not yet expose; new broker
  capabilities MUST be proposed upstream in `LuxAlgo/broker-sdk` first and
  only adopted here once the SDK exposes them.

The decision is enforced by `.omp/hooks/pre/block-importer-fetch.ts`,
which blocks edits to `packages/importers/src/` that introduce raw HTTP.
The same rule is documented for humans in `.omp/hooks/pre-commit.md`
§ "Additional Scans" and in `.omp/AGENTS.md` "Hard blocks" #2.

## Consequences

- Positive: one credential layer, one broker-rotation story, one place to
  handle rate limits and OAuth; the repo cannot ship a broker whose
  contract is not already in the SDK; importer code stays pure parse.
- Negative: features that the SDK does not yet support are blocked here
  until upstream accepts them; the SDK release cadence becomes a real
  dependency for broker expansion.
- Forbidden: any vendor SDK added to `package.json`, `pnpm-lock.yaml`, or
  imported by name from importer or web code; raw HTTP calls anywhere under
  `packages/importers/src/` or the web server that touches a broker.

This decision is not cheaply reversible — undoing it would require
re-introducing credential handling, OAuth flows, and rate-limit policies
across every broker we ship. Superseding it requires a new ADR that names
the new boundary.