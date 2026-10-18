# cTrader MCP Account Sync — Design

**Date:** 2026-10-13 (Local-only revision: 2026-10-17)
**Status:** Approved (brainstorming), implementation Local-only; Remote mode deferred
**Scope:** Sync path for cTrader via cTrader Desktop's Local MCP server (`http://127.0.0.1:9876/mcp/`). Reuses the existing sync pipeline (`insertExecutions` + `accounts.update`); ADR 0002 carves the MCP client out of ADR 0001.

## Problem

`@luxalgo/broker-sdk` does not expose cTrader. The journal currently has no way to live-sync cTrader trades into the existing round-trip engine. Users on Pepperstone, IC Markets, and other cTrader-based brokers fall back to manual CSV imports.

cTrader ships two MCP servers — Local (cTrader Desktop) and Remote (cTrader Web). The original design (2026-10-13) targeted both. After a live probe of both servers (see `.superpowers/sdd/ctrader-mcp-toolset-probe.md`), the Remote server's public API does **not** match what we assumed: there is no `get_account_list_by_access_token`, money is in minor units (no `moneyDigits` is exposed), `dealId` is a number not a string, `executionTimestamp` is epoch ms, and the response shape carries `swap` and `entryPrice` only on `get_deals`. Reconciling the Remote side requires several model changes (money conversion, time conversion, dedup-key reshuffle, account picker removal). Shipping Local-only first gets users a working sync today; Remote mode is deferred until the same probe can be re-run with a model rewrite.

## Non-goals

- Exposing journal data as an MCP server (out of scope; future work).
- Granting the journal's existing AI agent access to MCP tools (out of scope; a follow-up design that uses the seam left by this work).
- Adding cTrader to `@luxalgo/broker-sdk` (blocked until the upstream repo is accessible).
- Streaming sync responses (the existing JSON-only `/api/accounts/[id]/actions` shape is preserved).
- A new `accounts` table column. The existing schema carries everything we need.
- **Remote mode** in v0. See "Remote mode (deferred)" below.

## Goals

1. Sync cTrader trades via the **Local** MCP into `executions`, running through the round-trip engine.
2. Preserve fill-level granularity: one `execution` row per cTrader deal.
3. Preserve dedup across re-syncs via a composite deal key (`orderId + time + filledVolume + executionPrice`).
4. Surface positions, pending orders, and account balance in the existing `snapshotJson` shape.
5. Let the user pick which cTrader account to sync when the Local session exposes multiple accounts (e.g. Pepperstone Live + Demo).
6. Keep the dep cost to one package (`@ai-sdk/mcp`).

## Remote mode (deferred)

The original Remote-mode target is **not** shipped in v0. The probe at `.superpowers/sdd/ctrader-mcp-toolset-probe.md` shows the public Remote MCP at `https://mcp.ctrader.com/trading/mcp`:

- has no `get_account_list_by_access_token` (the token implicitly identifies one account, so the picker UX is moot);
- exposes `get_balance` returning integer minor units, not real currency;
- exposes `get_deals` with `executionTimestamp` in epoch ms and a 30-day range cap, not the cursor-walk the original design assumed;
- uses numeric `dealId`.

Adapting to all four would require money conversion, time conversion, account-picker removal, and a different dedup key — that work is deferred to a follow-up. The Local MCP we **do** support returns real currency, ISO-8601 `time` strings, a single `get_accounts_list` enumeration, and uses `orderId` (with `time` + `filledVolume` + `executionPrice` as tiebreakers) as the natural dedup key. The implementation in this repo is Local-only; a future "Remote mode" task should re-run the probe and refresh the design before re-introducing it.

## Data flow

```
UI: connect form
   └─► POST /api/accounts { kind: "sync", broker: "ctrader-mcp",
                              credentials: CTraderMcpCredentials }
         └─► encrypt credentials → accounts.insert
         └─► syncAccount(id) → dispatches on account.broker
               ├─► "ctrader-mcp" → syncCTraderMcpAccount(id)   ← Local-only
               └─► everything else → connect() via broker-sdk
                   syncCTraderMcpAccount:
                     1. decrypt credentials; build MCP client via @ai-sdk/mcp
                     2. initialize(); on failure → CTraderMcpSyncError
                     3. fetch get_accounts_list → cTraderAccountInfo { id, login,
                           brokerTitle, isLive, currency, accountType, isOnline }
                           (multiple accounts may be exposed; the user-selected
                           account id is persisted as ctraderAccountId)
                     4. fetch get_balance per the chosen account → snapshot fields
                     5. fetch get_symbols once → name → assetClass map
                        (deals arrive keyed by symbolName; symbols arrive keyed
                         by `name` — the cTrader MCP uses different keys for
                         each tool; the join is `deal.symbolName === symbol.name`)
                     6. page through get_deals via count=200 until empty
                           (Local has no time-range filter; dedup relies on
                            executionHash + the unique index)
                           map each deal → ImportedExecution
                     7. fetch get_positions + get_pending_orders for the snapshot
                     8. db.transaction(behavior: "immediate"):
                          insertExecutions(accountId, rows, "sync")
                            // inserts + rebuilds round-trip trades atomically
                          accounts.update:
                            lastSyncAt  = syncedAt   (cursor advances only on commit)
                            snapshotJson = { equity, balance, freeMargin,
                                             depositAsset, brokerName,
                                             positions, openOrders, fetchedAt }
                     9. return SyncOutcome
```

