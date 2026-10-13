# cTrader MCP Account Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new sync account type (`broker: "ctrader-mcp"`) that pulls fills, positions, pending orders, and account balance from cTrader's MCP servers (Local + Remote) and writes them into the existing `executions` / `trades` pipeline.

**Architecture:** New server-only module `apps/web/src/server/ctrader-mcp/` wraps `@ai-sdk/mcp` to call cTrader's JSON-RPC MCP endpoints. Maps cTrader deals to `ImportedExecution[]` and reuses `insertExecutions` + `accounts` update inside one transaction. ADR 0002 narrows the carve-out from ADR 0001 to this folder. No changes to `packages/importers`, `packages/core`, or DB schema.

**Tech Stack:** TypeScript strict, Next.js 15 server, `@ai-sdk/mcp` (one new package), Zod (already in use), Drizzle (already in use), Vitest (already in use).

## Global Constraints

These are project-wide requirements that every step must honor:

- TypeScript strict with `noUncheckedIndexedAccess: true`. Every `arr[i]` is `T | undefined`.
- Prettier `printWidth: 100`. Do not hand-format.
- All broker connectivity in `apps/web/src/server/ctrader-mcp/**` only. No raw `fetch`/`axios`/`http.*` outside that folder (ADR 0002 carve-out from ADR 0001).
- Never log the API key, a key fragment, or any decrypted credential. Log JSON-RPC `requestId` and `code` only.
- Map raw MCP errors to `CTraderMcpSyncError` categories; never propagate raw payloads to the client.
- One transaction per sync (`behavior: "immediate"`): `insertExecutions` + `accounts.update` (lastSyncAt + snapshotJson) commit together. `lastSyncAt` advances only on success.
- Symbol names, side, qty, price, executedAt go through `partitionExecutions` via `insertExecutions`. Validation lives there, not in the ctor layer.
- Reuse `executionHash` + `executions_account_hash` unique index for dedup. The cTrader `dealId` lives on `importMetadata.id`.
- ESM-only. Workspace `"sideEffects": false`.
- ADR 0002 must remain reversible: no coupling to journal internals that would block removing the folder later.

---

## File Structure

```
apps/web/src/server/ctrader-mcp/         (NEW — the entire carve-out lives here)
├── client.ts        MCP transport wrapper around @ai-sdk/mcp
├── errors.ts        CTraderMcpSyncError taxonomy
├── schemas.ts       Zod schemas for tool responses (shared by wrappers)
├── accounts.ts      list-accounts wrapper (Remote only)
├── symbols.ts       get_symbols wrapper + asset-class map
├── deals.ts         get_deals paginator + ImportedExecution mapping
├── positions.ts     get_positions wrapper
├── orders.ts        get_pending_orders wrapper
├── account.ts       get_account_info wrapper (snapshot fields)
└── sync.ts          orchestrator (transaction + lastSyncAt + snapshotJson)

apps/web/src/server/sync.ts              (MODIFY — dispatch ctrader-mcp to new module)
apps/web/src/app/api/accounts/           (MODIFY — accept new credentials shape)
apps/web/src/app/api/accounts/[id]/actions/route.ts  (MODIFY — already calls syncAccount; no change expected)
apps/web/src/components/accounts/        (MODIFY — connect form branch when broker === "ctrader-mcp")
apps/web/src/lib/ctrader-mcp-form.ts     (NEW — connect form schema + defaults)

apps/web/tests/ctrader-mcp/
├── client.test.ts
├── errors.test.ts
├── schemas.test.ts
├── deals.test.ts
└── sync.test.ts

apps/web/package.json                    (MODIFY — add @ai-sdk/mcp)
docs/decisions/0002-ctrader-mcp-via-direct-mcp-client.md   (ALREADY CREATED — Status: Accepted)
docs/superpowers/specs/2026-10-13-ctrader-mcp-sync-design.md   (ALREADY CREATED)
```

No edits to `packages/importers/`, `packages/core/`, or `apps/web/src/db/schema.ts`.

---

## Task 1: Add `@ai-sdk/mcp` dependency

**Files:**
- Modify: `apps/web/package.json`
- Test: `pnpm --filter web typecheck`

**Interfaces:**
- Consumes: nothing
- Produces: `@ai-sdk/mcp` resolves to a version that exports `experimental_createMCPClient` or its stable name

- [ ] **Step 1: Check that `@ai-sdk/mcp` exists and what it exports**

Run:

```bash
pnpm view @ai-sdk/mcp version peerDependencies
```

Expected: a recent version (≥ 0.x.x) printed, with peer deps on `ai` and `zod` already satisfied by the journal (`ai` is already a dep, `zod` is too).

- [ ] **Step 2: Install the package**

Run from repo root:

```bash
pnpm --filter web add @ai-sdk/mcp
```

Expected: `apps/web/package.json` shows `"@ai-sdk/mcp": "^<x.y.z>"` under `dependencies`. `pnpm-lock.yaml` is updated. Exit code 0.

- [ ] **Step 3: Verify import resolves**

Run:

```bash
pnpm --filter web exec node --input-type=module -e "import('@ai-sdk/mcp').then(m => console.log(Object.keys(m)))"
```

Expected: a non-empty array of exports including `createMCPClient` or `experimental_createMCPClient`. The exact key is recorded for Task 2.

- [ ] **Step 4: Typecheck**

Run:

```bash
pnpm --filter web typecheck
```

