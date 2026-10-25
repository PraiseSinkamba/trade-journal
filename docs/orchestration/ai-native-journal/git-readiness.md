# Git readiness and dispatch pinning

Observed source baseline: main, 548656bde1925afa8b1d66322e0fbd805eee60da, clean before preparation. All referenced spec/plan/phase/ADRs/discovery documents are already tracked at this baseline. Do not use older Prompt 00's copy-uncommitted-docs procedure.

The authoritative handoff start is the documentation commit that INTRODUCES this package's execution-manifest.json. A commit cannot embed its own SHA without changing that SHA; use this deterministic Git query and freeze its full result in the future Run record:

```text
git log --diff-filter=A -1 --format=%H -- docs/orchestration/ai-native-journal/execution-manifest.json
```

Call that result HANDOFF_SHA in records (not a guessed branch name). Before feature creation verify git cat-file -e HANDOFF_SHA:docs/orchestration/ai-native-journal/execution-manifest.json and every sources[].path from the manifest, and run the package validator in that commit's checkout. The result must be a descendant of the source baseline. Do not substitute current main, origin/main or the old design baseline. If the package is later deliberately amended, coordinator must approve and record the newer handoff commit including amendments rather than silently selecting a moving ref.

Feature starts at that full SHA. T-001 starts at the verified feature bootstrap commit descended from it. Each later phase starts at verified feature HEAD after its predecessor; record exact starting SHA before creation. Commit phase plans before spawning task children. Required docs are all in this one repository. There is no cross-repository copy requirement.

Preparation commit scope is docs/orchestration/ai-native-journal plus the small required learning-ledger entries in docs/MISTAKES.md and docs/LEARNINGS.md for a corrected draft test reference. No unrelated staging, source changes, history rewrite, implementation branch or worktree is authorized in preparation. Validate status/staged diff immediately before commit. If commit fails, the package is not ready for worker creation until that exact directory is committed; never suggest workers can inherit uncommitted files.

Dispatch readiness requires: resolved existing handoff commit, committed references/source hashes valid, phase authorization, correct Orca repo/host/worktree, predecessor integration accepted, dependency/tool preflight, isolated data/ports and no competing writer. Git readiness is not evidence of feature runtime acceptance.
