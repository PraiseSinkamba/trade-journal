import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { knowledgeHypotheses, knowledgePatterns, knowledgeSources } from "@/db/schema";
import type { JournalTx } from "@/db/transaction";
import { newUuid } from "@/server/ids";
import type { SourceChange } from "@/server/domain-events";
import {
  knowledgePayloadSchema,
  MAX_KNOWLEDGE_PAYLOAD_BYTES,
  nextRevision,
  planInvalidation,
  subjectKey,
  type KnowledgeRecord,
} from "../contracts/knowledge";

/**
 * The SQLite adapter for the source revisions (Phase 14).
 *
 * The adapter performs the decisions the pure `../knowledge/revisions.ts`
 * module makes: it records the source revision, invalidates the knowledge
 * that depends on it and raises the pending re-evaluation requests. It runs
 * inside the caller's transaction, so a source write and its revision commit
 * or roll back together.
 */

/** The knowledge rows one source change can reach. */
const dependentRows = (tx: JournalTx, change: SourceChange): KnowledgeRecord[] => {
  const hypothesisScope =
    change.accountId === null
      ? isNull(knowledgeHypotheses.accountId)
      : eq(knowledgeHypotheses.accountId, change.accountId);
  const patternScope =
    change.accountId === null
      ? isNull(knowledgePatterns.accountId)
      : eq(knowledgePatterns.accountId, change.accountId);

  const hypotheses = tx
    .select({
      id: knowledgeHypotheses.id,
      recordKind: sql<string>`'hypothesis'`,
      subjectType: knowledgeHypotheses.subjectType,
      subjectId: knowledgeHypotheses.subjectId,
      version: knowledgeHypotheses.version,
      status: knowledgeHypotheses.status,
      sourceKind: knowledgeHypotheses.sourceKind,
      sourceId: knowledgeHypotheses.sourceId,
      sourceRevision: knowledgeHypotheses.sourceRevision,
      accountId: knowledgeHypotheses.accountId,
      payloadJson: knowledgeHypotheses.payloadJson,
      evidenceIdsJson: knowledgeHypotheses.evidenceIdsJson,
    })
    .from(knowledgeHypotheses)
    .where(
      and(
        eq(knowledgeHypotheses.sourceKind, change.kind),
        eq(knowledgeHypotheses.sourceId, change.sourceId),
        hypothesisScope,
      ),
    )
    .all();

  const patterns = tx
    .select({
      id: knowledgePatterns.id,
      recordKind: sql<string>`'pattern'`,
      subjectType: knowledgePatterns.subjectType,
      subjectId: knowledgePatterns.subjectId,
      version: knowledgePatterns.version,
      status: knowledgePatterns.status,
      sourceKind: knowledgePatterns.sourceKind,
      sourceId: knowledgePatterns.sourceId,
      sourceRevision: knowledgePatterns.sourceRevision,
      accountId: knowledgePatterns.accountId,
      payloadJson: knowledgePatterns.payloadJson,
      evidenceIdsJson: knowledgePatterns.evidenceIdsJson,
    })
    .from(knowledgePatterns)
    .where(
      and(
        eq(knowledgePatterns.sourceKind, change.kind),
        eq(knowledgePatterns.sourceId, change.sourceId),
        patternScope,
      ),
    )
    .all();

  return [...hypotheses, ...patterns] as KnowledgeRecord[];
};

/**
 * The highest version the affected subjects already have.
 *
 * Only the subjects the change touches are looked up: a pending request takes
 * the next free version of its own table, so it never collides with a stored
 * one.
 */
const subjectVersions = (
  tx: JournalTx,
  subjects: readonly {
    readonly recordKind: "hypothesis" | "pattern";
    readonly subjectType: string;
    readonly subjectId: string;
  }[],
): Map<string, number> => {
  const versions = new Map<string, number>();
  const keep = (
    recordKind: "hypothesis" | "pattern",
    subjectType: string,
    subjectId: string,
    version: number,
  ): void => {
    const key = subjectKey(recordKind, subjectType, subjectId);
    const seen = versions.get(key);
    if (seen === undefined || version > seen) versions.set(key, version);
  };

  const hypothesisSubjects = subjects.filter((subject) => subject.recordKind === "hypothesis");
  if (hypothesisSubjects.length > 0) {
    for (const row of tx
      .select({
        subjectType: knowledgeHypotheses.subjectType,
        subjectId: knowledgeHypotheses.subjectId,
        version: knowledgeHypotheses.version,
      })
      .from(knowledgeHypotheses)
      .where(
        inArray(
          knowledgeHypotheses.subjectId,
          hypothesisSubjects.map((subject) => subject.subjectId),
        ),
      )
      .all()) {
      if (!hypothesisSubjects.some((subject) => subject.subjectType === row.subjectType)) continue;
      keep("hypothesis", row.subjectType, row.subjectId, row.version);
    }
  }

  const patternSubjects = subjects.filter((subject) => subject.recordKind === "pattern");
  if (patternSubjects.length > 0) {
    for (const row of tx
      .select({
        subjectType: knowledgePatterns.subjectType,
        subjectId: knowledgePatterns.subjectId,
        version: knowledgePatterns.version,
      })
      .from(knowledgePatterns)
      .where(
        inArray(
          knowledgePatterns.subjectId,
          patternSubjects.map((subject) => subject.subjectId),
        ),
      )
      .all()) {
      if (!patternSubjects.some((subject) => subject.subjectType === row.subjectType)) continue;
      keep("pattern", row.subjectType, row.subjectId, row.version);
    }
  }
  return versions;
};