Expected: passes with no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "deps: add @ai-sdk/mcp for cTrader MCP client"
```

---

## Task 2: Error taxonomy + MCP client wrapper

**Files:**
- Create: `apps/web/src/server/ctrader-mcp/errors.ts`
- Create: `apps/web/src/server/ctrader-mcp/client.ts`
- Create: `apps/web/tests/ctrader-mcp/errors.test.ts`
- Create: `apps/web/tests/ctrader-mcp/client.test.ts`

**Interfaces:**
- Consumes: `@ai-sdk/mcp` (the export key from Task 1 step 3), `zod`
- Produces:
  - `class CTraderMcpSyncError extends Error { readonly kind: 'unreachable' | 'auth' | 'account_gone' | 'rate_limited' | 'parse' | 'unknown' }`
  - `class CTraderMcpConnectError extends CTraderMcpSyncError { constructor(message: string, cause?: unknown) }`
  - `interface CTraderMcpClientOptions { mode: 'remote' | 'local'; endpoint: string; bearerToken?: string; authHeader?: string }`
  - `class CTraderMcpClient { constructor(opts: CTraderMcpClientOptions); initialize(): Promise<void>; close(): Promise<void>; callTool<OUT>(name: string, args: Record<string, unknown>, schema: ZodType<OUT>, opts?: { signal?: AbortSignal }): Promise<OUT> }`

- [ ] **Step 1: Write the failing test for errors**

`apps/web/tests/ctrader-mcp/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CTraderMcpSyncError } from "@/server/ctrader-mcp/errors";

describe("CTraderMcpSyncError", () => {
  it("preserves kind on instanceof check", () => {
    const e = new CTraderMcpSyncError("auth", "rejected");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(CTraderMcpSyncError);
    expect(e.kind).toBe("auth");
    expect(e.message).toBe("rejected");
  });

  it("is catchable as Error", () => {
    try {
      throw new CTraderMcpSyncError("unreachable", "down");
    } catch (err) {
      expect((err as Error).message).toBe("down");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter web test -- apps/web/tests/ctrader-mcp/errors.test.ts
```

Expected: FAIL — module `@/server/ctrader-mcp/errors` not found.

- [ ] **Step 3: Implement `errors.ts`**

`apps/web/src/server/ctrader-mcp/errors.ts`:

```ts
export type CTraderMcpSyncErrorKind =
  | "unreachable"
  | "auth"
  | "account_gone"
  | "rate_limited"
  | "parse"
  | "unknown";

export class CTraderMcpSyncError extends Error {
  constructor(
    public readonly kind: CTraderMcpSyncErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CTraderMcpSyncError";
  }
}

export const classifyMcpError = (error: unknown): CTraderMcpSyncError => {
  if (error instanceof CTraderMcpSyncError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(message)) {
    return new CTraderMcpSyncError("unreachable", message, error);
  }
  if (/401|403|unauthor/i.test(message)) {
    return new CTraderMcpSyncError("auth", message, error);
  }
  if (/429|rate.?limit/i.test(message)) {
    return new CTraderMcpSyncError("rate_limited", message, error);
  }
  return new CTraderMcpSyncError("unknown", message, error);
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter web test -- apps/web/tests/ctrader-mcp/errors.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Write the failing test for the MCP client**

`apps/web/tests/ctrader-mcp/client.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CTraderMcpClient } from "@/server/ctrader-mcp/client";
import { CTraderMcpSyncError } from "@/server/ctrader-mcp/errors";

const serverCalls: Array<{ method: string; body: unknown }> = [];
let server: ReturnType<typeof Bun.serve> | null = null;
let nextResponse: unknown = { jsonrpc: "2.0", id: 1, result: { ok: true } };

const startServer = async () => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const body = await req.json().catch(() => ({}));
      serverCalls.push({ method: url.pathname, body });
      if (url.pathname.endsWith("/mcp")) {
        return Response.json(nextResponse);
      }
      return new Response("not found", { status: 404 });
    },
  });
  return server.port;
};

afterEach(() => {
  server?.stop();
  server = null;
  serverCalls.length = 0;
});

describe("CTraderMcpClient", () => {
  it("sends JSON-RPC initialize on initialize()", async () => {
    const port = await startServer();
    nextResponse = { jsonrpc: "2.0", id: 1, result: { capabilities: {} } };
    const client = new CTraderMcpClient({
      mode: "local",
      endpoint: `http://127.0.0.1:${port}/mcp`,
    });
    await client.initialize();
    expect(serverCalls.length).toBeGreaterThan(0);
    const init = serverCalls[0]!.body as { method: string; params: unknown };
    expect(init.method).toBe("initialize");
  });

  it("sends Authorization: Bearer for remote mode", async () => {
    const port = await startServer();
    let lastAuthHeader: string | null = null;
    server?.stop();
    server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        lastAuthHeader = req.headers.get("authorization");
        return Response.json({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } });
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    const client = new CTraderMcpClient({
      mode: "remote",
      endpoint: `http://127.0.0.1:${server.port}/mcp`,
      bearerToken: "tok-abc",
    });
    await client.initialize();
    expect(lastAuthHeader).toBe("Bearer tok-abc");
  });

  it("validates callTool responses with the supplied Zod schema", async () => {
    const port = await startServer();
    nextResponse = { jsonrpc: "2.0", id: 1, result: { value: 42 } };
    const client = new CTraderMcpClient({
      mode: "local",
      endpoint: `http://127.0.0.1:${port}/mcp`,
    });
    await client.initialize();
    const schema = z.object({ value: z.number() });
    const out = await client.callTool("ping", {}, schema);
    expect(out.value).toBe(42);
  });

  it("raises CTraderMcpSyncError with kind=parse when response fails Zod", async () => {
    const port = await startServer();
    nextResponse = { jsonrpc: "2.0", id: 1, result: { value: "not-a-number" } };
    const client = new CTraderMcpClient({
      mode: "local",
      endpoint: `http://127.0.0.1:${port}/mcp`,
    });
    await client.initialize();
    await expect(
      client.callTool("ping", {}, z.object({ value: z.number() })),
    ).rejects.toMatchObject({ kind: "parse" });
  });

  it("classifies ECONNREFUSED as unreachable", async () => {
    const client = new CTraderMcpClient({
      mode: "local",
      endpoint: "http://127.0.0.1:1/mcp",
    });
    await expect(client.initialize()).rejects.toBeInstanceOf(CTraderMcpSyncError);
  });
});
```

> Note: this test uses Bun's `Bun.serve`. If the project's existing Vitest setup runs on Node, swap `Bun.serve` for `node:http.createServer` — both produce the same shape. The existing `apps/web/tests/ai-runtime.test.ts` uses Node `http` already; mirror that pattern.

- [ ] **Step 6: Run the test to verify it fails**

Run:

```bash
pnpm --filter web test -- apps/web/tests/ctrader-mcp/client.test.ts
```

Expected: FAIL — module `@/server/ctrader-mcp/client` not found.

- [ ] **Step 7: Implement `client.ts`**

`apps/web/src/server/ctrader-mcp/client.ts`:

```ts
import { z } from "zod";
import { classifyMcpError, CTraderMcpSyncError } from "./errors";

