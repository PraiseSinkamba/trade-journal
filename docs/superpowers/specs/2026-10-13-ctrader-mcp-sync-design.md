# cTrader MCP Account Sync — Design

**Date:** 2026-10-13
**Status:** Approved (brainstorming), pending implementation
**Scope:** New sync path for cTrader via the cTrader MCP servers (Local + Remote). Reuses the existing sync pipeline (`insertExecutions` + `rebuildAccount`); adds an ADR that carves the MCP client out of ADR 0001.

## Problem

`@luxalgo/broker-sdk` does not expose cTrader. The journal currently has no way to live-sync cTrader trades into the existing round-trip engine. Users on Pepperstone, IC Markets, and other cTrader-based brokers fall back to manual CSV imports. cTrader now ships two MCP servers (Local and Remote) that AI agents can talk to; we can route the same MCP traffic into our sync pipeline so trades appear in the journal automatically.

The same code path should support both transports:

- **Local MCP** — cTrader Desktop hosts `http://127.0.0.1:9876/mcp/`. Authenticated by the running desktop session; no extra header required.
- **Remote MCP** — cTrader Web → Settings → Remote MCP. Per-account bearer token, sent as `Authorization: Bearer <token>`.

## Non-goals

- Exposing journal data as an MCP server (out of scope; future work).
- Granting the journal's existing AI agent access to MCP tools (out of scope; a follow-up design that uses the seam left by this work).
- Adding cTrader to `@luxalgo/broker-sdk` (blocked until the upstream repo is accessible).
- Streaming sync responses (the existing JSON-only `/api/accounts/[id]/actions` shape is preserved).
- A new `accounts` table column. The existing schema carries everything we need.

## Goals

1. Sync cTrader trades via MCP into `executions`, running through the round-trip engine.
2. Preserve fill-level granularity: one `execution` row per cTrader deal.
3. Preserve dedup across re-syncs via the broker's `dealId`.
4. Support both Local MCP (desktop) and Remote MCP (cTrader Web) without code forks.
5. Support multiple cTrader accounts under one token (Remote) by storing the user-selected `ctraderAccountId`.
6. Surface positions, pending orders, and account balance in the existing `snapshotJson` shape.
7. Keep the dep cost to one package (`@ai-sdk/mcp`).

## Data flow

```
UI: connect form
   └─► POST /api/accounts { kind: "sync", broker: "ctrader-mcp",
                              credentials: CTraderMcpCredentials }
         └─► encrypt credentials → accounts.insert
         └─► syncAccount(id) → dispatches on account.broker
               ├─► "ctrader-mcp" → syncCTraderMcpAccount(id)   ← NEW
               └─► everything else → connect() via broker-sdk
                   syncCTraderMcpAccount:
                     1. decrypt credentials; build MCP client via @ai-sdk/mcp
                     2. initialize(); on failure → CTraderMcpSyncError
                     3. (remote) validate ctraderAccountId via
                           get_account_list_by_access_token
                     4. fetch get_symbols once → symbolId → assetClass map
                     5. page through get_deals fromTime..toTime
                           map each deal → ImportedExecution
                     6. fetch get_positions + get_pending_orders + get_account_info
                           (positions + orders + balance + equity for the snapshot)
                     7. db.transaction(behavior: "immediate"):
                          insertExecutions(accountId, rows, "sync")
                            // inserts + rebuilds round-trip trades atomically
                          accounts.update:
                            lastSyncAt  = syncedAt   (cursor advances only on commit)
                            snapshotJson = { equity, positions, openOrders,
                                             balance, freeMargin, fetchedAt }
                     8. return SyncOutcome
```

## Credentials shape

Persisted as encrypted JSON in `accounts.credentialsEnc`. Same encryption as every other sync account.

```ts
type CTraderMcpCredentials =
  | {
      mode: "remote";
      endpoint: string;
      bearerToken: string;
      /** Selected cTrader account id (numeric). Resolved at connect time
       *  via get_account_list_by_access_token. */
      ctraderAccountId: number;
    }
  | {
      mode: "local";
      endpoint: string;
      /** Optional Authorization header for desktop variants that require one. */
      authHeader?: string;
    };
```

