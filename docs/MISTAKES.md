# Mistakes

Open ledger of every mistake we've made and currently believe we understand.
Promote an entry to [LEARNINGS.md](./LEARNINGS.md) once we know the *general
principle* behind the fix, not just the patch. If the same mistake recurs after
promotion, escalate to a hard rule (skill, hook, or AGENTS.md invariant).

Format: one entry per mistake, newest on top. Reference the conversation
turn or commit if you have it; if not, describe the symptom precisely enough
to recognize the next time.

---

## Tauri / desktop packaging

- **Tauri 2.12 broke the MCP bridge plugin** because `tauri-plugin-mcp-bridge`
  pins `webview2-com = 0.38` while Tauri 2.12 pulls `webview2-com = 0.39`. The
  two `webview2-com-sys` versions produce different Rust types
  (`COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT`) and Cargo's `[patch.crates-io]`
  refuses two patches at the same source. Tried `0.2.2`, `0.13.0`, and
  `tauri-plugin-hushlor-mcp-bridge 0.14.0` — all fail. Locking to Tauri
  `2.11.5` and pinning `tauri-runtime = 2.9.2` compiles the plugin, but then
  Tauri 2.9.5+ has a `do_menu_item!` macro referencing
  `Error::UnexpectedMenuKind` that was never added to the enum — every
  2.9.x and 2.11.x breaks. Conclusion: **no Tauri 2.x today can compile the
  MCP plugin cleanly**. Use the browser MCP at `pnpm --filter web dev` until
  upstream fixes either side.

- **MCP plugin registered in `lib.rs` (debug-only) and added to capabilities,
  then rolled back three times** because of the above. Don't reintroduce the
  plugin without first verifying `cargo tree -i webview2-com` shows a single
  version on the target Tauri line.

## Tauri dev workflow

- **`tauri dev` file lock on `target/debug/trade-journal-desktop.exe`** when
  a previous Tauri process is still running. `tauri-build` line 164
  (`fs::remove_file(&dest).unwrap()`) panics on the running exe → build
  crashes. Workaround: kill the previous Tauri process AND the orphan
  sidecar Node before retrying. The sidecar Node is a grandchild of
  cargo, so it survives `taskkill /F /IM cargo.exe`.

- **tauri-build expects `binaries/node` to resolve to a Tauri-suffixed
  filename** at build time. The `externalBin: ["./binaries/node"]` setting
  in `tauri.conf.json` causes tauri-build to look for
  `binaries/node-x86_64-pc-windows-msvc.exe`. If the file is named just
  `node.exe` or has the wrong triple, build fails with "resource path
  doesn't exist".

- **Next.js dev server + Tauri sidecar both want port 3000**. The
  `devUrl: http://localhost:3000` in `tauri.conf.json` and the sidecar's
  `PORT=0` (OS-assigned) collide. If both run, the sidecar fails with
  `EADDRINUSE`. Fix: `beforeDevCommand: "pnpm --filter web dev"` (which
  we still need to add) or set `NODE_ENV=production` so the sidecar
  binds to a separate port and tells the webview.

- **Sidecar Node ABI mismatch with better-sqlite3 binding**. better-sqlite3
  prebuilds are ABI-specific: Node 22.x = ABI 127, Node 24.x = ABI 137.
  Whichever Node runs the dev server must match whichever ABI the binding
  was downloaded for. Symptom: every API route returns 500 with
  `NODE_MODULE_VERSION 127/137` error. Fix: `prebuild-install
  --target=<node-version>` to force a specific prebuild, or always install
  with the same Node on PATH.