/**
 * The current knowledge revision of a source.
 *
 * The counter is per source and independent of any financial or projection
 * revision. It is read inside the caller's transaction, so two concurrent
 * writers cannot allocate the same revision.
 */
export const currentSourceRevision = (
  tx: JournalTx,
  kind: SourceChange["kind"],
  sourceId: string,
): number => {
  const row = tx
    .select({ revision: knowledgeSources.revision })
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.kind, kind), eq(knowledgeSources.sourceId, sourceId)))
    .orderBy(sql`${knowledgeSources.revision} desc`)
    .limit(1)
    .get();
  return row?.revision ?? 0;
};

/**
 * The next knowledge revision of a source.
 *
 * The caller allocates the revision inside the write transaction, so the
 * revision and the write it belongs to commit together.
 */
export const nextSourceRevision = (
  tx: JournalTx,
  kind: SourceChange["kind"],
  sourceId: string,
): number => nextRevision(currentSourceRevision(tx, kind, sourceId));

/**
 * Records a source revision and invalidates the knowledge that depends on it.
 *
 * A revision records the source, marks the dependent knowledge `stale` and
 * raises one pending re-evaluation request per affected subject, bound to the
 * new source revision. A pending request an earlier correction left behind is
 * superseded, so a later evaluation never re-derives from superseded content.
 *
 * A deletion marks the dependent knowledge `invalidated` and raises nothing:
 * a source that no longer exists cannot be re-derived.
 *
 * The change is idempotent: a revision that is already recorded changes
 * nothing.
 */
export const applySourceChange = (tx: JournalTx, change: SourceChange): void => {
  const existing = tx
    .select({ id: knowledgeSources.id })
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.kind, change.kind),
        eq(knowledgeSources.sourceId, change.sourceId),
        eq(knowledgeSources.revision, change.revision),
      ),
    )
    .get();
  if (existing) return;

  const now = Date.now();
  tx.insert(knowledgeSources)
    .values({
      id: newUuid(),
      kind: change.kind,
      sourceId: change.sourceId,
      revision: change.revision,
      accountId: change.accountId,
      status: change.action === "deleted" ? "invalidated" : "active",
      correlationId: change.correlationId,
      recordedAt: now,
    })
    .run();

  // The previous revision of this source is no longer current.
  tx.update(knowledgeSources)
    .set({ status: "superseded" })
    .where(
      and(
        eq(knowledgeSources.kind, change.kind),
        eq(knowledgeSources.sourceId, change.sourceId),
        eq(knowledgeSources.status, "active"),
        sql`${knowledgeSources.revision} < ${change.revision}`,
      ),
    )
    .run();

  const dependent = dependentRows(tx, change);
  const decision = planInvalidation(change, dependent, subjectVersions(tx, dependent));

  if (decision.stale.length > 0) {
    const staleIds = decision.stale.map((record) => record.id);
    tx.update(knowledgeHypotheses)
      .set({ status: "stale", updatedAt: now })
      .where(inArray(knowledgeHypotheses.id, staleIds))
      .run();
    tx.update(knowledgePatterns)
      .set({ status: "stale", updatedAt: now })
      .where(inArray(knowledgePatterns.id, staleIds))
      .run();
  }

  if (decision.invalidated.length > 0) {
    const invalidatedIds = decision.invalidated.map((record) => record.id);
    tx.update(knowledgeHypotheses)
      .set({ status: "invalidated", updatedAt: now })
      .where(inArray(knowledgeHypotheses.id, invalidatedIds))
      .run();
    tx.update(knowledgePatterns)
      .set({ status: "invalidated", updatedAt: now })
      .where(inArray(knowledgePatterns.id, invalidatedIds))
      .run();
  }

  if (decision.superseded.length > 0) {
    const supersededIds = decision.superseded;
    tx.update(knowledgeHypotheses)
      .set({ status: "superseded", updatedAt: now })
      .where(inArray(knowledgeHypotheses.id, supersededIds))
      .run();
    tx.update(knowledgePatterns)
      .set({ status: "superseded", updatedAt: now })
      .where(inArray(knowledgePatterns.id, supersededIds))
      .run();
  }

  for (const successor of decision.successors) {
    const payload = knowledgePayloadSchema.parse(JSON.parse(successor.payloadJson));
    if (Buffer.byteLength(successor.payloadJson, "utf8") > MAX_KNOWLEDGE_PAYLOAD_BYTES) {
      throw new Error(
        `Knowledge payload for ${successor.subjectType}/${successor.subjectId} exceeds the ${MAX_KNOWLEDGE_PAYLOAD_BYTES} byte limit.`,
      );
    }
    if (Buffer.byteLength(successor.evidenceIdsJson, "utf8") > MAX_KNOWLEDGE_PAYLOAD_BYTES) {
      throw new Error(
        `Knowledge evidence for ${successor.subjectType}/${successor.subjectId} exceeds the ${MAX_KNOWLEDGE_PAYLOAD_BYTES} byte limit.`,
      );
    }
    const shared = {
      id: newUuid(),
      subjectType: successor.subjectType,
      subjectId: successor.subjectId,
      version: successor.version,
      status: "pending" as const,
      payloadSchemaVersion: payload.schemaVersion,
      payloadJson: successor.payloadJson,
      evidenceIdsJson: successor.evidenceIdsJson,
      sourceKind: successor.sourceKind,
      sourceId: successor.sourceId,
      sourceRevision: successor.sourceRevision,
      accountId: successor.accountId,
      createdAt: now,
      updatedAt: now,
    };
    // The pending request goes into the table its record came from, so the
    // record kind survives the invalidation.
    if (successor.recordKind === "pattern") {
      tx.insert(knowledgePatterns)
        .values({
          ...shared,
          evaluatorId: null,
          evaluatorVersion: null,
          evaluationState: null,
          requiredEvidence: null,
          availableEvidence: null,
        })
        .onConflictDoNothing({
          target: [
            knowledgePatterns.subjectType,
            knowledgePatterns.subjectId,
            knowledgePatterns.version,
          ],
        })
        .run();
    } else {
      tx.insert(knowledgeHypotheses)
        .values({ ...shared, evaluatorId: null, evaluatorVersion: null })
        .onConflictDoNothing({
          target: [
            knowledgeHypotheses.subjectType,
            knowledgeHypotheses.subjectId,
            knowledgeHypotheses.version,
          ],
        })
        .run();
    }
  }
};