- `mode = "remote"` sends `Authorization: Bearer <bearerToken>` on every request.
- `mode = "local"` sends nothing by default; sends `Authorization: <authHeader>` when present.
- `endpoint` is configurable so Docker users can target `http://host.docker.internal:9876/mcp/` or a LAN IP.

## Account schema

No change to `apps/web/src/db/schema.ts`. The new broker id is `"ctrader-mcp"`. `ibkrSyncTimeZone` stays `null`; `lastSyncAt` becomes the *earliest* `fromTime` for the next delta.

## MCP client

A small `apps/web/src/server/ctrader-mcp/client.ts` wraps `@ai-sdk/mcp`. The wrapper:

- Owns the transport options (endpoint, mode, bearerToken, authHeader).
- Calls `initialize` + `notifications/initialized` on first use; caches the session.
- Exposes a typed `callTool(name, args, schema)` that parses the response with the caller-supplied Zod schema.
- Paginates by following whatever cursor the tool returns (server-defined; we just loop until empty).

Tool wrappers (`deals.ts`, `positions.ts`, `orders.ts`, `account.ts`, `symbols.ts`, `accounts.ts`) each declare a Zod schema for the response and re-export the typed result.

## MCP tools used

| Tool | Returns | Used for |
|------|---------|----------|
| (handshake) `initialize` + `notifications/initialized` | session | one-time per client lifetime |
| `get_account_list_by_access_token` | list of cTrader accounts the token can access | account picker (Remote only) |
| `get_symbols` | per-symbol metadata including asset class | asset-class lookup |
| `get_deals` (paginated) | historical fills | source of `executions` rows |
| `get_positions` | open positions | snapshot JSON |
| `get_pending_orders` | working orders | snapshot JSON |
| `get_account_info` | balance, equity, free margin | snapshot JSON |

The same tool names are used for Local and Remote; if cTrader diverges between the two transports, `client.ts` keeps a per-mode name map.

## Mapping a cTrader deal to an `ImportedExecution`

```ts
{
  symbol:    deal.symbolId → get_symbols → symbol.name,
  side:      deal.side === "BUY" ? "buy" : "sell",
  quantity:  deal.filledVolume (units resolved via symbol metadata),
  price:     deal.executionPrice,
  fee:       (deal.commission ?? 0) + (deal.swap ?? 0),
  executedAt: deal.executionTime ISO,
  assetClass: symbolMap.get(deal.symbolId) ?? "other",
  importMetadata: {
    id: deal.dealId,
    group: deal.positionId,     // deals in the same position share a group
    order: dealIndex,
    preserveFee: true,
  },
}
```

Symbol resolution goes through `get_symbols` so we get `name` (e.g. `"EURUSD"`) and `digits` (price precision) without guessing.

## Idempotency rests on three layers

1. **`executionHash(symbol+side+qty+price+time, importMetadata)`** — already SHA-256s the dealId.
2. **Unique index `executions_account_hash(accountId, contentHash)`** — second insert of the same deal fails at the DB layer; counted as `duplicates`.
3. **Cursor safety** — `lastSyncAt` advances only after a successful `insertExecutions` transaction. A failed sync re-uses the same `fromTime` next attempt.

A re-sync returns `{ inserted: 0, duplicates: N, skipped: 0 }`. No harm, no duplicates.

## Error taxonomy

New `CTraderMcpSyncError extends Error` with `kind` matching the table below. The existing `/api/accounts` POST handler maps it to `bad(message, 502)`. Logs capture JSON-RPC `requestId` and `code`; raw payloads never reach the client.

