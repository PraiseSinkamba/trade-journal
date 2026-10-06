# Trade Journal Desktop

A self-contained Windows desktop application for the Trade Journal trading journal application. The app bundles a Node.js 22 runtime and the Next.js standalone server, presenting the journal UI in a native Tauri webview window.

## Quickstart

Download the latest installer and run it:

- **MSI**: `desktop/src-tauri/target/release/bundle/msi/Trade Journal_0.1.0_x64_en-US.msi`
- **NSIS**: `desktop/src-tauri/target/release/bundle/nsis/Trade Journal_0.1.0_x64-setup.exe`

After installation, launch **Trade Journal** from the Start Menu. The app will:
1. Open a 1400×900 window titled "Trade Journal"
2. Start the embedded Next.js server in the background
3. Load the journal UI in the webview

On first launch, data is stored under `%APPDATA%\TradeJournal\data\journal.db`.

## Development

### Prerequisites

- Node.js 22 (bundled as sidecar — the system Node can be any version)
- pnpm 9+
- Rust 1.91+ and Cargo
- Next.js (for `pnpm --filter web build`)

### Dev workflow

```bash
# Build the Next.js standalone (requires Node 22 — use bundled binary)
cp desktop/src-tauri/binaries/node-x86_64-pc-windows-msvc.exe /tmp/node.exe
PATH="/tmp:$PATH" node --max-old-space-size=2048 ./node_modules/next/dist/bin/next build

# Run Tauri in dev mode (spawns Next.js from resource dir)
pnpm tauri dev
```

### Rebuilding after source changes

If you modify `apps/web/src/`, rebuild the Next.js standalone first, then run:

```bash
pnpm --filter web build
cd desktop && pnpm tauri build
```

## Build

### Build outputs

| Artifact | Path |
|---|---|
| MSI installer | `desktop/src-tauri/target/release/bundle/msi/Trade Journal_0.1.0_x64_en-US.msi` |
| NSIS installer | `desktop/src-tauri/target/release/bundle/nsis/Trade Journal_0.1.0_x64-setup.exe` |
| Standalone exe | `desktop/src-tauri/target/release/trade-journal-desktop.exe` |

### Build requirements

