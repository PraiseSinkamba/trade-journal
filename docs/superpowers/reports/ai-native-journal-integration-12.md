# Phase 12 integration - scoped capability registry and tool gateway

## Outcome

Phase 12 (T-012) is integrated into `codex/ai-native-journal` at `9553de3940485b1a8492a61817f357d89a45753e`.

- Destination branch: `codex/ai-native-journal`
- Destination-before SHA: `18542aa14337b07fd21117a4b0fea6d60753a802`
- Candidate base SHA: `58209ba32ebb29a9c74b8d7ba4ebe48c766203ec`
- Candidate tip SHA: `348391575a509d8ef8c94aa1998e13c492b530d3`
- Merge SHA: `9553de3940485b1a8492a61817f357d89a45753e` (`--no-ff`)
- Merge parents: `18542aa14337b07fd21117a4b0fea6d60753a802` and `348391575a509d8ef8c94aa1998e13c492b530d3`

- 3483915 docs: record the Phase 12 budget exhaustion repair
- 60c4f25 fix: keep the legacy tool-call budget error reachable through the execution context
- 85a4226 docs: record the Phase 12 execution context and tool gateway evidence
- ead9b98 docs: note the propose access rule in the tool gateway
- a80af56 feat: execute scoped intelligence through compatible AI adapters
- a2f1f72 docs: plan the scoped capability registry and tool gateway

The phase report is `docs/superpowers/reports/ai-native-journal-phase-12.md` and the phase plan is `docs/superpowers/plans/ai-native-journal/phase-12.md`.

## Changed-file summary

.omp/reviewer-report.md | 140 ++----
apps/web/src/server/ai-capabilities.ts | 423 ++++++++++++++++
apps/web/src/server/ai-contracts.ts | 54 +++
apps/web/src/server/ai-scope.ts | 98 +++-
apps/web/src/server/ai.ts | 242 +--------
.../server/intelligence/contracts/capabilities.ts | 87 ++++
.../src/server/intelligence/contracts/execution.ts | 143 ++++++
.../web/src/server/intelligence/contracts/tools.ts | 50 ++
.../server/intelligence/runtime/ai-sdk-tools.ts | 57 +++
.../src/server/intelligence/runtime/dispatcher.ts | 71 +++
.../src/server/intelligence/runtime/execution.ts | 76 +++
.../intelligence/runtime/journal-capabilities.ts | 174 +++++++
.../src/server/intelligence/runtime/registry.ts | 46 ++
.../server/intelligence/runtime/tool-gateway.ts | 68 +++
apps/web/tests/ai-runtime.test.ts | 54 +++
apps/web/tests/intelligence-runtime.test.ts | 539 +++++++++++++++++++++
apps/web/tests/intelligence-scope.test.ts | 269 ++++++++++
...oped-intelligence-and-provider-compatibility.md | 23 +
.../plans/ai-native-journal/phase-12.md | 156 ++++++
.../reports/ai-native-journal-phase-12.md | 222 +++++++++
20 files changed, 2665 insertions(+), 327 deletions(-)

20 candidate files, 20 files in the merge.

## Ownership verdict

ALLOWED. Every changed path is inside the Phase 12 ownership set:

- `apps/web/src/server/ai.ts`
- `apps/web/src/server/ai-scope.ts`
- `apps/web/src/server/ai-capabilities.ts`
- `apps/web/src/server/ai-report-context.ts`
- `apps/web/src/server/ai-contracts.ts`
- `apps/web/tests/intelligence-runtime.test.ts`
- `apps/web/tests/intelligence-scope.test.ts`
- `docs/decisions/0008-scoped-intelligence-and-provider-compatibility.md`
- `docs/superpowers/plans/ai-native-journal/phase-12.md`
- `docs/superpowers/reports/ai-native-journal-phase-12.md`
- `apps/web/src/server/intelligence/contracts/`
- `apps/web/src/server/intelligence/runtime/`
- `apps/web/tests/ai-scope.test.ts` (plan-declared extension)
- `apps/web/tests/ai-runtime.test.ts` (coordinator-approved additive extension)
- `.omp/reviewer-report.md` (tracked-but-gitignored local artifact)