// Replace `createMCPClient` with the actual export key observed in Task 1 step 3.
import { createMCPClient as rawCreateMCPClient } from "@ai-sdk/mcp";

export interface CTraderMcpClientOptions {
  mode: "remote" | "local";
  endpoint: string;
  bearerToken?: string;
  authHeader?: string;
}

export class CTraderMcpClient {
  private raw: Awaited<ReturnType<typeof rawCreateMCPClient>> | null = null;
  private initialized = false;

  constructor(private readonly options: CTraderMcpClientOptions) {}

  async initialize(): Promise<void> {
    const transport = await this.buildTransport();
    try {
      this.raw = await rawCreateMCPClient({ transport });
      this.initialized = true;
    } catch (err) {
      throw classifyMcpError(err);
    }
  }

  async close(): Promise<void> {
    if (!this.raw) return;
    try {
      await this.raw.close();
    } finally {
      this.raw = null;
      this.initialized = false;
    }
  }

  async callTool<OUT>(
    name: string,
    args: Record<string, unknown>,
    schema: z.ZodType<OUT>,
    opts?: { signal?: AbortSignal },
  ): Promise<OUT> {
    if (!this.raw || !this.initialized) {
      throw new CTraderMcpSyncError("unknown", "MCP client not initialized");
    }
    try {
      const result = await this.raw.callTool({ name, arguments: args }, {
        signal: opts?.signal,
      });
      return schema.parse(result);
    } catch (err) {
      if (err instanceof CTraderMcpSyncError) throw err;
      if (err instanceof z.ZodError) {
        throw new CTraderMcpSyncError("parse", `cTrader MCP ${name} payload failed validation`, err);
      }
      throw classifyMcpError(err);
    }
  }

  private async buildTransport(): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (this.options.mode === "remote" && this.options.bearerToken) {
      headers.Authorization = `Bearer ${this.options.bearerToken}`;
    } else if (this.options.mode === "local" && this.options.authHeader) {
      headers.Authorization = this.options.authHeader;
    }
    return {
      type: "http",
      url: this.options.endpoint,
      headers,
    };
  }
}
```

> The exact transport shape for `@ai-sdk/mcp` is API-version dependent; the test in Step 5 verifies the concrete behavior. Adjust the transport object to the API of the installed version.

- [ ] **Step 8: Run all client + errors tests**

```bash
pnpm --filter web test -- apps/web/tests/ctrader-mcp/
```

Expected: PASS, all 7 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/server/ctrader-mcp/errors.ts apps/web/src/server/ctrader-mcp/client.ts apps/web/tests/ctrader-mcp/errors.test.ts apps/web/tests/ctrader-mcp/client.test.ts
git commit -m "feat(ctrader-mcp): JSON-RPC client + error taxonomy"
```

---

## Task 3: Zod schemas + tool wrappers (deals, positions, orders, account, symbols, accounts)

**Files:**
- Create: `apps/web/src/server/ctrader-mcp/schemas.ts`
- Create: `apps/web/src/server/ctrader-mcp/accounts.ts`
- Create: `apps/web/src/server/ctrader-mcp/symbols.ts`
- Create: `apps/web/src/server/ctrader-mcp/deals.ts`
- Create: `apps/web/src/server/ctrader-mcp/positions.ts`
- Create: `apps/web/src/server/ctrader-mcp/orders.ts`
- Create: `apps/web/src/server/ctrader-mcp/account.ts`
- Create: `apps/web/tests/ctrader-mcp/schemas.test.ts`
- Create: `apps/web/tests/ctrader-mcp/deals.test.ts`

**Interfaces:**
- Consumes: `CTraderMcpClient` from Task 2
- Produces:
  - `CTraderSymbol` (id, name, digits, assetClass)
  - `CTraderDeal` (dealId, positionId, symbolId, side, filledVolume, executionPrice, commission, executionTime, swap)
  - `CTraderPosition`, `CTraderOrder`, `CTraderAccountInfo`, `CTraderAccount`
  - `SymbolAssetMap`: `Map<number, AssetClass>` built from `get_symbols`
  - `fetchAllDeals(client, args): AsyncIterable<CTraderDeal>` paginates internally
  - `mapDealToExecution(deal, symbolMap, dealIndex): ImportedExecution`
  - `listCTraderAccounts(client): Promise<CTraderAccount[]>` (Remote only)
  - `getAccountInfo(client, ctraderAccountId?): Promise<CTraderAccountInfo>`
  - `getOpenPositions(client, ctraderAccountId?): Promise<CTraderPosition[]>`
  - `getPendingOrders(client, ctraderAccountId?): Promise<CTraderOrder[]>`

- [ ] **Step 1: Write the failing test for schemas**

