import { bad, handler, ok } from "@/server/api";
import { askJournalContext } from "@/server/ai-capabilities";
import { readAiRequest } from "@/server/ai-scope";
import { runAi } from "@/server/ai";
import { buildAskJournalPrompt } from "@/server/ai-prompts";

/**
 * "Ask your journal" — natural-language questions answered from the trader's
 * own aggregates. The same questions an agent can ask through the MCP tools.
 */
export const POST = handler(async (request: Request) => {
  const scope = readAiRequest(await request.json(), "question");
  const result = await askJournalContext(scope);
  if ("error" in result) return bad(result.error);
  const { context, scope: resolvedScope } = result;
  const answer = await runAi(buildAskJournalPrompt({ question: resolvedScope.question!, context }));
  return ok({ answer, scope: resolvedScope.scope });
});