## Credentials shape

Persisted as encrypted JSON in `accounts.credentialsEnc`. Same encryption as every other sync account.

```ts
type CTraderMcpCredentials = {
  endpoint: string;        // default http://127.0.0.1:9876/mcp/
  authHeader?: string;     // optional Authorization header for desktop builds that need one
  ctraderAccountId: number;// the cTrader Desktop account id the user picked
};
```

- The MCP client always sends `Authorization: <authHeader>` when `authHeader` is set; otherwise no auth header.
- `endpoint` is configurable so Docker users can target `http://host.docker.internal:9876/mcp/` or a LAN IP.
- `ctraderAccountId` is the cTrader Desktop `id` field from `get_accounts_list` — the pick the user made in the connect form's account dropdown.

## Account schema

No change to `apps/web/src/db/schema.ts`. The new broker id is `"ctrader-mcp"`. `lastSyncAt` is informational; dedup rides on `executions_account_hash` and the composite `importMetadata.id`.

## MCP client

A small `apps/web/src/server/ctrader-mcp/client.ts` wraps `@ai-sdk/mcp`. The wrapper:

- Owns the transport options (endpoint, authHeader).
- Calls `initialize` + `notifications/initialized` on first use; caches the session.
- Exposes a typed `callTool(name, args, schema)` that parses the response with the caller-supplied Zod schema.

Tool wrappers (`deals.ts`, `positions.ts`, `orders.ts`, `account.ts`, `symbols.ts`, `accounts.ts`) each declare a Zod schema for the response and re-export the typed result.

## MCP tools used

| Tool | Returns | Used for |
|------|---------|----------|
| (handshake) `initialize` + `notifications/initialized` | session | one-time per client lifetime |
| `get_accounts_list` | list of cTrader accounts the desktop session is connected to | account picker |
| `get_balance` | balance, equity, free margin (real currency) | snapshot JSON |
| `get_symbols` | per-symbol metadata | asset-class lookup |
| `get_deals` (paginated) | historical fills | source of `executions` rows |
| `get_positions` | open positions | snapshot JSON |
| `get_pending_orders` | working orders | snapshot JSON |

## Mapping a cTrader deal to an `ImportedExecution`

```ts
{
  symbol:    deal.symbolName,                       // string like "NAS100"
  side:      deal.side === "Buy" ? "buy" : "sell",  // Local uses mixed-case "Buy"/"Sell"
  quantity:  deal.filledVolume,
  price:     deal.executionPrice,
  fee:       Math.abs(deal.commission) + Math.abs(deal.swap),
  executedAt: deal.time,                            // ISO-8601
  assetClass: symbolMap.get(deal.symbolName) ?? "other",
  importMetadata: {
    id: `${deal.orderId}:${deal.time}:${deal.filledVolume}:${deal.executionPrice}`,
    group: String(deal.positionId),                 // deals in the same position share a group
    order: dealIndex,
    preserveFee: true,
  },
}
```

`Local has no dealId`, so the dedup key is a composite of `orderId + time + filledVolume + executionPrice`. Stable across the exact same fill; differs on any of the four components.

## Idempotency rests on three layers

1. **`executionHash(symbol+side+qty+price+time, importMetadata)`** — SHA-256s the composite id; identical fills collapse to one row.
2. **Unique index `executions_account_hash(accountId, contentHash)`** — second insert of the same fill fails at the DB layer; counted as `duplicates`.
3. **Cursor safety** — `lastSyncAt` advances only after a successful `insertExecutions` transaction. A failed sync re-uses the same fetch window next attempt.

A re-sync returns `{ inserted: 0, duplicates: N, skipped: 0 }`. No harm, no duplicates.

## Error taxonomy

`CTraderMcpSyncError extends Error` with `kind` matching the table below. The existing `/api/accounts` POST handler maps it to `bad(message, 502)`. Logs capture JSON-RPC `requestId` and `code`; raw payloads never reach the client.

