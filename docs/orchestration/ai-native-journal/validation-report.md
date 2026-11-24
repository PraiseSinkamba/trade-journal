# Preparation validation

Prepared on 2026-10-25 against source baseline `548656bde1925afa8b1d66322e0fbd805eee60da`.

Run from repository root:

```text
node docs/orchestration/ai-native-journal/validate-package.cjs
node docs/orchestration/ai-native-journal/validate-package.cjs --require-committed
node node_modules/prettier/bin/prettier.cjs --check docs/orchestration/ai-native-journal docs/MISTAKES.md docs/LEARNINGS.md
```

The second command is the post-commit dispatch-readiness check. It resolves the introducing documentation commit, checks ancestry and required committed files, and rejects an uncommitted package. Resolve the authoritative SHA using git-readiness.md rather than the moving main ref.

With the final execution prompt present, the default revision is the commit introducing that prompt. `--ref` accepts an explicitly pinned revision; the validator compares package contents against it as well as checking committed availability. The final prompt changes coordinator lifecycle to bounded dispatch/checkpoint/return and authorizes initial T-001 execution when submitted to OMP. No runtime orchestration was invoked while authoring it.

## Coverage reviewed

- 21 unique implementation packets and 21 serial waves; all 13 detailed plan tasks allocated, including split migration consumers and every mutation class.
- 20 valid predecessor edges; acyclic graph; Mermaid edges agree with manifest. No simultaneous phase owners. Conditional within-phase concurrency requires a later exact allocation, so none is implicitly dispatchable now.
- All design sections mapped in traceability.md: behavioral contracts have owners and future evidence; exclusions require preservation/review rather than implementation; §20 decisions retain the contract review's resolutions and empirical gates.
- Every packet includes objective, authority, context, repository, ownership, exclusions, prerequisites, interfaces, implementation discipline, acceptance, tests, reports, review/integration and escalation.
- Twelve source documents are fingerprinted using UTF-8 with CRLF normalized to LF and checked against the committed baseline. Source hashes are portable across Windows/Linux checkouts.
- Existing context paths and all local navigation links checked. Missing implementation paths are explicitly planned. Planned test filenames are checked against the detailed plan, including brace-expanded file lists, rather than accepted merely because they are labeled future outputs.
- Repository index has no submodule gitlinks; all required planning context belongs to this monorepo and is already committed. No source material needs copying from an independent repository.
- Shared schema, transaction, contracts, composition and packaging paths are ordered, with one owner per phase and reviewed allocation required for any split.

## Limits and dispatch blockers

This validates the execution contract, not the unimplemented feature. Application tests, builds, Docker/Tauri smoke and benchmarks were not run for this documentation change. The earlier 220-test result remains historical. Their task owners must supply fresh evidence at the specified gates.

Before worker creation, the package must pass the committed check and the future coordinator must record phase authorization and actual Orca repository/worktree identity. Before an affected implementation task begins, check Node/pnpm/native dependencies and its predecessor reports. Missing required target tooling blocks that task's acceptance. Phase-only execution plans are intentional worker deliverables created against integrated predecessor code, not missing handoff inputs.

The original approval labels remain unchanged; this package does not turn Proposed ADRs into Accepted or authorize launching every phase. Existing local phase-merge selection is preserved. No unresolved product design choice was introduced during preparation; material deviations still require a decision.

The Git submodule convenience command failed because of the sandbox's Windows shell initialization; tracked `.gitmodules`/gitlinks and worktree index inspection supplied the topology evidence instead. No implementation branch, worktree, Run, worker or feature code was created during preparation.
