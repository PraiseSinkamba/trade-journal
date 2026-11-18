# Trade Journal Desktop

A self-contained Windows desktop application for the Trade Journal trading journal. It bundles a
Node.js 24 sidecar and the packaged journal tree, and presents the journal UI in a native Tauri
webview.

## What the app does at runtime

```
trade-journal-desktop.exe
  ├── picks a free loopback port (127.0.0.1:0 → reads the assigned port → releases it)
  ├── spawns ONE managed child:
  │     node-x86_64-pc-windows-msvc.exe apps/web/scripts/run-journal.mjs
  │       --mode production --host 127.0.0.1 --port <port>
  │       --data-dir <absolute data dir> --worker enabled
  │     env: JOURNAL_DATA_DIR, NODE_ENV=production, HOSTNAME=127.0.0.1, PORT=<port>
  │   └── the supervisor owns the web child and the worker child
  ├── reads the supervisor's JSON readiness line on stdout:
  │     {"type":"ready","host":"127.0.0.1","port":<port>,"worker":"ready"}
  │   (the supervisor publishes it only after its own HTTP probe succeeded)
  ├── emits the Tauri event `server-ready` with {"url":"http://127.0.0.1:<port>"}
  └── webview window → the splash page → the journal URL once ready
```

- **One managed child.** The desktop owns the supervisor process. The supervisor owns the Next.js
  web child and the intelligence worker child.
- **Explicit nonzero port.** The desktop binds `127.0.0.1:0`, reads the port the OS assigned,
  releases the socket and passes that port to the child. If the child loses the release-to-bind
  race and exits before it becomes ready, the desktop picks a new port and retries, up to five
  attempts, then reports the failure.
- **Structured readiness.** The desktop does not scrape the Next.js banner. It parses the
  supervisor's JSON line, so the readiness it reports is already backed by a real HTTP response.
  The crate needs no HTTP client dependency.
- **Whole-tree termination.** The supervisor forks grandchildren, so termination kills the tree:
  `taskkill /F /T /PID <pid>` on Windows, then waits until the PID is gone. On other platforms the
  direct child is killed and waited for.
- **Shared state.** One `SharedServerState` holds the child, its PID, the URL and the lifecycle
  (`starting` → `ready` → `stopped`). Restart terminates the running tree before starting the
  next one. Quit and window close terminate the tree and then exit the application.
- **Tray menu**: right-click the tray icon → Show / Restart Server / Open Data Folder / Quit.
- **Data directory**: `%APPDATA%\com.luxalgo.tradejournal\TradeJournal\data` — outside the
  install directory, so upgrades never touch user data.

## Requirements

- pnpm 11 (the repository pins `pnpm@11.0.8`)
- Node.js 22 or newer for the workspace scripts
- Rust 1.91+ and Cargo
- The Node sidecar binary is **not** checked in. `pnpm --filter desktop setup:sidecar` downloads
  Node **24.11.0** (Node ABI **137**) and writes it to
  `desktop/src-tauri/binaries/node-x86_64-pc-windows-msvc.exe`. The bundle icons are generated
  the same way: `pnpm --filter desktop setup:icons`.

The sidecar is Node 24.11.0 because `better-sqlite3` is a native module compiled for one Node ABI.
Build the web tree with a Node 24 runtime (the sidecar) or the native module will not load in the
bundled server.

## Development

```bash
# from the repo root
pnpm --filter desktop setup:sidecar   # downloads the Node 24.11.0 sidecar
pnpm --filter desktop setup:icons     # regenerates desktop/src-tauri/icons/*
pnpm --filter web build               # builds the packaged tree under apps/web/.next/tauri-dist
pnpm --filter desktop tauri dev       # dev window; devUrl is http://localhost:3000
```

`pnpm --filter desktop build:app` builds the web tree and then the packaged application.
`pnpm --filter desktop build:debug` does the same in debug mode.

## Build outputs

The release artifacts land under the **active `CARGO_TARGET_DIR`** — read the variable instead of
assuming a path:

| Artifact | Path |
|---|---|
| MSI installer | `$CARGO_TARGET_DIR/release/bundle/msi/*.msi` |
| NSIS installer | `$CARGO_TARGET_DIR/release/bundle/nsis/*.exe` |
| Standalone exe | `$CARGO_TARGET_DIR/release/trade-journal-desktop.exe` |

With no `CARGO_TARGET_DIR` set, that is `desktop/src-tauri/target/release/...`.

Build storage can be redirected off the system volume with `CARGO_HOME`,
`CARGO_TARGET_DIR` and `TAURI_BUNDLER_CACHE`. WiX and NSIS are downloaded automatically.

## Packaged tree

`pnpm --filter web build` writes the tree the desktop launches:

```
apps/web/.next/tauri-dist/apps/web/
  ├── index.html              # splash page the webview loads first
  ├── server.js               # Next.js standalone entry point
  ├── scripts/run-journal.mjs # the supervisor the desktop spawns
  ├── scripts/http-child.mjs  # the web child the supervisor forks
  ├── worker/worker-entry.cjs # the intelligence worker the supervisor forks
  ├── .next/  public/  node_modules/
```

