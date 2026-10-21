# 05 — Events and Background Processing

**Evidence register:** ARCH-200–299

---

## 5.1 Event Infrastructure

**Finding:** No **domain** event bus, message broker, or job queue exists in the application. All coordination is direct function calls and HTTP request/response.

`VERIFIED` — Grep for `EventEmitter`, `addListener`, `dispatch`, `process.on`, `cron`, `worker_threads`, `pg-boss`, `bullmq`, `streamText`, `ReadableStream`, `WebSocket`, `EventSource` across `apps/web/src/`, `packages/*/src/`, and `scripts/` returns zero hits for domain-event patterns.

**Counterexample (the `subscribe` grep is NOT zero):** `apps/web/src/components/charts/tokens.ts:49-74` implements a real pub/sub listener registry — a `Set<() => void>` of listeners plus `subscribeTokens(listener)` (`:50`), consumed by `useSyncExternalStore(subscribeTokens, …)` (`:74`). It is a **design-token subscription** (theme-change notification for ECharts canvas painters), not a domain event bus. Two other pub/sub-shaped mechanisms exist and are documented in this report rather than hidden:

- `apps/web/src/lib/api-request.ts:10-43` — ref-counted in-flight GET sharing (`users` counter, `queueMicrotask` abort at zero).
- `apps/web/src/server/market-data/transport.ts:9-79` — an in-process outbound request **queue** with rate limits (not a broker).

**Scope:** the Rust desktop tree (`desktop/src-tauri/src/`) was also scanned. It contains no threads or channels — only `tokio::spawn` for async tasks (`desktop/src-tauri/src/lib.rs:95`).

---

### 5.2 Timers and Scheduling

#### `setInterval` — UI animation only

- `apps/web/src/components/trade-market-data.tsx:369` — animation frame counter, cancels on `playing` or `privacy` state change.

No other `setInterval` calls exist. `ARCH-201`

#### `setTimeout` — debounce and retries

| File | Purpose | ARCH |
|------|---------|------|
| `apps/web/src/lib/use-autosave.ts:65` | 500 ms debounce (`setTimeout(() => void flush(), 500)`) before flushing autosave | `ARCH-202` |
| `apps/web/src/server/market-data/transport.ts:39` | The **only** `setTimeout` call in the transport — re-arms the queue pump when a job is still waiting on a per-host cooldown | `ARCH-203` |

Market-data queue limits (`server/market-data/transport.ts`):

| Limit | Value | Line |
|-------|-------|------|
| Max concurrent jobs (global) | 6 | `:27` (`running < 6`) |
| Max concurrent jobs (per host) | 2 | `:27` (`(active.get(job.host) ?? 0) < 2`) |
| Queue depth before rejecting | 64 | `:44` (`queue.length >= 64`) |
| Minimum interval between starts, per host | 350 ms | `:9` (`minIntervalMs = 350`), applied at `:34` |

The transport also keeps a **process-local response cache** — the only quasi-persistent state in the app: a `Map` of cached entries with a TTL (15 s for current windows, 300 s for historical ones — `:143`) and a 4 MiB per-entry / 16 MiB total byte budget (`:144`, `:150`). Credentials are never part of the cache key — it is a SHA-256 of `host + sorted headers` (`:79`, `:82`).

#### `queueMicrotask` — request deduplication

- `apps/web/src/lib/api-request.ts:37` — aborts shared in-flight requests when last subscriber detaches.
- `apps/web/src/lib/use-api.ts` — uses `startTransition` (React scheduler), not a timer.

---

### 5.3 Reactive Data — No Streaming

**Finding:** All data fetching is request/response. No Server-Sent Events, WebSocket, or streaming responses.

`VERIFIED` — Grep for `streamText`, `ReadableStream`, `WebSocket`, `EventSource`, `createEventBus` across `apps/web/src/` returns zero hits. All four AI routes (`ask`, `recap`, `critique`, `reports`) return `NextResponse.json(...)` — fully buffered. `ARCH-204`

The Vercel AI SDK `runText` / `generateText` APIs are used (non-streaming). `ARCH-205`

---

### 5.4 Autosave / Background Write

The notebook editor uses `useAutosave` (`apps/web/src/lib/use-autosave.ts`):

