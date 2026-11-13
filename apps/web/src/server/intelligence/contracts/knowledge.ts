import { z } from "zod";
import type { SourceAction, SourceKind } from "@/server/domain-events";

/**
 * The shared knowledge contracts (Phase 14).
 *
 * A pattern is an evaluated relationship between facts. Evaluating it either
 * produces a conclusion with the evidence it used, or it produces nothing at
 * all because the evidence is not there yet. The second outcome is written
 * down explicitly: an unevaluated pattern is never guessed into a finding.
 *
 * This module holds the pure contracts and the pure decisions: no database,
 * no Next, no AI SDK, and **no behavioural or book rule** — only the
 * sufficiency of the evidence a pattern needs and the lifecycle of the
 * knowledge that depends on a source.
 */

/** The largest knowledge payload the journal stores, in bytes. */
export const MAX_KNOWLEDGE_PAYLOAD_BYTES = 16 * 1024;

/** The schema version every knowledge payload carries. */
export const KNOWLEDGE_PAYLOAD_SCHEMA_VERSION = 1;

/**
 * What a pattern evaluation concluded.
 *
 * `insufficient_evidence` names how much evidence the pattern needs and how
 * much it has; `evaluated` names the evaluator, its version and the evidence
 * it used.
 */
export type PatternEvaluation =
  | {
      readonly kind: "insufficient_evidence";
      readonly required: number;
      readonly available: number;
    }
  | {
      readonly kind: "evaluated";
      readonly evaluatorId: string;
      readonly version: string;
      readonly evidenceIds: readonly string[];
    };

const insufficientEvidenceSchema = z
  .object({
    kind: z.literal("insufficient_evidence"),
    required: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
  })
  .strict();

