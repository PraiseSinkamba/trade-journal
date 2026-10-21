# 07 — Authentication and Security

**Evidence register:** ARCH-300–399

---

## 7.1 Authentication Model

**Finding:** Single-user, self-hosted, optional password gate. No multi-user accounts, no RBAC, no OAuth/OIDC.

`VERIFIED` — `apps/web/src/server/auth.ts:4-6`: "Single-user auth, optional by design: it's your journal on your box."

`ARCH-301`

### Password Gate

| Env var | Effect | Default |
|---------|--------|---------|
| `JOURNAL_PASSWORD` unset | No auth — all requests pass | Active |
| `JOURNAL_PASSWORD=...` | Login required; session cookie checked | — |

Login is a single POST to `/api/auth` with `{ password }`. Success sets an `httpOnly` cookie. No username — one password, one session.

`ARCH-302`

### Session Token

```typescript
// apps/web/src/server/auth.ts:12-15
export const sessionToken = (): string =>
  createHmac("sha256", process.env.JOURNAL_PASSWORD ?? "")
    .update("session-v1")
    .digest("hex");
```

- HMAC-SHA256 over the constant string `"session-v1"`.
- Rotating `JOURNAL_PASSWORD` immediately invalidates all sessions (the token is derived from the password).
- Comparison uses `timingSafeEqual` for both password verification (`auth.ts:17-21`) and session validation (`auth.ts:23-29`). Note both call sites are guarded by an `expected.length === given.length &&` short-circuit before the constant-time compare — standard practice (it avoids `timingSafeEqual` throwing on unequal lengths), but it means the comparison is only constant-time **for equal-length inputs**.

`ARCH-303`

### Cookie

```typescript
// apps/web/src/app/api/auth/route.ts:12-18
jar.set(AUTH_COOKIE, sessionToken(), {
  httpOnly: true,
  sameSite: "lax",
  secure: new URL(request.url).protocol === "https:",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,  // 30 days
});
```

- `httpOnly` — inaccessible from JavaScript.
- `sameSite: lax` — not sent on cross-site POSTs.
- `secure` — only sent over HTTPS when the request URL is HTTPS.
- `maxAge` — a **browser-side** cookie lifetime only; see §7.8 for the absence of server-side session expiry.

**Proxy caveat:** `secure` is derived from `new URL(request.url).protocol`, i.e. the URL the Next server sees — not the scheme the client used. Behind a TLS-terminating reverse proxy that forwards plain HTTP upstream (the `docker-compose.yml` topology maps `3000:3000` with no TLS), `request.url` is `http:` and the cookie is silently issued **without** `Secure`.

`ARCH-304`

---

## 7.2 Middleware Gate

**File:** `apps/web/src/middleware.ts`

```typescript
export const middleware = (request: NextRequest) => {
  if (!process.env.JOURNAL_PASSWORD) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname === "/api/auth") return NextResponse.next();
  const cookie = request.cookies.get("journal_session")?.value;
  if (!cookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
};
```

**Critical limitation:** The middleware only checks for cookie **presence**, not validity. `VERIFIED` for the code; `INFERRED` for the stated reason.

The source comment (`middleware.ts:3-7`) says: *"the middleware runtime has no Node crypto, so it gates navigation while the handlers gate data."* Next 15.5 does support a Node.js middleware runtime, so the constraint is a **choice of the author**, not a hard platform limit — reworded accordingly.

The matcher (`middleware.ts:23-24`) is `["/((?!_next/static|_next/image|favicon.ico).*)"]` — everything except Next's static asset paths and the favicon runs through the gate.

`ARCH-305`

The actual cryptographic validation happens in every API route handler via the `handler()` wrapper in `apps/web/src/server/api.ts`:

```typescript
// apps/web/src/server/api.ts:27-30
if (!options.public && passwordConfigured()) {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!verifySession(token)) return bad("Unauthorized", 401);
}
```

`ARCH-306`

---

## 7.3 API Authorization — Route-Level

Every route handler is wrapped with `handler(...)` from `apps/web/src/server/api.ts`. Public routes (login, static assets) pass `{ public: true }`.

**All other routes require a valid session cookie** when `JOURNAL_PASSWORD` is set.

```typescript
export const POST = handler(async (request: Request) => { ... });
export const GET = handler(async (request: Request) => { ... });
// → { public: true } required for unauthenticated access
```

No role checks and no per-resource authorization — the app is single-user. The one meaningful narrowing control is at the **AI boundary**: `readAiRequest` (`apps/web/src/server/ai-scope.ts:50-181`) whitelists the request body fields (`question`/`date`, `filters`, `timeZone`, `dataSource`, `tradeCritiqueKey`), validates `dataSource` against a fixed enum, rejects unknown filter keys, and freezes the resulting scope (`deepFreeze`, `:15-22`). That is scope *narrowing*, not identity-based authorization.

