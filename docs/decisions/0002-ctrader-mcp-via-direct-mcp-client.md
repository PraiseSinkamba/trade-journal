# 0002 — cTrader MCP via direct MCP client

- Status: Accepted
- Date: 2026-10-13
- Deciders: trade-journal maintainers

## Context

ADR 0001 routes every broker-connectivity path through `@luxalgo/broker-sdk`,
forbidding raw HTTP, axios, and `http.*` calls anywhere outside the SDK.
That decision is correct for the long-term shape of the project: one
credential layer, one rotation story, one place for OAuth and rate-limit
policy.

cTrader does not yet appear in `@luxalgo/broker-sdk`, and the upstream repo
is not reachable from this fork right now. Users on cTrader-based brokers
(Pepperstone, IC Markets, and others) have no live-sync path and fall back
to manual CSV imports. cTrader now ships two MCP servers — Local for
desktop clients and Remote for cTrader Web — that expose the broker
endpoints as typed tools over JSON-RPC. The same Model Context Protocol
transport already runs Claude Code, Codex, Cursor, and other AI agents
against cTrader.

Adding a cTrader sync path means talking to a broker endpoint with broker
credentials. The question is how to do that without re-opening the door
that ADR 0001 closed.

## Decision

Direct MCP client access is permitted for cTrader, **only** inside
`apps/web/src/server/ctrader-mcp/**`. The carve-out is narrow and
auditable:

- Allowed — calling the cTrader MCP servers (Local and Remote) using
  `@ai-sdk/mcp` from the dedicated `ctrader-mcp` server module.
- Allowed — persisting a per-account bearer token (Remote), endpoint
  URL (Local), and optional auth header (Local variants) using the
  existing encrypted credentials store.
- Forbidden — raw `fetch`, `axios`, `http.*`, or any other direct HTTP
  call to a non-MCP cTrader endpoint from anywhere in this repo.
- Forbidden — importing cTrader-specific token types, OAuth helpers, or
  protobuf clients from any package outside `apps/web/src/server/ctrader-mcp/`.
- Forbidden — relaxing the hard block at `.omp/hooks/pre/block-importer-fetch.ts`.
  The importer package remains pure parse with no connectivity.

The `apps/web/src/server/sync.ts` dispatcher routes `broker === "ctrader-mcp"`
to the new module. Every other broker continues to flow through
`@luxalgo/broker-sdk` exactly as today.

## Consequences

- Positive: cTrader-based brokers get a live sync path today, without
  waiting for upstream broker-sdk to ship cTrader. Reuses the existing
  insertExecutions, rebuildAccount, dedup, and snapshot pipeline.
- Positive: the carve-out is one folder; an audit can list every file
  that bypasses broker-sdk in seconds.
- Negative: features that the cTrader MCP servers do not expose are
  blocked until either cTrader ships them or the journal gains access
  to broker-sdk upstream and adds them there.
- Negative: when broker-sdk is reachable, the journal-side cTrader
  module needs to be retired or reduced to a thin adapter that calls
  `connect({ broker: "ctrader-mcp" })`.
- Forbidden: any new direct broker HTTP call anywhere else in the repo;
any import of cTrader vendor SDKs or OAuth libraries outside the
cTrader MCP module.

## Scope (revision 2026-10-17)

The v0 implementation targeted in this ADR is **Local-only**. The public
Remote MCP at `https://mcp.ctrader.com/trading/mcp` does not expose
`get_account_list_by_access_token` and returns `get_balance` in integer
minor units (no `moneyDigits`), `get_deals` with `executionTimestamp` in
epoch ms and a 30-day range cap, and numeric `dealId`. Adapting to all
of those requires money conversion, time conversion, dedup-key
reshuffling, and removing the account-picker UX — that work is deferred
to a follow-up. Local MCP at `http://127.0.0.1:9876/mcp/` returns real
currency, ISO-8601 `time`, and `get_accounts_list` (so we can keep a
multi-account picker), and uses `orderId` (+ time/volume/price
tiebreakers) as the natural dedup key.

The `mode: "remote" | "local"` discriminator that the v0 form schema
briefly carried is removed; the credentials shape is now
`{ endpoint, authHeader?, ctraderAccountId }`. Re-introducing Remote
mode requires refreshing this ADR with the reconverted shapes; until
then this ADR governs the Local-only journal-side module.

This decision is reversible once broker-sdk upstream lands cTrader.
Reversal steps: open a PR on broker-sdk adding cTrader MCP support;
switch the journal-side `sync.ts` dispatch back to the SDK-embedded
path; delete `apps/web/src/server/ctrader-mcp/**`; supersede ADR 0002
with a one-line note in the new ADR's Context section. Until that
happens, ADR 0002 and ADR 0001 coexist.