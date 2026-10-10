import { bad, handler, ok } from "@/server/api";
import { tradeCritiqueContext } from "@/server/ai-capabilities";
import { runAi } from "@/server/ai";
import { buildTradeCritiquePrompt } from "@/server/ai-prompts";

/** Critique one trade: entries, exits, sizing, and the trader's own annotations. */
export const POST = handler(async (request: Request) => {
  const { key } = (await request.json()) as { key?: string };
  if (!key) return bad("key is required");
  const result = await tradeCritiqueContext(key);
  if (!result) return bad("Trade not found", 404);
  const critique = await runAi(buildTradeCritiquePrompt(result));
  return ok({ critique });
});