`ARCH-307`

---

## 7.4 AI Key Management

### Key Resolution Order

```typescript
// apps/web/src/server/settings.ts:119-129
export const resolveAiConfiguration = (): {
  provider: AiProvider;
  modelId: string;
  apiKey: string | null;
} => {
  const provider = getAiProvider();
  return {
    provider,
    modelId: getAiModel(provider),
    apiKey: getAiKey(provider),
  };
};
```

The ordering lives in `getAiKey` (`settings.ts:64-75`):

1. **Environment variable** (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, via `aiKeyEnvironment` at `:59-61`) — highest priority.
2. **Saved encrypted key** in the `settings` table, row key `${provider}KeyEnc` (`:67`).
3. **`null`** — feature disabled.

Note the property is **`modelId`**, not `model`.

`ARCH-308`

### AI Keys at Rest

Broker credentials AND AI provider keys are encrypted with AES-256-GCM before storage in the `settings` table.

```typescript
// apps/web/src/server/crypto.ts:24-34
export const encryptJson = (value: unknown): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    iv.toString("base64"),
    encrypted.toString("base64"),
    cipher.getAuthTag().toString("base64"),
  ].join(".");
};
```

Key material derivation:

```typescript
// apps/web/src/server/crypto.ts:12-22
const keyMaterial = (): Buffer => {
  const secret = process.env.JOURNAL_SECRET;
  if (secret && secret.length > 0) return scryptSync(secret, "luxalgo-trade-journal", 32);
  // Falls back to .secret file in data directory
  const dir = dataDir();
  const keyPath = join(dir, ".secret");
  if (!existsSync(keyPath)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return Buffer.from(readFileSync(keyPath, "utf8").trim(), "hex");
};
```

**Key derivation:** `scryptSync(JOURNAL_SECRET, "luxalgo-trade-journal", 32)` → 32-byte AES-256 key.
**Encryption:** AES-256-GCM with random 12-byte IV per encryption.
**Fallback:** Random key written to `{JOURNAL_DATA_DIR}/.secret` with mode `0o600` (owner-read-only).

**Secret-rotation failure mode:** changing `JOURNAL_SECRET` re-derives a different AES key, so every previously stored credential envelope fails to decrypt. `decryptJson` (`crypto.ts:36-46`) then throws either `"Malformed credential envelope"` (structurally broken) or a GCM auth-tag failure. `getAiKey` swallows that and returns `null` (`settings.ts:70-73`), so **saved AI keys silently disappear**; broker credentials fail closed at read time. There is no key-rotation or re-encryption path in the codebase.

`ARCH-309`

### AI Key Storage Flow

```
User enters key in AiSettings UI
    ↓
PATCH /api/settings { anthropicKey: "sk-ant-..." }   (app/api/settings/route.ts:47, :133-134)
    ↓
server/settings.ts:77-80  setAiKey("anthropic", key)
    ↓
    setSetting("anthropicKeyEnc", encryptJson(key.trim()))   (settings.ts:79)
    ↓
server/crypto.ts:24  encryptJson(key) → "base64iv.base64ct.base64tag"
    ↓
server/settings.ts:24-29  setSetting → db.insert(settings).values({key, value})
                                     .onConflictDoUpdate({ target: settings.key, set: { value } }).run()
```

Two corrections to the commonly assumed flow: the settings **row key is `anthropicKeyEnc`** (or `openaiKeyEnc`), not `anthropicKey`; and the write is an **upsert** via `setSetting`, not a `db.update(...).run()`.

Also note `setAiKey` is unconditional — a key saved through the UI is persisted to the DB **even when the same provider's environment variable is already set**. The env var only wins on *read*; it does not prevent storage.

The plaintext key never appears in logs.

`ARCH-310`

### AI Provider Outbound

- AI requests go **directly from this server** to the provider's API.
- `store: false` is set on all OpenAI API calls to prevent provider-side logging.
- Provider error messages are sanitised before returning to the UI — no key fragments.
- `apps/web/src/server/ai-runtime.ts` maps provider errors to safe categories: `missing_key`, `authentication`, `billing`, `rate_limited`, `model_unavailable`, `timeout`, `provider`.

`ARCH-311`

---

## 7.5 Credential Exposure Surface