| `kind`         | Trigger                                              | User-facing message |
|----------------|------------------------------------------------------|---------------------|
| `unreachable`  | MCP endpoint unreachable / TCP refusal               | "Can't reach cTrader MCP at <endpoint>. Check the URL and that the desktop is running." |
| `auth`         | 401/403 on initialize or tool call                   | "cTrader MCP authentication failed. Check the Authorization header and that the desktop is running." |
| `rate_limited` | 429                                                  | "cTrader MCP rate-limited. Retry in a minute." |
| `parse`        | Tool response fails Zod validation                   | "cTrader MCP returned unexpected data." (raw payload in logs only) |
| `unknown`      | Anything else                                        | "cTrader MCP sync failed. Check server logs." |

`account_gone` is **not** reachable on Local — there is no per-account token to invalidate. The Local desktop session either authenticates or it doesn't.

## UI changes

- **Connect form** (`apps/web/src/app/import/page.tsx`): when `broker === "ctrader-mcp"`:
  - Endpoint field (default `http://127.0.0.1:9876/mcp/`).
  - Optional Authorization header field.
  - "Fetch accounts" button → `POST /api/accounts/ctrader-mcp-preview` → cTrader account Select dropdown (Local desktop may expose multiple accounts; user picks one).
  - "Connect & sync" submits `{ endpoint, authHeader?, ctraderAccountId }` to `/api/accounts`.
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
  - `deals.test.ts` — representative Local deal payload maps to the expected `ImportedExecution`; `executionHash` is stable across re-orders; composite dedup id is built correctly.
  - `schemas.test.ts` — Local `cTraderDealSchema` accepts a representative payload, rejects missing required fields.
  - `errors.test.ts` — `classifyMcpError` maps raw messages to the safe taxonomy.
- **Integration test** (`apps/web/tests/ctrader-mcp/sync.test.ts`):
  - Stub MCP server returns canned `get_accounts_list`, `get_deals`, `get_balance`, `get_symbols`, `get_positions`, `get_pending_orders`.
  - First sync inserts N rows; second sync returns `inserted: 0, duplicates: N`.
  - When `insertExecutions` throws, `lastSyncAt` is **not** advanced.
- **Route tests**: `POST /api/accounts` with `broker: "ctrader-mcp"` returns 201 + `SyncOutcome`. `POST /api/accounts/ctrader-mcp-preview` returns the `get_accounts_list` accounts. `POST /api/accounts/[id]/actions { action: "sync" }` returns 200.
- **Manual smoke**: connect a real cTrader Desktop local MCP; verify the round-trip engine produces the expected trades; re-sync is a no-op for matching deals.

## Acceptance criteria

- [ ] `npx tsc --noEmit --project apps/web/tsconfig.json` is clean for touched files.
- [ ] `npx vitest run apps/web/tests/ctrader-mcp/ apps/web/tests/broker-connect.test.ts` passes.
- [ ] A real cTrader Desktop local MCP can be used to connect and sync trades into the journal.
- [ ] Re-syncing creates zero duplicates.
- [ ] Multi-account Local sessions prompt the user to pick which cTrader account to use.
- [ ] `docs/decisions/0002-ctrader-mcp-via-direct-mcp-client.md` exists and is `Accepted`.
- [ ] `apps/web/src/server/sync.ts` still dispatches to `@luxalgo/broker-sdk` for every non-`ctrader-mcp` broker.

## Risks

- **Local-only.** Remote mode is deferred; if a user without cTrader Desktop connects, the form simply won't reach the MCP server. Re-enabling Remote requires a design refresh.
- **`get_deals` history cap.** Local caps at 200 per page; pagination is `count`-driven with no time-range filter. First sync pulls the latest 200; subsequent syncs re-pull and dedup.
- **Asset-class inference.** `get_symbols` returns `{ name, description, category, assetClass, ... }`. We prefer the explicit `assetClass` string (Forex (Spot) → forex, Indices/Commodities/Metals/Energies/Bonds/Shares/ETFs → cfd, Crypto/Cryptocurrency → crypto, Stocks → stock); fall back to `category`; fall back to a `name + description` heuristic (contains `/` and 6 letters → forex; BTC/ETH/BITCOIN → crypto; numeric suffix → cfd); unknown → `other`.
- **Cursor drift on a failed run.** Guarded by the explicit "advance `lastSyncAt` only after commit" rule plus the integration test that asserts it.
- **broker-sdk upstream later ships cTrader.** Remove the ADR 0002 carve-out when that lands; the journal-side `ctrader-mcp/` module retires or shrinks to a thin adapter.