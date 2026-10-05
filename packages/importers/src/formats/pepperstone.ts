import { hasHeaders, parseCsv, toRecords, type Row } from "../csv";
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
 * Pepperstone cTrader "Order History" export. One row per deal/fill with
 * explicit swap + commission columns and a `position_id` linking the deals
 * of a single position. `data` is the deal fill timestamp; the `trade_id`
 * column is empty in every observed file (cTrader quirk) and is ignored.
 * The `execution_price`, `close_price`, and `price` columns all carry the
 * same value per row; `price` is read for simplicity.
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

const requireString = (row: Row, key: string): string => {
  const value = row[key];
  return typeof value === "string" ? value : "";
};

export const pepperstone: ImportFormat = {
  id: "pepperstone",
  label: "Pepperstone (cTrader order history export)",
  detect: (headers) =>
    hasHeaders(headers, [
      ["position_id"],
      ["deal_kind"],
      ["execution_price"],
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
      const positionId = requireString(row, "position_id");
      const orderId = requireString(row, "order_id");
      const symbol = requireString(row, "symbol").trim().toUpperCase();
      const side = parseSide(requireString(row, "side"));
      const quantity = parseQuantity(requireString(row, "quantity"));
      const price = parseMoney(requireString(row, "price"));
      const executedAt = parseTimestamp(requireString(row, "data"), options.timeZone);
      const swapRaw = parseMoney(requireString(row, "swap"));
      const commissionRaw = parseMoney(requireString(row, "commission"));
      const grossProfitRaw = parseMoney(requireString(row, "gross_profit"));
      const dealKind = requireString(row, "deal_kind");

      if (
        !symbol ||
        !side ||
        !executedAt ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(price)
      ) {
        skippedRows++;
        const reason = !symbol
          ? "missing symbol"
          : !side
            ? "unrecognised side value"
            : !executedAt
              ? "unparseable timestamp"
              : quantity <= 0
                ? "non-positive quantity"
                : "non-positive price";
        skippedReasons.push({ row: rowNumber, reason });
        continue;
      }

      const fee =
        (Number.isFinite(swapRaw) ? Math.abs(swapRaw) : 0) +
        (Number.isFinite(commissionRaw) ? Math.abs(commissionRaw) : 0);
      const reportedGrossPnl = Number.isFinite(grossProfitRaw) ? grossProfitRaw : undefined;

      if (dealKind && !KNOWN_DEAL_KINDS.has(dealKind)) {
        unknownDealKinds.add(dealKind);
      }

      executions.push({
        symbol,
        side,
        quantity,
        price,
        fee,
        executedAt,
        assetClass: classifySymbol(symbol),
        importMetadata: {
          id: orderId || `${positionId}-${executedAt}`,
          group: positionId,
          order: i,
          ...(reportedGrossPnl !== undefined ? { reportedGrossPnl } : {}),
          preserveFee: true,
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
