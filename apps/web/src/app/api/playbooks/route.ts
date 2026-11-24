import { asc, eq } from "drizzle-orm";
import { db, playbooks, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { newId, newUuid, nowIso } from "@/server/ids";
import { recordSourceChanges } from "@/server/intelligence/composition";

export const GET = handler(() => {
  const rows = db.select().from(playbooks).orderBy(asc(playbooks.createdAt)).all();
  const counts = new Map<string, number>();
  for (const trade of db.select({ playbookId: trades.playbookId }).from(trades).all()) {
    if (trade.playbookId) counts.set(trade.playbookId, (counts.get(trade.playbookId) ?? 0) + 1);
  }
  return ok({
    playbooks: rows.map((row) => ({
      ...row,
      rules: JSON.parse(row.rulesJson) as string[],
      tradeCount: counts.get(row.id) ?? 0,
    })),
  });
});

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as { name?: string; description?: string; rules?: string[] };
  const name = body.name;
  if (!name) return bad("name is required");
  const id = newId();
  // The playbook and its source revision commit together.
  recordSourceChanges((tx) => {
    tx.insert(playbooks)
      .values({
        id,
        name,
        description: body.description ?? "",
        rulesJson: JSON.stringify(body.rules ?? []),
        createdAt: nowIso(),
      })
      .run();
    return [
      {
        kind: "playbook",
        action: "revised",
        sourceId: id,
        accountId: null,
        correlationId: newUuid(),
      },
    ];
  });
  return ok({ id });
});