const evaluatedSchema = z
  .object({
    kind: z.literal("evaluated"),
    evaluatorId: z.string().min(1),
    version: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();

/** The strict schema of a pattern evaluation. */
export const patternEvaluationSchema: z.ZodType<PatternEvaluation> = z.union([
  insufficientEvidenceSchema,
  evaluatedSchema,
]) as z.ZodType<PatternEvaluation>;

/**
 * Evaluates a pattern against the evidence that is available.
 *
 * `required` is the evidence count the pattern needs; the caller declares it.
 * Fewer evidence ids than required yields `insufficient_evidence` with both
 * counts, otherwise the evaluation names the evaluator and the evidence it
 * used.
 */
export const evaluatePattern = (input: {
  readonly required: number;
  readonly evidenceIds: readonly string[];
  readonly evaluatorId: string;
  readonly version: string;
}): PatternEvaluation =>
  input.evidenceIds.length < input.required
    ? {
        kind: "insufficient_evidence",
        required: input.required,
        available: input.evidenceIds.length,
      }
    : {
        kind: "evaluated",
        evaluatorId: input.evaluatorId,
        version: input.version,
        evidenceIds: [...input.evidenceIds],
      };

/**
 * The strict schema of a knowledge payload.
 *
 * A payload is schema-versioned and capped: it states what was concluded
 * about a subject, never the raw material it was derived from.
 */
export const knowledgePayloadSchema = z
  .object({
    schemaVersion: z.literal(KNOWLEDGE_PAYLOAD_SCHEMA_VERSION),
    statement: z.string().min(1).max(4000),
    detail: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/** A knowledge payload, as it is stored. */
export type KnowledgePayload = z.infer<typeof knowledgePayloadSchema>;

/** The lifecycle of a stored knowledge record. */
export type KnowledgeStatus = "active" | "stale" | "pending" | "superseded" | "invalidated";

/** The kind of table a knowledge record lives in. */
export type KnowledgeRecordKind = "hypothesis" | "pattern";

/** One stored knowledge record, as the decisions see it. */
export interface KnowledgeRecord {
  readonly id: string;
  /** The table the record lives in: a hypothesis or a pattern. */
  readonly recordKind: KnowledgeRecordKind;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly version: number;
  readonly status: KnowledgeStatus;
  readonly sourceKind: SourceKind;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly accountId: string | null;
  readonly payloadJson: string;
  readonly evidenceIdsJson: string;
}

/** The pending re-evaluation request one affected subject raises. */
export interface KnowledgeSuccessor {
  /** The table the request belongs to: a hypothesis or a pattern. */
  readonly recordKind: KnowledgeRecordKind;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly version: number;
  readonly sourceKind: SourceKind;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly accountId: string | null;
  readonly payloadJson: string;
  readonly evidenceIdsJson: string;
}

/** What a source change does to the knowledge that depends on it. */
export interface InvalidationDecision {
  /** The records that were current and now need a re-evaluation. */
  readonly stale: readonly KnowledgeRecord[];
  /** The records whose source is gone and that can never be current again. */
  readonly invalidated: readonly KnowledgeRecord[];
  /** The pending requests an earlier correction left behind. */
  readonly superseded: readonly string[];
  /** The pending requests this change raises. */
  readonly successors: readonly KnowledgeSuccessor[];
}

/**
 * The next knowledge revision of a source.
 *
 * The revision counter is per source and independent of any financial or
 * projection revision.
 */
export const nextRevision = (current: number): number => current + 1;

/**
 * The key that names one knowledge subject inside one table.
 *
 * A hypothesis and a pattern may share a subject: they are separate records
 * with separate versions, so the key carries the table.
 */
export const subjectKey = (
  recordKind: KnowledgeRecordKind,
  subjectType: string,
  subjectId: string,
): string => `${recordKind} ${subjectType} ${subjectId}`;

/**
 * Whether a stored record depends on the changed source.
 *
 * The account scope is part of the match: an account-scoped source only
 * touches the knowledge of that account, and a shared source only touches
 * the knowledge that carries no account.
 */
export const dependsOnSource = (
  record: Pick<KnowledgeRecord, "sourceKind" | "sourceId" | "accountId">,
  change: {
    readonly kind: SourceKind;
    readonly sourceId: string;
    readonly accountId: string | null;
  },
): boolean =>
  record.sourceKind === change.kind &&
  record.sourceId === change.sourceId &&
  record.accountId === change.accountId;

/**
 * Decides what a source change does to the knowledge that depends on it.
 *
 * A correction marks the current records `stale` and raises one pending
 * re-evaluation request per affected subject, bound to the new source
 * revision. A pending request that an earlier correction left behind is
 * superseded, so a later evaluation never re-derives from superseded content.
 *
 * A deletion marks the current and the stale records `invalidated` and raises
 * nothing: a source that no longer exists cannot be re-derived.
 *
 * `subjectVersions` holds the highest version each subject already has, across
 * both knowledge tables. The pending request takes the next free version, so
 * it never collides with a stored one.
 */
export const planInvalidation = (
  change: {
    readonly kind: SourceKind;
    readonly action: SourceAction;
    readonly sourceId: string;
    readonly revision: number;
    readonly accountId: string | null;
  },
  records: readonly KnowledgeRecord[],
  subjectVersions: ReadonlyMap<string, number>,
): InvalidationDecision => {
  const dependent = records.filter((record) => dependsOnSource(record, change));
  const active = dependent.filter((record) => record.status === "active");
  const stale = dependent.filter((record) => record.status === "stale");
  const pending = dependent.filter((record) => record.status === "pending");

  if (change.action === "deleted") {
    return {
      stale: [],
      invalidated: [...active, ...stale],
      superseded: pending.map((record) => record.id),
      successors: [],
    };
  }

  // One request per affected subject: the newest record of that subject
  // carries the last known state into the pending row.
  const newest = new Map<string, KnowledgeRecord>();
  for (const record of [...active, ...stale]) {
    const key = subjectKey(record.recordKind, record.subjectType, record.subjectId);
    const seen = newest.get(key);
    if (seen === undefined || record.version > seen.version) newest.set(key, record);
  }

  const successors: KnowledgeSuccessor[] = [...newest.entries()].map(([key, record]) => ({
    recordKind: record.recordKind,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    version: (subjectVersions.get(key) ?? record.version) + 1,
    sourceKind: change.kind,
    sourceId: change.sourceId,
    sourceRevision: change.revision,
    accountId: change.accountId,
    payloadJson: record.payloadJson,
    evidenceIdsJson: record.evidenceIdsJson,
  }));

  return {
    stale: active,
    invalidated: [],
    superseded: pending.map((record) => record.id),
    successors,
  };
};
