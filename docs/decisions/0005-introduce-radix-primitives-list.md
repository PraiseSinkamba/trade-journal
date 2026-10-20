# 0005 — Introduce Radix primitives list

- Status: Accepted
- Date: 2026-10-20
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
