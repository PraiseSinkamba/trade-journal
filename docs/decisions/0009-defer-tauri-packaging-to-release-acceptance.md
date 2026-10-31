# 0009 — Defer Tauri packaging to release acceptance

- Status: Accepted
- Date: 2026-10-31
- Deciders: Maintainer instruction of 2026-10-31 to defer the Tauri desktop packaging subset from Phase 11 to Phase 21 and focus on feature phases

## Context

The vertical slice required before general AI execution was already delivered and covered by phases
3 to 10. Phase 11's only new implementation would have been the Tauri desktop packaging and sidecar
lifecycle work; the Slice A integrated gate is new recorded gate evidence built on scenarios already
implemented across phases 3 to 10.

That work was blocked by host-side desktop tooling defects and Docker daemon availability, and it
blocked no feature phase. The maintainer asked to defer it and focus on actual features.

The native task dependency chain cannot be rewired, so Phase 11 had to complete before Phase 12
could start.

## Decision

Phase 11 delivers the Slice A integrated gate only: the ten Section 18 scenarios as one coherent
no-provider slice, targeted financial regression and full test suite, packaged Node smoke and
recorded measured results.

The Tauri desktop packaging and lifecycle subset moves to Phase 21, which already owns complete
packaging and CI release acceptance including the Windows smoke. The Tauri lifecycle and ABI evidence
requirement is not dropped; it is required at the final gate, produced by Phase 21.

No dependency edge, wave boundary, schema allocation or gate threshold changed.

## Consequences

- Positive: feature phases are no longer blocked by host-side desktop tooling, and the Slice A gate
  can be evidenced from already-merged work.
- Negative: Phase 21 is larger, and the desktop packaging defects (the sidecar setup script using
  CommonJS calls in an ESM package, and the icon generator emitting an invalid ICO) are fixed there
  rather than now.
- Forbidden: starting general AI execution without the recorded Slice A gate evidence, treating the
  blocked Docker scratch-volume smoke as passed, and widening Phase 11 back into desktop work.

This ADR does not supersede ADR 0008.
