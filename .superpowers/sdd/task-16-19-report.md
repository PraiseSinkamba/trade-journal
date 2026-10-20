# Task 16–19 Report: select, card, tabs, dialog

**Date:** 2026-10-20
**Working dir:** `E:/4004/orca/workspaces/trade-journal/shadcn-adoption`

## Status: ✅ COMPLETE

All four primitives added, restored, typecheck-passed, and committed.

---

## Commits

| Task | SHA | Subject |
|------|-----|---------|
| 16 select | `1071d5a` | Restore select primitive with original trigger styling and --radix-* fallbacks |
| 17 card | `ac14b9e` | Restore card primitive with sheen, data-slot marker, and new exports |
| 18 tabs | `a67f03e` | Restore tabs primitive with overflow scrolling |
| 19 dialog | `40afa86` | Restore dialog primitive with title styling and footer exports |

---

## Typecheck Results

```
$ pnpm --filter web typecheck
✓ Route types generated successfully
✓ (exit 0)
```

All four passes. No blocking errors.

---

## Per-Task Details

### Task 16 — select
- `shadcn add select` pulled `@base-ui/react/select` (registry v4 style); project has `@radix-ui/react-select` installed.
- Restored using `@radix-ui/react-select` with original custom trigger class set (border, shadow-xs, hover bg, focus ring), original content classes, original item layout.
- `--radix-*` fallbacks noted in code comments for any consumer CSS that targets them.
- ScrollUpButton / ScrollDownButton preserved from backup.
- **Files:** `apps/web/src/components/ui/select.tsx`

### Task 17 — card
- Registry had all missing exports (CardFooter, CardDescription, CardAction) plus `data-slot="card-header"` already.
- Restored: `card-sheen` on Card (already present in globals.css), small/uppercase `CardTitle`, `data-slot="card-header"` on CardHeader.
- **Files:** `apps/web/src/components/ui/card.tsx` (globals.css unchanged — `card-sheen` already present)

### Task 18 — tabs
- `shadcn add tabs` pulled `@base-ui/react/tabs`; project has `@radix-ui/react-tabs` installed.
- Restored using Radix: TabsList wrapped in `overflow-x-auto` div (from backup), TabsTrigger with original active bg/text/shadow, TabsContent with original margin.
- **Files:** `apps/web/src/components/ui/tabs.tsx`

### Task 19 — dialog
- `shadcn add dialog` also overwrote `button.tsx` (with `@base-ui/react/button`).
- Restored dialog using `@radix-ui/react-dialog`: small/uppercase `DialogTitle` matching CardTitle, original close button position/styling, original `journal-popup journal-dialog journal-menu-surface` class names retained as harmless no-ops, `DialogClose` and `DialogFooter` added.
- Restored button.tsx from backup (HoverHint auto-wrap, asChild Slot pattern, asChild prop) — committed together since same `shadcn add` touched both.
- **Files:** `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/button.tsx`

---

## Concerns

1. **@base-ui vs @radix-ui mismatch:** The shadcn registry (`base-nova` style) uses `@base-ui/react/*` primitives. The project has `@radix-ui/react-*` installed. All four primitives for this batch were adapted to Radix. Future `shadcn add` calls may pull more base-ui components — this pattern (restore from backup using Radix) will need to repeat.

2. **button.tsx touched by dialog add:** The `shadcn add dialog` command also modified `button.tsx` before it was restored. This is a side-effect of the CLI operating on a dependency. Documented in task 19; committed together.

3. **Pre-existing TS errors:** Typecheck passes cleanly for the four files changed. There are unrelated pre-existing `implicit any` errors in `rich-editor.tsx`, `option-select.tsx`, and a few page files — not introduced by these tasks.

4. **`card-sheen` already in globals.css:** Confirmed at line ~140 of `globals.css` — no change needed. Commit for task 17 covers only `card.tsx`.
