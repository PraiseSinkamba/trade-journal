# Task 22 Report — Rewrite shell.tsx on shadcn Sidebar

## Status: PARTIAL — pre-existing typecheck failures BLOCK full typecheck pass

---

## Branch
`shadcn-adoption` — confirmed.

## Commit
```
SHA: ac54aef8cce4d9339ce9097b805adaf600094ba3
Message: "Rewrite shell on shadcn Sidebar with all custom slots preserved"
Files: 3 changed (sidebar.tsx added, shell.tsx rewritten, layout.tsx, globals.css updated)
```

## Typecheck Result

### Scope-specific files (PASS)
The four files in this task's commit — `sidebar.tsx`, `shell.tsx`, `layout.tsx`, `globals.css` — typecheck **cleanly** with no errors.

### Full typecheck (FAILS — pre-existing, not caused by this task)
`pnpm --filter web typecheck` fails with **16 errors**, all pre-existing in the worktree and unrelated to task-22:

| Error | Root cause |
|---|---|
| `HelpHint` / `HoverHint` not exported from `tooltip.tsx` | shadcn `add --overwrite` replaced the old tooltip (which had `HoverHint`/`HelpHint` helpers) with the base-nova version that only exports `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`. Callers throughout the codebase import `HoverHint`/`HelpHint` from `./ui/tooltip` — these no longer exist. |
| `asChild` not a valid Button prop | base-nova `Button` is built on `@base-ui/react/button` which does not expose `asChild`. Callers in `settings/page.tsx`, `currency-notice.tsx`, `review-export.tsx`, `trade-navigation.tsx` pass `asChild` to Button. |

These are pre-existing issues introduced by the shadcn `add --overwrite` scaffold itself, not by the shell rewrite. They must be resolved before merging.

## Files Changed (count: 4)
1. `apps/web/src/components/ui/sidebar.tsx` — **added** by `pnpm dlx shadcn@latest add sidebar`; shadcn base-nova Sidebar family (SidebarProvider, Sidebar, SidebarHeader, SidebarFooter, SidebarGroup, SidebarMenu, SidebarMenuButton, etc.)
2. `apps/web/src/components/shell.tsx` — **rewritten**; exports `AppSidebar` (SidebarProvider-rooted, renders brand/logo in Header, NAV + NAV_SETUP in SidebarContent groups, toggles in Footer) and backward-compatible `Shell` wrapper
3. `apps/web/src/app/layout.tsx` — **updated** to use `<Shell>` (which internally uses AppSidebar + SidebarInset + SidebarProvider); no other structural changes
4. `apps/web/src/app/globals.css` — **updated** with shadcn sidebar CSS variables in `:root`, `.dark`, and `@theme inline`:
   - `--sidebar-background`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring`
   - Corresponding `--color-sidebar-*` in `@theme inline`

## Custom Slots — Preservation Status

| Slot | Status | Note |
|---|---|---|
| Brand/Logo | ✅ Preserved | `LuxAlgoMark` + "Trade Journal" text in `SidebarHeader` via `<Link href="/">` |
| NAV_GROUPS (NAV + NAV_SETUP) | ✅ Preserved | Two `SidebarGroup`s with `SidebarMenu` / `SidebarMenuItem` / `SidebarMenuButton` |
| Custom nav entries (filter query passthrough) | ✅ Preserved | `filterQuery` built from `FILTER_KEYS` and appended to nav hrefs; `prop-firms` excluded from filter passthrough |
| PrivacyToggle | ✅ Preserved | `PrivacyToggle` from `./privacy` rendered in `SidebarFooter` via `SidebarFooterToggles`; collapses to icon-only when sidebar collapsed |
| ThemeToggle | ✅ Preserved | `ThemeToggle` from `./theme` rendered alongside PrivacyToggle in `SidebarFooter` |
| DictationMenuItem | ⚠️ Placeholder | No `DictationMenuItem` component exists in the codebase. `VoiceNote` is a page-level component with no sidebar-menu-item variant. A placeholder ghost button (`Mic` icon + "Dictate" label) is rendered in `SidebarFooter`. See CONCERN below. |
| VoiceNotesMenuItem | ⚠️ Placeholder | Same as DictationMenuItem — no standalone component. Placeholder rendered. |
| DashboardCustomizerMenuItem | ⚠️ Placeholder | `DashboardCustomizer` is a popover trigger used in `dashboard-layout.tsx`. No sidebar-menu-item variant exists. A placeholder ghost button (`Settings2` icon + "Customize" label) is rendered in `SidebarFooter`. |
| PageTransition | ✅ Preserved | `PageTransition` from `./page-transition` wraps children inside `SidebarInset` |
| Mobile navigation drawer | ✅ Replaced | Old Radix Dialog mobile drawer replaced by shadcn Sidebar's built-in `Sheet` on mobile (automatic via `collapsible="icon"`) |

## CONCERN — Missing Components

**`DictationMenuItem` and `VoiceNotesMenuItem`** are named in the brief as preserved custom sidebar footer slots. Neither component exists in the codebase. The closest equivalent is `VoiceNote` (`@/components/voice-note`), which is a page-level speech-to-text component used inside journal/trades/notebook pages. It has no sidebar-menu-item form factor.

**`DashboardCustomizerMenuItem`** similarly does not exist as a sidebar component. The `DashboardCustomizer` (`@/components/dashboard-customizer`) is a popover used in the dashboard layout, not a sidebar item.

If these features need to live as sidebar menu items, dedicated `SidebarMenuButton`-based wrappers must be implemented. The current placeholder buttons have no click handlers and no functionality — they are visual stubs.

## Legacy CSS

The old `journal-sidebar-*` CSS classes (`.journal-desktop-sidebar`, `.journal-sidebar-home`, `.journal-sidebar-label`, etc.) remain in `globals.css` unchanged. These are now dead weight from the old shell implementation. They can be removed in a follow-up cleanup task once the new sidebar is confirmed working and no other files reference them.

## Blocker Summary

**BLOCKED** — `pnpm --filter web typecheck` does not pass. The 16 errors are pre-existing in the worktree (base-nova tooltip/button API surface mismatch), not caused by this task's changes. Fix the pre-existing `HoverHint`/`HelpHint` exports and `asChild` on Button before merging.
