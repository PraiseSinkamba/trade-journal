import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { JournalDb } from "@/db/connection";
import {
  accounts,
  domainOutbox,
  executions,
  intelligenceSeedCheckpoints,
  tradeIdentities,
  tradeProjectionRevisions,
  trades,
} from "@/db/schema";
import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
import { appendDomainEvent } from "@/server/domain-event-store";
import { newUuid } from "@/server/ids";
import { recordProjectionRevision, resolveIdentity } from "@/server/trading/identity";
import {
  projectionOfRow,
  derivedQualityOf,
  type ReconcileResult,
} from "@/server/trading/reconcile";
import type { JobStore } from "../contracts/jobs";

/** Seeds current persisted facts, never reconstructing financial history or live changes. */
export const createBackfillService = (deps: {
  db: JournalDb;
  jobs: JobStore;
  clock?: () => number;
  batchSize?: number;
}) => {
  const clock = deps.clock ?? Date.now;
  const batchSize = deps.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error("Seed batch size must be a positive safe integer.");
  }

  const seedAccountInTx = (
    tx: JournalTx,
    accountId: string,
    operationId: string,
  ): ReconcileResult => {
    const result: ReconcileResult = {
      discovered: 0,
      opened: 0,
      closed: 0,
      revised: 0,
      removed: 0,
      unchanged: 0,
      ambiguous: 0,
    };
    const account = tx.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account) return result;
    const checkpoint = tx
      .select()
      .from(intelligenceSeedCheckpoints)
      .where(eq(intelligenceSeedCheckpoints.accountId, accountId))
      .get();
    if (checkpoint?.status === "completed" || checkpoint?.status === "suppressed") return result;
    const baselineOperationId = checkpoint?.baselineOperationId ?? operationId;
    if (!baselineOperationId.trim()) throw new Error("A seed needs an operation id.");
    const now = clock();
    const rows = tx
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.accountId, accountId),
          checkpoint?.lastTradeKey ? gt(trades.key, checkpoint.lastTradeKey) : undefined,
        ),
      )
      .orderBy(asc(trades.key))
      .limit(batchSize)
      .all();
    const executionIdsByKey = new Map(
      rows.map((row) => [row.key, JSON.parse(row.executionIdsJson) as string[]]),
    );
    const sourceIds = [...new Set([...executionIdsByKey.values()].flat())];
    const sourceRows: (typeof executions.$inferSelect)[] = [];
    for (let offset = 0; offset < sourceIds.length; offset += 500) {
      sourceRows.push(
        ...tx
          .select()
          .from(executions)
          .where(
            and(
              eq(executions.accountId, accountId),
              inArray(executions.id, sourceIds.slice(offset, offset + 500)),
            ),
          )
          .all(),
      );
    }
    const derivedQuality = derivedQualityOf(tx, sourceRows);

    for (const row of rows) {
      const identity = tx
        .select()
        .from(tradeIdentities)
        .where(
          and(
            eq(tradeIdentities.accountId, accountId),
            eq(tradeIdentities.currentKey, row.key),
            eq(tradeIdentities.state, "active"),
          ),
        )
        .get();
      const current = identity
        ? tx
            .select()
            .from(tradeProjectionRevisions)
            .where(
              and(
                eq(tradeProjectionRevisions.tradeId, identity.id),
                eq(tradeProjectionRevisions.revision, identity.revision),
              ),
            )
            .get()
        : undefined;
      let recorded: { tradeId: string; revision: number; revisionId: string };
      if (current) {
        recorded = { tradeId: current.tradeId, revision: current.revision, revisionId: current.id };
      } else {
        const executionIds = executionIdsByKey.get(row.key) ?? [];
        const resolution = resolveIdentity(tx, {
          accountId,
          tradeKey: row.key,
          executionIds,
          operationId: baselineOperationId,
        });
        if (resolution.kind === "ambiguous") {
          result.ambiguous++;
          continue;
        }
        recorded = recordProjectionRevision(tx, {
          resolution,
          accountId,
          tradeKey: row.key,
          projection: projectionOfRow(account, row, derivedQuality(executionIds)),
          operationId: baselineOperationId,
          recordedAt: now,
        });
      }
      const existing = tx
        .select({ id: domainOutbox.id })
        .from(domainOutbox)
        .where(
          and(
            eq(domainOutbox.aggregateType, "trade"),
            eq(domainOutbox.aggregateId, recorded.tradeId),
            eq(domainOutbox.aggregateRevision, recorded.revision),
            eq(domainOutbox.type, "trade.projection_changed"),
          ),
        )
        .get();
      if (existing) {
        result.unchanged++;
        continue;
      }
      appendDomainEvent(tx, {
        id: newUuid(),
        type: "trade.projection_changed",
        schemaVersion: 1,
        aggregate: { type: "trade", id: recorded.tradeId, revision: recorded.revision },
        correlationId: baselineOperationId,
        origin: "system",
        recordedAt: new Date(now).toISOString(),
        payload: {
          accountId,
          tradeKey: row.key,
          kind: "discovered",
          mode: "historical",
          projectionRevisionId: recorded.revisionId,
        },
      });
      result.discovered++;
    }

    const lastTradeKey = rows.at(-1)?.key ?? checkpoint?.lastTradeKey ?? null;
    const more =
      lastTradeKey !== null &&
      !!tx
        .select({ key: trades.key })
        .from(trades)
        .where(and(eq(trades.accountId, accountId), gt(trades.key, lastTradeKey)))
        .limit(1)
        .get();
    const state = {
      status: more ? ("running" as const) : ("completed" as const),
      lastTradeKey,
      baselineOperationId,
      updatedAt: now,
    };
    tx.insert(intelligenceSeedCheckpoints)
      .values({ accountId, ...state })
      .onConflictDoUpdate({ target: intelligenceSeedCheckpoints.accountId, set: state })
      .run();
    if (more) {
      deps.jobs.enqueue(
        tx,
        JSON.stringify(["seed_account", accountId, baselineOperationId, lastTradeKey]),
        { type: "seed_account", accountId },
        now,
      );
    }
    return result;
  };

  return {
    seedAccountInTx,
    seedAccount: (accountId: string, operationId: string): ReconcileResult =>
      withConnectionTransaction(deps.db, (tx) => seedAccountInTx(tx, accountId, operationId)),
  };
};
