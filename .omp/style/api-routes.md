# API Route Handler Style Guide

> Applies to `apps/web/src/app/api/` and server utilities under `apps/web/src/server/`. Next.js 15 Route Handlers, Drizzle ORM, better-sqlite3.

---

## Route handler wrapper

Every route handler is wrapped with `handler()` from `apps/web/src/server/api.ts`. It provides uniform JSON error responses (no HTML 500 pages) and enforces auth unless `{ public: true }` is passed.

```ts
import { handler } from "@/server/api";

export const GET = handler(async () => {
  // ...
});

export const POST = handler(async (req) => {
  const body = await req.json();
  // ...
});
```

The wrapper catches all thrown errors and returns `{ error: string }`. Never wrap a handler body in your own try/catch that swallows errors.

---

## Error types

- **`RequestError`** — thrown for 4xx client errors. The wrapper returns HTTP 400 with `{ error: message }`.
- Any other thrown `Error` — the wrapper returns HTTP 500 with `{ error: message }`.
- Never throw plain strings.

```ts
import { RequestError } from "@/server/api";

if (!accountId) throw new RequestError("accountId is required");
```

Use the `requireValue` helper for assertions:

```ts
import { requireValue } from "@/server/api";

requireValue(trade.symbol, "symbol is required");
```

---

## Authentication

Route handlers enforce auth unless `{ public: true }` is passed. Public routes: `/api/auth` and `login`.

```ts
// Public — no auth check
export const POST = handler(async (req) => { ... }, { public: true });
```

Auth is **verified twice**: the middleware in `apps/web/src/middleware.ts` gates navigation and API routes at the runtime level (presence check), and handlers re-verify the HMAC-signed session cookie to prevent cookie-tampering attacks. Do not rely on middleware alone.

```ts
// In every handler that reads the session:
const token = (await cookies()).get(AUTH_COOKIE)?.value;
if (!verifySession(token)) return bad("Unauthorized", 401);
```

---

## Input validation

Validate at the trust boundary — parse the raw request body, then pass typed objects to server helpers. Never spread `req.body` directly into DB queries.

```ts
export const POST = handler(async (req) => {
  const raw = await req.json();
  const body = parseTradeBody(raw); // throws RequestError on invalid
  return ok(await serverTrades.create(body));
});
```

Use `requireValue` or explicit type guards for required fields. Reject, don't coerce, on malformed input.

---

## AI path — never leak provider details

`apps/web/src/server/ai.ts` sanitizes all AI provider errors. The `runAi` function in that file maps `APICallError` to plain-language categories:

- `401`/`403` → "AI authentication_error: check your provider key"
- `429`/`529` → "AI rate limit: please try again shortly"
- `404` / model not found → "AI model unavailable"
- Billing/credit → "AI billing: check your provider account's credits"

Never relay raw provider error messages, key fragments, stack traces, or request payloads from AI calls. If you call `runAi`, wrap failures in a user-friendly message — do not re-throw the raw provider exception.

---

## Persistence with transactions

All write paths use `db.transaction` with `behavior: "immediate"` so the DB acquires a write lock immediately. Combine dependent inserts and any derived rebuilds (e.g., inserting executions then recomputing stats) in a **single transaction** — a failure must not leave executions without a parent trade or stats in an inconsistent state.

```ts
const result = db.transaction(
  () => {
    const execResult = insertExecutions(execs);
    rebuildStats(accountId);
    return execResult;
  },
  { behavior: "immediate" },
);
```

---

## Long-running operations

For operations that exceed a typical request timeout:

- **Stream NDJSON** to the client for large export/import payloads.
- Use `AbortController` to respect client disconnection.
- Never perform synchronous I/O in the main thread (no blocking `readFileSync`, no tight loops over large datasets without yielding).

---

## Broker connectivity

All broker access goes through `@luxalgo/broker-sdk` — specifically the `connect` and `listBrokers` exports in `apps/web/src/server/sync.ts`. **Never call a broker API directly.**

```ts
import { connect, listBrokers } from "@luxalgo/broker-sdk";

const connection = connect({ brokerId, credentials });
const snapshot = await connection.fetchSnapshot();
```

`listBrokers` returns available broker types; `connect` returns a connected session used for `fetchSnapshot`.

---

## Credentials

Read and write encrypted credentials through `apps/web/src/server/crypto.ts`. Never log decrypted secrets. Never store plaintext credentials in the DB.

```ts
import { decryptJson, encryptJson } from "@/server/crypto";

const credentials = decryptJson<Record<string, string>>(account.credentialsEnc);
```

---

## Route resource naming

One folder per resource, kebab-case:

```
api/trades/
api/executions/
api/import/
api/stats/
api/analysis/
api/journal/
api/ai/recap/
api/ai/critique/
api/ai/ask/
api/market-data/
api/prop-firms/
api/brokers/
```

Existing resources (as of this writing): `trades`, `executions`, `import`, `stats`, `analysis`, `journal`, `ai/{recap,critique,ask}`, `market-data`, `prop-firms`, `brokers`. Keep the list current when adding new routes.

---

## Response helpers

Use `ok(data)` for success — it sets `Cache-Control: private, no-store` by default. Use `bad(message, status)` for client errors.

```ts
return ok({ trades: result.trades, count: result.count });
return bad("Symbol is required", 400);
```

---

## Checklist before PR

- [ ] Every handler wrapped with `handler(fn)` from `@/server/api`
- [ ] `RequestError` thrown for 400 cases; plain `Error` only for 500
- [ ] Auth cookie re-verified in handler (not only middleware)
- [ ] Input parsed and validated at boundary before passing to server helpers
- [ ] All AI errors sanitized through `runAi` categories; no raw provider payloads leaked
- [ ] Write paths use `db.transaction` with `behavior: "immediate"` for atomicity
- [ ] No direct broker API calls; all broker connectivity via `@luxalgo/broker-sdk`
- [ ] No decrypted secrets logged
