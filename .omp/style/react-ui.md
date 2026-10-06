# React + UI Style Guide

> Applies to `apps/web/src/`. Next.js 15 with React 19, Tailwind v4, Radix UI primitives, ECharts via canvas.

---

## Client boundary

Use `"use client"` **only** when hooks or browser event handlers are needed. Server components stay synchronous and receive data via `useApi` wrapped in `<Suspense>`.

```tsx
// ✅ Server component — no "use client"
import { Suspense } from "react";
import { TradeTable } from "./trade-table";

export default function TradesPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <TradeTable />
    </Suspense>
  );
}
```

```tsx
// ✅ Client hook consumer — "use client" required
"use client";
import { useApi } from "@/lib/use-api";
```

Never mark a leaf component `"use client"` just to receive props — pass props through the server tree.

---

## Data fetching with `useApi`

Defined in `apps/web/src/lib/use-api.ts`. It deduplicates concurrent requests and cancels stale ones. **Do not cache completed financial data in a global store or React state** — the dashboard and reports re-fetch to reflect the latest server state.

```tsx
const { data, loading, error, refresh } = useApi<Trade[]>(
  selectedAccountId ? `/api/trades?accountId=${selectedAccountId}` : null
);
```

`useApi` uses `startTransition` internally so React yields to the browser mid-render while fresh data is being set. Never wrap `setData` yourself after calling `useApi`.

For mutations, use `postJson` (also in `use-api.ts`) — it throws on non-2xx responses:

```tsx
await postJson("/api/trades", { symbol: "ES", side: "buy", ... });
refresh();
```

---

## Autosave

Use `useAutosave` (search for existing usage in `apps/web/src/`) when persisting draft form state. The pattern:

1. Coalesce rapid keystrokes into a single pending write.
2. Flush on `beforeunload` via `navigator.sendBeacon` or fetch with `keepalive`.
3. On failure, keep the latest unsaved fields in memory — do not discard them silently.

Never autosave to `localStorage` for trade data; user state lives in the DB.

---

## Progressive rendering with `startTransition`

Any data-dependent render that is not wrapped by `useApi` must use `startTransition` explicitly:

```tsx
import { startTransition } from "react";

startTransition(() => {
  setDisplayedStats(filteredStats);
});
```

This prevents the main thread from blocking when processing large trade histories.

---

## File naming

All component files use **kebab-case**:

```
add-trade-dialog.tsx
trade-table.tsx
equity-curve-chart.tsx
```

Not `AddTradeDialog.tsx`, not `TradeTable.tsx`.

---

## Radix UI primitives

All interactive primitives live in `apps/web/src/components/ui/`. **Wrap, do not replace.** If you need a styled variant, compose over the primitive's slot API.

```tsx
import * as Dialog from "@/components/ui/dialog";

<Dialog.Root open={open} onOpenChange={setOpen}>
  <Dialog.Trigger asChild>
    <Button variant="outline">Add Trade</Button>
  </Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 bg-black/50" />
    <Dialog.Content className="fixed left-1/2 top-1/2 ...">
      {/* custom content */}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```

Available primitives (as of this writing):
`badge`, `button`, `calendar`, `card`, `checkbox`, `date-picker`, `dialog`, `dropdown-menu`, `input`, `label`, `option-select`, `select`, `skeleton`, `table`, `tabs`, `textarea`, `tooltip`.

---

## ECharts token system

ECharts paints to `<canvas>`, which cannot read CSS variables. Tokens are resolved at runtime via `useVizTokens` in `apps/web/src/components/charts/tokens.ts`. **Never hardcode hex colors in chart config.**

```tsx
import { useVizTokens } from "@/components/charts/tokens";

const tokens = useVizTokens();
const option: EChartsOption = {
  series: [{
    itemStyle: { color: tokens?.profit ?? "#0ca30c" },
  }],
};
```

The `useVizTokens` hook uses `useSyncExternalStore` to share one `MutationObserver` across every mounted chart — a theme class flip on `<html>` propagates to all charts simultaneously.

---

## P&L color is never load-bearing

From `docs/design.md` — color is pure reinforcement, never the sole carrier of meaning. This is both a design principle and an accessibility requirement (red/green fails CVD separation at ΔE ≈ 4, well under the ≥ 8 target).

Every P&L element must include at least two redundant signals:
- **Signed text**: `+$171.00` / `−$102.50`
- **Geometry**: bars grow from a zero baseline
- **Label**: `WIN` / `LOSS` chip, never a colored dot alone

```tsx
<span className={isProfit ? "text-profit" : "text-loss"}>
  {isProfit ? "+" : "−"}${Math.abs(value).toFixed(2)} <Badge variant={isProfit ? "win" : "loss"}>WIN</Badge>
</span>
```

---

## Tailwind v4 only

No `styled-components`, no Emotion, no arbitrary `style={{}}` except for dynamic values that cannot be expressed as tokens. When a value is used in both Tailwind and a dynamic style (e.g., chart tooltip), extract it to a CSS variable or token.

---

## Accessibility

- Every interactive element is a Radix primitive (not a raw `<div onClick>`).
- Focus rings are preserved — never `outline: none` without a replacement.
- DashboardLayout respects `prefers-reduced-motion`; charts simplify or hide animations when the media query is active.
- Form labels are associated via `htmlFor` / `id` pairs, not placeholders.

---

## Icons

Use `lucide-react` only. No icon font files (`.woff`, `.ttf` for icons). Pick an existing icon from the lucide set before adding a custom SVG.

```tsx
import { Check, AlertTriangle, TrendingUp } from "lucide-react";
```

---

## Privacy toggle

Theme and privacy are controlled via CSS variables on `<html>`. The privacy toggle must **hide values**, not just dim them — use a mask or zero-width replacement, not `opacity-30`.

```tsx
const displayValue = isPrivate ? "••••••" : formattedValue;
```

---

## Dark-first theme

All design tokens live in `apps/web/src/app/globals.css`. Never hardcode dark/light colors in components. Reference `--foreground`, `--card`, `--border`, etc.

---

## Checklist before PR

- [ ] No `"use client"` on server-component-pass-through components
- [ ] All chart colors come from `useVizTokens()`, not hardcoded hex
- [ ] P&L renders with signed text + geometric baseline + label chip; no single-signal color-only display
- [ ] Radix primitives used for all interactive UI; no raw `<div onClick>` equivalents
- [ ] No `localStorage` for trade/journal data
- [ ] Privacy toggle hides values (not just dims); theme via CSS variables only
- [ ] Tailwind v4 only; no Emotion or styled-components
- [ ] File names all kebab-case
