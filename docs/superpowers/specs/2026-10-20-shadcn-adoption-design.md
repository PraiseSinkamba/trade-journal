# shadcn/ui Adoption — Design

**Date:** 2026-10-20
**Status:** Approved (brainstorming)
**Scope:** Set up shadcn/ui in `apps/web`, swap shared primitives to the official registry, rewrite the application shell on the Sidebar primitive, and keep every project customization alive in the migrated primitives. Done in a new Orca-managed worktree. No visual change.

## Problem

`apps/web/src/components/ui/` is a hand-rolled set of Radix + Tailwind primitives that look like shadcn but never went through the shadcn CLI. There is no `components.json`, the registry is not configured, and the project’s own customisations (HoverHint auto-wrap inside Button, profit/loss Badge variants, the `option:<value>` encoding in OptionSelect, the privacy-aware MonetaryValue/HoverHint overlay, etc.) drift away from upstream on every update. Re-deriving these by hand every time is the symptom; the underlying force is that we want to consume the registry while keeping the local features that the app depends on.

The user wants a working version of the app in a new worktree that uses the official shadcn primitives, with the existing look preserved. ADR 0001 (broker connectivity via broker-sdk) and ADR 0002 (cTrader MCP carve-out) are unaffected.

## Goals

1. Run `shadcn init` in `apps/web`; produce `apps/web/components.json` with aliases pinned to the existing `src/components/ui`, `src/lib/utils`, and `src/app/globals.css`.
2. Swap shared primitives to the official shadcn versions: skeleton, label, input, textarea, badge, checkbox, table, dropdown-menu, select, sidebar, card, tabs, dialog, tooltip, button.
3. Re-implement the project’s domain primitives (`HoverHint`, `HelpHint`, `OptionSelect`, `DatePicker`, `Calendar`, `MonetaryValue`, `MonetaryField`) as local files built on top of the new shadcn primitives. Keep every public API identical so callers do not change.
4. Rewrite `components/shell.tsx` on top of shadcn’s `Sidebar` family. Keep privacy toggle, theme toggle, dictation/voice-notes triggers, dashboard customizer, brand/logo, custom nav entries, and the file path so callers do not change.
5. Land three ADRs at `docs/decisions/0003..0005` covering shadcn adoption, `tw-animate-css`, and the Radix primitives list.
6. Verify with the project’s existing gates plus a Playwright E2E that exercises Sidebar, privacy, theme, DatePicker, and OptionSelect.

## Non-goals