| Credential | Storage | Access |
|-----------|---------|--------|
| `JOURNAL_PASSWORD` | env var | Middleware (presence only), Node API handlers (HMAC compare) |
| AI API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) | env var | Node only (runtime) |
| Saved AI keys (encrypted) | `settings` table, row key `${provider}KeyEnc` | Node only |
| Broker credentials | `settings` table, AES-256-GCM encrypted | Node only |
| Encryption key (`.secret`) | `{JOURNAL_DATA_DIR}/.secret` file | Node only |
| Session cookie | Browser httpOnly cookie | JavaScript: none |

`ARCH-312`

### Side-Channel Risks

- **Logs:** No explicit redaction found in API handlers. If `data.error ?? "Request failed"` throws a raw provider message, it could reach the client JSON. `mapAiRuntimeError` in `ai-runtime.ts` wraps provider errors, but error paths in individual handlers must be audited. `ARCH-313`
- **Concrete leak vector:** `apps/web/src/server/api.ts:33` returns `error.message` **verbatim** for any exception that is not a `RequestError`. A raw driver error (e.g. a SQLite message containing file paths or SQL) is therefore serialised into the JSON response body and delivered to the browser with status 500.
- **Account names:** No obfuscation. Account names appear in API responses and UI. Not a secret by design (single-user).
- **Database file:** Copied `data/` directory retains the `.secret` key file, so broker/AI credentials remain decryptable. This is intentional — same trust boundary.

`ARCH-313`

---

## 7.6 API Error Handling

All route handlers use the `handler()` wrapper which catches exceptions and returns `{ error: message }` with appropriate HTTP status codes.

```typescript
// apps/web/src/server/api.ts:33-38
return NextResponse.json(
  { error: message },
  { status: error instanceof RequestError ? 400 : 500 },
);
```

`RequestError` is thrown by `requireValue(...)` for validation failures → 400. Other exceptions → 500. No stack traces in responses.

`ARCH-314`

---

## 7.7 Static Analysis of Auth Invariants

