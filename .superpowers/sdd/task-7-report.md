# Task 7 Report — shadcn init

## Status: COMPLETE

---

## Commit

| Field | Value |
|---|---|
| SHA | `cf6736dc6bb57872a1b4aa5911c4201198cae5ff` |
| Branch | `shadcn-adoption` |
| Message | `Initialise shadcn in apps/web and merge theme tokens` |

Files committed: `apps/web/components.json` (created), `apps/web/package.json` (modified).

---

## shadcn CLI output (actual values)

| Field | Value |
|---|---|
| `style` | `base-nova` (not `new-york`) |
| `base` | `neutral` |
| `tsx` | `true` |
| `tailwind.cssVariables` | `true` |
| `tailwind.version` | `4` |
| `aliases.ui` | `@/components/ui` → `src/components/ui` ✓ |
| `aliases.utils` | `@/lib/utils` → `src/lib/utils` ✓ |
| `aliases.lib` | `@/lib` → `src/lib` ✓ |
| `aliases.hooks` | `@/hooks` (bonus; not in brief) |
| `aliases.css` | **absent** — brief expected `aliases.css == "src/app/globals.css"` but the CLI did not emit it |

Note: `aliases.css` is not emitted by `base-nova` style. The CSS file path is tracked in `tailwind.css` instead (`"src/app/globals.css"`). No adjustment was made since the brief says "adjust per actual CLI output if the style is nova instead of new-york, that's fine" — same tolerance applies to absent `aliases.css`.

---

## Radix packages added

9 `@radix-ui/react-*` packages now in `package.json`:

```
@radix-ui/react-checkbox    ^1.3.11
@radix-ui/react-dialog      ^1.1.23
@radix-ui/react-dropdown-menu ^2.1.24
@radix-ui/react-label       ^2.1.15
@radix-ui/react-popover     ^1.1.23
@radix-ui/react-select      ^2.3.7
@radix-ui/react-slot         ^1.3.3
@radix-ui/react-tabs         ^1.1.21
@radix-ui/react-tooltip      ^1.2.16
```

---

## globals.css token verification

Both token sets confirmed present — no merge needed.

**`:root` block contains:**
- shadcn semantic tokens: `--background`, `--foreground`, `--primary`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`, `--radius`
- project tokens: `--brand`, `--profit`, `--profit-fill`, `--loss`, `--neutral-mid`, `--series-1` through `--series-8`, `--viz-surface`, `--ink-muted`, `--gridline`, `--baseline`

**`.dark` block contains:**
- same shadcn semantic tokens with dark values
- same project tokens with dark values

**`@theme inline` block** maps all shadcn CSS variables to `--color-*` tokens; project tokens (`--profit`, `--loss`, `--brand`, `--series-*`, `--viz-*`) are all mapped.

`prefers-reduced-motion` overrides are intact.

---

## Typecheck

```
pnpm --filter web typecheck  →  PASS (no errors)
```

`next typegen` ran successfully (`Route types generated successfully`).
`tsc --noEmit` ran to completion with zero diagnostics.

Note: `next` was absent from `apps/web/node_modules` at task start (pre-existing workspace issue; `next` existed in original `trade-journal` workspace but not in this worktree). It was added explicitly before typecheck (`pnpm add next@15.5.23 --filter web`). The `globals.css` was not staged in the commit because shadcn init left it unchanged (tokens were already present).

---

## Concerns

1. **`aliases.css` absent** — brief expected it; CLI with `base-nova` style does not emit it. CSS path is correctly stored in `tailwind.css` instead. No functional impact.

2. **`next` missing at task start** — pre-existing worktree state; remediated by `pnpm add next@15.5.23 --filter web`. The original trade-journal workspace has `next` in `apps/web/node_modules`; the worktree did not. Recommend verifying worktree creation (`pnpm install --frozen-lockfile`) is reliable in future worktrees.

3. **style = `base-nova`** — brief said `new-york` or `nova` acceptable; `base-nova` is a variant of nova. Same styling contract, no action needed.

4. **`globals.css` not in commit** — shadcn init did not modify the file (tokens were already correct). Committed as part of the prior backup snapshot (`0788079`). No data loss.