`tauri.conf.json` bundles that directory as the resource `apps/web`, so at runtime
`resource_dir/apps/web/scripts/run-journal.mjs` is the supervisor the desktop starts.

## Windows packaged smoke

```powershell
# 1. build the tree and the bundle
pnpm --filter web build
pnpm --filter desktop build:app

# 2. run the packaged exe and let it serve
& "$env:CARGO_TARGET_DIR\release\trade-journal-desktop.exe"

# 3. from another shell: the journal answers on the loopback port the app picked
Get-NetTCPConnection -State Listen | Where-Object LocalAddress -eq '127.0.0.1'

# 4. close the window (or use the tray → Quit): the app terminates the whole tree
#    and no node.exe descendant survives
```

The CI desktop job runs the same check: it discovers the loopback port from the `node.exe`
descendants of the app process, asserts the journal answers over HTTP, closes the app and then
asserts that none of those `node.exe` processes survived.

## Configuration

The desktop passes these to the supervisor, which forwards them to both children:

| Variable | Value |
|---|---|
| `JOURNAL_DATA_DIR` | absolute path of the app data directory |
| `NODE_ENV` | `production` |
| `HOSTNAME` | `127.0.0.1` |
| `PORT` | the nonzero loopback port the desktop picked |

The journal also reads these if they are set in the environment of the app:

| Variable | Description |
|---|---|
| `JOURNAL_PASSWORD` | Database encryption password |
| `JOURNAL_SECRET` | Session secret |
| `ANTHROPIC_API_KEY` | Anthropic API key for AI features |
| `OPENAI_API_KEY` | OpenAI API key for AI features |

## Troubleshooting

### "Port already in use"

The desktop picks its own free port, so this only happens when a foreign process holds the
journal's data directory lock or the app is started twice. Check for leftovers:

```
taskkill /F /IM node.exe
```

### The window stays on the splash page

The journal did not become ready. The app prints the supervisor's stderr to its own output;
check that the sidecar exists in `desktop/src-tauri/binaries/` and that the data directory is
writable.

### Build fails — better-sqlite3 ABI mismatch

`better-sqlite3` is a native module compiled for one Node ABI. Rebuild it with the same Node
major the sidecar uses (24):

```bash
cd apps/web/node_modules/better-sqlite3 && npx node-gyp rebuild
```

### Build fails — `next build` crashes

A pinned Node v24.20.0 once crashed the Next.js build worker during static page generation with
`Assertion failed: (env) != nullptr`. The bundled sidecar (v24.11.0) sidesteps this. If your
system Node crashes on the same call, run `next build` against the sidecar:

```bash
PATH="$(pwd)/desktop/src-tauri/binaries:$PATH" node --max-old-space-size=2048 ./node_modules/next/dist/bin/next build
```

### The dispatcher fails on `Get-FileHash`

`setup-sidecar-node.ps1` verifies the download with `Get-FileHash`, which Windows PowerShell 5.1
does not provide. The dispatcher runs the script with PowerShell 7 (`pwsh`) and falls back to
`powershell` only when `pwsh` is not installed, so install PowerShell 7 to run
`pnpm --filter desktop setup:sidecar`.

## Limitations

- **Windows-only**: no macOS or Linux builds are configured; `bundle.targets` is `["msi", "nsis"]`.
- **No auto-update**: upgrades require reinstalling the installer.
- **No code signing**: Windows SmartScreen may show a warning.
- **Large installer**: the bundled Node runtime and the packaged journal tree dominate the size.
- **MSI requires a GUI session**: Windows Installer cannot install silently in every environment.

## MCP bridge (planned, not yet wired)

`.omp/mcp.json` documents the planned `mcp-server-tauri` setup: webview screenshots, DOM queries,
IPC command capture, window state, all over a WebSocket on `127.0.0.1:9223`.

**Status:** not wired. Two stacked upstream bugs:
1. **`webview2-com` version conflict** — `tauri-plugin-mcp-bridge 0.13` and the hushlor fork both
   pin `webview2-com = 0.38`. Tauri 2.12+ pulls `webview2-com = 0.39`. The two versions produce
   incompatible Rust types (e.g. `COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT`).
2. **Tauri menu plugin macro bug** — every Tauri 2.x version from 2.9.0 through 2.12.1 has a
   `do_menu_item!` macro referencing `error::Error::UnexpectedMenuKind` that was never added to
   the enum. Verified by attempting builds at 2.9.0, 2.9.2, 2.9.5, 2.11.0–2.11.6, 2.12.0 — all
   fail with the same error. Fix will land in a future Tauri patch.

Workarounds are documented in `.omp/mcp.json`. For runtime inspection today, use the browser MCP
(`mcp__browsermcp_*`) against `pnpm --filter web dev` at `http://127.0.0.1:3000` — no Tauri
wrapper, no version pins.

## Migration from existing `apps/web/data/` users

1. Install the desktop app
2. Copy `apps/web/data/` to `%APPDATA%\com.luxalgo.tradejournal\TradeJournal\data\`
3. Launch the app — it uses the existing database

No migration script is needed; the database schema is identical.