```
User types → 500 ms debounce (:65) → PATCH /api/notes/{id}
             ↓ (pending edits merged)
             every POST carries keepalive when the body is < 50 000 chars (:24)
             ↓ beforeunload (:53-56) → flush() one last time
             ↓ on network error
             edits retained for retry
```

Note: `keepalive` is set on **every** autosave POST, not only during `beforeunload`; `beforeunload` merely triggers a final `flush()`. The 50 KB threshold is measured in JavaScript string characters, not bytes.

`ARCH-202`

---

### 5.5 Write Side Effects and Transaction Boundaries

**Finding:** Trade write side effects are synchronous and in-process. Bulk execution inserts are transactional; single-trade annotation updates and deletions are **not** wrapped in an explicit transaction.

`VERIFIED` — Write paths re-checked line by line:

| Write path | Transaction? | Evidence |
|------------|--------------|----------|
| Bulk execution import (`insertExecutions`) | **Yes** — `db.transaction((tx) => { … })` | `apps/web/src/server/executions.ts:124` |
| Trade annotation update (`PATCH /api/trades/[key]`) | **No** — a single `db.update(trades).set(patch).where(...).run()` | `apps/web/src/app/api/trades/[key]/route.ts:93` |
| Trade delete (`DELETE /api/trades/[key]`) | **No** — `db.delete(executions)…run()` then `rebuildAccount(accountId)` as two separate statements | `apps/web/src/server/executions.ts:223-229` |
| `GET /api/trades` | N/A — read-only | `apps/web/src/app/api/trades/route.ts` exports `GET` only |

`ARCH-206`

The `accounts` table triggers no external webhooks or downstream services. `rebuildAccount` (`apps/web/src/server/rebuild.ts:13`) recomputes round-trips and metrics in-process.

---

### 5.6 Summary — Reactive Architecture

```
Dashboard load → GET /api/stats?query
Filter change  → URL param update → useApi re-fetch (no polling)
Trade save     → POST /api/trades → db.transaction (bulk imports)
Autosave note  → 500 ms debounce → PATCH /api/notes/{id}
Market data    → queued HTTP fetch with per-host rate limits (6 / 2 / 64, 350 ms)
AI features    → request/response, no streaming
No background workers, no cron, no domain event bus, no SSE/WebSocket
```

`VERIFIED` — no `cron`, `setInterval` (other than animation), `EventEmitter`, or worker threads found in `apps/web/src`, `packages/*/src`, or `scripts/`. The only pub/sub construct is the design-token listener registry in `components/charts/tokens.ts:49-74`. `ARCH-200, ARCH-201, ARCH-207`

---

## Evidence Register

| ID | Source | Status |
|----|--------|--------|
| ARCH-200 | Grep `EventEmitter\|addListener\|dispatch\|process\.on\|cron\|worker_threads\|pg-boss\|bullmq` across `apps/web/src`, `packages/*/src`, `scripts/` | VERIFIED — no domain-event matches; `subscribe` **does** match `components/charts/tokens.ts:50` (design-token listener registry, not a domain bus) |
| ARCH-201 | `apps/web/src/components/trade-market-data.tsx:369` | VERIFIED — `setInterval` only for animation |
| ARCH-202 | `apps/web/src/lib/use-autosave.ts:65` (debounce), `:24` (keepalive), `:53-56` (beforeunload flush) | VERIFIED — 500 ms debounce flush; keepalive on every POST |
| ARCH-203 | `apps/web/src/server/market-data/transport.ts:39` (`setTimeout`), `:27` (6 global / 2 per host), `:44` (64 queue depth), `:9`+`:34` (`minIntervalMs = 350`) | VERIFIED — rate-limit queue |
| ARCH-204 | Grep `streamText\|ReadableStream\|WebSocket\|EventSource` | VERIFIED — no matches |
| ARCH-205 | `apps/web/src/server/ai-runtime.ts:130-160` | VERIFIED — `runTextAi` non-streaming |
| ARCH-206 | `apps/web/src/server/executions.ts:124`, `:223-229`; `apps/web/src/app/api/trades/[key]/route.ts:93`; `apps/web/src/app/api/trades/route.ts` | VERIFIED — bulk inserts transactional; annotation update and delete are not explicitly wrapped |
| ARCH-207 | Grep `cron\|worker_threads\|pg-boss\|bullmq\|setInterval` | VERIFIED — no background schedulers |
