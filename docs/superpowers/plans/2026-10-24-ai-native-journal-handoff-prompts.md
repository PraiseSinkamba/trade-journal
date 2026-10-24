# AI-Native Journal — Copyable Worktree Handoff Prompts

**Date:** 2026-10-24  
**Use:** Run Prompt 00 once, then copy one phase prompt into the implementing agent.
This sheet prepares work; writing it does not launch agents or create worktrees.

[Phase boundaries and schema allocation](2026-10-23-ai-native-journal-phases.md) ·
[Detailed tasks](2026-10-22-ai-native-journal-modernization.md) ·
[Design](../specs/2026-10-22-ai-native-journal-architecture-design.md) ·
[Contract review](../specs/2026-10-22-ai-native-journal-architecture-contract-review.md)

## Shared execution contract — every prompt incorporates this section

### Skills and authorization

Read and invoke `$orca-cli` at
`C:/Users/4004/.agents/skills/orca-cli/SKILL.md`, then load the executable's version-matched
guide. This machine resolved to `orca`; resolve again in each receiving session using the stub.
Use `superpowers:using-git-worktrees` for isolation checks, with Orca as the native creation
mechanism. The user explicitly requests nested feature/phase/task worktrees, so the skill's
default “already isolated, don't create another” does not remove the requested child boundaries.

Invoke `superpowers:writing-plans` to materialize the phase-only plan, then
`superpowers:subagent-driven-development` to execute that plan, including task reviews and
whole-phase review. Invoke `superpowers:finishing-a-development-branch` after verified completion.
Use installed skill versions; on this machine these were read under
`C:/Users/4004/.codex/plugins/cache/openai-curated-remote/superpowers/7.0.1/skills/`.

The user has selected **local merge back to the parent feature branch after testing**.
Do not ask them to choose a finishing menu again. Task branches merge into their phase branch;
phase branches merge into `codex/ai-native-journal`. This selection authorizes those local merges
only, not pushes, PRs, publishing, or merging the overall feature into `main`.
Do not blindly run the finishing skill's example `git pull` or change the original checkout's
branch. Work in the verified destination worktree. Keep Orca worktrees/branches after merging;
cleanup is separate and must use Orca, never forced raw Git worktree removal.

Submitting a phase prompt authorizes that phase's bounded planning, implementation, review and
local merge. Routine plan expansion within the existing design does not require another approval
round. A material financial identity/privacy change or failed release gate must be reported;
do not broaden the assignment to finish it. Finish this phase and stop; do not launch the next.

### Branch topology and durable handoff

```text
recorded starting commit (original checkout stays untouched)
└─ codex/ai-native-journal                  feature integration worktree
   ├─ codex/ai-native-journal-p01            phase worktree
   │  ├─ codex/ai-native-journal-p01-t01     independent task worktree
   │  └─ codex/ai-native-journal-p01-t02     independent task worktree
   ├─ codex/ai-native-journal-p02            created from updated feature HEAD
   └─ ...                                  one worktree per assigned phase
```

Record actual Orca repo/worktree IDs, absolute paths and branches in
`docs/superpowers/reports/ai-native-journal-worktrees.json` on the feature branch.
Do not guess Orca's branch naming from its display name. Inspect the returned checkout branch;
if necessary, rename only that newly created, exclusively owned branch with
`git -C "<returned-path>" branch -m <required-name>`, then verify Git and Orca state.
Never overwrite an existing branch. Resume a matching worktree/ledger rather than duplicating it.

Create with Orca; the following flags were checked against `orca worktree create --help`.
Angle-bracket values are discovered values, not literal commands. Do not create an `ORCA`
shell variable; substitute the executable selected by the skill.

```text
orca worktree create --repo id:<repoId> --name ai-native-journal --base-branch <recorded-start-ref> --no-parent --setup skip --json
orca worktree create --repo id:<repoId> --name ai-native-journal-pNN --base-branch codex/ai-native-journal --parent-worktree id:<feature-full-worktree-id> --setup skip --json
orca worktree create --repo id:<repoId> --name ai-native-journal-pNN-tTT --base-branch codex/ai-native-journal-pNN --parent-worktree id:<phase-full-worktree-id> --setup skip --json
```

