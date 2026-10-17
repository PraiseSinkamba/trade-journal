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
 * Local `get_symbols` returns vendor-specific metadata, not an explicit
 * `assetClass`. We classify from `symbolName` + `description` as a best
 * effort — fall through to `"other"` when nothing matches.
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
  const sym = symbols.find((s) => s.symbolName === symbolName);
  return sym ? classifySymbol(sym.symbolName, sym.description ?? "") : "other";
};
