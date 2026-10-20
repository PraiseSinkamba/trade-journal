# 0004 — Pin tw-animate-css as the animation utility

- Status: Accepted
- Date: 2026-10-20
- Deciders: Chris Naudé (via brainstorming on 2026-10-20)

## Context

`tw-animate-css` is the Tailwind v4 animation utility already used by the shadcn/ui registry default. The existing codebase carries no explicit animation dependency; shadcn components that animate (dialog, dropdown-menu, tooltip, sidebar) implicitly depend on this package through the registry. ADR 0003 adopts shadcn/ui as the shared primitive source, which pulls `tw-animate-css` into the dependency tree automatically. ADR 0005 formalises the Radix primitives list; this ADR completes the third dep-category gate by pinning the animation utility explicitly before any installation.

The alternative — letting the animation library float or switching to the legacy `tailwindcss-animate` — would introduce drift: `tailwindcss-animate` targets Tailwind v3 class-generation semantics and is incompatible with Tailwind v4's `@theme inline` token model. No other animation library is under consideration.

## Decision

Pin `tw-animate-css` as the only animation and transition source under Tailwind v4. All shadcn components and any future local animation utilities MUST use `tw-animate-css` keyframes and utility classes. `tailwindcss-animate` MUST NOT be reintroduced. The `prefers-reduced-motion` override in `globals.css` continues to apply; any new animation added to the project MUST document its reduced-motion fallbacks.

The ADR is enforced by the hard-block gate in `.omp/AGENTS.md`: no new dependency lands without a corresponding decision record.

## Consequences

- Positive: future `pnpm dlx shadcn@latest add` works without animation conflicts; the Tailwind v4 token model is respected end-to-end; no behavioural change to existing UI — animations are already running via this package today.
- Negative: developers who add raw `@keyframes` or third-party animation libraries without an ADR will be out-of-band and should be redirected to this decision.
- Forbidden: `tailwindcss-animate` MUST NOT be added to `package.json` or imported anywhere in the project.
