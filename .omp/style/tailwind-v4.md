# Tailwind v4 Style Guide

## CSS-First Configuration

Tailwind v4 has no `tailwind.config.js`. All design tokens are declared in `apps/web/src/app/globals.css` under `@theme`. Only add a config file when a plugin or integration requires it; even then, prefer passing options through the CSS layer.

```css
/* globals.css */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-profit: var(--profit);
  --color-loss: var(--loss);
  --radius-lg: var(--radius);
}
```

## Design Tokens

Tokens live in CSS custom properties (set on `:root` and `.dark`) and are referenced via `var()` in JS when needed. The dark-first palette covers surfaces, ink, chart chrome, and P&L colors:

```css
/* Light */
--background: #f9f9f7;
--foreground: #0b0b0b;
--profit: #006363;
--loss: #d03b3b;
--brand: #0b7cbd;

/* Dark */
--viz-surface: #101013;
--ink-muted: #8b8b95;
--profit: #0ca30c;
--loss: #d03b3b;
--brand: #1197e2;
--series-1: #3987e5;  /* categorical slot 1 — fixed assignment, never cycled */
```

## Dark Mode

The dark class strategy (`dark:`) is used throughout. A separate `privacy` class hides values without dimming — do not conflate the two:

```css
/* privacy mode: hides sensitive values, does not darken */
.privacy .sensitive-value { visibility: hidden; }
/* dark mode: theme inversion */
.dark { color-scheme: dark; }
```

Apply dark mode at the root (`<html class="dark">`) or per-section; all `dark:` utilities respond accordingly.

## Component Primitives

`apps/web/src/components/ui/` is the single source of truth for interactive primitives. Every button, dialog, dropdown, checkbox, calendar, date-picker, select, tooltip, and card lives there:

```
button.tsx, dialog.tsx, dropdown-menu.tsx, checkbox.tsx,
calendar.tsx, date-picker.tsx, select.tsx, option-select.tsx,
tooltip.tsx, card.tsx, input.tsx, textarea.tsx, label.tsx,
tabs.tsx, table.tsx, badge.tsx, skeleton.tsx
```

Never build an interactive primitive from scratch. Compose from these; extend them with Tailwind utility classes, not by forking the component.

## Class Composition — `cn()`

Use `cn()` from `apps/web/src/lib/utils.ts` to merge classes. It wraps `clsx` + `tailwind-merge`:

```ts
// apps/web/src/lib/utils.ts
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
```

```tsx
<button className={cn(
  "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
  "bg-primary text-primary-foreground hover:bg-primary/90",
  isActive && "ring-2 ring-ring",
  isDisabled && "opacity-50 pointer-events-none",
)}>
  {children}
</button>
```

Never concatenate class strings manually. Never use `clsx` or `tailwind-merge` directly in JSX — always through `cn()`.

## Conditional Classes

Prefer `clsx`/`tailwinds-merge` idioms (via `cn()`) over ternary sprawl:

```tsx
// BAD
<button className={`flex items-center gap-2 ${isActive ? "bg-brand text-white" : "bg-secondary"}`}>

// GOOD
<button className={cn(
  "flex items-center gap-2",
  isActive ? "bg-brand text-white" : "bg-secondary",
)}>
```

## Responsive Design

Mobile-first breakpoints. The dashboard layout is driven by `dnd-kit` (`apps/web/src/components/dashboard-layout.tsx`) — Tailwind classes on the grid container set column spans; dnd-kit reorders widgets programmatically at runtime.

```tsx
// apps/web/src/components/dashboard-layout.tsx
<div className={cn(
  "grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  "transition-all duration-200 ease-out",
)}>
  {widgets.map((w) => (
    <WidgetCard key={w.id} widget={w} spans={balancedDashboardSpans(w.size)} />
  ))}
</div>
```

Always wrap layout transitions in `@media (prefers-reduced-motion: reduce)` overrides or use the `motion-reduced` variant where available. Chart animations, tooltip reveals, and card reordering all disable on that preference:

```css
@media (prefers-reduced-motion: reduce) {
  .journal-hover-card,
  .journal-calendar-pnl-preview,
  .journal-calendar-pnl-line {
    animation: none !important;
  }
}
```

## Accessibility

- `focus-visible` rings on all interactive elements — never suppress without a replacement indicator
- `aria-*` attributes come from Radix UI primitives (already wired in `apps/web/src/components/ui/`)
- Semantic HTML: `<button>` for actions, `<a>` for navigation, `<table>` for tabular data
- Tabular numbers for financial values: `className="font-variant-numeric tabular-nums"` or the `.tnum` utility in globals.css
- All custom focus states respect `prefers-reduced-motion`

