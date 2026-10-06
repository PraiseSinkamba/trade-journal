# React + Next.js 15 (App Router) Style Guide

## File Conventions

Use the App Router folder structure exactly:

- `app/<route>/page.tsx` — page component; server by default unless `"use client"` is present
- `app/<route>/layout.tsx` — shared layout; server component that wraps child pages
- `app/api/<resource>/route.ts` — Route Handler; exports named HTTP verbs (`GET`, `POST`, `PATCH`, `DELETE`)

Pages stay server components. Every page file in `apps/web/src/app/` is `"use client"` (login, trades, reports, settings, notebook, etc.) because they use `useState` / `useEffect` / `next/navigation` — not because pages are inherently client-side.

## "use client" Boundary

Add `"use client"` only when the component uses:
- React hooks (`useState`, `useEffect`, `useCallback`, `useRef`, etc.)
- Browser APIs (`window`, `document`, `MutationObserver`)
- Event handlers (`onClick`, `onChange`, `onSubmit`)
- `next/navigation` (`useRouter`, `usePathname`)

A component that only receives props and renders UI stays a server component. Server components are synchronous, render on the server, and can `await` directly.

```tsx
// server — no hooks, no "use client"
import { db } from "@/server/db";

export default async function TradesPage() {
  const trades = await db.trades.findMany();
  return <TradesList trades={trades} />;
}
```

## Data Fetching

### Server Components
Fetch directly from the DB or internal service — no HTTP overhead.

```tsx
import { db } from "@/server/db";

export default async function ReportsPage() {
  const stats = await db.stats.aggregate({ … });
  // await without blocking the critical path only inside Suspense boundaries
  return <ReportSummary stats={stats} />;
}
```

### Client Components — `useApi`
Every client-side fetch goes through `useApi` (`apps/web/src/lib/use-api.ts`). It deduplicates in-flight GETs and aborts the request when the component unsubscribes.

```tsx
"use client";
import { useApi } from "@/lib/use-api";

export function PnLChart({ symbol }: { symbol: string }) {
  const { data, loading, error, refresh } = useApi(`/api/stats/${symbol}`);
  // …
}
```

`useApi` wraps reads in `startTransition` so React yields to the browser mid-render instead of blocking the main thread for the whole page. Do not wrap `useApi` in a plain `useEffect` + `fetch` — that bypasses dedup and cancellation.

### Mutations — Route Handlers, not Server Actions
Use Route Handlers for all mutations. Reserve Server Actions for form submissions that need progressive enhancement (no JS on the client).

```ts
// app/api/trades/route.ts
export const POST = handler(async ({ body }) => {
  const trade = await db.trades.create({ data: body });
  return ok({ trade });
});
```

## Streaming — Suspense

Never synchronously `await` a slow fetch on the critical path. Wrap data-dependent UI in `<Suspense>` so the shell paints first and content streams in.

```tsx
import { Suspense } from "react";
import { TradesTable } from "./trades-table"; // uses useApi internally

export default function TradesPage() {
  return (
    <main>
      <Toolbar />
      <Suspense fallback={<TradesTableSkeleton />}>
        <TradesTable />  {/* streams when useApi resolves */}
      </Suspense>
    </main>
  );
}
```

## Caching

Never cache completed financial data in a global or module-level variable. The dashboard and reports re-fetch on every visit — stale P&L is worse than no P&L.

```ts
// BAD — shared mutable cache for financial data
let cache: PnLResult | null = null;
export function getPnL() { return cache ?? fetchPnL(); }

// GOOD — per-request, no cross-request leakage
export async function getPnLForRequest(id: string) {
  return db.pnl.findUnique({ where: { id } });
}
```

`next.config.ts` (`apps/web/next.config.ts`) marks `better-sqlite3` as `serverExternalPackages` and excludes runtime data directories from the standalone output bundle:

```ts
serverExternalPackages: ["better-sqlite3"],
outputFileTracingExcludes: {
  "/*": ["./data/**/*", "../../outputs/**/*", "../../.runtime-backup*/**/*"],
},
```

## Middleware — Auth Guard

`apps/web/src/middleware.ts` gates all routes except `/login`, `/api/auth`, `_next/static`, `_next/image`, and `favicon.ico`. It is a runtime guard only — it checks cookie presence, not cryptographic validity:

```ts
// apps/web/src/middleware.ts
export const middleware = (request: NextRequest) => {
  if (!process.env.JOURNAL_PASSWORD) return NextResponse.next();
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

API Route Handlers re-verify the session cryptographically using `verifySession` from `apps/web/src/server/auth.ts` — HMAC with `timingSafeEqual` to prevent timing attacks:

```ts
// apps/web/src/server/auth.ts
export const verifySession = (token: string | undefined): boolean => {
  if (!passwordConfigured()) return true;
  if (!token) return false;
  const expected = Buffer.from(sessionToken(), "utf8");
  const given = Buffer.from(token, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
};
```

The middleware blocks navigation; the handler validates data. Both layers are required.

## Image Optimisation

Always use `next/image` for static assets. Never use raw `<img>`.

```tsx
import Image from "next/image";
<Image src="/icons/trades.svg" alt="Trades" width={20} height={20} />
```

## Metadata

Use `generateMetadata` for per-route SEO titles. Keep titles short and descriptive; reflect route params.

```ts
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: { key: string } }): Promise<Metadata> {
  return { title: `Trade ${params.key} — Trade Journal` };
}
```

## Link Prefetching

The default prefetching on `<Link>` is beneficial for static routes. Disable it for routes with frequent mutations (e.g. the dashboard) to avoid stale prefetch artifacts:

```tsx
<Link href="/dashboard" prefetch={false}>
  Dashboard
</Link>
```

## API Route Handler Pattern

Every Route Handler in `apps/web/src/app/api/` uses a shared `handler` wrapper from `apps/web/src/server/api.ts` that enforces auth, parses JSON, and returns typed responses via `ok()` / `bad()`:

```ts
// apps/web/src/server/api.ts
export const verifySession = (token: string | undefined): boolean => { … };

export class RequestError extends Error {}
export function requireValue(condition: unknown, message: string): asserts condition { … }

export const handler = (fn: (req: Request) => Promise<unknown>) => async (req: Request) => {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!verifySession(token)) return new Response("Unauthorized", { status: 401 });
  try { return ok(await fn(req)); }
  catch (e) { return bad(e); }
};
```

Never write raw `Response.json()` in an API route — use the shared wrapper to ensure consistent auth and error handling.

## Citations

- `apps/web/src/lib/use-api.ts` — `useApi` hook, `startTransition` on reads, `postJson` for mutations
- `apps/web/src/middleware.ts` — route guard, `JOURNAL_PASSWORD` gating, `/api/` vs navigation redirect split
- `apps/web/next.config.ts` — `serverExternalPackages`, `outputFileTracingExcludes`, standalone output
- `apps/web/src/server/auth.ts` — `verifySession` HMAC + `timingSafeEqual`, session token lifecycle

---

## Checklist before PR

- No `"use client"` on components that don't use hooks, event handlers, or browser APIs
- All financial data fetches use `useApi` (client) or direct DB access (server); no module-level financial caches
- Slow server reads wrapped in `<Suspense>`; `startTransition` used inside `useApi` for progressive paint
- API mutations use Route Handlers; Server Actions only for progressive-enhancement forms
- Middleware and API handlers both enforce auth; no auth logic only in middleware without handler verification
- All images use `next/image`; no raw `<img>` tags
- `generateMetadata` present on pages with dynamic route params
- Link prefetch disabled on dashboard and other frequently-mutated routes