- ~2GB disk space on the volume holding `CARGO_TARGET_DIR` and `TAURI_BUNDLER_CACHE` (default: `E:\build-cache\`)
- WiX (downloaded automatically by Tauri for MSI bundling)
- NSIS (downloaded automatically for the NSIS installer)

### Build storage on E:

All Rust and Tauri build storage is redirected off `C:` to `E:` via persistent user-scope environment variables. Set them once and every future session uses them:

| Variable | Value | What it redirects |
|---|---|---|
| `CARGO_HOME` | `E:\build-cache\cargo` | Cargo registry, git checkouts, build cache |
| `CARGO_TARGET_DIR` | `E:\build-cache\target` | All `cargo build` artifacts (Tauri Rust compilation) |
| `TAURI_BUNDLER_CACHE` | `E:\build-cache\tauri` | WiX + NSIS toolchain downloads |

To (re)set:

```powershell
[Environment]::SetEnvironmentVariable('CARGO_HOME', 'E:\build-cache\cargo', 'User')
[Environment]::SetEnvironmentVariable('CARGO_TARGET_DIR', 'E:\build-cache\target', 'User')
[Environment]::SetEnvironmentVariable('TAURI_BUNDLER_CACHE', 'E:\build-cache\tauri', 'User')
```

Open a fresh terminal after setting.

### Build steps

```bash
# 1. Build Next.js standalone (Node 22 required — see above)
pnpm --filter web build

# 2. Build Tauri app (produces both MSI and NSIS)
cd desktop && pnpm tauri build
```

## Project layout

```
desktop/
  src-tauri/
    src/
      main.rs          # Tauri entry point
      server.rs        # Next.js sidecar spawn + port discovery
    binaries/
      node.exe         # Node 22 runtime (x86_64-pc-windows-msvc)
    tauri.conf.json    # App config, bundle targets, resources
  Cargo.toml
  package.json

apps/web/
  .next/standalone/    # Next.js standalone server output
  .next/tauri-dist/   # Webview assets (static build, no node_modules)
  scripts/
    copy-static-build.js  # Copies standalone + static for Tauri bundling
```

## How it works

```
trade-journal-desktop.exe
  ├── Spawns: node-x86_64-pc-windows-msvc.exe apps/web/server.js
  │   ├── PORT=0 (ephemeral port)
  │   ├── JOURNAL_DATA_DIR=%APPDATA%/TradeJournal/data
  │   ├── NODE_ENV=production
  │   └── stdout → regex extracts assigned port (e.g. "Local: http://127.0.0.1:38472")
  │
  └── Webview window → http://127.0.0.1:<discovered-port>
```

- **Resource directory**: At runtime, `process.resourcesPath` points to the installed app's `resources/` folder. The Next.js standalone (`server.js`, `.next/`, `node_modules`) is bundled there under `apps/web/`.
- **Port discovery**: The Rust sidecar spawns `node server.js`, reads stdout line-by-line until it finds the bound port via a regex (`Local:.*http://127.0.0.1:(\d+)`), then emits a `server-ready` Tauri event carrying the URL.
- **Tray menu**: Right-click the tray icon → Show / Restart Server / Open Data Folder / Quit.
- **Data directory**: All journal data lives under `%APPDATA%\TradeJournal\data\` (not inside the install directory, so upgrades don't touch user data).

## Configuration

The following environment variables are passed to the Next.js server:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `0` | Ephemeral port assigned by the OS |
| `JOURNAL_DATA_DIR` | `%APPDATA%\TradeJournal\data` | Where `journal.db` and all data lives |
| `NODE_ENV` | `production` | Enables Next.js production mode |

Next.js also reads these if set:

| Variable | Description |
|---|---|
| `JOURNAL_PASSWORD` | Database encryption password |
| `JOURNAL_SECRET` | Session secret |
| `ANTHROPIC_API_KEY` | Anthropic API key for AI features |
| `OPENAI_API_KEY` | OpenAI API key for AI features |

## Troubleshooting

### "Port already in use" after restart

Kill any lingering `node.exe` processes and try again:
```
taskkill /F /IM node.exe
```

### App window is blank

Check the tray icon — the server may have failed to start. Right-click → Open Data Folder and verify `journal.db` was created. Check the app logs for errors.

### Sidecar not found

The Node 22 binary must be at `binaries/node.exe-x86_64-pc-windows-msvc.exe` inside the installed app's resource directory. If upgrading, ensure the binary is included in the bundle.

### Build fails — better-sqlite3 ABI mismatch

`better-sqlite3` is a native module compiled for a specific Node.js ABI version. After changing the Node.js version used to build:
```bash
cd apps/web/node_modules/better-sqlite3 && npx node-gyp rebuild
```

### Build fails — Node 24 crash during `next build`

Node 24 (v24.20.0 on this system) crashes the Next.js build worker during static page generation with `Assertion failed: (env) != nullptr`. Workaround: use the bundled Node 22 binary to run `next build`:
```bash
PATH="$(pwd)/desktop/src-tauri/binaries:$PATH" node --max-old-space-size=2048 ./node_modules/next/dist/bin/next build
```

## Limitations

- **Windows-only**: No macOS or Linux builds are configured. The `bundle.targets` in `tauri.conf.json` is `["msi", "nsis"]`.
- **No auto-update**: There is no Tauri updater configured. Upgrades require reinstalling the installer.
- **No code signing**: The installers are not signed. Windows SmartScreen may show a warning.
- **Large installer size**: The bundled Node 22 runtime (~77 MB) makes the installer ~60 MB. This is expected for a self-contained app.
- **MSI requires GUI session**: The MSI install process requires an interactive desktop session (cannot be silently installed in all environments due to Windows Installer requirements).

## MCP bridge (planned, not yet wired)

`.omp/mcp.json` documents the planned `mcp-server-tauri` setup: webview screenshots, DOM queries, IPC command capture, window state, all over a WebSocket on `127.0.0.1:9223`.

**Status:** not wired. Two stacked upstream bugs:
1. **`webview2-com` version conflict** — `tauri-plugin-mcp-bridge 0.13` and the hushlor fork both pin `webview2-com = 0.38`. Tauri 2.12+ pulls `webview2-com = 0.39`. The two versions produce incompatible Rust types (e.g. `COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT`).
2. **Tauri menu plugin macro bug** — every Tauri 2.x version from 2.9.0 through 2.12.1 has a `do_menu_item!` macro referencing `error::Error::UnexpectedMenuKind` that was never added to the enum. Verified by attempting builds at 2.9.0, 2.9.2, 2.9.5, 2.11.0–2.11.6, 2.12.0 — all fail with the same error. Fix will land in a future Tauri patch.

Workarounds documented in `.omp/mcp.json`. For runtime inspection today, use the browser MCP (`mcp__browsermcp_*`) against `pnpm --filter web dev` at `http://127.0.0.1:3000` — no Tauri wrapper, no version pins.

## Migration from existing `apps/web/data/` users

If you have data in `apps/web/data/` from development:

1. Install the desktop app
2. Copy `apps/web/data/` to `%APPDATA%\TradeJournal\data\`
3. Launch the app — it will detect and use the existing database

No migration script is needed; the database schema is identical.
