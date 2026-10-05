# Supported Import Formats

The auto-detect list returned by `/api/import` is built from
`packages/importers/src/detect.ts` (the `LEGACY_FORMATS` array). Each
format has a parser module under `packages/importers/src/formats/`
and at least one test under `packages/importers/tests/`.

| Format ID | Parser | Notes |
| --- | --- | --- |
| `metatrader` | `formats/metatrader.ts` | MT4/MT5 HTML statements. |
| `ibkr` | `formats/ibkr.ts` | Activity statement, multi-section. |
| `ibkrFlex` | `formats/simple.ts` | Flex Query, distinct from `ibkr`. |
| `thinkorswim` | `formats/thinkorswim.ts` | Charles Schwab account statement. |
| `pepperstone` | `formats/pepperstone.ts` | Pepperstone cTrader order history. |
| `tradezella` | `formats/tradezella.ts` | TradeZella export. |
| `tradervue` | `formats/simple.ts` | Tradervue executions export. |
| `topstepx` | `formats/simple.ts` | TopstepX fills (Bid/Ask → buy/sell). |
| `tradingview` | `formats/simple.ts` | Paper-trading history. |
| `ninjatrader` | `formats/ninjatrader.ts` | Executions export with execution ID. |
| `tradovate` | `formats/simple.ts` | Tradovate orders (filled rows only). |
| `webull` | `formats/simple.ts` | Webull orders (filled rows only). |
| `dastrader` | `formats/simple.ts` | DAS Trader Pro executions. |
| `history-*` | `formats/history.ts` | Adapter-driven generic-CSV family. |

When a file doesn't match any signature, the import page offers the
generic column mapper; the AI assist path can be used as a last resort.
