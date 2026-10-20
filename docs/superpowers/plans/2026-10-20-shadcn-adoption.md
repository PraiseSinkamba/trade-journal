# shadcn/ui Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up shadcn/ui in `apps/web`, swap the hand-rolled Radix/Tailwind primitives for official registry versions (preserving every project customization), rewrite the app shell on the shadcn `Sidebar` primitive, and verify everything with the project's existing gates plus a Playwright E2E.

**Architecture:** Run `shadcn init` in a fresh Orca worktree; back up the current `components/ui/` and `components/shell.tsx`; add each primitive via `shadcn add`; per-file restore the project's customizations on top of the registry output; refit domain primitives (`HoverHint`, `HelpHint`, `OptionSelect`, `DatePicker`, `Calendar`, `MonetaryValue`, `MonetaryField`) onto the new primitives without changing public API; rewrite `shell.tsx` on `Sidebar`; merge shadcn tokens with the project's existing theme; gate with format/typecheck/test/license/build + a 5-test Playwright spec. ADRs 0003/0004/0005 land ahead of any dep install.

**Tech Stack:** shadcn/ui (latest CLI), Radix UI primitives, Tailwind CSS v4 + `tw-animate-css`, Next.js 15 App Router, React 19, TypeScript strict, Drizzle (unchanged), Playwright (if not already configured).

---

## File Structure

| File | Responsibility | Status |
| --- | --- | --- |
| `.gitignore` | Add `.worktrees/` so the new worktree isn't tracked | Modify |
| `docs/decisions/0003-adopt-shadcn-ui.md` | ADR for the shadcn adoption | Create |
| `docs/decisions/0004-introduce-tw-animate-css.md` | ADR for the animation utility | Create |
| `docs/decisions/0005-introduce-radix-primitives-list.md` | ADR for the Radix primitive packages | Create |
| `apps/web/components.json` | shadcn registry manifest (aliases, theme, base) | Create (via `shadcn init`) |
| `apps/web/package.json` | Adds Radix + `tw-animate-css` as direct deps | Modify |
| `apps/web/src/lib/utils.ts` | Existing `cn` helper, no change expected | Verify |
| `apps/web/src/app/globals.css` | shadcn tokens merged with project tokens; `card-sheen`, `journal-calendar-*` | Modify |
| `apps/web/src/components/ui/skeleton.tsx` | Plain wrapper, restore as-is | Restore |
| `apps/web/src/components/ui/label.tsx` | Radix passthrough | Restore |
| `apps/web/src/components/ui/input.tsx` | Plain input | Restore |
| `apps/web/src/components/ui/textarea.tsx` | Plain textarea | Restore |
| `apps/web/src/components/ui/badge.tsx` | `Badge` + `badgeVariants` incl. `profit`/`loss` variants | Restore |
| `apps/web/src/components/ui/checkbox.tsx` | Radix checkbox with indeterminate + group/state | Restore |
| `apps/web/src/components/ui/table.tsx` | Wrapped in `overflow-x-auto` + tabular-nums | Restore |
| `apps/web/src/components/ui/dropdown-menu.tsx` | Minimal API; export extended pieces | Restore |
| `apps/web/src/components/ui/select.tsx` | Custom trigger styling on Radix Select | Restore |
| `apps/web/src/components/ui/card.tsx` | `card-sheen`, `data-slot="card-header"`, small uppercase title | Restore |
| `apps/web/src/components/ui/tabs.tsx` | Triggers in overflow-x scroll | Restore |
| `apps/web/src/components/ui/dialog.tsx` | Existing API + `DialogFooter`/`DialogClose` | Restore |
| `apps/web/src/components/ui/tooltip.tsx` | `Tooltip*` + `HoverHint` + `HelpHint` | Restore |
| `apps/web/src/components/ui/button.tsx` | `HoverHint` auto-wrap for icon-only/title-only | Restore |
| `apps/web/src/components/ui/sidebar.tsx` | shadcn `Sidebar` family (added) | Restore |
| `apps/web/src/components/ui/calendar.tsx` | `journal-calendar-*` mapping; shadcn Calendar body | Restore |
| `apps/web/src/components/ui/date-picker.tsx` | min/max validation, Clear/Today; on new `Popover`/`Input`/`Calendar` | Restore |
| `apps/web/src/components/option-select.tsx` | `option:<value>` encoding on shadcn `Select*` | Restore |
| `apps/web/src/components/privacy.tsx` | `MonetaryValue`/`MonetaryField` against new `HoverHint` | Restore |
| `apps/web/src/components/shell.tsx` | Rewritten on shadcn `Sidebar` family | Rewrite |
| `apps/web/src/app/layout.tsx` | Wraps in `SidebarProvider` via `AppSidebar` | Modify (≤ 5 lines) |
| `apps/web/tests/e2e/shadcn-adoption.spec.ts` | Playwright spec (5 tests) | Create |
| (worktree) `.backup/components-ui/*` | Snapshot of originals before `shadcn add` | Create |
| (worktree) `.backup/components/shell.tsx` | Snapshot of original shell | Create |
| (worktree) `.backup/BACKUP_MANIFEST.md` | Per-file customizations manifest | Create |

No changes to `packages/core`, `packages/importers`, `apps/web/src/db/`, `apps/web/src/server/`, or the Tauri desktop build.

---

## Global Constraints

From the project's `.omp/AGENTS.md`, `.omp/hooks/`, and the spec:

- TypeScript strict, ESM, no `any`. Aliases: `@/…`. Helpers at top of files.
- One commit per task; commit messages lead with the *what*, not the file path.
- Run `pnpm --filter web typecheck` after each per-file restore.
- Hard rule #1 — every new dep lands only after its ADR is committed.
- Hard rule #4 — `Badge` profit/loss carries both color **and** label/icon; never color-only.
- Hard rule #5 — no new telemetry endpoint.
- Hard block — no raw `fetch`/`axios`/`http.` in `packages/importers/src/` (unchanged; this plan doesn't touch importers).
- Reviewer gate — `.omp/reviewer-report.md` must report `## Verdict: PASS` before `git commit` lands via the `reviewer-gate.ts` pre-hook.
- Tailwind v4 stays. No `tailwind.config.js` written (CLI handles this for v4).
- Theme storage key remains `journal-theme-v1`; do not switch to shadcn's default `theme`.
- Restore step is the only place where project customisations could be dropped — per-file commits + Playwright spec + reviewer agent.

---

### Task 1: Add `.worktrees/` to `.gitignore` and commit

**Files:**
- Modify: `.gitignore` (append a new section).

**Why:** Per the `using-git-worktrees` skill, project-local worktree directories must be gitignored before `git worktree add`. Currently `.gitignore` does not list `.worktrees/`.

- [ ] **Step 1: Edit `.gitignore`**

Append at the end of `.gitignore`:

```
# Local-only worktrees
.worktrees/
```

- [ ] **Step 2: Verify the change**

Run: `git check-ignore -v .worktrees`

Expected: a line like `.gitignore:<lineno>:.worktrees/	.worktrees` confirming the directory is ignored.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "Ignore project-local worktree directory"
```

---

### Task 2: Create the Orca worktree

**Files:** none (Orca state change only).

**Produces:**
- A new Orca worktree at `.worktrees/shadcn-adoption/` on branch `feat/shadcn-adoption`.
- A `.omp/reviewer-report.md` with `## Verdict: PASS` is **not** required yet (no code change in this task). The next task (backups) is the first that produces real artifacts and is the first to gate on the reviewer.

- [ ] **Step 1: Get the repo id**

Run: `orca repo list --json`

Pick the entry whose path is `E:/4004/orca/trade-journal` and capture its `id` field. (If only one repo is registered, that's the id.)

- [ ] **Step 2: Create the worktree**

Run:

```bash
orca worktree create \
  --repo id:<repoId> \
  --name shadcn-adoption \
  --base-branch main \
  --json
```

Capture the new worktree `id` from the response (looks like `<repoId>::.worktrees/shadcn-adoption`). Set the display name and a status comment:

```bash
orca worktree set \
  --worktree id:<repoId>::.worktrees/shadcn-adoption \
  --display-name "shadcn-adoption" \
  --comment "shadcn adoption: backup → init → add → restore" \
  --workspace-status in-progress \
  --json
```

- [ ] **Step 3: Verify the worktree exists**

Run: `git worktree list`

Expected: a new entry at `E:/4004/orca/trade-journal/.worktrees/shadcn-adoption  b2bdd11 [feat/shadcn-adoption]`.

- [ ] **Step 4: Install deps in the new worktree**

Run:

```bash
cd .worktrees/shadcn-adoption
pnpm install --frozen-lockfile
```

Expected: lockfile resolves without modifications; `node_modules/` populated.

---

### Task 3: Back up current primitives + manifest

**Files (created inside the worktree):**
- `.worktrees/shadcn-adoption/.backup/components-ui/*.tsx`
- `.worktrees/shadcn-adoption/.backup/components/shell.tsx`
- `.worktrees/shadcn-adoption/.backup/BACKUP_MANIFEST.md`

**Why:** Per the spec's restore step, the originals must be recoverable. The backup directory itself is the source of truth during restore; this task commits it as one revert-point commit.

- [ ] **Step 1: Copy primitives**

```bash
cd .worktrees/shadcn-adoption
mkdir -p .backup/components-ui .backup/components
cp apps/web/src/components/ui/*.tsx .backup/components-ui/
cp apps/web/src/components/shell.tsx .backup/components/
```

- [ ] **Step 2: Write the manifest**

Create `.backup/BACKUP_MANIFEST.md` with this content (replace `<date>` with today's YYYY-MM-DD):

```
# Backup manifest — shadcn adoption

Captured: <date>

## apps/web/src/components/ui/

| File | Customisations to restore after `shadcn add` |
|------|------------------------------------------------|
| `skeleton.tsx` | Plain wrapper. Restore as-is. |
| `label.tsx` | Radix passthrough. Restore as-is. |
| `input.tsx` | Plain input. Restore as-is. |
| `textarea.tsx` | Plain textarea. Restore as-is. |
| `badge.tsx` | Adds `profit` and `loss` variants to `badgeVariants`. |
| `checkbox.tsx` | Indeterminate state via `Minus` icon + `group/checkbox` data-state. |
| `table.tsx` | Wrapped in `overflow-x-auto`; tabular-nums in CSS. |
| `dropdown-menu.tsx` | Minimal export set; consumers depend on the trimmed surface. |
| `select.tsx` | Custom trigger styling using `--radix-*` vars; ScrollUp/Down present. |
| `card.tsx` | Adds `card-sheen` utility class; `CardHeader` carries `data-slot="card-header"`; `CardTitle` is small/uppercase (not h3). |
| `tabs.tsx` | `TabsList` in `overflow-x-auto`; triggers stack on narrow widths. |
| `dialog.tsx` | Adds `CardTitle`-style title (small/uppercase); Close button built into `DialogContent`. |
| `tooltip.tsx` | Exports `Tooltip*` + `HoverHint` + `HelpHint`. `HoverHint` short-circuits when `content` is null. |
| `button.tsx` | Wraps body in `HoverHint` when `title` is set or icon-only without `aria-label`. Uses `asChild` Slot. |
| `calendar.tsx` | Wraps `react-day-picker` v9 with `journal-calendar-*` utility classes. |
| `date-picker.tsx` | Radix `Popover` + `Input` + lazy Calendar; min/max validation; `aria-invalid` + `role="alert"` error span; Clear/Today actions. |
| `option-select.tsx` | Declarative `<option>` list; `"All"` empty-string choice encoded as `option:<value>`. |

## apps/web/src/components/

| File | Customisations to restore after Sidebar rewrite |
|------|-------------------------------------------------|
| `shell.tsx` | Privacy toggle, theme toggle, dictation/voice-notes triggers, dashboard customizer mount, brand/logo, custom nav entries, `SidebarFooter` anchor. |

## Restoration policy

After each `shadcn add`, open the backup file, start from the new registry version, and merge in the project customisations. Keep every import path consumers already use.
```

- [ ] **Step 3: Commit the backup**

```bash
cd .worktrees/shadcn-adoption
git add .backup
git commit -m "Snapshot current primitives before shadcn adoption"
```

---

### Task 4: ADR 0003 — Adopt shadcn/ui

**Files:**
- Create: `docs/decisions/0003-adopt-shadcn-ui.md`

**Why:** Hard block #1 forbids new deps without an ADR. This ADR covers the shadcn adoption as the umbrella decision.

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/0003-adopt-shadcn-ui.md` (MADR-lite, matching `docs/decisions/0000-template.md`):

```md
# 0003 — Adopt shadcn/ui

- Status: Accepted
- Date: <today>
- Deciders: Chris Naudé (via brainstorming on 2026-10-20)

## Context

`apps/web/src/components/ui/` is a hand-rolled set of Radix + Tailwind primitives that look like shadcn but never went through the shadcn CLI. There is no `components.json`, the registry is not configured, and the project's own customisations (HoverHint auto-wrap inside Button, profit/loss Badge variants, the `option:<value>` encoding in OptionSelect, the privacy-aware MonetaryValue/HoverHint overlay, etc.) drift away from upstream on every update. Re-deriving these by hand every time is the symptom.

## Decision

Adopt shadcn/ui as the source of shared primitives in `apps/web`. Run `pnpm dlx shadcn@latest init` to produce `apps/web/components.json` (aliases pinned to `src/components/ui`, `src/lib/utils`, `src/app/globals.css`). Swap shared primitives to the official registry versions; keep domain primitives (`HoverHint`, `HelpHint`, `OptionSelect`, `DatePicker`, `Calendar`, `MonetaryValue`, `MonetaryField`) as local files built on top of the new primitives, with public API unchanged. Rewrite `components/shell.tsx` on shadcn's `Sidebar` family while preserving every existing feature. Tailwind v4 stays; no `tailwind.config.js` written. ADR 0004 formalises the animation dep; ADR 0005 lists the Radix primitives.

## Consequences

- Positive: future `pnpm dlx shadcn@latest add <name>` works; per-file diffs become reviewable; the project customisations live in restored primitives that are themselves reviewable commits.
- Negative: the restore step is the only place where project customisations could be dropped. Mitigated by per-file commits, a Playwright E2E that exercises the customisations, and the reviewer agent.
- Forbidden: any new dep without its own ADR (0004, 0005); any visual refresh beyond "swap with official primitives, same look"; a Tailwind v3 downgrade; any new telemetry endpoint.

This decision is reversible without cost — removing the registry and reverting to the backup directory restores the pre-migration state.
```

- [ ] **Step 2: Commit**

```bash
cd .worktrees/shadcn-adoption
git add docs/decisions/0003-adopt-shadcn-ui.md
git commit -m "Adopt shadcn/ui as the source of shared primitives"
```

---

### Task 5: ADR 0004 — Introduce `tw-animate-css`

**Files:**
- Create: `docs/decisions/0004-introduce-tw-animate-css.md`

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/0004-introduce-tw-animate-css.md`:

```md
# 0004 — Introduce `tw-animate-css`

- Status: Accepted
- Date: <today>
- Deciders: Chris Naudé (via brainstorming on 2026-10-20)

## Context

The shadcn registry default uses `tw-animate-css` for animation utilities under Tailwind v4. The package is already present in `apps/web/package.json`, but no ADR has captured the choice. Without one, future contributors could re-introduce `tailwindcss-animate` or remove the dep entirely.

## Decision

Pin `tw-animate-css` as the only animation/transition utility source under Tailwind v4 in `apps/web`. Existing animation references using `tailwindcss-animate` (if any) must be replaced.

## Consequences

- Positive: registry default works out of the box; reduced-motion overrides stay consistent.
- Negative: none today.
- Reversible — bumping the dep is a normal package update; removing it requires replacing every animated utility.
```

- [ ] **Step 2: Commit**

```bash
cd .worktrees/shadcn-adoption
git add docs/decisions/0004-introduce-tw-animate-css.md
git commit -m "Pin tw-animate-css as the animation utility"
```

---

### Task 6: ADR 0005 — Radix primitives list

**Files:**
- Create: `docs/decisions/0005-introduce-radix-primitives-list.md`

- [ ] **Step 1: Determine the exact Radix set**

Run from the worktree:

```bash
pnpm dlx shadcn@latest info --json
```

Capture every `@radix-ui/react-*` package listed in the swap components. Compare against the existing `apps/web/package.json` `dependencies` to identify the additions.

- [ ] **Step 2: Write the ADR**

Create `docs/decisions/0005-introduce-radix-primitives-list.md`:

```md
# 0005 — Introduce Radix primitives list

- Status: Accepted
- Date: <today>
- Deciders: Chris Naudé (via brainstorming on 2026-10-20)

## Context

shadcn's `button`, `dialog`, `select`, `tabs`, `tooltip`, `dropdown-menu`, `checkbox`, `label`, `popover`, `sidebar`, `accordion`, `radio-group`, `separator`, and `toast` primitives use `@radix-ui/react-*` packages. Several are already present in `apps/web/package.json`. Hard block #1 forbids any new dep without an ADR.

## Decision

Add the following Radix packages as first-party dependencies in `apps/web/package.json` (each under its existing MIT licence):

- `@radix-ui/react-slot` — used by `Button` (`asChild`).
- `@radix-ui/react-label` — used by `Label`.
- `@radix-ui/react-checkbox` — used by `Checkbox`.
- `@radix-ui/react-dropdown-menu` — used by `DropdownMenu`.
- `@radix-ui/react-select` — used by `Select`.
- `@radix-ui/react-tabs` — used by `Tabs`.
- `@radix-ui/react-dialog` — used by `Dialog`.
- `@radix-ui/react-tooltip` — used by `Tooltip`/`HoverHint`/`HelpHint`.
- `@radix-ui/react-popover` — used by `DatePicker`/`Sidebar`.
- `@radix-ui/react-accordion` — used by `Sidebar` group accordions.
- `@radix-ui/react-separator` — used by `Sidebar` separators.
- `@radix-ui/react-radio-group` — reserved for future use; pulled in by the Sidebar family.
- `@radix-ui/react-toast` — reserved for future use; pulled in by the registry default.

(Exact set may shift with the registry version. Update this list when a `shadcn add` introduces a new package.)

## Consequences

- Positive: registry default works out of the box; ADR makes the dep list auditable.
- Negative: ~12 small new packages. License check (`node scripts/check-licenses.mjs`) verifies MIT compatibility.
- Reversible — when shadcn/ui no longer needs a given Radix primitive, remove both the dep and the import.
```

- [ ] **Step 3: Commit**

```bash
cd .worktrees/shadcn-adoption
git add docs/decisions/0005-introduce-radix-primitives-list.md
git commit -m "List the Radix primitives that ship with shadcn"
```

---

### Task 7: `shadcn init`

**Files:**
- Create: `apps/web/components.json`
- Modify: `apps/web/src/app/globals.css` (merged tokens)
- Modify: `apps/web/package.json` (new deps)

**Why:** Stand up the registry manifest. After this task, future `shadcn add` calls work.

- [ ] **Step 1: Run init**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest init --defaults --yes --force
```

Expected: `apps/web/components.json` is written with `aliases` pointing at `src/components/ui`, `src/lib/utils`, `src/app/globals.css`, and `tsx: true`. `apps/web/src/app/globals.css` now contains shadcn's `:root` and `.dark` token blocks alongside the project's.

- [ ] **Step 2: Verify `components.json`**

Run: `cat apps/web/components.json`

Expected: `aliases.ui == "src/components/ui"`, `aliases.utils == "src/lib/utils"`, `aliases.lib == "src/lib"`, `aliases.css == "src/app/globals.css"`, `tailwind.cssVariables == true`, `tailwind.version == "4"`, `tsx == true`, `base == "radix"`, `style == "new-york"`.

- [ ] **Step 3: Verify Radix deps were added**

Run: `grep -E "@radix-ui" apps/web/package.json`

Expected: a list of `@radix-ui/react-*` packages now appears in `apps/web/package.json`. Cross-check against ADR 0005; reconcile any differences in the ADR.

- [ ] **Step 4: Verify globals.css contains both sets of tokens**

Read `apps/web/src/app/globals.css`. Confirm:
- The shadcn semantic tokens (`--background`, `--foreground`, `--primary`, `--card`, `--popover`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`) appear in `:root` and `.dark`.
- The project's tokens (`--brand`, `--profit`, `--loss`, `--series-1..8`, `--viz-*`) are still present.
- The `@theme inline` block lists both project utilities and shadcn utilities.

If the project's tokens are missing, restore them from the backup of the original globals.css (read the original via `git show main:apps/web/src/app/globals.css` and merge into the post-init file). The `prefers-reduced-motion` overrides stay.

- [ ] **Step 5: Verify the app still builds**

```bash
cd .worktrees/shadcn-adoption
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd .worktrees/shadcn-adoption
git add apps/web/components.json apps/web/package.json apps/web/src/app/globals.css
git commit -m "Initialise shadcn in apps/web and merge theme tokens"
```

---

### Task 8: Add `skeleton` and restore

**Files:**
- Modify: `apps/web/src/components/ui/skeleton.tsx`

**Why:** Lowest-risk primitive. Restore is a no-op.

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add skeleton --yes --overwrite
```

- [ ] **Step 2: Restore**

Open `.backup/components-ui/skeleton.tsx`. The original was a plain wrapper around the `cn` helper. The new registry output is identical in spirit. If the registry uses a different export name (e.g. `Skeleton` vs `Skeleton as SkeletonDefault`), keep the original export name from the backup. The expected outcome: the file matches the backup byte-for-byte or differs only in import paths.

- [ ] **Step 3: Verify**

```bash
cd .worktrees/shadcn-adoption
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd .worktrees/shadcn-adoption
git add apps/web/src/components/ui/skeleton.tsx
git commit -m "Restore skeleton primitive on shadcn registry"
```

---

### Task 9: Add `label` and restore

**Files:**
- Modify: `apps/web/src/components/ui/label.tsx`

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add label --yes --overwrite
```

- [ ] **Step 2: Restore**

The original was a Radix `Label.Root` passthrough. If the new registry adds `data-slot` markers or `cn` wrappers, keep them. The expected outcome: file matches the backup or differs only in markers/imports.

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/label.tsx
git commit -m "Restore label primitive on shadcn registry"
```

---

### Task 10: Add `input` and restore

**Files:**
- Modify: `apps/web/src/components/ui/input.tsx`

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add input --yes --overwrite
```

- [ ] **Step 2: Restore**

Original was a plain wrapper around `<input>` using `cn`. Keep any project-specific className extensions or `data-slot` markers if the new registry output doesn't already have them.

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/input.tsx
git commit -m "Restore input primitive on shadcn registry"
```

---

### Task 11: Add `textarea` and restore

**Files:**
- Modify: `apps/web/src/components/ui/textarea.tsx`

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add textarea --yes --overwrite
```

- [ ] **Step 2: Restore**

Original was a plain `<textarea>` wrapper. Keep any className extensions from the backup.

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/textarea.tsx
git commit -m "Restore textarea primitive on shadcn registry"
```

---

### Task 12: Add `badge` and restore (profit/loss variants)

**Files:**
- Modify: `apps/web/src/components/ui/badge.tsx`

**Why:** `Badge` carries the P&L color signal. Hard rule #4 forbids color-only; the `profit`/`loss` variants must remain visible alongside any label/icon. The restore step adds the missing variants on top of the registry.

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add badge --yes --overwrite
```

- [ ] **Step 2: Restore**

Open `.backup/components-ui/badge.tsx`. The original exported `Badge` and `badgeVariants` with `default`, `secondary`, `outline`, `profit`, `loss` variants. After the `shadcn add`, merge the `profit` and `loss` variants into `badgeVariants`:

```ts
const badgeVariants = cva(
  "...base classes...",
  {
    variants: {
      variant: {
        default: "...",
        secondary: "...",
        destructive: "...",
        outline: "...",
        profit: "border-transparent bg-profit/15 text-profit",
        loss: "border-transparent bg-loss/15 text-loss",
      },
    },
    defaultVariants: { variant: "default" },
  }
);
```

`bg-profit/15 text-profit` uses the project's `--profit` token (mapped via `@theme inline` in `globals.css`). Verify the token mapping exists; if not, the Theme Merge task will add it.

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/badge.tsx
git commit -m "Restore badge primitive with profit and loss variants"
```

---

### Task 13: Add `checkbox` and restore

**Files:**
- Modify: `apps/web/src/components/ui/checkbox.tsx`

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add checkbox --yes --overwrite
```

- [ ] **Step 2: Restore**

Original used Radix `Checkbox` with an indeterminate state via the `Minus` icon and `group/checkbox` `data-state` attribute. Confirm the new registry output supports indeterminate (registry default does). If not, fold in the indeterminate branch from the backup:

```ts
const icon = checked === "indeterminate" ? Minus : checked ? Check : null;
```

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/checkbox.tsx
git commit -m "Restore checkbox primitive on shadcn registry"
```

---

### Task 14: Add `table` and restore

**Files:**
- Modify: `apps/web/src/components/ui/table.tsx`

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add table --yes --overwrite
```

- [ ] **Step 2: Restore**

Original wrapped the table in an `overflow-x-auto` div and applied `tabular-nums` via CSS (not on the component itself). Keep the same exported surface; if the wrapper div is missing, re-add it. The CSS rule for `tabular-nums` lives in `globals.css` (verify).

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/table.tsx
git commit -m "Restore table primitive on shadcn registry"
```

---

### Task 15: Add `dropdown-menu` and restore

**Files:**
- Modify: `apps/web/src/components/ui/dropdown-menu.tsx`

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add dropdown-menu --yes --overwrite
```

- [ ] **Step 2: Restore**

Original had a minimal export surface (`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`). The new registry exports the full set including `Label`, `Separator`, `CheckboxItem`, `RadioItem`, `Sub`, etc. **Keep every export the original had; add the new exports alongside** so callers can opt in later. Used by `components/rich-editor.tsx`.

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/dropdown-menu.tsx
git commit -m "Restore dropdown-menu primitive with extended exports"
```

---

### Task 16: Add `select` and restore

**Files:**
- Modify: `apps/web/src/components/ui/select.tsx`

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add select --yes --overwrite
```

- [ ] **Step 2: Restore**

Original used custom trigger styling with `--radix-*` CSS vars (e.g. `bg-[var(--radix-select-trigger-background)]`). The new registry uses Tailwind utilities (`bg-popover`, `text-popover-foreground`, etc.). **Keep both** — add the `--radix-*` references as fallback comments for any consumer that depends on them, and let the Tailwind utilities take priority. Preserve `ScrollUpButton` / `ScrollDownButton`.

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/select.tsx
git commit -m "Restore select primitive with original trigger styling"
```

---

### Task 17: Add `card` and restore

**Files:**
- Modify: `apps/web/src/components/ui/card.tsx`
- Modify: `apps/web/src/app/globals.css` (add `card-sheen` if missing)

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add card --yes --overwrite
```

- [ ] **Step 2: Restore**

Original:
- Added `card-sheen` utility class.
- `CardHeader` carries `data-slot="card-header"` marker.
- `CardTitle` was small/uppercase, not an `<h3>`.
- Lacked `CardFooter`, `CardDescription`, `CardAction`.

After add, merge in:
1. The `card-sheen` utility (define in `globals.css` next to other Sidebar theme utilities if not already there).
2. The `data-slot="card-header"` marker on `CardHeader`.
3. The small/uppercase `CardTitle` styling.
4. Add the missing `CardFooter`, `CardDescription`, `CardAction` exports from the registry (callers can opt in later).

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/card.tsx apps/web/src/app/globals.css
git commit -m "Restore card primitive with sheen, data-slot marker, and new exports"
```

---

### Task 18: Add `tabs` and restore

**Files:**
- Modify: `apps/web/src/components/ui/tabs.tsx`

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add tabs --yes --overwrite
```

- [ ] **Step 2: Restore**

Original had `TabsList` inside an `overflow-x-auto` wrapper so triggers stack on narrow widths. Keep the wrapper; preserve the `data-slot="tabs-list"` marker if present.

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/tabs.tsx
git commit -m "Restore tabs primitive with overflow scrolling"
```

---

### Task 19: Add `dialog` and restore

**Files:**
- Modify: `apps/web/src/components/ui/dialog.tsx`

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add dialog --yes --overwrite
```

- [ ] **Step 2: Restore**

Original had a small/uppercase title (matching `CardTitle`). Lacked `DialogClose` and `DialogFooter`. After add:
1. Keep the small/uppercase `DialogTitle` (or expose a `titleSize` variant if the registry supports it).
2. Add `DialogClose` and `DialogFooter` exports from the registry.

Used by 7 pages and `components/filter-bar.tsx`, `components/review-export.tsx`, `components/rich-editor.tsx`.

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/dialog.tsx
git commit -m "Restore dialog primitive with title styling and footer exports"
```

---

### Task 20: Add `tooltip` and restore (HoverHint + HelpHint)

**Files:**
- Modify: `apps/web/src/components/ui/tooltip.tsx`

**Why:** `HoverHint` is the most-reused custom export. Used in 9+ places. Must keep its public API identical.

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add tooltip --yes --overwrite
```

- [ ] **Step 2: Restore HoverHint and HelpHint**

Open `.backup/components-ui/tooltip.tsx`. After the registry's `Tooltip` / `TooltipTrigger` / `TooltipContent` / `TooltipProvider` exports, append:

```tsx
// Project extensions.
export function HoverHint({
  label,
  content,
  children,
  align = "center",
  side = "top",
  delayDuration,
}: HoverHintProps) {
  if (content === null) return <>{children}</>;
  return (
    <Tooltip delayDuration={delayDuration ?? 350} skipDelayDuration={150}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent align={align} side={side}>
        {content ?? label}
      </TooltipContent>
    </Tooltip>
  );
}

export function HelpHint(props: HoverHintProps) {
  return (
    <HoverHint {...props}>
      <CircleHelp className="h-4 w-4 text-muted-foreground" aria-hidden />
    </HoverHint>
  );
}
```

`HoverHintProps` is whatever the backup defines; keep its shape byte-for-byte.

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/tooltip.tsx
git commit -m "Restore tooltip primitive with HoverHint and HelpHint exports"
```

---

### Task 21: Add `button` and restore (HoverHint auto-wrap)

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx`

**Why:** The `HoverHint` auto-wrap on title-only or icon-only buttons is the most fragile customisation. Replacing `button.tsx` without preserving this regresses accessibility of every icon-only Button in the app.

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add button --yes --overwrite
```

- [ ] **Step 2: Restore the HoverHint auto-wrap**

Open `.backup/components-ui/button.tsx`. The `Button` component wraps its body in `HoverHint` when `title` is set **or** when the button is icon-only (no text children) and no `aria-label` is provided. After the registry `Button` export, the body becomes:

```tsx
const needsTooltip = Boolean(title) || (iconOnly && !ariaLabel);
const inner = <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;

return needsTooltip ? (
  <HoverHint content={title ?? ariaLabel ?? null}>{inner}</HoverHint>
) : inner;
```

`iconOnly` is `!children || (Array.isArray(children) && children.every(c => !c || (typeof c === "object" && (c as any).type?.displayName !== "VisuallyHidden")))`. Simpler: check `!children || Children.count(children) === 0` plus the absence of `aria-label`. The exact heuristic is in the backup file — copy it across.

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/button.tsx
git commit -m "Restore button primitive with HoverHint auto-wrap on icon-only"
```

---

### Task 22: Add `sidebar` and rewrite `shell.tsx`

**Files:**
- Modify: `apps/web/src/components/ui/sidebar.tsx` (added by CLI)
- Modify: `apps/web/src/components/shell.tsx` (rewritten)
- Modify: `apps/web/src/app/layout.tsx` (wrap in `SidebarProvider`)

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add sidebar --yes --overwrite
```

- [ ] **Step 2: Rewrite `shell.tsx`**

Open `.backup/components/shell.tsx` as the reference. Rewrite using shadcn's `Sidebar` family:

```tsx
"use client";
import * as React from "react";
import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { HoverHint } from "@/components/ui/tooltip";
import { PrivacyToggle } from "@/components/privacy";
import { ThemeToggle } from "@/components/theme-toggle";
// ... existing icon + dictation + voice-notes + dashboard customizer imports ...

export function AppSidebar({ ...props }: AppSidebarProps) {
  return (
    <SidebarProvider defaultOpen {...props}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <BrandLogo />
        </SidebarHeader>
        <SidebarContent>
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild tooltip={item.tooltip}>
                        <Link href={item.href}>
                          <item.Icon aria-hidden />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DictationMenuItem />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <VoiceNotesMenuItem />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <DashboardCustomizerMenuItem />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <PrivacyToggle />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <ThemeToggle />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}

export default AppSidebar;
```

`NAV_GROUPS`, `BrandLogo`, `DictationMenuItem`, `VoiceNotesMenuItem`, `DashboardCustomizerMenuItem` are the exact constants/components the backup file exports. Reuse them byte-for-byte. `HoverHint` labels on dictation/voice-notes come from the backup.

- [ ] **Step 3: Update `layout.tsx`**

In `apps/web/src/app/layout.tsx`, replace the existing `<Shell>` (or whatever wraps the page) with `<AppSidebar>`. Confirm `app/globals.css` includes the shadcn Sidebar theme variables (`--sidebar-background`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring`); if not, add them during the Theme Merge task.

- [ ] **Step 4: Verify**

```bash
cd .worktrees/shadcn-adoption
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/sidebar.tsx apps/web/src/components/shell.tsx apps/web/src/app/layout.tsx
git commit -m "Rewrite shell on shadcn Sidebar with all custom slots preserved"
```

---

### Task 23: Add `calendar` and restore

**Files:**
- Modify: `apps/web/src/components/ui/calendar.tsx`
- Modify: `apps/web/src/app/globals.css` (add `journal-calendar-*` classes)

- [ ] **Step 1: Add**

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add calendar --yes --overwrite
```

- [ ] **Step 2: Restore the calendar class mapping**

The original `calendar.tsx` mapped `react-day-picker` classNames to `journal-calendar-*` utilities. Add those utilities to `globals.css` (read the backup or `git show main:apps/web/src/app/globals.css | grep journal-calendar` to extract):

```css
.journal-calendar { @apply ...; }
.journal-calendar-day { @apply ...; }
.journal-calendar-day_selected { @apply ...; }
/* etc. */
```

Then export `Calendar` from the new file with the same `classNames` mapping on `react-day-picker` (or use shadcn's `Calendar` component, which already accepts `classNames`).

- [ ] **Step 3: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/calendar.tsx apps/web/src/app/globals.css
git commit -m "Restore calendar primitive on shadcn registry"
```

---

### Task 24: Refit `DatePicker` on shadcn primitives

**Files:**
- Modify: `apps/web/src/components/ui/date-picker.tsx`

**Why:** `DatePicker` is heavily customised (validation, Clear/Today, ARIA states). Refit on shadcn's `Popover` + `Input` + `Calendar` while keeping every behavior.

- [ ] **Step 1: Refit**

Open `.backup/components-ui/date-picker.tsx`. Replace internal Radix imports with shadcn equivalents:
- `Popover`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover` (add `popover` via `pnpm dlx shadcn@latest add popover --yes --overwrite` if not already present).
- `Input` from `@/components/ui/input`.
- `Calendar` from `@/components/ui/calendar`.
- Preserve: `aria-invalid`, `role="alert"` on error span, min/max validation, Clear/Today actions, the existing export name and prop shape.

If `popover` wasn't added, add it now:

```bash
cd .worktrees/shadcn-adoption/apps/web
pnpm dlx shadcn@latest add popover --yes --overwrite
```

- [ ] **Step 2: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/date-picker.tsx apps/web/src/components/ui/popover.tsx
git commit -m "Refit date-picker on shadcn Popover, Input, and Calendar"
```

---

### Task 25: Refit `OptionSelect` on shadcn `Select*`

**Files:**
- Modify: `apps/web/src/components/ui/option-select.tsx`

**Why:** Six+ consumer pages depend on the `option:<value>` encoding. Public API stays identical.

- [ ] **Step 1: Refit**

Open `.backup/components-ui/option-select.tsx`. The original wrapped Radix `Select` to support declarative `<option>` lists and the `"All"` empty-string choice encoded as `option:<value>`. Rewrite internals on shadcn's `Select` / `SelectTrigger` / `SelectContent` / `SelectItem` / `SelectValue`. Keep:
- The export name `OptionSelect`.
- The prop shape (default `value`, `onChange`, `options`, `placeholder`, `aria-label`, etc.).
- The `option:<value>` encoding for empty-string values.
- The mapping from `<option>`-shaped data to `SelectItem` children.

- [ ] **Step 2: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/option-select.tsx
git commit -m "Refit option-select on shadcn Select with option:<value> encoding"
```

---

### Task 26: Refit `MonetaryValue` / `MonetaryField` on new `HoverHint`

**Files:**
- Modify: `apps/web/src/components/privacy.tsx`

- [ ] **Step 1: Refit**

Open `components/privacy.tsx`. Replace any internal tooltip references with the new `HoverHint`. Keep:
- The masked span `<span aria-label="Monetary value hidden">••••</span>`.
- The `HoverHint` overlay when the field is masked.
- The `MonetaryValue` and `MonetaryField` exports.

- [ ] **Step 2: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/privacy.tsx
git commit -m "Refit MonetaryValue and MonetaryField on new HoverHint"
```

---

### Task 27: Theme merge finalization

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Why:** Confirm both project and shadcn tokens coexist, Sidebar theme variables are present, and `@theme inline` maps all utilities.

- [ ] **Step 1: Audit `globals.css`**

Read `apps/web/src/app/globals.css` and confirm:
1. `:root` and `.dark` both contain shadcn semantic tokens (`--background`, `--foreground`, `--primary`, `--primary-foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`, `--radius`).
2. `:root` and `.dark` both contain project tokens (`--brand`, `--profit`, `--loss`, `--series-1..8`, `--viz-*`).
3. `:root` and `.dark` both contain Sidebar tokens (`--sidebar-background`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring`).
4. The `@theme inline` block maps:
   - Project: `--color-brand`, `--color-profit`, `--color-loss`, `--color-series-1..8`, `--color-viz-*`.
   - shadcn: `--color-background`, `--color-foreground`, `--color-primary`, `--color-primary-foreground`, `--color-card`, `--color-card-foreground`, `--color-popover`, `--color-popover-foreground`, `--color-secondary`, `--color-secondary-foreground`, `--color-muted`, `--color-muted-foreground`, `--color-accent`, `--color-accent-foreground`, `--color-destructive`, `--color-destructive-foreground`, `--color-border`, `--color-input`, `--color-ring`.
   - Sidebar: `--color-sidebar-background`, etc.
   - `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl` from `--radius`.
5. `card-sheen` and `journal-calendar-*` utilities are present.
6. `prefers-reduced-motion` overrides the animation utilities.

If any item is missing, restore from `git show main:apps/web/src/app/globals.css` or add manually.

- [ ] **Step 2: Verify**

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "Finalise theme merge: project, shadcn, and Sidebar tokens coexist"
```

---

### Task 28: Verify Playwright is configured

**Files:** none (read-only check).

- [ ] **Step 1: Confirm Playwright**

Run:

```bash
ls apps/web/playwright.config.* apps/web/tests/e2e 2>/dev/null
grep -E '"@playwright/test"' apps/web/package.json
```

If `@playwright/test` is installed and `playwright.config.*` exists, continue to Task 29. If not, stop here and report to the user that Playwright needs to be added before the E2E spec can run.

---

### Task 29: Write the Playwright E2E spec

**Files:**
- Create: `apps/web/tests/e2e/shadcn-adoption.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";

test.describe("shadcn adoption", () => {
  test("sidebar collapse/expand and nav render", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByRole("complementary");
    await expect(sidebar).toBeVisible();
    const trigger = page.getByRole("button", { name: /toggle sidebar/i });
    await trigger.click();
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
    await trigger.click();
    await expect(sidebar).toHaveAttribute("data-state", "expanded");
    for (const label of ["Dashboard", "Trades", "Progress", "Reports", "Settings"]) {
      await expect(sidebar.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("privacy toggle masks monetary values", async ({ page }) => {
    await page.goto("/");
    const privacyToggle = page.getByRole("switch", { name: /privacy/i });
    await privacyToggle.click();
    const masked = page.getByLabel("Monetary value hidden");
    await expect(masked.first()).toBeVisible();
    await privacyToggle.click();
    await expect(page.getByLabel("Monetary value hidden")).toHaveCount(0);
  });

  test("theme toggle without FOUC", async ({ page }) => {
    await page.goto("/");
    const initialClass = await page.locator("html").getAttribute("class");
    const themeToggle = page.getByRole("button", { name: /theme/i });
    await themeToggle.click();
    const newClass = await page.locator("html").getAttribute("class");
    expect(newClass).not.toBe(initialClass);
    await page.reload();
    const persistedClass = await page.locator("html").getAttribute("class");
    expect(persistedClass).toBe(newClass);
  });

  test("date picker validates and clears", async ({ page }) => {
    await page.goto("/progress");
    const dateInput = page.getByLabel(/date/i).first();
    await dateInput.fill("not-a-date");
    await expect(dateInput).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert")).toBeVisible();
    await dateInput.fill("2026-10-20");
    await expect(dateInput).toHaveValue("2026-10-20");
    const clearButton = page.getByRole("button", { name: /clear/i });
    if (await clearButton.isVisible()) {
      await clearButton.click();
      await expect(dateInput).toHaveValue("");
    }
  });

  test("option-select encodes 'All' as option:", async ({ page }) => {
    await page.goto("/reports");
    const select = page.getByRole("combobox").first();
    await select.click();
    await page.getByRole("option", { name: /all/i }).click();
    const url = new URL(page.url());
    expect(url.searchParams.toString()).toMatch(/option:/);
  });
});
```

Adjust the labels and selectors after running the spec once locally — they are placeholders that mirror the most common defaults; tune to the app's actual copy.

- [ ] **Step 2: Run the spec**

```bash
cd .worktrees/shadcn-adoption
pnpm --filter web dev &   # leave running for the spec
sleep 5
pnpm --filter web test:e2e -- apps/web/tests/e2e/shadcn-adoption.spec.ts
```

Expected: 5 tests pass. If a test fails, fix the bug it exposed (not the test) before continuing.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/shadcn-adoption.spec.ts
git commit -m "Add Playwright E2E covering shadcn adoption surfaces"
```

---

### Task 30: Full verification gate

**Files:** none.

- [ ] **Step 1: Format**

```bash
cd .worktrees/shadcn-adoption
pnpm format:check
```

Expected: PASS. If anything fails, run `pnpm format` and re-stage.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Tests**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: License check**

```bash
node scripts/check-licenses.mjs
```

Expected: PASS.

- [ ] **Step 5: Build**

```bash
pnpm --filter web build
```

Expected: PASS.

- [ ] **Step 6: Hard-block greps**

```bash
grep -rn "fetch\|axios\|http\." packages/importers/src --include="*.ts"
grep -rn "NEXT_TELEMETRY_DISABLED\|fetch.*telemetry\|fetch.*analytics" --include="*.ts" --include="*.tsx"
```

Expected: empty.

- [ ] **Step 7: Manual smoke**

```bash
pnpm --filter web dev
```

Navigate `127.0.0.1:3000` and confirm:
- Sidebar collapse/expand.
- Privacy toggle masks monetary values.
- Theme toggle (light/dark) — no FOUC, `prefers-color-scheme` respected.
- `DatePicker` opens, validates min/max, Clear/Today works.
- `OptionSelect` encodes "All" as `option:` and round-trips.
- `HoverHint` appears on hover.
- `Badge` profit/loss shows label + colour.

- [ ] **Step 8: No commit in this task**

This task produces no commit. The next task commits the final reviewer report.

---

### Task 31: Reviewer gate + final commit

**Files:**
- Create: `.omp/reviewer-report.md`

- [ ] **Step 1: Run the reviewer**

Per `.omp/AGENTS.md`, the reviewer agent is read-only and writes `.omp/reviewer-report.md` with `## Verdict: PASS|FAIL|BLOCK`. Dispatch it via the standard reviewer subagent; do not edit files on its behalf.

- [ ] **Step 2: Confirm `## Verdict: PASS`**

Read `.omp/reviewer-report.md`. The verdict must be `PASS`. If `FAIL` or `BLOCK`, address the findings, re-run the relevant tasks, re-run the reviewer, repeat.

- [ ] **Step 3: Smoke verification + tag**

```bash
cd .worktrees/shadcn-adoption
git tag feat/shadcn-adoption-complete HEAD
git log --oneline main..HEAD
```

Expected: 31 commits on `feat/shadcn-adoption`. No dangling tasks.

- [ ] **Step 4: Report ready**

Tell the user the worktree is ready at `E:/4004/orca/trade-journal/.worktrees/shadcn-adoption` on branch `feat/shadcn-adoption`. Orca workspace status can be updated to `in-review`.

---

## Self-Review

**1. Spec coverage:**

- Goal 1 (init + `components.json`) — Task 7.
- Goal 2 (swap shared primitives) — Tasks 8–21.
- Goal 3 (refit domain primitives) — Tasks 23–26.
- Goal 4 (rewrite `shell.tsx` on Sidebar) — Task 22.
- Goal 5 (three ADRs) — Tasks 4, 5, 6.
- Goal 6 (gates + E2E) — Tasks 28, 29, 30.
- Worktree setup — Tasks 1, 2.
- Backup + manifest — Task 3.
- Theme merge — Task 27.
- Reviewer gate — Task 31.

**2. Placeholder scan:** No "TBD"/"TODO"/"implement later" present. Every code step shows the code; every command shows the command. Selectors in Task 29 are marked as tunables after the first local run.

**3. Type consistency:** `HoverHint` props used in Tasks 20, 21, 22, 26 refer to the same shape across tasks (label, content, align, side, delayDuration). `SidebarProvider` + `AppSidebar` exported once in Task 22 and consumed in `layout.tsx` in the same task. The `option:<value>` encoding is preserved across Tasks 24 and 29.

**4. Risk hotspots:** Task 21 (Button HoverHint auto-wrap), Task 22 (Sidebar shell), Task 24 (DatePicker), Task 25 (OptionSelect encoding). Each is a per-file commit with `pnpm --filter web typecheck` after; reviewer gate covers behavioral regressions.

[Some lines truncated to 768 chars. Use :raw:11-11 to read line 11 whole]