| Invariant | Status | Evidence |
|-----------|--------|---------|
| No auth bypass when `JOURNAL_PASSWORD` unset | VERIFIED — middleware returns early | `middleware.ts:10`; `api.ts:27` |
| No route is accessible without session when password is set | VERIFIED — handler wrapper checks every route; only `/api/auth` is `public: true` | `api.ts:27-30`; `app/api/auth/route.ts:21` |
| Password comparison is timing-safe | VERIFIED with caveat — `timingSafeEqual`, guarded by a length check | `auth.ts:20,28` |
| Session token is HMAC (not MAC-then-compare issue) | VERIFIED — `createHmac` + `timingSafeEqual` | `auth.ts:12-15,28` |
| **No server-side session expiry** | VERIFIED — `verifySession` checks only the HMAC; no timestamp/TTL is stored or checked | `auth.ts:23-29` |
| AI keys encrypted at rest | VERIFIED — AES-256-GCM | `crypto.ts:24-34` |
| AI keys use KDF | VERIFIED — `scryptSync` | `crypto.ts:14` |
| Broker credentials encrypted at rest | VERIFIED — same `crypto.ts` | `ARCH-309` |
| CSRF protection | VERIFIED — **no** CSRF token, no `Origin`/`Referer` check anywhere in `apps/web/src`. Mitigated only by `sameSite: "lax"` plus `Content-Type: application/json` on mutating requests | `app/api/auth/route.ts:14`; grep for `csrf\|Origin\|Referer` in `apps/web/src` → zero hits |
| Login brute-force protection | VERIFIED — **none**. `POST /api/auth` has no attempt counter, delay, or lockout; see `08` §8.8 | `app/api/auth/route.ts:7-19` |
| No API key in URL params or logs | INFERRED — `resolveAiConfiguration` returns key to runtime only | `settings.ts:119-129` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` not **persisted** | PARTIALLY VERIFIED — env vars are never written to the DB, but `setAiKey` stores a UI-entered key unconditionally, even when an env var is also set | `settings.ts:59-61,77-80` |

`ARCH-315`

---

## 7.8 Security Summary

```
┌─────────────────────────────────────────────────────────────┐
│  Unauthenticated (no JOURNAL_PASSWORD)                        │
│  All routes: / /api/* → no gate                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Authenticated (JOURNAL_PASSWORD set)                         │
│  Middleware: cookie presence check (navigation gate)         │
│  API routes: HMAC timing-safe verify (Node)                  │
│  Session: httpOnly cookie, sameSite=lax, path=/              │
│  Browser cookie maxAge: 30 days                              │
│  Server-side expiry: NONE — the token is valid until         │
│  JOURNAL_PASSWORD changes                                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  AI Keys                                                    │
│  Priority: env var > encrypted settings table               │
│  Storage: AES-256-GCM, KDF scryptSync(JOURNAL_SECRET)       │
│  Outbound: direct to provider, store=false for OpenAI       │
│  Error sanitisation: provider errors → safe categories      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Single-user model — no RBAC, no multi-tenant isolation    │
└─────────────────────────────────────────────────────────────┘
```

### Session Lifetime — No Server-Side Expiry

**Finding:** The session token has **no server-side expiry**. The cookie's `maxAge: 60 * 60 * 24 * 30` (`apps/web/src/app/api/auth/route.ts:17`) is a browser-side instruction only — the browser drops the cookie after 30 days, but nothing on the server enforces that window.

`VERIFIED` — `verifySession` (`apps/web/src/server/auth.ts:23-29`) performs exactly three checks:

```typescript
export const verifySession = (token: string | undefined): boolean => {
  if (!passwordConfigured()) return true;
  if (!token) return false;
  const expected = Buffer.from(sessionToken(), "utf8");
  const given = Buffer.from(token, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
};
```

The token carries **no timestamp, counter, or nonce** — it is a pure HMAC of the constant `"session-v1"` under `JOURNAL_PASSWORD`. A captured cookie therefore remains valid **indefinitely** on the server until `JOURNAL_PASSWORD` is changed (which changes the HMAC and invalidates all sessions).

Practical impact: the effective session lifetime is "until the browser drops the cookie, or until the password is rotated". Exfiltrated cookies (browser history, `curl` logs, a shared machine, a backup) are not self-limiting. Mitigating factors: the cookie is `httpOnly` and `sameSite: lax`, and the app is single-user and self-hosted.

**Desktop note:** in the Tauri desktop runtime the webview talks to `http://127.0.0.1:<port>`, so `secure` is never set on the cookie — see `06` §6.13 and `08` §8.14.

`ARCH-315a`

---

## Evidence Register

| ID | Source | Status |
|----|--------|--------|
| ARCH-301 | `apps/web/src/server/auth.ts:4-6` | VERIFIED |
| ARCH-302 | `apps/web/src/server/auth.ts:10`; `apps/web/src/middleware.ts:10`; `apps/web/src/server/api.ts:27` | VERIFIED |
| ARCH-303 | `apps/web/src/server/auth.ts:12-15` | VERIFIED |
| ARCH-303a | `apps/web/src/server/auth.ts:20,28` — `timingSafeEqual` behind a length check | VERIFIED with caveat |
| ARCH-304 | `apps/web/src/app/api/auth/route.ts:12-18` (cookie code) | VERIFIED — **file corrected** from `server/auth.ts` |
| ARCH-305 | `apps/web/src/middleware.ts:9-20` (presence check), `:23-24` (matcher) | VERIFIED (code) / INFERRED (Edge rationale) |
| ARCH-306 | `apps/web/src/server/api.ts:27-30` | VERIFIED |
| ARCH-307 | `apps/web/src/server/api.ts:20-40`; `apps/web/src/app/api/auth/route.ts:21` | VERIFIED |
| ARCH-308 | `apps/web/src/server/settings.ts:119-129` (`resolveAiConfiguration`, field `modelId`), `:59-75` (resolution order) | VERIFIED — **signature corrected** |
| ARCH-309 | `apps/web/src/server/crypto.ts:12-22` (KDF), `:24-34` (encryptJson), `:36-46` (decryptJson) | VERIFIED |
| ARCH-310 | `apps/web/src/app/api/settings/route.ts:47,133-134`; `apps/web/src/server/settings.ts:77-80`; `:24-29` | VERIFIED — **flow corrected**: row key `anthropicKeyEnc`, upsert via `setSetting` |
| ARCH-311 | `apps/web/src/server/ai-runtime.ts:145,199,262,304` (`store: false`), `:66-111` (`mapAiRuntimeError`) | VERIFIED |
| ARCH-312 | `apps/web/src/server/settings.ts`, `crypto.ts`, `auth.ts` | VERIFIED |
| ARCH-313 | `apps/web/src/server/api.ts:33`; `apps/web/src/server/ai-runtime.ts` | INFERRED |
| ARCH-314 | `apps/web/src/server/api.ts:33-38` | VERIFIED |
| ARCH-315 | `auth.ts`, `crypto.ts`, `api.ts`, `settings.ts`, `middleware.ts` | VERIFIED |
| ARCH-315a | `apps/web/src/server/auth.ts:23-29` (`verifySession` — no expiry check); `apps/web/src/app/api/auth/route.ts:17` (browser-only `maxAge`) | VERIFIED — **no server-side session expiry** |
| ARCH-315c | `apps/web/src/server/settings.ts:59-61,77-80` | PARTIALLY VERIFIED — env vars not persisted, but `setAiKey` stores unconditionally |
