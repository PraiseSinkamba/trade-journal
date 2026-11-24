import { eq } from "drizzle-orm";
import { db, playbooks, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { newUuid } from "@/server/ids";
import { recordSourceChanges } from "@/server/intelligence/composition";

type Params = { params: Promise<{ id: string }> };

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const existing = db.select().from(playbooks).where(eq(playbooks.id, id)).get();
  if (!existing) return bad("Playbook not found", 404);
  const body = (await request.json()) as { name?: string; description?: string; rules?: string[] };
  // The edit and its source revision commit together.
  recordSourceChanges((tx) => {
    tx.update(playbooks)
      .set({
        name: body.name ?? existing.name,
        description: body.description ?? existing.description,
        rulesJson: body.rules ? JSON.stringify(body.rules) : existing.rulesJson,
      })
      .where(eq(playbooks.id, id))
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
  return ok({ updated: true });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  // The playbook delete also clears the playbook from the trades that
  // referenced it, so those trades change too. Both kinds of change commit
  // together, under one correlation id.
  const correlationId = newUuid();
  recordSourceChanges((tx) => {
    // The referenced trades are read inside the transaction, so a trade that
    // started referencing the playbook in the meantime is cleared with a
    // revision of its own.
    const referenced = tx
      .select({ key: trades.key, accountId: trades.accountId })
      .from(trades)
      .where(eq(trades.playbookId, id))
      .all();
    tx.update(trades).set({ playbookId: null }).where(eq(trades.playbookId, id)).run();
    tx.delete(playbooks).where(eq(playbooks.id, id)).run();
    return [
      {
        kind: "playbook",
        action: "deleted",
        sourceId: id,
        accountId: null,
        correlationId,
      },
      ...referenced.map((trade) => ({
        kind: "annotation" as const,
        action: "revised" as const,
        sourceId: trade.key,
        accountId: trade.accountId,
        correlationId,
      })),
    ];
  });
  return ok({ deleted: true });
});
