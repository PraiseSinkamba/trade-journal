import { eq, inArray } from "drizzle-orm";
import { db, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { newUuid, nowIso } from "@/server/ids";
import { deleteTrades } from "@/server/trading/commands";
import { changeContext } from "@/server/trading/reconcile";
import { recordSourceChanges } from "@/server/intelligence/composition";

interface BulkBody {
  keys: string[];
  action: "review" | "unreview" | "tag" | "untag" | "playbook" | "delete";
  tag?: string;
  playbookId?: string | null;
}

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as BulkBody;
  if (!Array.isArray(body.keys) || body.keys.length === 0) return bad("keys are required");
  const rows = db.select().from(trades).where(inArray(trades.key, body.keys)).all();

  switch (body.action) {
    case "review":
    case "unreview":
      // The annotations and their source revisions commit together. Each
      // trade is its own source, in the account the trade belongs to.
      recordSourceChanges((tx) => {
        tx.update(trades)
          .set({ reviewedAt: body.action === "review" ? nowIso() : null })
          .where(inArray(trades.key, body.keys))
          .run();
        return rows.map((row) => ({
          kind: "annotation" as const,
          action: "revised" as const,
          sourceId: row.key,
          accountId: row.accountId,
          correlationId: newUuid(),
        }));
      });
      return ok({ updated: rows.length });
    case "tag":
    case "untag": {
      const tag = body.tag;
      if (!tag) return bad("tag is required");
      recordSourceChanges((tx) => {
        for (const row of rows) {
          const tags = new Set<string>(row.tagsJson ? (JSON.parse(row.tagsJson) as string[]) : []);
          if (body.action === "tag") tags.add(tag);
          else tags.delete(tag);
          tx.update(trades)
            .set({ tagsJson: JSON.stringify([...tags]) })
            .where(eq(trades.key, row.key))
            .run();
        }
        return rows.map((row) => ({
          kind: "annotation" as const,
          action: "revised" as const,
          sourceId: row.key,
          accountId: row.accountId,
          correlationId: newUuid(),
        }));
      });
      return ok({ updated: rows.length });
    }
    case "playbook":
      recordSourceChanges((tx) => {
        tx.update(trades)
          .set({ playbookId: body.playbookId ?? null })
          .where(inArray(trades.key, body.keys))
          .run();
        return rows.map((row) => ({
          kind: "annotation" as const,
          action: "revised" as const,
          sourceId: row.key,
          accountId: row.accountId,
          correlationId: newUuid(),
        }));
      });
      return ok({ updated: rows.length });
    case "delete": {
      // One command, one transaction: every affected account is rebuilt once.
      // The annotations go with the trades, so their deletions commit with it.
      recordSourceChanges(() => {
        deleteTrades(body.keys, changeContext("user", "live"));
        return rows.map((row) => ({
          kind: "annotation" as const,
          action: "deleted" as const,
          sourceId: row.key,
          accountId: row.accountId,
          correlationId: newUuid(),
        }));
      });
      return ok({ deleted: rows.length });
    }
    default:
      return bad("Unknown action");
  }
});
