import { z } from "zod";
import type { TimingQuality } from "@/server/trading/projection";

/**
 * The observation contract (Phase 08).
 *
 * An observation is a factual statement the journal derives from an immutable
 * projection revision. It is not a conclusion, a judgement or a score: it says
 * what the trade was, in the currency it was made in, with the evidence quality
 * that says how much of it the source actually stated.
 *
 * This module is pure. It holds the vocabulary and the evaluator; the durable
 * storage lives in `../infrastructure/knowledge-store.ts` and the wiring in
 * `../composition.ts`.
 */

/** The lifecycle of a stored observation. */
export type ObservationStatus = "active" | "superseded" | "invalidated";

/** How the identity of the observed trade was resolved. */
export type IdentityResolution = "exact_key" | "explicit_transfer" | "new" | "ambiguous";

/**
 * The factual evidence of one immutable projection revision.
 *
 * Every field is a fact the journal recorded, never an inference: the revision
 * it was derived from, the money it made, the currency it was made in and the
 * quality of the timing behind it.
 */
export interface TradeProjectionEvidence {
  /** The projection revision the observation was derived from. */
  readonly revisionId: string;
  /** The immutable identity of the observed trade. */
  readonly tradeId: string;
  /** The revision number of that identity. */
  readonly revision: number;
  readonly accountId: string;
  readonly tradeKey: string;
  readonly currency: string;
  readonly status: "open" | "win" | "loss" | "breakeven";
  readonly netPnl: number;
  readonly fees: number;
  readonly openQuantity: number;
  readonly openedAt: string;
  readonly closedAt: string | null;
  /** How good the timing evidence behind the projection is. */
  readonly timingQuality: TimingQuality;
  /** The duration, when the source stated the times it was measured from. */
  readonly durationMs: number | null;
  readonly identityResolution: IdentityResolution;
}

/**
 * What the evaluator concluded.
 *
 * An ambiguous identity is never observed: the journal does not know which
 * trade it is talking about, so it says that instead of guessing.
 */
export type ObservationResult =
  | { readonly kind: "trade_projection"; readonly evidence: TradeProjectionEvidence }
  | {
      readonly kind: "insufficient_evidence";
      readonly reason: "ambiguous_identity" | "source_removed";
    };

/** The evaluator that owns every observation this phase writes. */
export const OBSERVATION_EVALUATOR_ID = "trade.projection-observed";

/** The version of that evaluator. */
export const OBSERVATION_EVALUATOR_VERSION = "1";

/** The type of every observation this phase writes. */
export const OBSERVATION_TYPE = "trade_projection";

const timingQualitySchema = z.enum(["source_reported", "reconstructed", "unknown"]);

const tradeProjectionEvidenceObjectSchema = z
  .object({
    revisionId: z.string().min(1),
    tradeId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    accountId: z.string().min(1),
    tradeKey: z.string().min(1),
    currency: z.string().min(1),
    status: z.enum(["open", "win", "loss", "breakeven"]),
    netPnl: z.number().finite(),
    fees: z.number().finite(),
    openQuantity: z.number().finite(),
    openedAt: z.string().min(1),
    closedAt: z.string().min(1).nullable(),
    timingQuality: timingQualitySchema,
    durationMs: z.number().int().nonnegative().nullable(),
    identityResolution: z.enum(["exact_key", "explicit_transfer", "new", "ambiguous"]),
  })
  .strict();

const observationResultObjectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("trade_projection"),
      evidence: tradeProjectionEvidenceObjectSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("insufficient_evidence"),
      reason: z.enum(["ambiguous_identity", "source_removed"]),
    })
    .strict(),
]);

/** The strict schema of the evidence an observation is derived from. */
export const tradeProjectionEvidenceSchema: z.ZodType<TradeProjectionEvidence> =
  tradeProjectionEvidenceObjectSchema;

/** The strict schema of an observation result. */
export const observationResultSchema: z.ZodType<ObservationResult> = observationResultObjectSchema;

/**
 * The pure evaluator.
 *
 * A duration is a fact only when the source stated the times it was measured
 * from. A reconstructed or unknown timing stores a null duration instead: the
 * quality value is the explicit reason there is none, and a duration the
 * source never stated is never promoted into one.
 */
export const evaluateTradeProjection = (
  source: TradeProjectionEvidence,
): ObservationResult => {
  if (source.identityResolution === "ambiguous") {
    // The journal cannot say which trade it observed, so it does not observe.
    return { kind: "insufficient_evidence", reason: "ambiguous_identity" };
  }
  const durationMs = source.timingQuality === "source_reported" ? source.durationMs : null;
  return {
    kind: "trade_projection",
    evidence: durationMs === source.durationMs ? source : { ...source, durationMs },
  };
};
