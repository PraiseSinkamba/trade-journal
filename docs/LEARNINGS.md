# Learnings

Distilled principles extracted from mistakes in [MISTAKES.md](./MISTAKES.md).
One entry per principle, organized by domain. Reference back to the
mistake(s) that produced the learning.

**Promotion rules** (enforced by `AGENTS.md`):

- A mistake moves here once we know the *general* principle, not just
  the patch that fixed the symptom.
- If a learning's underlying mistake recurs after promotion, it
  escalates to a hard rule: a pre-commit hook, an `AGENTS.md`
  invariant, or a dedicated skill. Reference that rule from this
  file so the codified version has a name.
- Each entry names the upstream mistake(s) that produced it.

---

## Tauri / desktop packaging

- **Tauri plugins that depend on webview2-com must match Tauri's
  pinned version.** `tauri-plugin-mcp-bridge` and similar plugins
  pin `webview2-com = 0.38`. Tauri 2.12 pins `0.39`, Tauri 2.9–2.11
  pin `0.36–0.38`. Pick a Tauri version where both align, or use
  a plugin version that already tracks Tauri. _(Source: Tauri 2.12
  broke the MCP bridge plugin.)_

- **For Tauri dev, run the dev server first or wire it via
  `beforeDevCommand`.** Otherwise the sidecar and the dev server
  race for the same port (3000) and the sidecar loses with
  EADDRINUSE. The Tauri webview then has no server to load. _(Source:
  Next.js dev server + Tauri sidecar both want port 3000.)_

- **Sidecar Node ABI must match the better-sqlite3 binding ABI.**
  Node 22.x = ABI 127, Node 24.x = ABI 137. If they don't match, every
  DB-touching API route fails. Always rebuild better-sqlite3 against
  the sidecar's Node version with
  `prebuild-install --target=<node-version> --runtime=node`. _(Source:
  Sidecar Node ABI mismatch with better-sqlite3 binding.)_

- **Strip Windows `\\?\` extended-length path prefix before passing
  paths to child processes.** Node 24's `realpathSync` resolves the
  prefix to the drive root (`E:`) and fails EISDIR. Tauri 2.x's
  `app.path().resource_dir()` returns paths with this prefix in dev
  mode. Always strip in the calling code. _(Source: Windows
  extended-length path prefix caused EISDIR.)_

## Build / packaging mechanics

- **Sidecar binaries and other bundled resources are always
  removed-and-replaced on each `tauri build`**. If a previous Tauri
  process is running, the destination file is locked and the build
  crashes with "Access is denied". Kill the previous process and
  its orphan sidecar children before rebuilding. _(Source: tauri-build
  file lock on running exe.)_

- **Next.js standalone output assumes `node_modules/<pkg>` next to
  `server.js`.** Flattening pnpm's `.pnpm/<pkg>/node_modules/<pkg>`
  into a single `node_modules` works most of the time, but
  pnpm-junction-symlinks on Windows (which `statSync` errors on
  with EPERM) cause some packages to be silently skipped. Always
  verify the bundled output by running the server and hitting a
  real API. _(Source: Pnpm junction symlinks on Windows.)_

## Cargo / dependency management

- **`[patch.crates-io] version = "=X.Y.Z"` cannot override a
  transitive dep that already has its own patch at the same source.**
  Cargo refuses with "patches must point to different sources".
  When two crates in the dep tree both pin a single package, fix
  one of the crates' source, not just the version. _(Source: Cargo's
  [patch.crates-io] version constraint.)_

- **`tauri-build` line 164 (in 2.7.x) calls `fs::remove_file` without
  graceful fallback on `AccessDenied`.** This is upstream behavior,
  not a config issue. The fix is at the workflow level: ensure no
  Tauri process holds the destination file open during the build.

## Environment / disk

- **Build caches and target directories should live off C: when
  C: is tight.** Set `CARGO_HOME`, `CARGO_TARGET_DIR`, and
  `TAURI_BUNDLER_CACHE` to a separate drive (e.g. `E:\build-cache\...`)
  via Windows user-scope environment variables. Tauri release builds
  need ~2 GB for registry + target + WiX + NSIS. _(Source: C: only
  had 0.26 GB free.)_

- **Don't kill all `node.exe` processes.** Many long-running Node
  services (VS Code LSP via vtsls, IDE helpers) use Node. Filter by
  PID or by process path (e.g.
  `Get-Process node | Where-Object { $_.Path -like '*target*' }`).
  _(Source: TaskKill /IM node.exe kills ALL node processes.)_

## Imports / CSV

- **AI column-mapping has a hard 1–200 execution cap per preview.**
  When the LLM hits its output token limit, the response is
  truncated → JSON parse fails → "AI could not extract the complete
  statement". Always split larger files by date or symbol, then
  import each chunk. _(Source: AI import fails with truncated
  response.)_

- **For unknown CSV formats, the generic column mapper is more
  reliable than the AI fallback.** The deterministic parsers
  recognize 14 known formats; everything else falls through to the
  column mapper. Once you map headers once, the app caches the
  mapping for the same account. Faster, more predictable, and no
  LLM-rate-limit issues. _(Source: AI parsing supports 1–200
  executions per preview.)_

- **When `Get-Content -TotalCount 1` returns the line as a single
  string, pipe the whole file to `ConvertFrom-Csv`** to get a parsed
  object. A single-line read produces a one-column record named "s".
  _(Source: CSV split script via PowerShell produces one-column
  data.)_

## .omp / project structure

- **Forward-spec files (`.omp/mcp.json`) are useful even when the
  underlying feature can't be wired.** They document intent,
  blockers, and required state so future attempts don't start from
  zero. They cost one stale file; the value is preserved context
  across rebuilds. _(Source: .omp/mcp.json was preserved through
  several rolled-back MCP plugin registration attempts.)_

---

## Hard rules (codified from recurring mistakes)

These are mistakes that recurred even after the lesson was documented.
They now have a permanent guard:

- (none yet)

To add a hard rule: extract the pattern from a `MISTAKES.md` entry,
  add the rule's text here, and link the codification (skill, hook,
  or AGENTS.md invariant) in the entry.
