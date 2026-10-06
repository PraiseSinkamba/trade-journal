# API Design Style Guide

HTTP API design for `apps/web/src/app/api/`. Companion to `api-routes.md` (handler mechanics). This guide covers the contract and shape.

---

## Resource Naming

```
app/api/
  trades/          ← collection of trade resources
  executions/      ← execution records
  imports/         ← import sessions
  accounts/        ← account configs
```

- Folders: kebab-case, plural nouns for collections.
- One primary resource per folder. Side-effects (e.g. `/imports/[id]/resolve`) are nested folders, not query params.
- Do not verb URLs: the HTTP method is the verb.

---

## Response Envelope

**Success** — `200 OK`, `201 Created`, `204 No Content`:

```ts
// Single resource
{ data: T }

// Paginated list (executions, trades)
{ items: T[], nextCursor?: string }

// Mutation with side-effects (import, sync)
{ data: T, warnings?: string[] }
```

**Error** — always 4xx or 5xx:

```ts
// Validation / domain errors (400, 409, 422)
{ error: { code: string; message: string; fields?: Record<string, string> } }

// Auth / forbidden (401, 403)
{ error: { code: "UNAUTHORIZED" | "FORBIDDEN"; message: string } }

// Not found (404)
{ error: { code: "NOT_FOUND"; message: string } }

// Unexpected (500) — logged server-side; message is generic
{ error: { code: "INTERNAL_ERROR"; message: "An unexpected error occurred" } }
```

**Never** return a raw provider payload, stack trace, or key fragment in an error body. The client sees `code` + `message` only.

See `apps/web/src/server/api.ts` for the `RequestError` class and `requireValue` helper that enforce this envelope.

---

## Status Code Rules

| Code | Use |
|------|-----|
| `200` | GET, PATCH, idempotent POST (e.g. rebuild) |
| `201` | POST that creates a resource (import, sync) |
| `204` | DELETE; POST with no body to return |
| `400` | Malformed request body, missing required field |
| `401` | Missing or invalid authentication token |
| `403` | Valid token but insufficient permission |
| `404` | Resource does not exist |
| `409` | Conflict — trade key clash, duplicate import hash |
| `422` | Body parses but fails semantic validation (e.g. close before open) |
| `500` | Unexpected exception; logged, never exposed |

---

## Pagination — Cursor-Based

Large collections (executions, trades) use cursor pagination. **Never use OFFSET** — it drifts under concurrent writes.

```ts
// Request
GET /api/executions?cursor=eyJhaWQiOjEsImRpciI6M30&limit=100

// Response envelope
{ items: Execution[], nextCursor: string | null }
```

Cursor encodes the sort key + last seen id. Limit is capped server-side (max 500). Return `null` for `nextCursor` when the page is final.

See `apps/web/src/server/executions.ts` for the cursor encoding pattern using `btoa(JSON.stringify({...}))`.

---

## Idempotency

Import and sync endpoints accept `Idempotency-Key` header.

```
POST /api/imports
Idempotency-Key: <uuid-v4>
```

If a request with the same key was already processed, return its cached response without re-running the import. Keys expire after 24 hours. Replay returns the same status code as the original.

---

## Versioning

- Additive changes (new optional field, new endpoint) do **not** bump the version.
- Breaking changes (removed field, changed semantics, renamed enum value) require a versioned path: `/api/v2/...`.
- A new required field is breaking. A new optional field is additive.
- Document breaking decisions in `docs/decisions/` with an ADR.

---

## Filtering

Read filters from `packages/core/src/analysis.ts` — `FILTER_KEYS`, `readFilters`, `matchesFilters`. **Do not reimplement filter parsing** in route handlers.

```ts
// Correct — delegates to shared filter logic
const filters = readFilters(searchParams);
const trades = await db.select().from(tradesTable).where(matchesFilters(filters));
```

---

## Timestamps

- All timestamps in responses: **ISO 8601 strings in UTC**, e.g. `"2025-01-15T09:30:00.000Z"`.
- Display timezone is the client's responsibility.
- Server stores and compares in UTC; never store local time.

---

## Backwards Compatibility

- **Never remove a field** from a response envelope without a deprecation notice in `docs/decisions/`.
- Add new fields as **optional**.
- If a field must be removed, deprecate it first (document, then sunset).

---

## Cross-Cutting Concerns

- Auth is injected by the Next.js route wrapper — handlers receive a typed `session`.
- Rate limiting: apply per-`session.accountId`, not per-IP.
- Request IDs: generate with `crypto.randomUUID()` and include in logs; return `X-Request-ID` header in responses.

---

## Cite

- `apps/web/src/server/api.ts` — `RequestError`, `requireValue`, response envelope helpers
- `apps/web/src/server/executions.ts` — cursor pagination, idempotency key handling, insert pattern

---

## Checklist before PR

- [ ] Every endpoint returns the documented envelope (`{ data }` / `{ items, nextCursor }` / `{ error }`); no bare objects or arrays at top level
- [ ] Status codes match the table above; no `200` for an error condition
- [ ] Cursor pagination used for lists > 1 page; OFFSET not used anywhere
- [ ] Import/sync endpoints read `Idempotency-Key` header and return cached result on replay
- [ ] Error responses contain no stack trace, no API key fragment, no raw provider payload
- [ ] Filters delegated to `readFilters` / `matchesFilters` from `packages/core/src/analysis.ts`
- [ ] All timestamps are ISO 8601 UTC strings; no local-time storage
- [ ] New fields are optional-only; removed fields documented in `docs/decisions/`
