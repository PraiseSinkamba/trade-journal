# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

# Unreleased

### Fork-specific changes (this fork)

- shadcn/ui adoption: the shadcn registry in `apps/web/src/components/ui` is now the source of the shared primitives, with the original button, card, dialog, dropdown-menu, select, table, checkbox, input, label, skeleton, textarea, tabs, tooltip, calendar and date-picker surfaces rebuilt on top of it and their custom slots and exports restored. The project theme tokens, the shadcn tokens and the sidebar tokens are merged into one theme (`78004d7`, `cf6736d`, `799653e`)
- Shell rewrite on the shadcn `Sidebar`: the sidebar header matches the page header height, the trigger stays visible in collapsed mode so the sidebar can be expanded again, the header toggle is edge-mounted, and the sidebar text and GitHub link are hidden while collapsed and replaced by `SidebarRail` (`3f74a01`, `5cda73b`, `a3d2dda`, `c511cda`, `72746b0`, `ac54aef`)
- Calendar work: a shadcn calendar primitive with the `journal-date-calendar` root class, square day cells capped at 7rem so the calendar page stops expanding, and a shadcn `HoverCard` for the day preview (`340bf2b`, `76945cc`, `9b32c2b`)
- AI runtime architecture: a provider-neutral, bounded AI execution layer split into `ai-runtime.ts`, `ai-contracts.ts`, `ai-prompts.ts`, `ai-report-context.ts` and `ai-capabilities.ts`, with the prompts moved behind the feature boundaries and the capabilities returning read-only context while the routes own the `runAi` call (`0958619`, `157cfb1`, `4037892`, `05cae7b`, `4af8be7`)
- AI scope: read-only, scope-bound capabilities for the ask-your-journal agent and the reports agent (`c2e9836`, `f14fd4d`, `a417c66`, `6cd6dc1`)
- Server-side AI import credentials: the browser now sends only `ai: true`, and the server resolves provider, model and API key from Settings, so no credential reaches the client (`8039199`)
- Architecture discovery documentation: `docs/architecture-discovery/` documents the project overview, AI architecture, domain model, data architecture, events and background processing, frontend architecture, authentication and security, runtime and operations, dependencies and coupling, testing and quality, and architectural readiness, each with a review file (`30c760e`)
- cTrader MCP account sync: a JSON-RPC client with an error taxonomy, Zod tool wrappers, order-history and account schemas with a 30-day windowed fetcher, a transaction-scoped cursor sync orchestrator, a decrypt-guarded client cleanup, and a Local-only server plus UI with an account picker and connect form (`33bc629` through `31d1d28`)
- Pepperstone cTrader order history import format, registered in auto-detect ahead of TradeZella, with fees, asset class and group linkage (`372e117`, `13aab49`)
- Import preview improvements: per-row skip reasons propagated through the parsers, adapters and `ParsedImport`; a refute-and-remap affordance; a tighter AI import prompt with the file headers passed as context; and the full preview card shown after a manual mapping is applied (`2b4da1f` through `5934fd0`)
- Account auto-selection: the current account is stored in Settings and auto-picked by the import page, manual trade entry and the header dropdown (`f109b0a`, `d0156a2`)
- Tauri desktop scaffold with a Node 22 sidecar build pipeline (`cee93b3`, `0406c0f`)
- Fixed: statement timestamps are accepted with microsecond precision and a comma decimal separator (`939dd38`); the production path no longer wipes the SQLite WAL (`cae69ef`)

### Added

- Customizable dashboard: drag cards to rearrange, hide and restore them, save named layouts; responsive layout with a mobile navigation drawer
- Privacy mode that masks monetary values across the app while keeping counts, ratios and chart shapes
- Markdown notes with formatting toolbar, reusable templates, exact trade links, and image/PDF attachments on trades, days and notebook notes
- Advanced report filters, comparison groups, a two-way cross-analysis matrix, and additional breakdowns (asset class, month, entry/exit hour, position size, planned/realized R)
- Playbook rule checklists per trade with adherence rates and followed-vs-broken performance
- Routines with weekday schedules and completion history; a missed-opportunity log kept out of trading metrics
- PDF and PNG review exports; JSON export now includes folders, templates, rule assessments, routines and defaults
- Configurable breakeven tolerance, default fees, and default stop/target distances per account and symbol
- Importers: MetaTrader 5 deal reports and TradingView strategy exports
- Importers: XTB xStation `.xlsx` account workbooks, with closed positions, open holdings and later closes of those holdings (contributed by @zahei, [#42](https://github.com/LuxAlgo/trade-journal/issues/42))
- Realized R accounts for contract multipliers and scaled entries
- Optional historical market data connections (London Strategic Edge, Alpaca, OANDA, Binance, Coinbase, or your own candle CSV) with estimated MAE/MFE and candle replay on closed trades
- Prop firm tracker: evaluation and reset costs, refunds, payout requests, receipts, cash ROI, renewals, attachments, CSV import and export
- Calendar insights, rolling performance trends, and a trade explorer scatter in Reports
- Light mode, a collapsible sidebar, and friendlier AI setup and error notices
- OpenAI-compatible AI provider for local or third-party models (Ollama, LM Studio, OpenRouter and others), and documented `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` gateway support (proposed by @fiandev in [#19](https://github.com/LuxAlgo/trade-journal/pull/19))

### Changed

- Data loads render as React transitions, so a tab change paints progressively instead of freezing while every card and chart mounts at once
- The development server runs on Turbopack, roughly halving first-visit compile times when switching tabs in `pnpm dev`
- Removed the gradient accent bar and gradient Edge Score number; the active nav item and the score now use the solid brand blue
- Trade pages chart recorded fills only and never contact a data provider on open; market candles load only from a data source you choose
- Gross profit and gross loss now include every closed trade, so trades labeled breakeven by a tolerance still count; the Edge Score version is bumped to 2
- Reports and dashboard aggregation reuse daily totals and equity for large histories; charts load only the components they use
- Executions are validated and written together with their recomputed trades in one transaction
- Node 22 or newer is required (already required by the AI dependencies)

### Fixed

- IBKR Flex Query XML statements can be uploaded on Import → File upload, and their times are read in the statement timezone, as broker sync does. Previously an XML upload was not recognized and could not be imported, so the Default import timezone never applied ([#16](https://github.com/LuxAlgo/trade-journal/issues/16)).
- Password protection now verifies the session signature on every API route. Previously, when `JOURNAL_PASSWORD` was set, any request carrying a cookie of the right name was accepted, so a forged cookie could read the journal.

## [0.1.0] - 2026-09-03

Initial public release.

### Added

- Round-trip engine: flat-to-flat position cycles from raw fills, FIFO/LIFO/weighted-average matching, partial fills, position flips, futures multipliers, rebuild-stable annotation keys (`@luxalgo/journal-core`)
- Analytics: P&L, win and day-win rates, profit factor, expectancy, R multiples, streaks, drawdown and recovery, profit concentration, calendar and bucket aggregations, the open Edge Score
- Statement importers with auto-detection for 12 formats, one-click TradeZella/Tradervue migration with exact P&L reconciliation, and a column mapper for anything else (`@luxalgo/journal-importers`)
- Web app: dashboard, P&L calendar, daily journal with voice dictation, trades table, trade pages with charting, notebook, playbooks, reports
- Broker sync via `@luxalgo/broker-sdk` with credentials encrypted at rest
- Optional AI reflection (bring your own Anthropic API key): session recaps, trade critiques, ask-your-journal
- Docker deployment, optional password auth, full JSON/CSV export