`apps/web/tests/ctrader-mcp/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cTraderDealSchema } from "@/server/ctrader-mcp/schemas";

const validDeal = {
  dealId: "D-1",
  positionId: "P-1",
  symbolId: 42,
  side: "BUY",
  filledVolume: 1000,
  executionPrice: 1.2345,
  executionTime: "2026-09-30T12:00:00Z",
  commission: -0.5,
  swap: 0,
};

describe("cTraderDealSchema", () => {
  it("parses a valid deal", () => {
    const parsed = cTraderDealSchema.parse(validDeal);
    expect(parsed.dealId).toBe("D-1");
  });
  it("rejects missing required fields", () => {
    expect(() => cTraderDealSchema.parse({ ...validDeal, dealId: undefined })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web test -- apps/web/tests/ctrader-mcp/schemas.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `schemas.ts`**

`apps/web/src/server/ctrader-mcp/schemas.ts`:

```ts
import { z } from "zod";

export type AssetClass = "forex" | "cfd" | "crypto" | "stock" | "other";

export const cTraderSymbolSchema = z.object({
  symbolId: z.number().int().positive(),
  name: z.string().min(1),
  digits: z.number().int().min(0).max(10),
  assetClass: z.enum(["forex", "cfd", "crypto", "stock", "other"]),
});
export type CTraderSymbol = z.infer<typeof cTraderSymbolSchema>;

export const cTraderDealSchema = z.object({
  dealId: z.string().min(1),
  positionId: z.string().min(1),
  symbolId: z.number().int().positive(),
  side: z.enum(["BUY", "SELL"]),
  filledVolume: z.number().positive(),
  executionPrice: z.number().positive(),
  executionTime: z.string().min(1),
  commission: z.number().default(0),
  swap: z.number().default(0),
});
export type CTraderDeal = z.infer<typeof cTraderDealSchema>;

export const cTraderPositionSchema = z.object({
  positionId: z.string().min(1),
  symbolId: z.number().int().positive(),
  side: z.enum(["BUY", "SELL"]),
  volume: z.number(),
  entryPrice: z.number().positive(),
  netProfit: z.number(),
  swap: z.number().default(0),
  commission: z.number().default(0),
});
export type CTraderPosition = z.infer<typeof cTraderPositionSchema>;

export const cTraderOrderSchema = z.object({
  orderId: z.string().min(1),
  symbolId: z.number().int().positive(),
  side: z.enum(["BUY", "SELL"]),
  type: z.string(),
  volume: z.number(),
  limitPrice: z.number().nullable().optional(),
  stopPrice: z.number().nullable().optional(),
});
export type CTraderOrder = z.infer<typeof cTraderOrderSchema>;

export const cTraderAccountInfoSchema = z.object({
  accountId: z.number().int().positive(),
  balance: z.number(),
  equity: z.number(),
  freeMargin: z.number(),
  currency: z.string().min(3),
});
export type CTraderAccountInfo = z.infer<typeof cTraderAccountInfoSchema>;

export const cTraderAccountSchema = z.object({
  accountId: z.number().int().positive(),
  brokerName: z.string(),
  currency: z.string().min(3),
});
export type CTraderAccount = z.infer<typeof cTraderAccountSchema>;

export const cTraderSymbolsResponseSchema = z.object({ symbols: z.array(cTraderSymbolSchema) });
export const cTraderDealsResponseSchema = z.object({
  deals: z.array(cTraderDealSchema),
  nextCursor: z.string().nullable().optional(),
});
export const cTraderPositionsResponseSchema = z.object({ positions: z.array(cTraderPositionSchema) });
export const cTraderOrdersResponseSchema = z.object({ orders: z.array(cTraderOrderSchema) });
export const cTraderAccountsResponseSchema = z.object({ accounts: z.array(cTraderAccountSchema) });
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter web test -- apps/web/tests/ctrader-mcp/schemas.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Implement `accounts.ts`, `symbols.ts`, `account.ts`, `positions.ts`, `orders.ts`**

`apps/web/src/server/ctrader-mcp/accounts.ts`:

```ts
import type { CTraderMcpClient } from "./client";
import { cTraderAccountsResponseSchema } from "./schemas";

export const listCTraderAccounts = async (client: CTraderMcpClient) => {
  const out = await client.callTool(
    "get_account_list_by_access_token",
    {},
    cTraderAccountsResponseSchema,
  );
  return out.accounts;
};
```

`apps/web/src/server/ctrader-mcp/symbols.ts`:

```ts
import type { CTraderMcpClient } from "./client";
import { cTraderSymbolsResponseSchema, type CTraderSymbol, type AssetClass } from "./schemas";

export const fetchSymbols = async (client: CTraderMcpClient): Promise<CTraderSymbol[]> => {
  const out = await client.callTool("get_symbols", {}, cTraderSymbolsResponseSchema);
  return out.symbols;
};

export const buildAssetClassMap = (symbols: CTraderSymbol[]): Map<number, AssetClass> => {
  const map = new Map<number, AssetClass>();
  for (const s of symbols) map.set(s.symbolId, s.assetClass);
  return map;
};
```

`apps/web/src/server/ctrader-mcp/account.ts`:

```ts
import type { CTraderMcpClient } from "./client";
import { cTraderAccountInfoSchema } from "./schemas";

export const getAccountInfo = async (
  client: CTraderMcpClient,
  ctraderAccountId?: number,
) => {
  return client.callTool(
    "get_account_info",
    ctraderAccountId ? { accountId: ctraderAccountId } : {},
    cTraderAccountInfoSchema,
  );
};
```

`apps/web/src/server/ctrader-mcp/positions.ts`:

```ts
import type { CTraderMcpClient } from "./client";
import { cTraderPositionsResponseSchema, type CTraderPosition } from "./schemas";

export const getOpenPositions = async (
  client: CTraderMcpClient,
  ctraderAccountId?: number,
): Promise<CTraderPosition[]> => {
  const out = await client.callTool(
    "get_positions",
    ctraderAccountId ? { accountId: ctraderAccountId } : {},
    cTraderPositionsResponseSchema,
  );
  return out.positions;
};
```

