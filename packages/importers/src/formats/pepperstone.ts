import { hasHeaders, headerKey, parseCsv, pick, toRecords, type Row } from "../csv";
import { parseTimestamp } from "../dates";
import { parseMoney, parseQuantity } from "../numbers";
import { parseSide } from "./fills";
import type {
  ImportFormat,
  ImportOptions,
  ImportedExecution,
  ParsedImport,
  SkippedReason,
} from "../types";
import type { AssetClass } from "@luxalgo/journal-core";

/**
 * Pepperstone cTrader "Order History" export. Each row is the closing deal
 * of a closed position (cTrader's "Deals" tab); the opening fill is not
 * present in the export. The row carries the position's `open_time` and
 * `close_time` plus the broker's `gross_profit`, `net_profit`, `swap`, and
 * `commission`. Two-row positions (close_partial + close_final, or
 * stop_out + manual_after_stop) appear as multiple closing deals under the
 * same `position_id`.
 *
 * To round-trip a position with the existing engine, this format emits
 * two executions per row: a synthetic opening fill at `open_time` with the
 * opposite side, and the real close at `data` (the row's "fill time").
 * Both share `importMetadata.group = position_id` so the engine pairs them
 * into one cycle. The close carries `reportedGrossPnl = net_profit` so the
 * cycle's net P&L matches the broker exactly (`netPnl = grossPnl - fees`,
 * with `fees = 0` because the broker's P&L is already net of swap and
 * commission). Multi-row positions become a single cycle with multiple
 * exits and per-exit P&L.
 *
 * The synthetic entry's `price` is a placeholder; any analytics that
 * depend on `trade.avgEntry` (Edge Score, R-multiples) will read this
 * synthetic value when only the cTrader export is the source. Import a
 * fills export for true entry prices.
 */
export const SYMBOL_CLASSES: Record<string, AssetClass> = {
  // forex majors / crosses
  AUDUSD: "forex",
  CHFJPY: "forex",
  EURGBP: "forex",
  GBPUSD: "forex",
  USDJPY: "forex",
  // metal / energy CFDs
  XAUUSD: "cfd",
  XAGUSD: "cfd",
  UKOUSD: "cfd",
  USOUSD: "cfd",
  // index CFDs
  NAS100: "cfd",
  US30: "cfd",
  SPX500: "cfd",
  GER40: "cfd",
  JPN225: "cfd",
  UK100: "cfd",
};

export const KNOWN_DEAL_KINDS: ReadonlySet<string> = new Set([
  "close_full",
  "close_partial",
  "close_final",
  "stop_out",
  "manual_after_stop",
]);

const classifySymbol = (raw: string): AssetClass => {
  const symbol = raw.trim().toUpperCase();
  if (SYMBOL_CLASSES[symbol]) return SYMBOL_CLASSES[symbol]!;
  if (/\d/.test(symbol)) return "cfd";
  if (/^[A-Z]{6}$/.test(symbol)) return "forex";
  return "other";
};

/** Header keys use csv.ts' headerKey normalization: lowercased, no punctuation. */
const str = (row: Row, header: string): string => pick(row, [headerKey(header)]) ?? "";

export const pepperstone: ImportFormat = {
  id: "pepperstone",
  label: "Pepperstone (cTrader order history export)",
  detect: (headers) =>
    hasHeaders(headers, [
      ["positionid"],
      ["dealkind"],
      ["executionprice"],
      ["broker"],
    ]),
  parse: (content, options: ImportOptions): ParsedImport => {
    const records = toRecords(parseCsv(content));
    const executions: ImportedExecution[] = [];
    const skippedReasons: SkippedReason[] = [];
    const unknownDealKinds = new Set<string>();
    let skippedRows = 0;

    for (let i = 0; i < records.length; i++) {
      const row = records[i]!;
      const rowNumber = i + 2; // header is row 1
      const positionId = str(row, "position_id");
      const orderId = str(row, "order_id");
      const symbol = str(row, "symbol").trim().toUpperCase();
      const closeSide = parseSide(str(row, "side"));
      const quantity = parseQuantity(str(row, "quantity"));
      const price = parseMoney(str(row, "price"));
      const closeAt = parseTimestamp(str(row, "data"), options.timeZone);
      const openAt = parseTimestamp(str(row, "open_time"), options.timeZone);
      const netProfitRaw = parseMoney(str(row, "net_profit"));
      const dealKind = str(row, "deal_kind");

      if (
        !symbol ||
        !closeSide ||
        !openAt ||
        !closeAt ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(price)
      ) {
        skippedRows++;
        const reason = !symbol
          ? "missing symbol"
          : !closeSide
            ? "unrecognised side value"
            : !openAt || !closeAt
              ? "unparseable timestamp"
              : quantity <= 0
                ? "non-positive quantity"
                : "non-positive price";
        skippedReasons.push({ row: rowNumber, reason });
        continue;
      }

      const reportedGrossPnl = Number.isFinite(netProfitRaw) ? netProfitRaw : undefined;
      const entrySide: "buy" | "sell" = closeSide === "buy" ? "sell" : "buy";
      const assetClass = classifySymbol(symbol);
      const order = i * 2;

      if (dealKind && !KNOWN_DEAL_KINDS.has(dealKind)) {
        unknownDealKinds.add(dealKind);
      }

      // Synthetic opening fill at the position's open_time with the
      // opposite side. The price is a placeholder; the engine uses
      // reportedGrossPnl on the close to compute realized P&L.
      executions.push({
        symbol,
        side: entrySide,
        quantity,
        price,
        fee: 0,
        executedAt: openAt,
        assetClass,
        importMetadata: {
          id: `${positionId}-open`,
          group: positionId,
          order,
          preserveFee: false,
        },
      });

      // Real closing fill at the row's `data` time. reportedGrossPnl
      // carries the broker's net_profit so the engine's cycle net P&L
      // matches the broker exactly (netPnl = grossPnl - cycle.fees,
      // and cycle.fees is 0 because the broker P&L is net of swap/commission).
      executions.push({
        symbol,
        side: closeSide,
        quantity,
        price,
        fee: 0,
        executedAt: closeAt,
        assetClass,
        importMetadata: {
          id: orderId || `${positionId}-${closeAt}`,
          group: positionId,
          order: order + 1,
          ...(reportedGrossPnl !== undefined ? { reportedGrossPnl } : {}),
          preserveFee: false,
        },
      });
    }

    const warnings: string[] = [];
    if (unknownDealKinds.size > 0) {
      warnings.push(
        `Unrecognised deal_kind values encountered: ${[...unknownDealKinds].sort().join(", ")}. Imported anyway; verify if your Pepperstone export format changed.`,
      );
    }

    return {
      format: "pepperstone",
      executions,
      skippedRows,
      skippedReasons,
      warnings,
    };
  },
};
