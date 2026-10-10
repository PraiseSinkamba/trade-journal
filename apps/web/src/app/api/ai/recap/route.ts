import { eq } from "drizzle-orm";
import { db, journalDays } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { dailyRecapContext } from "@/server/ai-capabilities";
import { readAiRequest } from "@/server/ai-scope";
import { runAi } from "@/server/ai";
import { buildDailyRecapPrompt } from "@/server/ai-prompts";

/** Generate a session recap for one trading day from the day's actual trades. */
export const POST = handler(async (request: Request) => {
  const scope = readAiRequest(await request.json(), "date");
  const { filters } = scope;
  const date = scope.date!;

  // Day notes are shared across accounts and cannot be attributed to a filtered subset.
  const onlyDateFilters = Object.keys(filters).every((key) => key === "from" || key === "to");
  const existingNote = onlyDateFilters
    ? db.select().from(journalDays).where(eq(journalDays.date, date)).get()?.note
    : undefined;

  try {
    const { context, date: d } = await dailyRecapContext(scope, date, existingNote);
    const recap = await runAi(buildDailyRecapPrompt({ date: d, ...context }));
    return ok({ recap, scope: scope.scope });
  } catch (e) {
    if (e instanceof Error && e.message === "No closed trades match this day and the selected filters") {
      return bad(e.message);
    }
    throw e;
  }
});