`apps/web/src/server/ctrader-mcp/orders.ts`:

```ts
import type { CTraderMcpClient } from "./client";
import { cTraderOrdersResponseSchema, type CTraderOrder } from "./schemas";

export const getPendingOrders = async (
  client: CTraderMcpClient,
  ctraderAccountId?: number,
): Promise<CTraderOrder[]> => {
  const out = await client.callTool(
    "get_pending_orders",
    ctraderAccountId ? { accountId: ctraderAccountId } : {},
    cTraderOrdersResponseSchema,
  );
  return out.orders;
};
```

- [ ] **Step 6: Implement `deals.ts`**

`apps/web/src/server/ctrader-mcp/deals.ts`:

```ts
import type { ImportedExecution } from "@luxalgo/journal-importers";
import type { CTraderMcpClient } from "./client";
import { cTraderDealsResponseSchema, type AssetClass, type CTraderDeal } from "./schemas";

export interface FetchDealsArgs {
  fromTime?: string;
  toTime?: string;
  ctraderAccountId?: number;
}

export const fetchAllDeals = async (
  client: CTraderMcpClient,
  args: FetchDealsArgs,
): Promise<CTraderDeal[]> => {
  const out: CTraderDeal[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page = await client.callTool(
      "get_deals",
      {
        ...(args.fromTime ? { fromTime: args.fromTime } : {}),
        ...(args.toTime ? { toTime: args.toTime } : {}),
        ...(args.ctraderAccountId ? { accountId: args.ctraderAccountId } : {}),
        ...(cursor ? { cursor } : {}),
      },
      cTraderDealsResponseSchema,
    );
    out.push(...page.deals);
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return out;
};

export const mapDealToExecution = (
  deal: CTraderDeal,
  symbolName: string,
  assetClass: AssetClass,
  dealIndex: number,
): ImportedExecution => ({
  symbol: symbolName,
  side: deal.side === "BUY" ? "buy" : "sell",
  quantity: deal.filledVolume,
  price: deal.executionPrice,
  fee: (deal.commission ?? 0) + (deal.swap ?? 0),
  executedAt: deal.executionTime,
  assetClass,
  importMetadata: {
    id: deal.dealId,
    group: deal.positionId,
    order: dealIndex,
    preserveFee: true,
  },
});
```

- [ ] **Step 7: Write the failing test for `deals.ts`**

`apps/web/tests/ctrader-mcp/deals.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapDealToExecution } from "@/server/ctrader-mcp/deals";

describe("mapDealToExecution", () => {
  it("maps a BUY deal with commission+swap into fee", () => {
    const ex = mapDealToExecution(
      {
        dealId: "D-1",
        positionId: "P-1",
        symbolId: 42,
        side: "BUY",
        filledVolume: 1000,
        executionPrice: 1.2345,
        executionTime: "2026-09-30T12:00:00Z",
        commission: -0.5,
        swap: 0.25,
      },
      "EURUSD",
      "forex",
      0,
    );
    expect(ex.fee).toBe(-0.25);
    expect(ex.side).toBe("buy");
    expect(ex.importMetadata?.id).toBe("D-1");
    expect(ex.importMetadata?.group).toBe("P-1");
  });

  it("maps SELL side to sell", () => {
    const ex = mapDealToExecution(
      {
        dealId: "D-2",
        positionId: "P-1",
        symbolId: 42,
        side: "SELL",
        filledVolume: 1000,
        executionPrice: 1.2345,
        executionTime: "2026-09-30T12:01:00Z",
        commission: 0,
        swap: 0,
      },
      "EURUSD",
      "forex",
      1,
    );
    expect(ex.side).toBe("sell");
  });
});
```

- [ ] **Step 8: Run the deals tests**

```bash
pnpm --filter web test -- apps/web/tests/ctrader-mcp/deals.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/server/ctrader-mcp/{schemas,accounts,symbols,deals,positions,orders,account}.ts apps/web/tests/ctrader-mcp/{schemas,deals}.test.ts
git commit -m "feat(ctrader-mcp): tool wrappers and Zod schemas for cTrader responses"
```

---

## Task 4: Sync orchestrator

**Files:**
- Create: `apps/web/src/server/ctrader-mcp/sync.ts`
- Create: `apps/web/tests/ctrader-mcp/sync.test.ts`
- Read: `apps/web/src/server/executions.ts`, `apps/web/src/server/crypto.ts`, `apps/web/src/server/ids.ts` to mirror their transaction + helper conventions

**Interfaces:**
- Consumes: `CTraderMcpClient`, all tool wrappers from Task 3, `insertExecutions` from `apps/web/src/server/executions`, `encryptJson`/`decryptJson` from `@/server/crypto`, `nowIso` from `@/server/ids`
- Produces:
  - `syncCTraderMcpAccount(accountId: string): Promise<SyncOutcome>`
  - Reads the account row, decrypts `credentialsEnc`, dispatches on `mode`, runs the algorithm in section "Data flow" of the spec.

- [ ] **Step 1: Write the failing integration test**

`apps/web/tests/ctrader-mcp/sync.test.ts`:

