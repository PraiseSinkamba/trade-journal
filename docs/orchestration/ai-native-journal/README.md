# AI-native journal — Orca ADE execution contract

This package prepares OMP implementation of the existing architecture modernization. Codex has performed documentation preparation only. No feature code, implementation branch, Orca Run, Task, Dispatch or worktree is created by this package.

## Source of truth

Repository-relative paths work from every worker checkout. The committed architecture design and normative contract review define behavior; the phase guide controls order, boundaries and migration numbering; the detailed plan defines exact interfaces, implementation steps and tests. This package controls OMP ownership, native dispatch, worktree placement and integration bookkeeping under the user's latest request. It does not redesign those contracts.

- [Architecture design](../../superpowers/specs/2026-10-22-ai-native-journal-architecture-design.md)
- [Normative contract review](../../superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md)
- [Detailed implementation plan](../../superpowers/plans/2026-10-22-ai-native-journal-modernization.md)
- [21-phase guide and migration checklist](../../superpowers/plans/2026-10-23-ai-native-journal-phases.md)
- [Earlier prompt sheet](../../superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md), scope reference only: its dirty-document copy bootstrap and phase-agent orchestration are superseded here.

## Outcome and architecture

First deliver no-provider trade-change → transactional event → durable worker → factual observation/evidence (Slice A). Then deliver scoped optional AI → opportunity → controlled engagement → native interaction → durable workflow/knowledge (Slice B). Finish retention, recovery, packaging and contention gates. Preserve existing financial calculations, hashes/keys, annotations, imports, cTrader sync and all three provider categories.

Phase 11 closes the Slice A integrated gate and Phase 21 owns the Tauri packaging subset: the ten Section 18 scenarios are implemented across phases 3 to 10, and Phase 11 records them as one coherent no-provider slice with the targeted financial regression and packaged Node smoke, while the Tauri work was blocked by host-side desktop tooling defects, so the feature phases could proceed without it.

Keep the modular monolith. Core and importers remain pure public packages; private intelligence belongs under apps/web. Trading owns reconstruction and source mutation. Infrastructure owns SQLite repositories, outbox, jobs and fenced effects; knowledge/runtime/experience use typed ports; composition wires adapters. No DB/Next/React/AI SDK leakage into pure contracts. A supervised Node process owns HTTP/worker children; Tauri owns that supervisor. No network work in write transactions, implicit import-started worker, model financial writes or unrestricted SQL/HTTP tools.

## Repository topology and observed drift

Preparation checkout: E:/4004/orca/trade-journal; main at 548656bde1925afa8b1d66322e0fbd805eee60da; initially clean; one Git worktree. Origin is PraiseSinkamba/trade-journal and upstream is LuxAlgo/trade-journal. pnpm workspace modules: packages/core, packages/importers, apps/web and desktop. They share one Git history. No .gitmodules file or mode-160000 gitlinks are tracked; git submodule status encountered a Windows sandbox shell error, so absence is established from the Git index instead. No submodule initialization or superproject pointer update applies.

Broker SDK is a locked external package, not a nested source checkout. cTrader MCP is an existing boundary, not a new worker repository. No task needs external repository edits. If an external change becomes necessary, stop that scope for a separately approved, version-pinned packet; do not assume this repository's docs appear elsewhere.

Compared with the original e45707b baseline, current committed changes are planning/discovery documentation and the default OpenAI model update in ai-settings.ts with its tests. Preserve the newer model behavior. Current DB still has singleton WAL cleanup and bootstrap upgrades without an ordered ledger: T-001/T-002 remain necessary. Historical 220-test evidence is not current full CI proof.

## Navigation

- [Ready-to-paste parent OMP execution prompt](orca-execution-prompt.md): independent native workers, initial T-001 dispatch and nonblocking coordination. This is the execution entry point; its committed revision includes the original handoff.

