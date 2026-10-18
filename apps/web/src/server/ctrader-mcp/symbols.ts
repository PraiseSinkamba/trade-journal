import type { CTraderMcpClient } from "./client";
import {
  cTraderSymbolsResponseSchema,
  type CTraderSymbol,
  type AssetClass,
} from "./schemas";

export const fetchSymbols = async (
  client: CTraderMcpClient,
): Promise<CTraderSymbol[]> => {
  const out = await client.callTool("get_symbols", {}, cTraderSymbolsResponseSchema);
  return out.symbols;
};

/**
 * Local `get_symbols` returns vendor-specific metadata. Prefer the explicit
 * `assetClass` string when present, fall back to a `name + description +
 * category` heuristic, then to `"other"`.
 *
 * cTrader assetClass strings seen in the wild:
 *   "Forex (Spot)", "Indices", "Commodities", "Metals", "Energies",
 *   "Bonds", "Shares", "ETFs", "Crypto", "Cryptocurrency", "Stocks".
 */
const mapCTraderAssetClass = (raw: string | undefined | null): AssetClass | null => {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === "forex (spot)" || v.startsWith("fx ")) return "forex";
  if (v === "crypto" || v === "cryptocurrency") return "crypto";
  if (
    v === "indices" ||
    v === "index" ||
    v === "commodities" ||
    v === "metals" ||
    v === "energies" ||
    v === "bonds" ||
    v === "shares" ||
    v === "etfs"
  ) {
    return "cfd";
  }
  if (v === "stocks") return "stock";
  return null;
};

/**
 * Heuristic fallback when the vendor's explicit `assetClass` is missing or
 * unrecognized. Uses `name` + `description`; mirrors the legacy logic.
 */
export const classifySymbol = (symbolName: string, description: string): AssetClass => {
  const name = symbolName.toUpperCase();
  const desc = description.toUpperCase();
  if (name.includes("/") && /[A-Z]{6}/.test(name)) return "forex";
  if (name.includes("BTC") || name.includes("ETH") || desc.includes("BITCOIN")) return "crypto";
  if (/\d{2,}$/.test(name)) return "cfd";
  return "other";
};

/** Lookup helper; avoids building an intermediate Map per sync. */
export const findAssetClass = (
  symbols: CTraderSymbol[],
  symbolName: string,
): AssetClass => {
  const sym = symbols.find((s) => s.name === symbolName);
  if (!sym) return "other";
  const direct = mapCTraderAssetClass(sym.assetClass);
  if (direct) return direct;
  const byCategory = mapCTraderAssetClass(sym.category);
  if (byCategory) return byCategory;
  return classifySymbol(sym.name, sym.description ?? "");
};