Use the full `repoId::worktreePath` returned ID. Lineage and Git base are separate: specify both.
`--setup skip` avoids inherited hooks using live data; inspect setup before running a frozen
install and necessary hooks in the new worktree. Never share writable `node_modules`, native
SQLite binaries, build outputs or databases between workers. A package-manager download store
can be shared. Each worker gets distinct scratch data and ports; do not use live ports 3000/3001.
For an Orca tool denial follow the stub's escalation rule, not a fallback into the main checkout.

These prompts run the receiving controller in the new phase checkout (explicit working
directory for every tool/subagent). Creating a worktree does not move an existing chat's cwd.
Use workdir-aware subagents; if the harness cannot bind them to a checkout, use an Orca-launched
agent with an explicit task brief and supervise it. Do not dispatch multiple writers into the
same checkout. If `--agent` is used, its launch already started an agent; never double-launch.

### Planning requirements and inherited references

Every phase gets its **own SDD plan path**:
`docs/superpowers/plans/ai-native-journal/phase-NN.md`.
These files are created by the receiving phase agent against merged predecessor code; they do
not exist merely because this prompt sheet names them. Do not invoke SDD with the whole
21-phase guide or the whole 13-task plan, which would authorize too much work and share a ledger.

Read, in this order, from the assigned checkout:

1. `AGENTS.md` and any applicable nested instructions.
2. This sheet's shared contract and the assigned phase prompt.
3. `docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-design.md`.
4. `docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md`.
5. `docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md` (phase and migration sections).
6. The assigned task subset of `docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md`.
7. `docs/decisions/0006-transactional-trade-events-and-identity.md`,
   `0007-durable-sqlite-worker-and-migrations.md`, and
   `0008-scoped-intelligence-and-provider-compatibility.md`.
8. Predecessor reports and the relevant actual source/tests listed in the phase prompt.
   For discrepancies consult `docs/architecture-discovery/{ARCHITECTURE_CONTEXT,CODE_NAVIGATION,EVIDENCE_REGISTER}.md`
   and relevant numbered reports; current source governs implemented behavior.

Each phase plan must contain exact files/interfaces, small checkbox tasks, schema ownership,
failing-test/implementation/verification steps, dependency DAG, exclusive file ownership,
merge order, regression commands and its stop condition. Copy binding global constraints.
Identify artifacts that do not exist until an earlier phase; missing prerequisites are a blocked
assignment, not permission to silently implement that earlier phase.
Commit the phase plan before branching task worktrees so every task inherits the same contract.
If a phase plan/SDD ledger already exists, resume it; don't reset completed work.

### Parallel tasks and merge discipline

Phases remain dependency ordered by default. Worktree isolation alone does not make dependent
phases parallel. Speed comes from independent tasks inside the assigned phase. Only run tasks
concurrently when their required contracts are committed and file ownership does not overlap.
Examples appear in each prompt; they are candidates, not proof of independence.

Use one fresh implementer and the skill's prescribed reviewer flow per task. Give each worker
the task brief, exact absolute checkout, plan/spec paths, owned files and test commands.
Tell workers they are not alone, must not revert others' changes, and must stay in their checkout.
Do not run the project-wide suite in subagents; controllers own full-suite gates. Reviewers
review the same task commit range in that task checkout; they do not become additional writers.

One controller owns migration registry, `schema.ts`, baseline snapshot, lockfile, common contract
files and composition edits within a phase. Preallocate migration numbers from the phase guide;
do not let parallel workers choose the same version or edit a historical migration.
Land shared contracts/schema prerequisites first; branch dependent tasks from that updated phase
HEAD. Keep task-specific SDD artifacts scoped to the phase's ledger; don't launch competing
whole-phase SDD controllers.

Serialize task merges into the phase worktree and phase merges into the feature worktree.
Before merge check clean worktrees, recorded branch identities, parent ancestry, completed reviews
and tests. Incorporate the latest destination HEAD into the source branch without rewriting
shared history, resolve conflicts there, review resolutions and rerun affected tests.
Only one integrator may mutate the feature checkout at a time; reserve this in a coordination
record/lock and recheck the destination SHA before merging. If it moved, resync and retest.
A merge conflict or failing merged result is not phase completion.