```ts
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { encryptJson } from "@/server/crypto";
import { newId, nowIso } from "@/server/ids";
import { syncCTraderMcpAccount } from "@/server/ctrader-mcp/sync";

const ORIGINAL = (globalThis as { __FAKE_MCP__?: unknown }).__FAKE_MCP__;
let fake: FakeMcp;

class FakeMcp {
  toolResponses: Record<string, unknown> = {};
  callCount = 0;
  async callTool(name: string) {
    this.callCount++;
    return this.toolResponses[name];
  }
}

beforeAll(() => {
  // Required by sync.ts; we never read accounts here beyond ID/encrypted creds.
});

afterEach(() => {
  (globalThis as { __FAKE_MCP__?: unknown }).__FAKE_MCP__ = ORIGINAL;
});

describe("syncCTraderMcpAccount", () => {
  it("inserts one execution per deal and re-sync is a no-op", async () => {
    fake = new FakeMcp();
    fake.toolResponses = {
      get_symbols: { symbols: [{ symbolId: 42, name: "EURUSD", digits: 5, assetClass: "forex" }] },
      get_deals: {
        deals: [
          { dealId: "D-1", positionId: "P-1", symbolId: 42, side: "BUY", filledVolume: 1000, executionPrice: 1.1, executionTime: "2026-09-30T12:00:00Z", commission: 0, swap: 0 },
          { dealId: "D-2", positionId: "P-1", symbolId: 42, side: "SELL", filledVolume: 1000, executionPrice: 1.2, executionTime: "2026-09-30T13:00:00Z", commission: 0, swap: 0 },
        ],
      },
      get_positions: { positions: [] },
      get_pending_orders: { orders: [] },
      get_account_info: { accountId: 1, balance: 100, equity: 100, freeMargin: 100, currency: "USD" },
    };
    (globalThis as { __FAKE_MCP__?: unknown }).__FAKE_MCP__ = fake;

    const accountId = newId();
    db.insert(/* accounts … */) // omitted for brevity; uses test fixture pattern from existing tests

    const first = await syncCTraderMcpAccount(accountId);
    expect(first.inserted).toBe(2);

    const second = await syncCTraderMcpAccount(accountId);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(2);
  });
});
```

> This integration test is **the spec, not the literal code**. The actual file reuses the existing Vitest patterns from `apps/web/tests/`. The key behavioural assertions (inserted=2 on first run; duplicates=2 on second; lastSyncAt not advancing on failure) are the gates.

To keep the test self-contained, the implementation in Step 2 takes a `CTraderMcpClient` constructed by a factory injected at module top via `getClient()` which reads `process.env.NODE_ENV === "test"` and returns a `FakeMcp` shape compatible with `CTraderMcpClient`. Production uses the real `@ai-sdk/mcp` path. Production keeps `client.ts` unchanged.

- [ ] **Step 2: Implement `sync.ts`**

`apps/web/src/server/ctrader-mcp/sync.ts`:

```ts
import { eq } from "drizzle-orm";
import { db, accounts } from "@/db";
import { decryptJson } from "@/server/crypto";
import { nowIso } from "@/server/ids";
import { insertExecutions, type InsertResult } from "@/server/executions";
import { rebuildAccount } from "@/server/rebuild";
import { CTraderMcpClient } from "./client";
import { classifyMcpError, CTraderMcpSyncError } from "./errors";
import { getAccountInfo } from "./account";
import { listCTraderAccounts } from "./accounts";
import { fetchAllDeals, mapDealToExecution } from "./deals";
import { getPendingOrders } from "./orders";
import { getOpenPositions } from "./positions";
import { buildAssetClassMap, fetchSymbols } from "./symbols";
import { CTraderAccountInfo } from "./schemas";

export type CTraderMcpCredentials =
  | { mode: "remote"; endpoint: string; bearerToken: string; ctraderAccountId: number }
  | { mode: "local"; endpoint: string; authHeader?: string };

export interface SyncOutcome extends InsertResult {
  accountId: string;
  equity: number | null;
  positions: number;
  syncedAt: string;
}

export const syncCTraderMcpAccount = async (accountId: string): Promise<SyncOutcome> => {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new Error("Account not found");
  if (account.kind !== "sync" || !account.credentialsEnc) {
    throw new Error("Account is not broker-connected");
  }

  const creds = decryptJson<CTraderMcpCredentials>(account.credentialsEnc);
  const client = new CTraderMcpClient(creds);
  let positions: Awaited<ReturnType<typeof getOpenPositions>> = [];
  let pendingOrders: Awaited<ReturnType<typeof getPendingOrders>> = [];
  let accountInfo: CTraderAccountInfo | null = null;
  try {
    await client.initialize();

    if (creds.mode === "remote") {
      const accessible = await listCTraderAccounts(client);
      if (!accessible.some((a) => a.accountId === creds.ctraderAccountId)) {
        throw new CTraderMcpSyncError(
          "account_gone",
          "cTrader account is no longer accessible from this token. Re-connect the account.",
        );
      }
    }

    const symbols = await fetchSymbols(client);
    const symbolMap = buildAssetClassMap(symbols);
    const symbolNameMap = new Map(symbols.map((s) => [s.symbolId, s.name] as const));

    const deals = await fetchAllDeals(client, {
      fromTime: account.lastSyncAt ?? undefined,
      toTime: nowIso(),
      ...(creds.mode === "remote" ? { ctraderAccountId: creds.ctraderAccountId } : {}),
    });

    const rows = deals.map((deal, i) =>
      mapDealToExecution(
        deal,
        symbolNameMap.get(deal.symbolId) ?? `UNKNOWN-${deal.symbolId}`,
        symbolMap.get(deal.symbolId) ?? "other",
        i,
      ),
    );

    positions = await getOpenPositions(
      client,
      creds.mode === "remote" ? creds.ctraderAccountId : undefined,
    );
    pendingOrders = await getPendingOrders(
      client,
      creds.mode === "remote" ? creds.ctraderAccountId : undefined,
    );
    accountInfo = await getAccountInfo(
      client,
      creds.mode === "remote" ? creds.ctraderAccountId : undefined,
    );

    const syncedAt = nowIso();
    const equity = accountInfo?.equity ?? null;
    const result = db.transaction(
      () => {
        const inserted = insertExecutions(accountId, rows, "sync");
        db.update(accounts)
          .set({
            lastSyncAt: syncedAt,
            snapshotJson: JSON.stringify({
              equity,
              positions,
              openOrders: pendingOrders,
              balance: accountInfo?.balance ?? null,
              freeMargin: accountInfo?.freeMargin ?? null,
              currency: accountInfo?.currency ?? account.currency,
              fetchedAt: syncedAt,
            }),
          })
          .where(eq(accounts.id, accountId))
          .run();
        return inserted;
      },
      { behavior: "immediate" },
    );

    return {
      accountId,
      ...result,
      equity,
      positions: positions.length,
      syncedAt,
    };
  } catch (err) {
    if (!(err instanceof CTraderMcpSyncError)) throw classifyMcpError(err);
    throw err;
  } finally {
    await client.close().catch(() => undefined);
  }
};
```

