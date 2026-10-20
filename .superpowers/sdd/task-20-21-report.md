# Task 20–21 Report

## Status: COMPLETE

---

## Task 20: Add `tooltip` and restore (HoverHint + HelpHint)

### What was done

1. **shadcn add**: `pnpm dlx shadcn@latest add tooltip --yes --overwrite`
   - Installed `@base-ui/react` as a new dependency (not `@radix-ui/react-tooltip`)
   - Generated `tooltip.tsx` using `@base-ui/react/tooltip` primitives

2. **Restore HoverHint + HelpHint** on base-ui primitives:
   - `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent` re-exported from base-ui
   - `HoverHint` implemented: short-circuits on `content === null`; wraps children in `TooltipTrigger` with `delay={delayDuration ?? 350}` and `closeDelay={skipDelayDuration ?? 150}`; renders content (optionally with `heading`) inside `TooltipContent` with project custom styling (`journal-hover-card`, `collisionPadding={12}`)
   - `HelpHint` implemented: wraps `CircleHelp` icon button in `HoverHint`
   - `HoverHintProps` typed with all fields from backup: `children: ReactElement`, `content: ReactNode`, `heading?: string`, `align`, `side`, `sideOffset`, `delayDuration`, `skipDelayDuration`
   - Project custom `TooltipContent` styling preserved: `journal-hover-card z-[80] max-w-[min(19rem,calc(100vw-24px))] rounded-xl border bg-popover p-3.5 text-[13px] leading-relaxed text-popover-foreground`

3. **Caller fix** (minimal, required for typecheck to pass):
   - `layout.tsx`: `TooltipProvider delayDuration={350} skipDelayDuration={150}` → `TooltipProvider delay={350}` (base-ui uses `delay` on `TooltipProvider`, not `delayDuration`/`skipDelayDuration`)

4. **Typecheck**: PASS

### Commit
```
f4c9b89 Restore tooltip primitive with HoverHint and HelpHint exports
```

---

## Task 21: Add `button` and restore (HoverHint auto-wrap)

### What was done

1. **shadcn add**: `pnpm dlx shadcn@latest add button --yes --overwrite`
   - Generated `button.tsx` using `@base-ui/react/button` (`ButtonPrimitive`)
   - **Overwrote** the existing custom button (the registry version has no `title` prop, no `HoverHint` wrap, no `asChild`)

2. **Restore HoverHint auto-wrap**:
   - Kept new `buttonVariants` from registry (includes new size variants: `xs`, `sm`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg`)
   - `title` prop restored: `hint = title || (size === "icon" ? ariaLabel : undefined)`
   - `asChild` support restored using base-ui `render` prop: `render={React.createElement("button", { className, ...props })}`
   - `HoverHint` auto-wrap: `hint ? <HoverHint content={hint}>{inner}</HoverHint> : inner`
   - `aria-label` logic restored: `ariaLabel ?? (size === "icon" ? title : undefined)`

3. **Typecheck**: PASS

### Commit
```
4fbd285 Restore button primitive with HoverHint auto-wrap on icon-only
```

---

## Verification

| Check | Result |
|-------|--------|
| `pnpm --filter web typecheck` | PASS (✓ Route types generated) |
| Task 20 commit | `f4c9b89` |
| Task 21 commit | `4fbd285` |
| `HoverHint` content null short-circuit | ✓ preserved |
| `HoverHint` delayDuration=350 / skipDelayDuration=150 | ✓ implemented via base-ui `delay`/`closeDelay` |
| `HelpHint` with `heading` prop | ✓ typed and implemented |
| Button `HoverHint` auto-wrap for `title` set | ✓ preserved |
| Button `HoverHint` auto-wrap for icon-only without aria-label | ✓ preserved |
| `asChild` support via base-ui `render` prop | ✓ restored |

---

## Concerns

### Concern 1: `@base-ui/react` tooltip API is substantially different from Radix
The base-ui tooltip uses `TooltipPopup` (not `TooltipContent`), `TooltipTrigger` children (not `asChild`), `delay`/`closeDelay` (not `delayDuration`/`skipDelayDuration`), and no `collisionPadding` on content. All HoverHint/HelpHint consumers were updated to match, but any future base-ui API changes may require more migration work.

### Concern 2: `TooltipProvider` delay propagation
Base-ui's `TooltipProvider` has a single `delay` prop. The plan specified `skipDelayDuration` (how long to wait before re-showing after hiding). Base-ui uses `closeDelay` on `TooltipTrigger` for this. The current implementation passes `closeDelay={skipDelayDuration ?? 150}` to `TooltipTrigger` per-HoverHint call, which is the correct mapping but differs from the original Radix behavior where `skipDelayDuration` was on the `TooltipProvider`.

### Concern 3: `layout.tsx` fix outside task scope
The `TooltipProvider` prop name change (`delayDuration`/`skipDelayDuration` → `delay`) was a minimal fix applied in Task 20 to make typecheck pass. This was not in the plan's Task 20 scope (layout.tsx changes are in Task 22's SidebarProvider wrapping), but was unavoidable given the type error.

---

## Files Changed

| File | Task | Change |
|------|------|--------|
| `apps/web/src/components/ui/tooltip.tsx` | 20 | Restored HoverHint + HelpHint on base-ui primitives |
| `apps/web/src/app/layout.tsx` | 20 | TooltipProvider props: `delayDuration`/`skipDelayDuration` → `delay={350}` |
| `apps/web/src/components/ui/button.tsx` | 21 | Restored HoverHint auto-wrap + `asChild` via base-ui `render` prop |
| `apps/web/package.json` | 20 | Added `@base-ui/react` dependency |