Prefer `git -C "<destination>" merge --no-ff "<source-branch>"` after verifying the exact
destination; no raw worktree creation/removal. Do not run concurrent git merges/checkouts in
one worktree. A target checked out elsewhere must be integrated in that actual checkout.
Run the finishing skill's full suite on the phase candidate and merged feature result, plus
phase-required migration/typecheck/build/native checks. Existing passing evidence on identical
code may serve where the skill permits; changed merge results require verification.
Do not claim a required Docker/Tauri gate passed if tooling is unavailable; retain the phase
branch and report the blocked gate rather than marking it completed/merged.

Commit `docs/superpowers/reports/ai-native-journal-phase-NN.md` on the phase before merging:
scope, task commits, migrations/indexes, commands/results, reviews, deviations and next inputs.
After merge, record source tip, destination-before SHA, merge SHA and post-merge checks in
`docs/superpowers/reports/ai-native-journal-integration-NN.md` on the feature branch.
The manifest/integration log is written only by the integrator. Skill scratch cleanup must not
remove persistent plans/reports or Orca worktrees. Final response identifies feature/phase IDs,
paths, branch/merge SHAs, tests and remaining risks. Then stop.

## Prompt 00 — Bootstrap the feature integration worktree

```text
Prepare the AI-native journal feature worktree only; do not implement Phase 01 yet.

Use $orca-cli from C:/Users/4004/.agents/skills/orca-cli/SKILL.md and load its
version-matched guide. Read the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Use superpowers:using-git-worktrees with Orca as the native worktree manager.

Source checkout: E:/4004/orca/trade-journal.
Inspect its branch/HEAD/status and Orca repo/worktree list. Record this starting
commit as the feature's upstream baseline; do not assume a later main or remote.
Create an Orca feature worktree from that ref and verify its branch is
codex/ai-native-journal. Reuse an existing matching feature worktree if present;
never reset or overwrite it. Keep the original checkout and its dirty files intact.

The planning documents were uncommitted when this sheet was prepared. They will
not appear in a new worktree automatically. Copy ONLY this feature's documentation
from the source checkout into the new feature worktree, inspect and commit it there:
- docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-design.md
- docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md
- docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md
- docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md
- docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
- docs/decisions/0006-transactional-trade-events-and-identity.md
- docs/decisions/0007-durable-sqlite-worker-and-migrations.md
- docs/decisions/0008-scoped-intelligence-and-provider-compatibility.md
- docs/architecture-discovery/ reference documents, including current uncommitted
  context/navigation/evidence and report updates.

Compare each destination before copying; never overwrite newer feature edits.
Do not stage source-checkout files, .omp reports, unrelated changes, databases,
credentials, build output or dependency folders. Do not use git add . or stash all.
Read AGENTS.md and the linked design, review, task plan, phase guide and ADRs.

Create docs/superpowers/reports/ai-native-journal-worktrees.json with actual
Orca repo/full feature worktree IDs, absolute paths, branch, upstream source SHA
and documentation manifest. Set up dependencies with frozen lockfile after
inspecting hooks; use scratch JOURNAL_DATA_DIR. Verify docs links/formatting and
baseline tests; report failures honestly without unrelated production fixes.

Commit only the documentation/bootstrap manifest on the feature branch.
Report the feature worktree ID/path, branch, source and docs commit SHAs.
Stop and leave it ready for a separate Phase 01 prompt. Do not merge to main or push.
All later phase prompts use superpowers:subagent-driven-development and finish
by merging their verified phase branch into this feature branch locally.
```

## Phase prompt index

All phase prompts require a phase-only plan. “Expand” means extract precise tasks from the
existing design, not reopen product brainstorming. More complex phases explicitly require
concurrency/lifecycle/security planning before implementation.