- [Machine-readable manifest](execution-manifest.json): 21 stable tasks, sources/hashes, dependencies, waves and placement.
- [Dependency graph](dependency-graph.md): critical path and conservative concurrency.
- [Integration plan](integration-plan.md): ownership, quality gates, recovery and approval boundaries.
- [Coordinator briefing](coordinator-handoff.md): future parent OMP responsibilities; not a launch prompt.
- [Git readiness](git-readiness.md): exact start-ref resolution and dispatch preflight.
- [Traceability](traceability.md): all design sections and plan subsets mapped to owners/evidence.
- [Validation report](validation-report.md) and [validator](validate-package.cjs).
- [ADR 0009 — Defer Tauri packaging to release acceptance](../../decisions/0009-defer-tauri-packaging-to-release-acceptance.md)

- [T-001 — Safe connection/transaction seams; separate request errors from Next](tasks/T-001.md)
- [T-002 — Versioned migration runner and legacy baseline](tasks/T-002.md)
- [T-003 — Projection identity, fingerprints and immutable revisions, not wired to routes](tasks/T-003.md)
- [T-004 — Outbox, durable jobs and fenced worker mechanics, exercised in tests only](tasks/T-004.md)
- [T-005 — Transaction-aware reconciliation for manual and generic ingestion](tasks/T-005.md)
- [T-006 — All broker and specialized import paths](tasks/T-006.md)
- [T-007 — Remaining mutation commands and settings-driven rebuilds](tasks/T-007.md)
- [T-008 — Factual observations and explicit cTrader evidence quality](tasks/T-008.md)
- [T-009 — Historical seed/replay and no-provider recovery](tasks/T-009.md)
- [T-010 — Node supervisor, worker bundle and Docker startup](tasks/T-010.md)
- [T-011 — Slice A integrated gate and financial regression](tasks/T-011.md)
- [T-012 — Execution contexts, deterministic capability registry and tool gateway](tasks/T-012.md)
- [T-013 — Background AI policies, reservations and provider adapter integration](tasks/T-013.md)
- [T-014 — Knowledge-source revisions and invalidation](tasks/T-014.md)
- [T-015 — Durable time/condition scheduling](tasks/T-015.md)
- [T-016 — Persistent workflow command/transition engine](tasks/T-016.md)
- [T-017 — Engagement and opportunity coordination](tasks/T-017.md)
- [T-018 — Authenticated interaction/control APIs](tasks/T-018.md)
- [T-019 — Native inbox/control UI and Slice B review](tasks/T-019.md)
- [T-020 — Retention, backup/restore, deletion and operations documentation](tasks/T-020.md)
- [T-021 — Tauri packaging, performance and CI release acceptance](tasks/T-021.md)

## Confirmed, assumed and unresolved

Confirmed: sequential bounded phases, existing architecture/contracts, migration allocation 0001–0007, no-provider first, Orca isolation, worker OMP implementation, local tested merges to feature only. No new runtime dependency is planned.

Execution assumptions: the future OMP host can resolve this repository and has Node/pnpm, git and native SQLite tooling; Orca's repo ID and live handles must be discovered then. Superpowers availability is host-specific; workers read installed practices and report any missing skill with equivalent explicit gates. No machine-local skill path is required for accessing the feature contract.

Pending execution evidence: clean frozen install, current baseline checks, actual Docker and Windows/Tauri sidecar tests, large-volume benchmarks, model capability configuration. These are phase preflight/release gates, not reasons to fabricate success. Missing tooling blocks its affected gate and must be reported. Live broker/provider experiments are not authorized or required merely to establish a baseline.

Approval metadata gap: older plan/review and ADRs still say Proposed/approval pending. Preserve them. The user's workflow selects implementation by another agent and tested local phase merges; this preparation instruction explicitly authorizes no dispatch. The next execution instruction must identify the authorized phase(s). Record that authorization in the Run; do not infer permission to execute all 21 waves from this package or change ADR status without evidence. Routine phase-plan expansion is already part of the agreed workflow; material design changes need an explicit decision.

No unresolved product decision is invented. If fresh source contradicts the contracts, coordinator records the conflict and obtains a decision before changing financial identity, privacy, migration semantics or release thresholds.
