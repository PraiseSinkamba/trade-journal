import { bad, handler, ok } from "@/server/api";
import { askJournalContext } from "@/server/ai-capabilities";
import { readAiRequest } from "@/server/ai-scope";
import { runAskJournalAi } from "@/server/ai";

/**
 * "Ask your journal" starts from aggregates, then runs one bounded read-only
 * agent execution over the frozen route-created scope.
 */
export const POST = handler(async (request: Request) => {
  const scope = readAiRequest(await request.json(), "question");
  const result = await askJournalContext(scope);
  if ("error" in result) return bad(result.error);
  const { context, scope: resolvedScope } = result;
  const answer = await runAskJournalAi(resolvedScope, context);
  return ok({ answer, scope: resolvedScope.scope });
});