- Any layout redesign or visual refresh beyond “swap to official primitives, same look”.
- New pages, new features, or new components beyond what the swap list needs.
- Tailwind v3 downgrade. Tailwind v4 `@theme inline` stays.
- Telemetry, analytics, or any new endpoint (hard rule #5).
- Removing the existing customisations (HoverHint wrapping inside Button, profit/loss Badge variants, `card-sheen`, calendar class names).
- `packages/core`, `packages/importers`, and the Tauri desktop build — untouched.
- ADRs 0001 and 0002 — unchanged.

## Workflow

```
backup  →  init  →  add  →  restore  →  smoke  →  verify
```

### 1. Worktree + workspace

- Branch: `feat/shadcn-adoption` off `main` (HEAD `b2bdd11`).
- Path: `.worktrees/shadcn-adoption/`. Add `.worktrees/` to `.gitignore` on `main` before the worktree add (currently absent).
- Orca: `ORCA worktree create --name shadcn-adoption --no-parent --json`, then `ORCA worktree set --worktree id:<repoId>::<.worktrees/shadcn-adoption> --display-name "shadcn-adoption" --comment "shadcn adoption: backup → init → add → restore" --workspace-status in-progress`.
- Install: `pnpm install --frozen-lockfile` inside the new worktree before any CLI run.

### 2. Backup current primitives

- Copy `apps/web/src/components/ui/*` to `.worktrees/shadcn-adoption/.backup/components-ui/` and `components/shell.tsx` to `.worktrees/shadcn-adoption/.backup/components/shell.tsx`.
- Produce `.backup/BACKUP_MANIFEST.md` listing every backed-up file and a one-line note of its current customisations.
- Commit the backup as a single revert-point commit on `feat/shadcn-adoption`.

### 3. Init shadcn

- `cd apps/web && pnpm dlx shadcn@latest init --defaults --yes --force`.
- `--defaults` = `--template=next --preset=nova` (base style implied). `--force` overwrites any partial `components.json`. CLI writes `apps/web/components.json` (aliases → `src/components/ui`, `src/lib/utils`, `src/app/globals.css`), reads the existing v4 token file, and writes no `tailwind.config.js`.

### 4. Add individual components

```
pnpm dlx shadcn@latest add --yes --overwrite \
  skeleton label input textarea badge checkbox table dropdown-menu \
  select sidebar card tabs dialog tooltip button
```

`--overwrite` is safe because the working tree only carries the new registry output and our backup commits capture the originals.

### 5. Restore customisations

For each file `components/ui/<name>.tsx`:

1. Open the backup at `.backup/components/ui/<name>.tsx`.
2. Start from the new registry version.
3. Add the project’s existing custom classes, `data-slot` markers, extra variants, and `HoverHint` wrapping.
4. Keep every import path consumers already use (`@/components/ui/button`, etc.).
5. Where the registry exposes a behaviour the project had custom (e.g. shadcn’s `CardAction`, `CardFooter`, `DialogFooter`, `DialogClose`), add the new export alongside the project’s existing exports so callers can opt in later.

For `components/shell.tsx`:

1. Rewrite as a thin wrapper around shadcn’s `Sidebar` / `SidebarContent` / `SidebarHeader` / `SidebarFooter` / `SidebarMenu` / `SidebarMenuItem` / `SidebarMenuButton` / `SidebarGroup` family.
2. Render **Privacy toggle** in `SidebarFooter` via the existing `PrivacyToggle` import (privacy state context unchanged).
3. Render **Theme toggle** alongside privacy.
4. Render **Dictation / voice-notes triggers** as `SidebarMenuButton` items with their existing icons and `HoverHint` labels.
5. Render **Dashboard customizer** as a `SidebarMenuButton` / `SidebarGroupAction` that opens the existing dialog.
6. Render **Brand/logo** in `SidebarHeader`; if it relies on `card-sheen`, port the utility class to `globals.css` next to the Sidebar theme block.
7. Re-emit **Custom nav entries** as `SidebarGroup`s; each item uses `SidebarMenuButton asChild` so existing `next/link` `<Link>`s keep working.
8. Export `AppSidebar` as a `SidebarProvider`-rooted wrapper so `app/layout.tsx` only needs `<AppSidebar />` + `<SidebarInset>` with no other layout change.
9. Keep the file at `components/shell.tsx` and default-export `AppSidebar` so callers in pages stay unchanged.

Each restored file is its own commit on `feat/shadcn-adoption` so reviewers can read the diff cleanly.

## Domain primitives refit (kept as local files)

These files stay at their existing paths; only their internals change:

- **`HoverHint`** (`components/ui/tooltip.tsx`): wrap shadcn’s `Tooltip` / `TooltipTrigger` / `TooltipContent`. Keep the `content={null}` short-circuit, `delayDuration={350}` / `skipDelayDuration={150}` defaults, `asChild` Slot, and the same prop shape (`label`, `content`, `align`, `side`). Export unchanged so `Button`’s auto-wrap continues to work.
- **`HelpHint`** (same file): keep the `CircleHelp` icon trigger inside `HoverHint`; refit to the new tooltip primitives.
- **`OptionSelect`** (`components/ui/option-select.tsx`): public API unchanged — declarative `<option>` list, `"All"` empty-string choice encoded as `option:<value>`. Internals rebuilt on shadcn’s `Select*` family. The six+ consumer pages stay untouched.
- **`DatePicker`** (`components/ui/date-picker.tsx`): keep `aria-invalid`, `role="alert"` error span, min/max validation, Clear/Today actions. Internals rebuilt on shadcn’s `Popover` + `Input` + the new `Calendar`.
- **`Calendar`** (`components/ui/calendar.tsx`): keep the `journal-calendar-*` utility class mapping (move that block to `globals.css` next to the Sidebar theme tokens). Body is shadcn’s `Calendar` wrapping `react-day-picker`.
- **`MonetaryValue` / `MonetaryField`** (`components/privacy.tsx`): keep the masked span (`aria-label="Monetary value hidden"`) and the `HoverHint` overlay; refit against the new `HoverHint`.

No consumer page imports change.

## Three ADRs

Format: MADR-lite (Status, Date, Context, Decision, Consequences), matching `docs/decisions/0000-template.md`. Hard block #1 in `.omp/AGENTS.md` mandates an ADR before any new dependency is added.

1. **`docs/decisions/0003-adopt-shadcn-ui.md`** — Accepted.
   - Context: primitives hand-rolled at `components/ui/`; no `components.json`. Drift from upstream on every update.
   - Decision: adopt shadcn/ui as the source of shared primitives. `apps/web/components.json` becomes the registry manifest. Swap shared primitives + sidebar to official versions; keep domain primitives as local files on top of the new primitives.
   - Consequences: future `pnpm dlx shadcn@latest add` works; per-component diffs become reviewable; the three new dep categories land via 0004 + 0005.

2. **`docs/decisions/0004-introduce-tw-animate-css.md`** — Accepted.
   - Context: `tw-animate-css` is the Tailwind v4 animation utility already used by the shadcn registry default; ADR formalises the dep.
   - Pin `tw-animate-css` as the only animation/transition source under Tailwind v4. No behavioural change today; prevents drift back to legacy `tailwindcss-animate`.

3. **`docs/decisions/0005-introduce-radix-primitives-list.md`** — Accepted.
   - Context: shadcn’s `button`, `dialog`, `select`, `tabs`, `tooltip`, `dropdown-menu`, `checkbox`, `label`, `popover`, `sidebar`, etc. use `@radix-ui/react-*` packages. Several are already present.
   - Add the Radix primitives the swap list requires as first-party deps under their existing licences (all MIT). The decision lists the exact package set so future versions don’t surprise anyone.

Each ADR is committed on `feat/shadcn-adoption` ahead of any dep installation.

## Theme + tokens (Tailwind v4 unchanged)

- shadcn’s `init` writes its semantic tokens (`--background`, `--foreground`, `--primary`, `--primary-foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`, `--radius`) into `apps/web/src/app/globals.css`. Keep them.
- Project-named tokens (`--brand`, `--profit`, `--loss`, `--series-1..8`, `--viz-*`) stay alongside in both `:root` (light) and `.dark` blocks. The `@theme inline` block maps both the project utilities (`bg-brand`, `text-profit`, `text-loss`, `bg-series-1`, etc.) and the new shadcn utilities (`bg-background`, `text-foreground`, `bg-card`, etc.).
- Hard rule #4: `Badge` `profit`/`loss` carries both colour **and** label/icon. Never colour-only.
- Existing pre-paint `THEME_INIT_SCRIPT` (storage key `journal-theme-v1`) stays. Do **not** switch to shadcn’s default `theme`; would cause FOUC.
- `prefers-reduced-motion` overrides the new shadcn animation utilities; verify in the smoke run.
- `card-sheen` and the `journal-calendar-*` class mapping live in the same `globals.css` block, next to the Sidebar theme variables.

## Verification + gates

**Per primitive** (after each `shadcn add` + restore commit):
- `pnpm --filter web typecheck` for fast feedback.

**After all swaps** (full gate):
```
pnpm format:check
pnpm typecheck
pnpm test
node scripts/check-licenses.mjs
pnpm --filter web build
```

**E2E (Playwright)** in `apps/web/tests/e2e/shadcn-adoption.spec.ts` (verify the project already has Playwright configured before writing the spec; if not, that becomes a tiny pre-step):

- Test 1 — Sidebar: navigate to `/`, assert sidebar visible, click collapse toggle, assert collapsed state, expand, assert all nav links render.
- Test 2 — Privacy: click Privacy toggle, assert monetary values on dashboard render as masked spans (`aria-label="Monetary value hidden"`); toggle off, assert visible.
- Test 3 — Theme: click theme toggle, assert `html` class flips between light/dark with no FOUC; refresh and assert no flash.
- Test 4 — Date Picker: open `DatePicker` on `progress` page, type invalid date, assert `aria-invalid` + `role="alert"` appears; pick valid date, assert value applied; click Clear, assert empty.
- Test 5 — OptionSelect: open `OptionSelect` on `reports` page, choose “All”, assert query string contains `option:` encoding; pick specific value, assert normal value.

**Smoke run** (manual sanity, after E2E passes):
- `pnpm --filter web dev`, navigate `127.0.0.1:3000`, eyeball HoverHint, profit/loss Badge labels, sidebar brand/logo, prefers-reduced-motion behaviour.

**Reviewer gate:** reviewer writes `.omp/reviewer-report.md` with `## Verdict: PASS`; `.omp/hooks/pre/reviewer-gate.ts` allows `git commit` only on PASS. CI runs gates + E2E on push.

**Hard blocks re-checked:**
- No raw `fetch`/`axios`/`http.` in `packages/importers/src/` (unchanged).
- No P&L colour as the sole signal.
- No new telemetry endpoint.
- ADRs gate each new dep.

## Acceptance criteria

- [ ] `pnpm format:check` is clean.
- [ ] `pnpm typecheck` is clean.
- [ ] `pnpm test` passes.
- [ ] `node scripts/check-licenses.mjs` passes.
- [ ] `pnpm --filter web build` succeeds.
- [ ] `apps/web/components.json` exists with aliases pinned to `src/components/ui`, `src/lib/utils`, `src/app/globals.css`.
- [ ] Three ADRs at `docs/decisions/0003`, `0004`, `0005` are committed with `Status: Accepted`.
- [ ] Every entry on the swap list is now an `shadcn add`-produced registry version with the project’s customisations restored.
- [ ] `components/shell.tsx` is rewritten on shadcn’s `Sidebar` family and preserves privacy, theme, dictation, voice-notes, dashboard customizer, brand/logo, and custom nav.
- [ ] Domain primitives (`HoverHint`, `HelpHint`, `OptionSelect`, `DatePicker`, `Calendar`, `MonetaryValue`, `MonetaryField`) keep their public API and import paths.
- [ ] Playwright E2E in `apps/web/tests/e2e/shadcn-adoption.spec.ts` exercises Sidebar, privacy, theme, DatePicker, and OptionSelect.
- [ ] Manual smoke run on `pnpm --filter web dev` confirms no FOUC and HoverHint / profit-loss Badge / Sidebar brand/logo / reduced-motion all behave.
- [ ] `.omp/reviewer-report.md` reports `## Verdict: PASS`.
- [ ] No new telemetry endpoint.

## Risks

- **Per-file diff discipline.** The restore step is the only place where project customisations could be dropped. Mitigation — per-file commits, reviewer agent, and a Playwright E2E that exercises the behaviours that customisations provide.
- **`HoverHint` woven into `Button`** — replacing `tooltip.tsx` without preserving the auto-wrap regresses accessibility of every icon-only Button in the app (shell nav, ThemeToggle, PrivacyToggle, dictation, voice notes, dashboard customizer). Mitigation — explicit restore rule; Playwright Test 1.
- **Theme FOUC** — switching to shadcn’s default `theme` key introduces flash. Mitigation — keep `journal-theme-v1` and `THEME_INIT_SCRIPT` untouched.
- **P&L colour as sole signal** — hard rule #4 forbids it. Mitigation — explicit rule in Section 6 + Playwright assertion that `Badge` profit/loss carries a label.
- **Tailwind v4 tokens collision** — duplicated or shadowed variables between shadcn’s set and the project’s set would silently override one. Mitigation — `globals.css` reviewed during restore; reviewer agent flags duplicate names.
- **`prefers-reduced-motion`** — shadcn animations inherit the project’s reduced-motion override but a missed keyframe could slip. Smoke run verifies.
- **Multi-package dep churn** — shadcn init pulls ~15 Radix packages. Each covered by ADR 0005 so the dep list is auditable.
- **License check** — `node scripts/check-licenses.mjs` runs in the gate; ADR 0005 confirms the licence story.

[Some lines truncated to 768 chars. Use :raw:11-11 to read line 11 whole]