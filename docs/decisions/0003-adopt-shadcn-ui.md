# 0003 — Adopt shadcn/ui

- Status: Accepted
- Date: 2026-10-20
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
