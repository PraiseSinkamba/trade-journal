# Task 12–15 Report — shadcn primitive restores (badge, checkbox, table, dropdown-menu)

## Summary

| # | Task | Primitive | Commit SHA | Subject | Typecheck |
|---|------|-----------|-----------|---------|-----------|
| 12 | Task 12 | badge | `ed3105c` | Restore badge primitive with profit/loss variants | PASS |
| 13 | Task 13 | checkbox | `0c7f46a` | Restore checkbox primitive with indeterminate state | PASS |
| 14 | Task 14 | table | `960bf0c` | Restore table primitive with overflow-x-auto wrapper | PASS |
| 15 | Task 15 | dropdown-menu | `9021246` | Restore dropdown-menu primitive with minimal Radix surface | PASS |

## Per-Task Details

### Task 12 — badge
- **shadcn output**: `@base-ui/react/checkbox`-backed, uses `useRender` + `mergeProps`, no `profit`/`loss` variants.
- **Restore**: wrote `badge.tsx` using the project's CVA-only pattern (per backup), `import { cn } from "@/lib/utils"`, with `profit: "border-transparent bg-profit/15 text-profit"` and `loss: "border-transparent bg-loss/15 text-loss"` variants merged into `badgeVariants`. `profit`/`loss` CSS tokens ( `--profit: #006313` / `#d03b3b`) confirmed present in `globals.css` at lines 42/84 and 44/86.
- **Note**: the committed file (`ed3105c Initial public release`) already matched the restored output — the pre-shadcn `badge.tsx` already had the CVA pattern with profit/loss variants. Running shadcn would have overwritten it; the restore put it back identical to what was already committed.

### Task 13 — checkbox
- **shadcn output**: `@base-ui/react/checkbox`-backed, no `Minus` icon for indeterminate, different styling API.
- **Restore**: used `@radix-ui/react-checkbox` (per backup), added `data-slot="checkbox"`, preserved `Check` + `Minus` icon pair for `checked`/`indeterminate` states, kept `group/checkbox` data-state styling from backup.

### Task 14 — table
- **shadcn output**: `overflow-x-auto` wrapper via `data-slot="table-container"`, `TableFooter`/`TableCaption` added, `TableHead` uses `h-10`/`text-foreground`.
- **Restore**: merged — kept shadcn's `data-slot` attrs, `TableFooter`, `TableCaption`; restored backup's `min-w-0 max-w-full overscroll-x-contain` wrapper class on `Table`; restored `text-xs font-medium text-muted-foreground` on `TableHead` (backup); restored `py-2` on `TableCell` (backup); removed shadcn's `h-10` (replaced with backup's `h-9`).

### Task 15 — dropdown-menu
- **shadcn output**: `@base-ui/react/menu`-backed, 16 exports, complex nested positioning API.
- **Restore**: used `@radix-ui/react-dropdown-menu` (per backup), minimal 4-export surface (`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`), preserved backup's `journal-popup journal-menu-surface` class and `sideOffset={6}` / `collisionPadding={12}` customizations.
- **Note**: same situation as badge — the committed file content already matched the restored output; shadcn would have overwritten it, restore put it back identical.

## Typecheck Results

All four `pnpm --filter web typecheck` runs returned exit code 0 (Route types generated successfully, no TypeScript errors).

```
Task 12 (badge):   PASS  (28.66s wall time)
Task 13 (checkbox): PASS  (34.32s wall time)
Task 14 (table):   PASS  (25.49s wall time)
Task 15 (dropdown-menu): PASS (29.42s wall time)
```

## Report Path

```
.superpowers/sdd/task-12-15-report.md
```

## Concerns

1. **Badge and dropdown-menu matched existing commits**: both `badge.tsx` and `dropdown-menu.tsx` were already in their restored form in the repo before shadcn was initialized. The shadcn CLI overwrites them, and the restore step puts the identical content back — functionally correct but visually confusing (1-line diffs on restore commits). This suggests these two components never needed "restoring" because they pre-date the shadcn migration; they were already the project's custom version.
2. **New dep risk on checkbox restore**: the restore uses `@radix-ui/react-checkbox` (already in package.json from label's Radix dependency). Verified present in `package.json`.
3. **`tw-animate-css` dep drift**: the shadcn registry adds animation utilities that reference `tw-animate-css`. No conflicts encountered in typecheck, but task 5 (ADR 0004) captures this formally.