## Chart Colors — `tokens.ts`

ECharts paints to canvas and cannot read CSS variables. Every chart resolves colors through `apps/web/src/components/charts/tokens.ts` via the `useVizTokens` hook (a `useSyncExternalStore` wrapper around a single `MutationObserver` on `document.documentElement`):

```ts
// apps/web/src/components/charts/tokens.ts
export const useVizTokens = (): VizTokens | null =>
  useSyncExternalStore(subscribeTokens, getTokens, getServerTokens);
```

Pass `VizTokens` directly to chart `.setOption()` — never hardcode hex strings in chart config:

```tsx
const t = useVizTokens();
if (!t) return <Skeleton />;
return <EChartsOption config={{ color: t.series, lineStyle: { color: t.gridline } }} />;
```

For Recharts (SVG, can read CSS vars), import token variables directly as CSS custom properties via `var(--series-1)`.

## P&L Color Rule — Never the Only Signal

P&L green/red follows trader convention and is **never load-bearing**. Every financial value combines three redundant channels:

1. **Signed text** — `+$171.00` / `−$102.50` in ink tokens
2. **Zero-anchored geometry** — bars grow from a horizontal baseline; direction is shape, not color
3. **Text chips** — `WIN` / `LOSS` labels; never colored dots alone

Calendar cells render the number and trade count; background tint scales with **magnitude** (lightness, not hue — survives red-green colorblindness). Trade entry/exit markers differ by **shape and position** (▲ below the bar, ▼ above).

Color reinforces, never carries, financial meaning. See `docs/design.md`.

## Avoid

- **`@apply` in component files** — keep utilities in markup; `@apply` is acceptable in globals.css for reusable base styles only
- **Arbitrary value proliferation** — if a value appears once, a custom property or CSS variable is the right escalation path
- **Inline styles for theming** — inline `style={{ color: '…' }}` bypasses the token system; use `var(--x)` via `cn()` or the `style` prop with CSS variable names
- **Hardcoded hex in chart config** — always use `useVizTokens()` or CSS custom properties
- **One-off color literals** — every color reference should trace back to a named token (`--profit`, `--loss`, `--series-N`, `--ink-muted`)

## Utility Classes in globals.css

globals.css defines a small set of project-specific utilities beyond Tailwind's default set. These are not component classes — they are layout and visual primitives:

```css
.tnum            { font-variant-numeric: tabular-nums; }
.card-sheen      { box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04), 0 1px 2px rgb(0 0 0 / 0.25); }
.journal-shell    { --journal-header-offset: 56px; }
.journal-main    { container: journal / inline-size; }
.journal-hover-card { … }   /* tooltip with entrance animation */
.journal-chart-frame { … }  /* chart SVG overflow isolation */
```

Use these utilities as-is rather than recreating their effects with inline styles or utility sprawl.

## Citations

- `apps/web/src/components/ui/` — all interactive primitives (button, dialog, calendar, date-picker, select, tooltip, card, etc.)
- `apps/web/src/components/charts/tokens.ts` — `useVizTokens`, `readVizTokens`, `tooltipStyle`, single-observer token subscription
- `apps/web/src/components/dashboard-layout.tsx` — dnd-kit grid, `balancedDashboardSpans`, motion-reduced drag path
- `docs/design.md` — P&L color rule, CVD-safe magnitude encoding, validated 8-slot categorical palette, single-hue sequential ramps
- `apps/web/src/app/globals.css` — full token set on `:root` and `.dark`, `@theme inline`, `.tnum`, `.journal-*` utilities, `prefers-reduced-motion` resets

---

## Checklist before PR

- All colors trace to CSS custom properties (`var(--profit)`, `var(--series-N)`, etc.); no raw hex in JSX or chart config
- `cn()` used for all class composition; no manual string concatenation or bare template literals in `className`
- Interactive primitives composed from `apps/web/src/components/ui/`; no custom button/dialog built from `<div>` + Tailwind
- Dark mode via `dark:` utility; privacy class not used as a dark mode substitute
- Chart colors resolved via `useVizTokens()` (ECharts) or CSS vars (Recharts); never hardcoded hex in chart config
- P&L values render signed text + geometry + text chip; color is reinforcement only
- All motion respects `prefers-reduced-motion`; layout transitions disabled on that preference
- No `@apply` in component files; no inline styles for theming; no arbitrary value proliferation
- Tabular numbers on financial values (`.tnum` or `font-variant-numeric: tabular-nums`)