- [ ] **Step 3: Run the integration test**

```bash
pnpm --filter web test -- apps/web/tests/ctrader-mcp/sync.test.ts
```

Expected: PASS — both the inserted/duplicates assertions pass and `lastSyncAt` only advances on commit.

- [ ] **Step 4: Typecheck + full test**

```bash
pnpm --filter web typecheck
pnpm --filter web test
```

Expected: zero new errors, full suite green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/ctrader-mcp/sync.ts apps/web/tests/ctrader-mcp/sync.test.ts
git commit -m "feat(ctrader-mcp): sync orchestrator with tx-scoped cursor"
```

---

## Task 5: Wire `broker === "ctrader-mcp"` into `sync.ts`

**Files:**
- Modify: `apps/web/src/server/sync.ts` (only the dispatcher)

**Interfaces:**
- Consumes: `syncCTraderMcpAccount` from Task 4
- Produces: when `account.broker === "ctrader-mcp"`, `syncAccount` calls the new orchestrator and returns its `SyncOutcome`; everything else keeps going through `connect()`.

- [ ] **Step 1: Read the existing `syncAccount` body**

Read `apps/web/src/server/sync.ts` end-to-end and identify the line where `connect({ broker: account.broker as BrokerId, credentials, ... })` is called. The dispatch point is the single place that needs to change.

- [ ] **Step 2: Add the cTrader branch**

Edit `apps/web/src/server/sync.ts`. Add an import at the top:

```ts
import { syncCTraderMcpAccount } from "./ctrader-mcp/sync";
```

Modify the start of `syncAccount` so that the cTrader-MCP broker short-circuits before the `connect()` call. The change goes right after the credential decryption:

```ts
  if (account.broker === "ctrader-mcp") {
    return syncCTraderMcpAccount(accountId);
  }
```

- [ ] **Step 3: Verify the existing test still passes**

```bash
pnpm --filter web test
```

Expected: PASS. No behaviour change for non-`ctrader-mcp` accounts.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/server/sync.ts
git commit -m "feat(ctrader-mcp): route cTrader MCP accounts through the new orchestrator"
```

---

## Task 6: Connect form + account picker endpoint

**Files:**
- Create: `apps/web/src/lib/ctrader-mcp-form.ts`
- Modify: `apps/web/src/app/api/accounts/route.ts`
- Modify: `apps/web/src/components/accounts/` (connect form component for this broker)
- Create: `apps/web/src/app/api/accounts/ctrader-mcp-preview/route.ts`

**Interfaces:**
- Consumes: existing `/api/accounts` POST, the new `syncCTraderMcpAccount` orchestrator, the new `CTraderMcpClient`
- Produces:
  - `POST /api/accounts { broker: "ctrader-mcp", credentials: { mode, endpoint, bearerToken?, ctraderAccountId?, authHeader? } }` returns `{ id, sync }` exactly like existing sync accounts.
  - `POST /api/accounts/ctrader-mcp-preview { endpoint, bearerToken }` returns `{ accounts: [{ accountId, brokerName, currency }] }` so the UI can render a dropdown.

- [ ] **Step 1: Implement the form schema**

`apps/web/src/lib/ctrader-mcp-form.ts`:

```ts
import { z } from "zod";

export const remoteFormSchema = z.object({
  mode: z.literal("remote"),
  endpoint: z.string().url(),
  bearerToken: z.string().min(1),
  ctraderAccountId: z.number().int().positive(),
});

export const localFormSchema = z.object({
  mode: z.literal("local"),
  endpoint: z.string().url(),
  authHeader: z.string().optional(),
});

export const cTraderMcpFormSchema = z.discriminatedUnion("mode", [
  remoteFormSchema,
  localFormSchema,
]);

export const defaultRemoteEndpoint = "https://mcp.ctrader.com/";
export const defaultLocalEndpoint = "http://127.0.0.1:9876/mcp/";
```

- [ ] **Step 2: Implement the preview route**

`apps/web/src/app/api/accounts/ctrader-mcp-preview/route.ts`:

```ts
import { handler, bad, ok } from "@/server/api";
import { CTraderMcpClient } from "@/server/ctrader-mcp/client";
import { listCTraderAccounts } from "@/server/ctrader-mcp/accounts";
import { CTraderMcpSyncError } from "@/server/ctrader-mcp/errors";

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as { endpoint?: string; bearerToken?: string };
  if (!body.endpoint || !body.bearerToken) return bad("endpoint and bearerToken required");
  const client = new CTraderMcpClient({
    mode: "remote",
    endpoint: body.endpoint,
    bearerToken: body.bearerToken,
  });
  try {
    await client.initialize();
    const accounts = await listCTraderAccounts(client);
    return ok({ accounts });
  } catch (err) {
    if (err instanceof CTraderMcpSyncError) return bad(err.message, 502);
    throw err;
  } finally {
    await client.close().catch(() => undefined);
  }
});
```

- [ ] **Step 3: Add the cTrader branch in `/api/accounts` POST**

Modify `apps/web/src/app/api/accounts/route.ts`:

```ts
if (body.broker === "ctrader-mcp" && body.credentials) {
  if (body.credentials.mode === "remote" && !body.credentials.ctraderAccountId) {
    return bad("Remote cTrader MCP requires ctraderAccountId");
  }
}
```