No path outside that set changed, so the integration did not abort on an out-of-scope path.

## Boundary checks

- Schema and migration: no path under `apps/web/src/db/` changed and no migration file changed.
  Phase 12's schema allocation is None.
- Dependency and lockfile: no `package.json` and no `pnpm-lock.yaml` changed. Phase 12 adds no
  dependency.
- Cross-boundary import: the contracts layer (`intelligence/contracts/`) imports no database
  module, no Next module, no AI SDK module and no workspace package. The runtime layer
  (`intelligence/runtime/`) imports no database module and no Next module; its AI SDK import is
  the intended adapter boundary in `ai-sdk-tools.ts`.
- Frozen sources: `docs/decisions/0008-scoped-intelligence-and-provider-compatibility.md` is both
  one of the 12 hash-pinned sources and a file T-012 owns, so the phase legitimately updated it and
  the package validator reported the drift. The manifest now records the owner on that source and
  the validator requires the owning task to claim the path, so the other 11 sources stay
  byte-identical to the baseline commit and the owned ADR's current hash is still pinned exactly.
  Package validation after the change: 21 tasks, 21 waves, 20 dependency edges, 12 sources, 79
  local links, acyclic, 0 errors.

## Destination gate

| Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Exit | Result |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| `pnpm install --frozen-lockfile`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 0    | passed |
| `pnpm --filter web typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 0    | passed |
| `pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 0    | passed |
| `pnpm --filter web migrations:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 0    | passed |
| `node scripts/check-licenses.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 0    | passed |
| `pnpm exec prettier --check .omp/reviewer-report.md apps/web/src/server/ai-capabilities.ts apps/web/src/server/ai-contracts.ts apps/web/src/server/ai-scope.ts apps/web/src/server/ai.ts apps/web/src/server/intelligence/contracts/capabilities.ts apps/web/src/server/intelligence/contracts/execution.ts apps/web/src/server/intelligence/contracts/tools.ts apps/web/src/server/intelligence/runtime/ai-sdk-tools.ts apps/web/src/server/intelligence/runtime/dispatcher.ts apps/web/src/server/intelligence/runtime/execution.ts apps/web/src/server/intelligence/runtime/journal-capabilities.ts apps/web/src/server/intelligence/runtime/registry.ts apps/web/src/server/intelligence/runtime/tool-gateway.ts apps/web/tests/ai-runtime.test.ts apps/web/tests/intelligence-runtime.test.ts apps/web/tests/intelligence-scope.test.ts docs/decisions/0008-scoped-intelligence-and-provider-compatibility.md docs/superpowers/plans/ai-native-journal/phase-12.md docs/superpowers/reports/ai-native-journal-phase-12.md` | 0    | passed |
| `pnpm build`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 0    | passed |
| `pnpm test`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 0    | passed |

The gate ran alone on the host, sequentially, after the merge. Every exit code above is the
exit status of the command itself, never the status of a pipe.

The `desktop` workspace was deliberately not typechecked here. Root `pnpm typecheck` also runs
the `desktop` workspace, whose `cargo check` fails on a pre-existing repository defect: the
Tauri sidecar resource `binaries/node-x86_64-pc-windows-msvc.exe` is missing because
`desktop/scripts/run-sidecar-setup.js` uses CommonJS `require()` inside an ESM package. That
defect belongs to Phase 21 and is recorded as blocked host evidence. It was not mocked and it is
not reported as passed.

## What was not done

No push. No pull request. No merge into `main`. The Docker daemon was not started and no Docker
result is claimed. The `desktop` workspace cargo gate was not run, not mocked and not reported as
passed; it stays recorded as blocked host evidence for Phase 21.

## Review verdict

The candidate commits were reviewed, the ownership boundary held, the merge is a non-fast-forward merge into `codex/ai-native-journal`, and the destination gate passed on its own. Phase 12 is integrated and verified on the destination branch.
