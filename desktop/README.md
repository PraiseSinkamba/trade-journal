# Trade Journal — Desktop

Tauri desktop wrapper for the Trade Journal web app.

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

## Build

```bash
pnpm build
```

Produces Windows `.msi` and `.nsis` installers in `src-tauri/target/release/bundle/`.

## Data Directory

On Windows: `%APPDATA%\com.luxalgo.tradejournal\TradeJournal\data`
On macOS: `~/Library/Application Support/com.luxalgo.tradejournal/TradeJournal/data`
On Linux: `~/.config/com.luxalgo.tradejournal/TradeJournal/data`

Existing `apps/web/data/` users: copy your `data/` folder into the above directory before first launch.

## Sidecar

Node 22 is bundled via Tauri sidecar. No system Node dependency required.