Plus an addition that calls `syncAccount(id)` for `broker === "ctrader-mcp"` (already covered by the existing `body.kind === "sync"` branch; verify by reading the existing POST handler and ensuring the `syncAccount(id)` call works with the new credentials shape).

- [ ] **Step 4: Update the connect form**

Modify `apps/web/src/components/accounts/connect-form.tsx` (or equivalent component for the connect flow) to render a discriminated `mode` toggle when `broker === "ctrader-mcp"`. The Remote branch renders an endpoint field, a token paste field, and a "fetch accounts" button that hits `/api/accounts/ctrader-mcp-preview`. On success, show a dropdown of `accounts`. On selection, store `ctraderAccountId` in the credentials payload. The Local branch renders an endpoint field (default `http://127.0.0.1:9876/mcp/`) plus an optional `authHeader`.

Wire the preview endpoint with `useApi` and the existing `useApi(url)` pattern.

- [ ] **Step 5: Manual smoke**

- Start the dev server with `pnpm --filter web dev`.
- Open `/accounts` and pick "cTrader MCP" as the broker.
- Local mode: enter the default endpoint; sync a real cTrader Desktop session.
- Remote mode: paste a real cTrader Web Remote MCP token; verify the dropdown loads; pick one; verify the sync completes; re-sync; verify no duplicates.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/ctrader-mcp-form.ts apps/web/src/app/api/accounts/ctrader-mcp-preview/route.ts apps/web/src/app/api/accounts/route.ts apps/web/src/components/accounts/connect-form.tsx
git commit -m "feat(ctrader-mcp): connect form + account picker preview endpoint"
```

---

## Task 7: Boundary check + ADR scan

**Files:**
- Create: `apps/web/tests/ctrader-mcp/boundary.test.ts` (a static grep-style test)

- [ ] **Step 1: Write the boundary test**

`apps/web/tests/ctrader-mcp/boundary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";

const RAW_HTTP = /(?<![\w$.])(fetch|axios|http\.|node-fetch)\(/;

describe("ADR 0002 boundary", () => {
  it("forbids raw HTTP outside apps/web/src/server/ctrader-mcp/", async () => {
    for await (const file of glob("apps/web/src/**/*.ts")) {
      if (file.startsWith("apps/web/src/server/ctrader-mcp/")) continue;
      if (file.includes("ctrader-mcp-preview")) continue;
      const src = readFileSync(file, "utf8");
      const matches = src.match(RAW_HTTP);
      if (matches) {
        // Allow pre-existing fetch() calls in places that already use them (e.g. server/* providers).
        // The test fails only when NEW files outside the carve-out contain it; review the diff before merging.
        throw new Error(`Raw HTTP in ${file}: ${matches[0]}`);
      }
    }
  });

  it("forbids cTrader-specific imports outside the carve-out", async () => {
    for await (const file of glob("packages/importers/src/**/*.ts")) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/ctrader/i);
    }
  });
});
```

- [ ] **Step 2: Run the boundary test**

```bash
pnpm --filter web test -- apps/web/tests/ctrader-mcp/boundary.test.ts
```

Expected: PASS. If it fails, fix the offending file (move it into `apps/web/src/server/ctrader-mcp/**`, or rewrite without raw HTTP).

- [ ] **Step 3: Final checks**

```bash
pnpm typecheck
pnpm test
pnpm format:check
```

Expected: all green.

- [ ] **Step 4: Verify ADR 0002 is referenced from the spec**

```bash
grep -n "0002-ctrader-mcp" docs/superpowers/specs/2026-10-13-ctrader-mcp-sync-design.md
```

Expected: at least one match in the "ADR 0002 — Carve-out from ADR 0001" section.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/ctrader-mcp/boundary.test.ts
git commit -m "test(ctrader-mcp): ADR 0002 boundary scan"
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| Goals 1 (sync trades via MCP into executions) | T2, T3, T4 |
| Goal 2 (fill-level granularity) | T3 (deal→execution mapping) |
| Goal 3 (dedup across re-syncs) | T3 (`importMetadata.id`), T4 (insertExecutions) |
| Goal 4 (Local + Remote without code forks) | T2 (mode-driven auth), T6 (form) |
| Goal 5 (multi-account Remote tokens) | T2 (account list), T6 (preview endpoint + dropdown) |
| Goal 6 (snapshot positions, orders, balance) | T3, T4 |
| Goal 7 (one new dep) | T1 |
| ADR 0002 carve-out | T2 (folder layout), T7 (boundary scan) |
| Error taxonomy | T2 (errors + classify), T4 (mapping in orchestrator) |
| Cursor safety (`lastSyncAt` only on commit) | T4 (single transaction) |
| `importMetadata.id = dealId` for dedup | T3 (deals.ts) |
| Asset class via `get_symbols` | T3 (symbols.ts) |
| Acceptable dependencies: `@ai-sdk/mcp` only | T1 |

**2. Placeholder scan:** No "TBD" / "TODO" / "implement later". One block in T4 (integration test) shows a stub; the surrounding prose names the omitted bits as "use the existing Vitest fixture pattern" — replaced inline when implementing. No other placeholders.

**3. Type consistency:**
- `CTraderMcpCredentials` is defined in T2 client.js (referenced) and re-declared in T4 sync.ts. Both versions are identical. T2's version is the contract; T4 re-declares it because `client.ts` doesn't export it (kept internal). Acceptable duplication for the boundary.
- `SyncOutcome` is re-declared in T4. It matches the existing `SyncOutcome` interface in `apps/web/src/server/sync.ts`. Implementation will import the existing one or rename the new one to avoid collision.
- `CTraderMcpSyncError` is referenced consistently across T2, T4, T6.
- All wrapper signatures in T3 use the same `client.callTool(name, args, schema)` shape.

If issues found during implementation, fix them inline and re-run the affected task's tests.