- **Windows extended-length path prefix (`\\?\`)** caused `realpathSync`
  to resolve the sidecar script path to just `E:` (drive root), throwing
  `EISDIR`. `app.path().resource_dir()` returns paths with this prefix in
  dev mode. Fix: strip `\\?\` before passing to the sidecar arg list.

## Standalone server bundling

- **Pnpm junction symlinks on Windows (EPERM on stat)**. The
  `copy-static-build.js` script reads `node_modules/.pnpm/<pkg>` which
  contains Windows junctions pointing into the pnpm content-addressable
  store. `statSync` returns EPERM for these junctions. The script's
  `try { statSync(...) } catch { readlinkSync(...); }` fallback handles
  most packages, but some (better-sqlite3's prebuild itself) are
  silently skipped, leading to "Cannot find module 'next'" in the bundled
  output. Workaround: don't trust the flattened copy — verify each chunk
  manually after bundling.

- **Standalone output `server.js` references packages via `require` that
  aren't at the same level**. Next.js standalone expects
  `node_modules/<pkg>` next to `server.js`. Flattening `.pnpm/.../node_modules/<pkg>`
  into a single `node_modules` is the right shape, but skipping any
  package breaks the require chain silently.

## Tauri build / cargo

- **Tauri-build writes a sidecar binary next to the main exe and tries
  to remove-and-replace it on every build.** If the previous Tauri
  process held the file open, `fs::remove_file` fails → build crashes
  with "Access is denied" (os error 5). The fix is to ensure no Tauri
  process is running before the rebuild.

- **Cargo's `[patch.crates-io] version = "=X.Y.Z"` won't override a
  transitive dep that also has a patch at the same source.** When two
  crates in the dep tree both pin `webview2-com-sys`, Cargo refuses
  to apply a second patch. The workaround is to patch one of the
  crates' source, not just the version.

## Build artifacts / cache

- **Cleaning `target/` on Windows can take 60+ seconds** if cargo is
  still building (file lock). The shell `cd /d` redirect can hang
  PowerShell. Workaround: use `Start-Process` with a `.cmd` wrapper
  instead of `cd && cargo clean`, and check `Get-Process cargo,rustc`
  before running anything that needs the target dir.

- **PowerShell can hang after a long stdout** from `cargo build`,
  causing subsequent tool calls to time out. Workaround: always
  redirect cargo output to a log file (`> build.log 2>&1`) and read
  the log separately.

## Disk space

- **C: only had 0.26 GB free** when the project started. Tauri release
  builds need ~2 GB (cargo registry + target/ + WiX + NSIS). Fix: set
  `CARGO_HOME`, `CARGO_TARGET_DIR`, `TAURI_BUNDLER_CACHE` to point at
  E:\build-cache via Windows user-scope env vars. Cleaned `~/.cargo/registry`,
  `target/`, and `AppData/Local/Tauri` to free up C:.

- **`TaskKill /IM node.exe`** kills ALL node processes, including the
  user's VS Code Language Server (vtsls), IDE helpers, and other
  long-running Node services. Always filter to a specific PID or use
  `Get-Process node | Where-Object { $_.Path -like '*target*' }`.

## Imports / CSV

- **AI import fails with "AI could not extract the complete statement"
  when the CSV is too large** (>200 executions). The LLM hits its
  output token limit. Fix: split the file by date or symbol before
  importing, as documented in the importers doc.

- **CSV split script via PowerShell `Get-Content -TotalCount 1`
  returns the line as a single string**, not a parsed CSV header.
  `ConvertFrom-Csv` then creates a one-column object named "s". Fix:
  read the entire file and pipe to `ConvertFrom-Csv`, or parse the
  first line manually.

## .omp / project structure

- **Created `MCP` content in `.omp/` but the Rust plugin can't be
  compiled** — see the Tauri/MCP mistakes above. The `.omp/mcp.json`
  forward-spec is good documentation but doesn't make the plugin
  actually work.

- **`.omp/mcp.json` was preserved through several rounds of code
  edits** even though the plugin registration was rolled back each
  time. That's intentional — it documents the intended state and
  the blockers, so future attempts don't start from zero. The cost:
  one stale file that could mislead a future reader. Worth the tradeoff.

---

Format to add a new entry:

```md
## <short title>
- **Symptom**: <what you saw>
- **Cause**: <why it happened>
- **Fix**: <what to do>
- **Date**: <YYYY-MM-DD>
- **Ref**: <commit hash, PR number, or "see LEARNINGS.md">
```

If a fix becomes permanent in code (a hook, a config, a test), link to
that from here AND add a pointer to it in `LEARNINGS.md` so the
codified rule has a known name and provenance.
