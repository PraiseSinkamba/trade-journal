import type { CTraderMcpClient } from "./client";
import { cTraderSymbolsResponseSchema, type CTraderSymbol, type AssetClass } from "./schemas";

export const fetchSymbols = async (client: CTraderMcpClient): Promise<CTraderSymbol[]> => {
  const out = await client.callTool("get_symbols", {}, cTraderSymbolsResponseSchema);
  return out.symbols;
};

export const buildAssetClassMap = (symbols: CTraderSymbol[]): Map<number, AssetClass> => {
  const map = new Map<number, AssetClass>();
  for (const s of symbols) map.set(s.symbolId, s.assetClass);
  return map;
};