- [Phase 01 — Safe database seams](#prompt-01)
- [Phase 02 — Versioned migration foundation](#prompt-02)
- [Phase 03 — Trade projection identity](#prompt-03)
- [Phase 04 — Durable jobs and outbox](#prompt-04)
- [Phase 05 — Manual and generic reconciliation](#prompt-05)
- [Phase 06 — Broker and specialized import integration](#prompt-06)
- [Phase 07 — Remaining financial mutations](#prompt-07)
- [Phase 08 — Persistent factual observations](#prompt-08)
- [Phase 09 — Historical backfill and recovery](#prompt-09)
- [Phase 10 — Node supervisor and Docker](#prompt-10)
- [Phase 11 — Tauri integration and Slice A](#prompt-11)
- [Phase 12 — Scoped capability and tool gateway](#prompt-12)
- [Phase 13 — Background AI policy and adapters](#prompt-13)
- [Phase 14 — Knowledge sources and invalidation](#prompt-14)
- [Phase 15 — Durable scheduler](#prompt-15)
- [Phase 16 — Persistent workflow engine](#prompt-16)
- [Phase 17 — Engagement coordination](#prompt-17)
- [Phase 18 — Interaction and control APIs](#prompt-18)
- [Phase 19 — Native interaction UI and Slice B](#prompt-19)
- [Phase 20 — Retention backup and operations](#prompt-20)
- [Phase 21 — Performance and release acceptance](#prompt-21)

<a id="prompt-01"></a>

## Prompt 01 — Safe database seams

```text
Implement Phase 01 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Prompt 00 completed; feature docs and manifest committed.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p01, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-01.md
Planning required: Expand the existing task into small connection lifecycle, synchronous transaction, error-boundary and import-guard tasks; no architecture redesign.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 01)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 1)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/db/{index,bootstrap,schema}.ts; apps/web/src/server/{api,executions,request-error}.ts; apps/web/tests/{execution-storage,ai-scope}.test.ts

Allowed scope: Safe database seams; Task 1.
Schema work: None.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: After connection/error exports are settled, import-graph guards and lifecycle tests may run in separate task worktrees.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Connection close preserves other connections; async callbacks rejected; rollback and scope regressions pass.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-01.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 02.
```

<a id="prompt-02"></a>

## Prompt 02 — Versioned migration foundation

```text
Implement Phase 02 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 01 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p02, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-02.md
Planning required: Write a detailed migration-runner plan first: frozen baseline, immutable source checksums, history validation, synchronous application, manifest generation, legacy parity and failure recovery.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 02)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 2 runner only; phase guide's mandatory migration section)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/db/{bootstrap,schema,connection,transaction}.ts; apps/web/tests/db-concurrent-init.test.ts; docs/decisions/0007-durable-sqlite-worker-and-migrations.md

Allowed scope: Versioned migration foundation; Task 2 runner only; phase guide's mandatory migration section.
Schema work: 0001-legacy-baseline.ts + journal_migrations ledger.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: One owner for registry/schema/checksum changes; documentation can run independently after the migration contract is fixed.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Fresh/current/legacy/concurrent startup, tampered or future history rejection, rollback and checksum build stability pass; no intelligence tables yet.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-02.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 03.
```

<a id="prompt-03"></a>

## Prompt 03 — Trade projection identity

```text
Implement Phase 03 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 02 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p03, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-03.md
Planning required: Plan canonical fingerprints, exact-key identity, explicit transfer proof, tombstones and revision membership separately before coding.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 03)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 3 + projection part of Task 2)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/rebuild.ts; packages/core/src/{round-trips,types}.ts; apps/web/src/server/ids.ts; docs/decisions/0006-transactional-trade-events-and-identity.md

Allowed scope: Trade projection identity; Task 3 + projection part of Task 2.
Schema work: 0002-trade-projections.ts.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Pure canonicalization and identity fixtures can split after types are committed; only one schema/migration owner.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Annotation-only changes do not revise facts; reappearance gets new identity; crossing-flat overlap cannot imply continuity; core keys unchanged.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-03.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 04.
```

<a id="prompt-04"></a>

## Prompt 04 — Durable jobs and outbox

```text
Implement Phase 04 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 03 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p04, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-04.md
Planning required: Write a detailed concurrency plan with claim SQL, lease/fence semantics, completion transaction, cancellation and crash boundaries.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 04)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 4 + transport part of Task 2)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/domain-events.ts; apps/web/src/db/{connection,transaction,migrations}.ts; docs/decisions/0007-durable-sqlite-worker-and-migrations.md

Allowed scope: Durable jobs and outbox; Task 4 + transport part of Task 2.
Schema work: 0003-durable-jobs.ts.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Outbox and job adapters may split only after common schemas/claim contracts land; worker integration is dependent.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Two-connection claims, duplicate fanout, expired leases, stale-owner rejection and rollback pass; production worker remains disabled.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-04.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 05.
```

<a id="prompt-05"></a>

## Prompt 05 — Manual and generic reconciliation

```text
Implement Phase 05 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 04 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p05, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-05.md
Planning required: Extract only manual/generic ingestion integration; plan every transaction-taking call and unchanged public adapter before coding.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 05)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 5 manual/generic subset)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/{executions,rebuild,position-import,settings}.ts; apps/web/src/app/api/{executions,import}/route.ts; apps/web/src/server/trading/

Allowed scope: Manual and generic reconciliation; Task 5 manual/generic subset.
Schema work: None.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Keep shared ingestion/rebuild ownership serial; independent test fixtures may run separately.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Fills, projections, events and notes roll back together; identical retries are silent; production event capture stays off.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-05.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 06.
```

<a id="prompt-06"></a>

## Prompt 06 — Broker and specialized import integration

```text
Implement Phase 06 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 05 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p06, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-06.md
Planning required: Plan each adapter as a distinct task against the merged reconciliation interfaces; preserve source-specific validation and counts.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 06)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 5 SDK/cTrader/NinjaTrader/XTB/IBKR/demo subset)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/{sync,ninjatrader-import,xtb-import,ibkr-flex-xml-import,demo}.ts; apps/web/src/server/ctrader-mcp/; docs/decisions/{0001-broker-connectivity-via-broker-sdk,0002-ctrader-mcp-via-direct-mcp-client}.md

Allowed scope: Broker and specialized import integration; Task 5 SDK/cTrader/NinjaTrader/XTB/IBKR/demo subset.
Schema work: None.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: SDK/IBKR, cTrader, and NinjaTrader adapters can use independent worktrees with exclusive files; one controller owns shared import route edits.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: All existing broker/import suites pass; fetch outside write transactions; snapshots/batches/events atomic; cTrader and hosted AI import behavior preserved.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-06.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 07.
```

<a id="prompt-07"></a>

## Prompt 07 — Remaining financial mutations

```text
Implement Phase 07 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 06 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p07, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-07.md
Planning required: Plan separate single/bulk deletion, account clear/delete/transfer and settings rebuild tasks; map all mutation paths.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 07)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 5 delete/account/settings subset)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/app/api/trades/{[key],bulk}/route.ts; apps/web/src/app/api/accounts/[id]/{route.ts,actions/route.ts}; apps/web/src/app/api/settings/route.ts; apps/web/src/server/trading/commands.ts

Allowed scope: Remaining financial mutations; Task 5 delete/account/settings subset.
Schema work: None.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Route families can split after command interfaces land; one owner for shared commands and purge implementation.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Transfer and annotations atomic; ambiguous mapping rejected; removals/purge safe; complete mutation matrix and settings rollback pass.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-07.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 08.
```

<a id="prompt-08"></a>

## Prompt 08 — Persistent factual observations

```text
Implement Phase 08 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 07 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p08, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-08.md
Planning required: Plan pure evaluator, evidence quality enrichment, fenced persistence and invalidation separately; specify how quality reaches reconciliation before fingerprinting.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 08)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 6 + observation part of Task 2)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/intelligence/{contracts,composition.ts}; apps/web/src/server/ctrader-mcp/{deals,sync}.ts; apps/web/src/server/trading/projection.ts

Allowed scope: Persistent factual observations; Task 6 + observation part of Task 2.
Schema work: 0004-observations.ts including seed checkpoints.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Pure evaluator and cTrader quality adapter may split after shared evidence contracts are fixed; persistence owns schema.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Duplicate/reordered events never create duplicate current truth; unknown/reconstructed timing is not reliable duration; financial/hash fixtures unchanged.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-08.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 09.
```

<a id="prompt-09"></a>

## Prompt 09 — Historical backfill and recovery

```text
Implement Phase 09 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 08 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p09, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-09.md
Planning required: Expand restartable baseline/replay tests and process-kill fixtures; distinguish explicit reset suppression from incomplete seed.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 09)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 7)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/intelligence/infrastructure/{jobs,knowledge-store,backfill}.ts; apps/web/src/server/intelligence/composition.ts; apps/web/tests/intelligence-observations.test.ts

Allowed scope: Historical backfill and recovery; Task 7.
Schema work: None; uses 0004 checkpoints.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Replay and seed tests can split after checkpoint/handler interfaces land.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: No-provider vertical slice survives reopen and interrupted processing; seed is historical; late events and replay cannot revive removed evidence.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-09.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 10.
```

<a id="prompt-10"></a>

## Prompt 10 — Node supervisor and Docker

```text
Implement Phase 10 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 09 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p10, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-10.md
Planning required: Detailed lifecycle/build plan required: IPC parent death, HTTP readiness, worker restart caps, shutdown and independent bundle assets.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 10)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 8 excluding Tauri/Rust)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/package.json; apps/web/scripts/copy-static-build.js; apps/web/next.config.ts; Dockerfile; apps/web/src/server/intelligence/{composition,worker-entry}.ts

Allowed scope: Node supervisor and Docker; Task 8 excluding Tauri/Rust.
Schema work: None.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Supervisor lifecycle and bundling/Docker work can split with an agreed artifact/IPC contract; shared package scripts have one owner.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Standalone clean-directory and Docker scratch-volume startup, crash, shutdown and dependency tracing pass; no route/build worker startup.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-10.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 11.
```

<a id="prompt-11"></a>

## Prompt 11 — Tauri integration and Slice A

```text
Implement Phase 11 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 10 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p11, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-11.md
Planning required: Detailed Windows process ownership, nonzero-port retry, sidecar ABI and installed-artifact test plan required.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 11)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 8 Tauri subset + Slice A gate)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
desktop/src-tauri/src/{server,lib}.rs; desktop/src-tauri/tauri.conf.json; desktop/package.json; desktop/README.md; apps/web/scripts/{run-journal,http-child}.mjs

Allowed scope: Tauri integration and Slice A; Task 8 Tauri subset + Slice A gate.
Schema work: None.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Rust lifecycle and packaging smoke fixtures can split once IPC/artifact contract is stable; do not duplicate native builds concurrently.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Actual packaged sidecar restart/quit/collision tests pass without orphans; no-provider Slice A and full financial regression pass.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-11.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 12.
```

<a id="prompt-12"></a>

## Prompt 12 — Scoped capability and tool gateway

```text
Implement Phase 12 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 11 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p12, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-12.md
Planning required: Plan pure contracts and adapter interfaces first, then registry, scope checks and SDK exposure; no background provider policy yet.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 12)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 9 contexts/registry/gateway only)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/{ai,ai-scope,ai-capabilities,ai-report-context,ai-contracts}.ts; apps/web/src/server/intelligence/contracts/; docs/decisions/0008-scoped-intelligence-and-provider-compatibility.md

Allowed scope: Scoped capability and tool gateway; Task 9 contexts/registry/gateway only.
Schema work: None.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Registry and tool gateway can split after shared context/types land; no duplicated edits to ai.ts.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Unknown fields, denied tools, out-of-scope keys, budget/cancellation and invalid outputs rejected; legacy 3+1 tools and AI JSON contracts preserved.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-12.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 13.
```

<a id="prompt-13"></a>

## Prompt 13 — Background AI policy and adapters

```text
Implement Phase 13 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 12 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p13, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-13.md
Planning required: Detailed reservation, provider pinning, configuration change and cancellable adapter plan required; preserve existing interactive policies.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 13)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Remainder of Task 9)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/{ai-runtime,ai-contracts,settings,ai-import}.ts; apps/web/src/app/api/settings/route.ts; apps/web/src/components/ai-settings.tsx; apps/web/src/server/intelligence/runtime/

Allowed scope: Background AI policy and adapters; Remainder of Task 9.
Schema work: 0005-intelligence-runtime.ts.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Policy storage and runtime cancellation adapter may split after interfaces land; settings route/UI remain under one task owner.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Opt-in, daily reservation, keyless compatible, URL/model change, timeout and no silent fallback tests pass; hosted-only import compatibility retained.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-13.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 14.
```

<a id="prompt-14"></a>

## Prompt 14 — Knowledge sources and invalidation

```text
Implement Phase 14 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 13 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p14, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-14.md
Planning required: Plan source revision contracts and exact write-path matrix, then knowledge invalidation; create schedule schema but not scheduler behavior.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 14)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 10 source/knowledge subset)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/app/api/{journal,playbooks,notes,folders}/; apps/web/src/app/api/trades/{[key],bulk}/; apps/web/src/server/domain-events.ts; apps/web/src/server/intelligence/knowledge/

Allowed scope: Knowledge sources and invalidation; Task 10 source/knowledge subset.
Schema work: 0006-knowledge-scheduling.ts.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Source route families can split after union/store contracts land; one domain-event/schema owner.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Source correction/deletion and visibility changes invalidate dependent knowledge; no financial overwrite; schema upgrade parity passes.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-14.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 15.
```

<a id="prompt-15"></a>

## Prompt 15 — Durable scheduler

```text
Implement Phase 15 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 14 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p15, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-15.md
Planning required: Extract concrete scheduler plan from merged schema: deterministic ticks, event checkpoints, DST and missed-interval coalescing.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 15)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 10 scheduler subset)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/intelligence/infrastructure/{scheduler,jobs,outbox}.ts; apps/web/src/server/intelligence/composition.ts; packages/core/src/time.ts

Allowed scope: Durable scheduler; Task 10 scheduler subset.
Schema work: None; uses 0006 schedules.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Time-trigger and condition-trigger fixtures may split against a fixed schedule API; one scheduler implementation owner.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Duplicate ticks, restart, DST gap/fold, condition replay and offline catch-up pass; scheduling invokes no LLM.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-15.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 16.
```

<a id="prompt-16"></a>

## Prompt 16 — Persistent workflow engine

```text
Implement Phase 16 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 15 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p16, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-16.md
Planning required: Detailed command digest/CAS, transition history and transactional effect scheduling plan required; no engagement implementation yet.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 16)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 11 workflows only)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/intelligence/contracts/experience.ts; apps/web/src/server/intelligence/experience/workflows.ts; apps/web/src/server/intelligence/infrastructure/{experience-store,jobs}.ts

Allowed scope: Persistent workflow engine; Task 11 workflows only.
Schema work: 0007-intelligence-experience.ts.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Pure transition reducer and repository tests can split after workflow state contracts land; schema/command store has one owner.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Stale and duplicate commands, differing payload reuse, crash-before-effect and waiting-without-job tests pass.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-16.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 17.
```

<a id="prompt-17"></a>

## Prompt 17 — Engagement coordination

```text
Implement Phase 17 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 16 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p17, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-17.md
Planning required: Extract policy and reservation tasks with exact cooldown, expiry, opt-in and dedup defaults from the review.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 17)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 11 engagement only)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/intelligence/experience/{engagement,interactions,workflows}.ts; apps/web/src/server/intelligence/infrastructure/experience-store.ts; apps/web/src/server/intelligence/contracts/experience.ts

Allowed scope: Engagement coordination; Task 11 engagement only.
Schema work: None; uses 0007 opportunities.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Pure policy and persistence tests may split after inputs/decisions are fixed.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Dismissal, expiry, overlap, cooldown and delivery reservation tests pass; unknown trading activity cannot justify proactive interruption.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-17.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 18.
```

<a id="prompt-18"></a>

## Prompt 18 — Interaction and control APIs

```text
Implement Phase 18 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 17 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p18, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-18.md
Planning required: Plan route contracts, current authorization, origin policy, stale command and purge-race coverage; no UI tasks.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 18)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 12 backend only)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/{api,auth,request-origin}.ts; apps/web/src/app/api/intelligence/; apps/web/src/server/intelligence/{composition.ts,experience,contracts}; apps/web/src/lib/intelligence-interactions.ts

Allowed scope: Interaction and control APIs; Task 12 backend only.
Schema work: None.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Read endpoints and command endpoints may split after common DTO/auth helpers land; one owner for shared composition and origin policy.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Auth/origin/scope, correction, deleted account during AI, stale/duplicate action and sanitized error tests pass.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-18.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 19.
```

<a id="prompt-19"></a>

## Prompt 19 — Native interaction UI and Slice B

```text
Implement Phase 19 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 18 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p19, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-19.md
Planning required: Write bounded component/data-flow plan using verified API contracts and current native primitives; preserve existing AI screens.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 19)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 12 UI + Slice B gate)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/components/{shell.tsx,ui,intelligence}; apps/web/src/app/settings/page.tsx; apps/web/src/lib/{intelligence-interactions,use-api,use-ai-request}.ts; docs/decisions/0003-adopt-shadcn-ui.md

Allowed scope: Native interaction UI and Slice B; Task 12 UI + Slice B gate.
Schema work: None.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Inbox and settings controls can split with distinct files; one integration owner for shell/settings page and end-to-end flow.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Keyboard/privacy/loading/error tests and restart-to-workflow-continuation pass; optional/no-provider Slice B, full tests and typecheck pass.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-19.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 20.
```

<a id="prompt-20"></a>

## Prompt 20 — Retention backup and operations

```text
Implement Phase 20 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 19 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p20, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-20.md
Planning required: Detailed retention/reference graph, cancellation fencing, quiescent backup/restore and reset-suppression plan required.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 20)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Task 13 storage/operations subset)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
apps/web/src/server/intelligence/infrastructure/{retention,knowledge-store,experience-store,jobs}.ts; apps/web/src/server/trading/commands.ts; docs/database-migrations.md; docs/intelligence-operations.md

Allowed scope: Retention backup and operations; Task 13 storage/operations subset.
Schema work: No new schema expected; any needed change gets a new forward migration.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Backup tooling/docs and retention logic may split after deletion/backup contracts land; never share a database fixture.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Reference-safe prune, dedup preservation, purge/leased completion race and synthetic credential restore pass; no automatic destructive downgrade.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-20.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 21.
```

<a id="prompt-21"></a>

## Prompt 21 — Performance and release acceptance

```text
Implement Phase 21 only, using Orca worktrees and Superpowers subagent development.

Read and follow the shared execution contract in:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md
Invoke $orca-cli, superpowers:using-git-worktrees, superpowers:writing-plans,
superpowers:subagent-driven-development, and finally
superpowers:finishing-a-development-branch.

Prerequisite: Phase 20 integrated and verified on codex/ai-native-journal; read its phase and integration reports.
Discover the feature checkout from docs/superpowers/reports/ai-native-journal-worktrees.json.
Create/reuse a distinct Orca child worktree from its current verified HEAD:
branch codex/ai-native-journal-p21, parent the feature's full Orca worktree ID.
All implementation tools and workers must use that child checkout, not the original
checkout. Follow the shared contract's task-worktree and serialized-merge rules.

Target phase plan: docs/superpowers/plans/ai-native-journal/phase-21.md
Planning required: Plan reproducible scratch workloads, artifact matrix and gates; this is verification/hardening, not deferred feature implementation.
Create and commit this phase-only plan before SDD; if already present, validate it
against current source and resume its ledger. Do not feed SDD the entire umbrella plan.

Read all common references listed in the shared contract, especially:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md (Phase 21)
docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md (Remainder of Task 13)
Phase-specific source/reference paths (braces abbreviate explicit path alternatives;
these are NOT PowerShell commands; future modules exist only after predecessors):
.github/workflows/{ci,release}.yml; scripts/{benchmark-intelligence.mjs,verify-features.py}; Dockerfile; desktop/README.md; docs/intelligence-operations.md; all phase reports

Allowed scope: Performance and release acceptance; Remainder of Task 13.
Schema work: None unless an independently reviewed forward repair is necessary.
For schema work obey the phase guide's immutable migrations, checksums, typed-schema
parity, fresh/legacy upgrade and rollback checklist; one registry/schema owner.
Do not implement another phase's remaining task steps.

Parallelism candidate: Read-only artifact audit, benchmarks and target-specific smoke may run separately with isolated builds/data/ports; feature integration remains serialized.
Use fresh implementer/reviewer subagents per task. Independent writers get separate
Orca child task worktrees based on the phase branch and exclusive file ownership.
Merge reviewed/tested tasks into this phase branch in dependency order, then perform
whole-phase review and required verification.
Phase acceptance: Full CI, actual Docker/Windows smoke, 1k/10k/100k benchmark and package-content checks pass; p95 threshold and no lost effects proven.
Use disposable data, preserve existing financial/AI contracts, and run the detailed
task's targeted checks plus the finishing skill's full-suite gate.

Write and commit docs/superpowers/reports/ai-native-journal-phase-21.md.
The user has selected finishing option 1: merge locally to codex/ai-native-journal
after passing reviews/tests. No repeated merge-choice question is needed.
Synchronize with current feature HEAD, review conflicts, retest, serialize the merge
in the actual feature checkout, verify the merged result and record the integration
report per the shared contract. No push or merge to main; retain Orca worktrees.
If a required gate fails, preserve the branch and report it instead of marking done.
Report worktree IDs/paths, source and merge SHAs, tests/schema changes and stop.
Do not start Phase 22 or merge the overall feature into main.
```
