# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Independent active traders and prop-firm traders. They review trading activity after sessions and across longer periods to understand performance, maintain disciplined execution, and manage prop-firm obligations alongside trading results.

## Product Purpose

Trade Journal records executions from broker sync, statement imports, and manual entry; reconstructs them into auditable round-trip trades; and turns that record into analytics, review, journaling, and optional AI-assisted reflection. Success means both clearer evidence of what works and more disciplined trading decisions.

## Positioning

A local-first, self-hosted trading journal whose documented round-trip and Edge Score calculations operate on the user's own data, while broker connections, market data, and AI use services the user chooses.

## Operating Context

Users import or sync executions, review dashboards, calendars, reports, trade details, and daily journal entries, then export or back up their local data. Prop-firm users additionally track evaluations, reset costs, payouts, and cash records separately from trade P&L. The product runs as a web application and is also packaged as a Windows desktop app.

## Capabilities and Constraints

- Local SQLite stores journal data; the product does not require an account or setup wizard for local use.
- Users can connect supported brokers read-only, import documented statement formats or mapped CSVs, and enter trades manually.
- The round-trip engine supports FIFO, LIFO, and weighted-average accounting, including partial fills, scale-ins, flips, and futures multipliers.
- Broker credentials and saved AI credentials are encrypted at rest; AI is bring-your-own-key for Anthropic or OpenAI.
- Market data, broker connectivity, and AI are optional and user-selected; no provider is enabled by default.
- Prop-firm cash tracking remains separate from trade P&L.
- The product is early release: APIs and schema may change before 1.0.

## Brand Commitments

The product is named Trade Journal. It is an open-source LuxAlgo project; its source is MIT-licensed, while the Trade Journal name and LuxAlgo marks remain subject to the repository trademark policy. Product language must not undermine its local-first, auditable, privacy-respecting model.

## Evidence on Hand

- `README.md` documents features, workflows, privacy model, configuration, screenshots, and local/demo usage.
- `docs/edge-score.md`, `docs/importers.md`, `docs/market-data.md`, and `docs/prop-firms.md` provide product-specific calculation and workflow detail.
- `.github/assets/` contains the product banner and current screenshots, all explicitly described as synthetic demo records.
- No real customer testimonials, performance benchmarks, pricing claims, or live account data are available for future work to invent.

## Product Principles

1. Keep the user's financial record local, portable, and under their control.
2. Make every performance conclusion traceable to recorded executions and documented calculations.
3. Treat reflection and disciplined execution as equally important outcomes to analytics.
4. Keep optional external services user-selected and separate from the core journal.
5. Represent prop-firm cash obligations without conflating them with trading performance.

## Accessibility & Inclusion

P&L color is reinforcement rather than the sole signal: signed text, geometry, labels, and marker shape communicate direction. Light and dark themes and mobile navigation are supported.