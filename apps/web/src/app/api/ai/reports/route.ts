import { bad, handler, ok } from "@/server/api";
import { askJournalContext } from "@/server/ai-capabilities";
import { readAiRequest } from "@/server/ai-scope";
import { runReportsAgentAi } from "@/server/ai";

/**
 * "Reports" starts from aggregates, then runs the reports-agent bounded loop
 * with switch_report_mode available over the frozen route-created scope.
 */
export const POST = handler(async (request: Request) => {
  const scope = readAiRequest(await request.json(), "question");
  const result = await askJournalContext(scope);
  if ("error" in result) return bad(result.error);
  const { context, scope: resolvedScope } = result;
  const answer = await runReportsAgentAi(resolvedScope, context);
  return ok({ answer, scope: resolvedScope.scope });
});