/**
 * The knowledge that a scope may see.
 *
 * A null scope is the unscoped view: it returns everything. A narrowed scope
 * returns the knowledge of the named accounts only, so the knowledge derived
 * from a shared source — the journal day note, the notes and the playbooks —
 * is never exposed to a single account.
 */
export const listKnowledgeInScope = (
  tx: JournalTx,
  scope: { readonly accountIds: readonly string[] | null },
): KnowledgeRecord[] => {
  const narrowed =
    scope.accountIds === null
      ? undefined
      : inArray(knowledgeHypotheses.accountId, [...scope.accountIds]);
  const patternNarrowed =
    scope.accountIds === null
      ? undefined
      : inArray(knowledgePatterns.accountId, [...scope.accountIds]);

  const hypothesisRows = tx
    .select({
      id: knowledgeHypotheses.id,
      recordKind: sql<string>`'hypothesis'`,
      subjectType: knowledgeHypotheses.subjectType,
      subjectId: knowledgeHypotheses.subjectId,
      version: knowledgeHypotheses.version,
      status: knowledgeHypotheses.status,
      sourceKind: knowledgeHypotheses.sourceKind,
      sourceId: knowledgeHypotheses.sourceId,
      sourceRevision: knowledgeHypotheses.sourceRevision,
      accountId: knowledgeHypotheses.accountId,
      payloadJson: knowledgeHypotheses.payloadJson,
      evidenceIdsJson: knowledgeHypotheses.evidenceIdsJson,
    })
    .from(knowledgeHypotheses)
    .where(narrowed)
    .all();

  const patternRows = tx
    .select({
      id: knowledgePatterns.id,
      recordKind: sql<string>`'pattern'`,
      subjectType: knowledgePatterns.subjectType,
      subjectId: knowledgePatterns.subjectId,
      version: knowledgePatterns.version,
      status: knowledgePatterns.status,
      sourceKind: knowledgePatterns.sourceKind,
      sourceId: knowledgePatterns.sourceId,
      sourceRevision: knowledgePatterns.sourceRevision,
      accountId: knowledgePatterns.accountId,
      payloadJson: knowledgePatterns.payloadJson,
      evidenceIdsJson: knowledgePatterns.evidenceIdsJson,
    })
    .from(knowledgePatterns)
    .where(patternNarrowed)
    .all();

  return [...hypothesisRows, ...patternRows] as KnowledgeRecord[];
};
