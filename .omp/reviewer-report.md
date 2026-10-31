## Verdict: PASS

## Reviewer Report — Phase 10 packaging link repair (delta after `a890700` review)

Scope reviewed (this delta only):

- `apps/web/scripts/repair-links.mjs` (new file)
- `apps/web/scripts/copy-static-build.js` (uncommitted diff: import + `repairBrokenLinks` call + `.next/static`/`public` copy into the standalone tree)
- `apps/web/tests/intelligence-packaging.test.ts` — new `describe("packaged dependency links")` block (2 tests)

Out of scope, spot-checked only for shared-invariant regression: `apps/web/scripts/run-journal.mjs`,
`apps/web/src/server/intelligence/worker-entry.ts`, `apps/web/tests/intelligence-supervisor.test.ts`,
`Dockerfile`.

### PASS / FAIL

PASS — no blocking defect found in this delta. Findings below are non-blocking notes and coverage gaps
(per `.omp/agents/reviewer.md`, coverage gaps are the orchestrator's call, not a FAIL).

### Findings

- [PASS] `apps/web/scripts/repair-links.mjs:38-49` — repair semantics match the stated invariant.
  A link the host can follow is skipped (`probe(path)` true → `continue`); an unfollowable link whose
  named target exists is re-pointed at exactly that target; a link whose target does not exist is left
  untouched (`if (!existsSync(target)) continue;` — no delete, no replace). Verified by read-only probe
  on Windows: resolvable dir link skipped; unresolvable dir link re-created as a junction with the same
  absolute target and its content readable; unresolvable *file* link replaced by a byte-identical
  regular-file copy; dangling link left in place (`lstat.isSymbolicLink() === true`, `stat` still ENOENT).
- [PASS] `apps/web/scripts/repair-links.mjs:36,51` — recursion stays inside the tree it was given.
  `readdirSync(..., { withFileTypes: true })` reports junctions/symlinks as `isSymbolicLink()`, so
  `entry.isDirectory()` is false for them and the walk never descends through a link. Full-depth walk of
  `apps/web/.next/standalone`: 19 links, 0 broken, 0 resolving outside the standalone tree.
- [PASS] `apps/web/scripts/repair-links.mjs:40` — relative targets are resolved against the link's own
  parent directory, not the tree root: the recursive call passes the child directory as `directory`, and
  `resolve(directory, readlinkSync(path))` uses that same directory. Correct for both relative symlinks
  (relative to the link's parent) and absolute Windows junction targets.
- [PASS] `apps/web/scripts/repair-links.mjs:43-47` — no package content is altered: a directory link
  becomes a link to the same target, a file link becomes a copy of the same file. The repair runs on
  `.next/standalone` (build output), never on `node_modules` sources, and the copy step in
  `copy-static-build.js` already dereferences links when materialising `tauri-dist`.
- [PASS] `apps/web/scripts/repair-links.mjs:42` — no silent corruption on failure: the link is removed
  before the replacement is created, but any failure of `symlinkSync`/`copyFileSync` propagates out of
  `repairBrokenLinks` and aborts `copy-static-build.js`, so the build fails loudly rather than shipping a
  half-repaired tree. Probe confirmed `rmSync(junctionPath, { force: true })` removes only the link — the
  target directory and its contents were intact afterwards.
- [PASS] `apps/web/scripts/copy-static-build.js:15,28-31` — wiring is correct and ordered correctly: the
  repair runs before the `node_modules` materialisation, so the copy step's `statSync` (link-following)
  now succeeds on the previously unresolvable links. `apps/web/package.json` has `"type": "module"`, so
  the ESM `import { repairBrokenLinks } from "./repair-links.mjs"` is valid.
- [PASS] `apps/web/scripts/copy-static-build.js:65-69` — the additional `.next/static` → `.next/standalone/apps/web/.next/static`
  and `public` → `.next/standalone/apps/web/public` copies are correct for the standalone server: Next's
  standalone `server.js` `chdir`s to its own directory, so both must sit next to it. This also matches the
  existing Dockerfile, which ships `.next/static` → `apps/web/.next/static` and `public` → `apps/web/public`.
- [PASS] `apps/web/tests/intelligence-packaging.test.ts:122-152` — the new tests fail without the repair
  (the module import fails, and a no-op repair returns `0` where `1` is expected) and pass with it.
  Behavioural assertion present: after repair the link is readable and yields the target's content.
  Targeted run: `pnpm exec vitest run apps/web/tests/intelligence-packaging.test.ts -t "packaged dependency links"`
  → 2 passed, 2 skipped.
- [PASS] POSIX safety of the new tests — `symlink(target, link, "junction")` and
  `symlinkSync(target, path, "junction")` are accepted on POSIX by Node (`validateOneOf(type, 'type',
  ['dir','file','junction',...])`) and libuv's Unix backend ignores the junction flag, creating a plain
  symlink. CI (`ubuntu-latest`) is therefore unaffected. `apps/web/tests/intelligence-packaging.test.ts`
  compiles and typechecks with `allowJs: true` / `moduleResolution: "bundler"`.
- [PASS] hard blocks — no new dependency (`repair-links.mjs` uses only `node:fs` / `node:path`), therefore
  no ADR required; no schema, migration, lockfile, provider, financial, trade-key or UI change in this
  delta; no raw fetch in importers; no P&L chart touched.
- [PASS] shared invariants unchanged — `apps/web/scripts/run-journal.mjs:62,66-68,187-191`: shutdown
  deadline `10_000` ms, restart base `1_000` ms / max `30_000` ms, crash window `600_000` ms, `crashes.length >= 5`
  → `unhealthy`. `Dockerfile` unchanged: one container, one volume, `USER node`, supervisor entry point,
  explicit worker asset copies.
- [PASS] format / type — `pnpm exec prettier --check apps/web/scripts/repair-links.mjs
  apps/web/scripts/copy-static-build.js apps/web/tests/intelligence-packaging.test.ts` → "All matched files
  use Prettier code style!"; `pnpm exec tsc --noEmit` in `apps/web` → exit 0.

### Notes (non-blocking)

- [NOTE] `apps/web/scripts/repair-links.mjs:40` — the repair does not check that the resolved target is
  inside the tree it was given. A link naming an outside target would be re-pointed at an absolute
  build-machine path (and, for a file, copied in). No such link exists in the current
  `.next/standalone` tree (19 links, all inside), so no impact is demonstrable today. Smallest fix if the
  concern is ever realised: skip targets that are not contained in the tree root.
- [NOTE] `apps/web/scripts/repair-links.mjs:42-47` — replace is not atomic (remove, then create). A failure
  between the two leaves the dependency link missing, but the exception aborts the build, so this is a
  loud failure rather than a corrupt artifact.
- [NOTE] `apps/web/scripts/copy-static-build.js:28-31` — repairing in place mutates `.next/standalone`, so
  a later `next build` regenerates the original link shapes; the repair is idempotent for links that
  already resolve.

### Coverage gaps (orchestrator's call, not a FAIL)

- No test covers the "target does not exist → link left alone" branch
  (`repair-links.mjs:41`). Verified by read-only probe, but not asserted in the suite.
- No test covers the file-link branch (`repair-links.mjs:45-47`, `copyFileSync`), i.e. the Windows
  "file symlinks need elevated rights" path the comment describes.
- No test asserts that `copy-static-build.js` actually calls the repair, nor that the packaged standalone
  tree is bootable after a repair; the two new tests exercise `repairBrokenLinks` in isolation. The
  end-to-end claim ("packaged supervisor reaches `ready`") is evidenced by the parent, not by this suite.
- The second new test asserts `repaired === 0` and that the link still resolves as a directory; it does
  not assert the link is still a link (no `readlink` check), so it would not catch a repair that replaced a
  resolvable link with a plain directory.

### Summary

N PASS, 0 FAIL, 0 BLOCK.

Checks performed: read-only review of the three in-scope files plus the phase-10 plan, the T-010 packet,
the reviewer role and the applicable style guides; read-only filesystem probes of link resolution
behaviour and of the full `apps/web/.next/standalone` link inventory; targeted Vitest run of
`apps/web/tests/intelligence-packaging.test.ts` ("packaged dependency links": 2 passed, 2 skipped);
`prettier --check` on the three touched files (pass); `tsc --noEmit` in `apps/web` (exit 0).

Not run: no production build, no whole-project typecheck, no full test suite, no install, no formatter
write, no git mutation. No file other than this report (`.omp/reviewer-report.md`) was created or modified.