| `kind`         | Trigger                                              | User-facing message |
|----------------|------------------------------------------------------|---------------------|
| `unreachable`  | MCP endpoint unreachable / TCP refusal               | "Can't reach cTrader MCP at <endpoint>. Check the URL and that the desktop is running." |
| `auth`         | 401/403 on initialize or tool call                   | "cTrader MCP rejected the credentials. For remote: refresh the token in cTrader Web → Settings → Remote MCP." |
| `account_gone` | Stored `ctraderAccountId` not in accessible list     | "cTrader account is no longer accessible from this token. Re-connect the account." |
| `rate_limited` | 429                                                  | "cTrader MCP rate-limited. Retry in a minute." |
| `parse`        | Tool response fails Zod validation                   | "cTrader MCP returned unexpected data: <one-line summary>." (raw payload in logs only) |
| `unknown`      | Anything else                                        | "cTrader MCP sync failed. Check server logs." |

## UI changes

- **Connect form** (`apps/web/src/app/accounts/`): when `broker === "ctrader-mcp"`:
  - Mode toggle `Local | Remote`.
  - Remote: token paste → "fetch accounts" button calls a preview endpoint → dropdown of cTrader accounts → select.
  - Local: endpoint + optional auth header.
- **Existing UI flows** (sync action, account detail, snapshot panel) work unchanged because the orchestrator returns the existing `SyncOutcome`.

## ADR 0002 — Carve-out from ADR 0001

`docs/decisions/0002-ctrader-mcp-via-direct-mcp-client.md` is `Accepted`.
It permits direct MCP client access **only** inside
`apps/web/src/server/ctrader-mcp/**`, using `@ai-sdk/mcp`. Forbidden
elsewhere in the repo: raw `fetch`/`axios`/`http.*` to non-MCP cTrader
endpoints, and importing cTrader-specific token types or auth helpers
from importer packages. The carve-out is reversible: when broker-sdk
upstream is reachable, the journal-side module retires and ADR 0002 is
superseded.

## Testing

- **Unit tests** (`apps/web/tests/ctrader-mcp/`):
  - `client.test.ts` — JSON-RPC request shape; Zod validation failures raise `parse`.
  - `deals.test.ts` — representative deal payload maps to the expected `ImportedExecution`; `executionHash` is stable across re-orders.
- **Integration test** (`apps/web/tests/ctrader-mcp/sync.test.ts`):
  - Stub MCP server returns canned `get_deals`, `get_positions`, `get_symbols`, `get_account_info`.
  - First sync inserts N rows; second sync returns `inserted: 0, duplicates: N`.
  - When `insertExecutions` throws, `lastSyncAt` is **not** advanced.
  - Account-selection flow: token with 2 accounts triggers picker; selected id is persisted.
- **Route tests**: `POST /api/accounts` with `broker: "ctrader-mcp"` returns 201 + `SyncOutcome`. `POST /api/accounts/[id]/actions { action: "sync" }` returns 200.
- **Manual smoke**: connect a real cTrader Web Remote MCP token; verify the round-trip engine produces the expected trades; re-sync is a no-op for matching deals.

## Acceptance criteria

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes including new `ctrader-mcp` suite.
- [ ] A real cTrader Web token can be used to connect and sync trades into the journal.
- [ ] A real cTrader Desktop local MCP can be used to connect and sync trades into the journal.
- [ ] Re-syncing creates zero duplicates.
- [ ] Multi-account Remote tokens prompt the user to pick which cTrader account to use.
- [ ] `docs/decisions/0002-ctrader-mcp-via-direct-mcp-client.md` exists and is `Accepted`.
- [ ] `apps/web/src/server/sync.ts` still dispatches to `@luxalgo/broker-sdk` for every non-`ctrader-mcp` broker.

## Risks

- **Tool-name divergence between Local and Remote.** Both transports list the same names in public docs; if reality differs, the `client.ts` per-mode name map keeps the rest of the code identical.
- **`get_deals` history cap.** cTrader may cap how far back deals are queryable. First sync pulls as much as the endpoint returns; subsequent syncs are unaffected.
- **Asset-class inference.** Depends on `get_symbols` metadata quality. Unknown symbols fall back to `other` rather than guessing.
- **Cursor drift on a failed run.** Guarded by the explicit "advance `lastSyncAt` only after commit" rule plus the integration test that asserts it.
- **broker-sdk upstream later ships cTrader.** Remove the ADR 0002 carve-out when that lands; the journal-side `ctrader-mcp/` module retires or shrinks to a thin adapter.