import { createHash } from "node:crypto";
import type { ExitAttribution, TradeDirection, TradeStatus } from "@luxalgo/journal-core";

/**
 * Quality of the timing evidence behind a projection.
 *
 * `source_reported` means the source stated the time, `reconstructed` means it
 * was derived from other fills and `unknown` means nothing reliable is known.
 * A crossing fill only proves reconstruction, never a reliable opening time.
 */
export type TimingQuality = "source_reported" | "reconstructed" | "unknown";

/** The id prefix a source uses for a fill the journal invented. */
export const SYNTHETIC_EXECUTION_ID_PREFIX = "synthetic:open:";

/** Whether an id marks a fill the journal invented rather than a source record. */
export const isSyntheticExecutionId = (id: string | null | undefined): boolean =>
  typeof id === "string" && id.startsWith(SYNTHETIC_EXECUTION_ID_PREFIX);

/** What the source can prove about one fill. */
export interface ExecutionEvidenceContext {
  /** The source the fill came from, e.g. `ctrader_deal`. */
  readonly sourceKind: string;
  /** The source stated the fill's own time. */
  readonly sourceReportedTime: boolean;
  /** The fill's time was derived from other records of the same source. */
  readonly reconstructedTime: boolean;
  /** The fill is a placeholder the journal invented, not a source record. */
  readonly synthetic: boolean;
}

/** The fill the classifier judges. */
export interface ExecutionEvidenceFill {
  /** The source's own id of the fill. */
  readonly sourceId?: string | null;
}

/** The classification of one fill. */
export interface ClassifiedExecutionEvidence {
  readonly timingQuality: TimingQuality;
  readonly sourceKind: string;
}

/**
 * Classifies the timing evidence of one fill.
 *
 * The rules, in order:
 * 1. a synthetic fill is never `source_reported`. It is `reconstructed` when the source's own
 *    records supplied the time, and `unknown` otherwise;
 * 2. a fill whose time was derived from other source records is `reconstructed`;
 * 3. a fill whose own time the source stated is `source_reported`;
 * 4. anything else is `unknown`.
 *
 * The classifier never looks at a duration: a synthetic entry with a zero duration and a synthetic
 * entry with a nonzero duration are classified the same way, so a nonzero duration can never
 * upgrade a synthetic entry into source-reported timing.
 */
export const classifyExecutionEvidence = (
  fill: ExecutionEvidenceFill,
  context: ExecutionEvidenceContext,
): ClassifiedExecutionEvidence => {
  // The id is the second signal of a synthetic fill: a caller that forgot to set the flag still
  // cannot get a source-reported timing out of a fill the journal invented.
  const synthetic = context.synthetic || isSyntheticExecutionId(fill.sourceId);
  let timingQuality: TimingQuality = "unknown";
  if (synthetic) {
    timingQuality = context.reconstructedTime ? "reconstructed" : "unknown";
  } else if (context.reconstructedTime) {
    timingQuality = "reconstructed";
  } else if (context.sourceReportedTime) {
    timingQuality = "source_reported";
  }
  return { timingQuality, sourceKind: context.sourceKind };
};

/**
 * User-authored context carried by a trade row.
 *
 * Labels, notes, ratings and playbooks describe how the trader reads a trade,
 * never what the trade was. They are accepted on the input and never reach a
 * fingerprint or a snapshot.
 */
export interface ProjectionAnnotations {
  notes?: string | null;
  tags?: readonly string[] | null;
  rating?: number | null;
  reviewed?: boolean | null;
}

/**
 * The computed rebuild row of one trade plus the currency and evidence quality
 * that change what its numbers mean.
 */
export interface ProjectionInput {
  accountId: string;
  /** The rebuild-stable key of the trade (`accountId|symbol|direction|openedAt`). */
  tradeKey: string;
  symbol: string;
  assetClass: string | null;
  direction: TradeDirection;
  status: TradeStatus;
  openedAt: string;
  closedAt: string | null;
  quantity: number;
  openQuantity: number;
  avgEntry: number;
  avgExit: number | null;
  grossPnl: number;
  fees: number;
  netPnl: number;
  executionCount: number;
  /** The fills that make up the cycle. */
  executionIds: readonly string[];
  /** The realized attribution of each exit fill under the account's method. */
  exits: readonly ExitAttribution[];
  durationMs: number | null;
  /** Currency the money columns are denominated in. */
  currency: string;
  timingQuality: TimingQuality;
  annotations?: ProjectionAnnotations | null;
}

/** Version of the stored snapshot shape. Bumped when the snapshot changes. */
export const PROJECTION_SNAPSHOT_VERSION = 1;

/** Hard bound on a stored snapshot, in bytes. */
export const PROJECTION_SNAPSHOT_MAX_BYTES = 16 * 1024;

const canonicalNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    return Number.isNaN(value) ? '"NaN"' : value > 0 ? '"Infinity"' : '"-Infinity"';
  }
  return Object.is(value, -0) ? "0" : String(value);
};

/**
 * Compares two numbers into a total order.
 *
 * `NaN` never compares equal to anything, so it is ordered by its canonical
 * spelling instead. Every pair of values gets a stable answer, which is what
 * canonicalization needs.
 */
const compareNumbers = (left: number, right: number): number => {
  if (Number.isNaN(left) || Number.isNaN(right)) {
    const leftText = canonicalNumber(left);
    const rightText = canonicalNumber(right);
    if (leftText === rightText) return 0;
    return leftText < rightText ? -1 : 1;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

/**
 * Serializes a value as canonical JSON: object keys sorted, numbers written
 * unambiguously and `undefined` dropped. Two values that mean the same thing
 * always produce the same string.
 */
export const canonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return "null";
};

/**
 * Orders two normalized exit entries into a total order.
 *
 * One execution can carry more than one attribution entry, so the execution id
 * alone is not a total order: the remaining fields break the tie.
 */
const compareExits = (
  left: { executionId: string; grossPnl: number; quantity: number },
  right: { executionId: string; grossPnl: number; quantity: number },
): number => {
  if (left.executionId !== right.executionId) {
    return left.executionId < right.executionId ? -1 : 1;
  }
  const pnl = compareNumbers(left.grossPnl, right.grossPnl);
  if (pnl !== 0) return pnl;
  return compareNumbers(left.quantity, right.quantity);
};

/**
 * The facts a fingerprint covers: every computed field of the rebuild row, the
 * normalized exit attribution, the execution membership, and the currency and
 * evidence quality that change what the numbers mean.
 *
 * Membership and exits are normalized so that the same set of facts always
 * hashes the same way.
 */
const fingerprintPayload = (input: ProjectionInput): Record<string, unknown> => ({
  accountId: input.accountId,
  tradeKey: input.tradeKey,
  symbol: input.symbol,
  assetClass: input.assetClass,
  direction: input.direction,
  status: input.status,
  openedAt: input.openedAt,
  closedAt: input.closedAt,
  quantity: input.quantity,
  openQuantity: input.openQuantity,
  avgEntry: input.avgEntry,
  avgExit: input.avgExit,
  grossPnl: input.grossPnl,
  fees: input.fees,
  netPnl: input.netPnl,
  executionCount: input.executionCount,
  durationMs: input.durationMs,
  currency: input.currency,
  timingQuality: input.timingQuality,
  executionIds: [...input.executionIds].sort(),
  exits: input.exits
    .map((exit) => ({
      executionId: exit.executionId,
      grossPnl: exit.grossPnl,
      quantity: exit.quantity,
    }))
    .sort(compareExits),
});

/**
 * The bounded factual projection stored with a revision.
 *
 * It holds the scalar computed facts, the currency and the evidence quality.
 * The execution membership is normalized into its own rows and the exit
 * attribution is covered by the fingerprint, so the snapshot stays small.
 */
const snapshotPayload = (input: ProjectionInput): Record<string, unknown> => ({
  schemaVersion: PROJECTION_SNAPSHOT_VERSION,
  accountId: input.accountId,
  tradeKey: input.tradeKey,
  symbol: input.symbol,
  assetClass: input.assetClass,
  direction: input.direction,
  status: input.status,
  openedAt: input.openedAt,
  closedAt: input.closedAt,
  quantity: input.quantity,
  openQuantity: input.openQuantity,
  avgEntry: input.avgEntry,
  avgExit: input.avgExit,
  grossPnl: input.grossPnl,
  fees: input.fees,
  netPnl: input.netPnl,
  executionCount: input.executionCount,
  durationMs: input.durationMs,
  currency: input.currency,
  timingQuality: input.timingQuality,
});

/**
 * The canonical JSON of the facts a fingerprint covers.
 *
 * Key order never matters: the same projection always serializes the same way.
 */
export const canonicalProjectionJson = (input: ProjectionInput): string =>
  canonicalJson(fingerprintPayload(input));

/**
 * The bounded snapshot stored with a revision.
 *
 * @throws when the snapshot exceeds {@link PROJECTION_SNAPSHOT_MAX_BYTES}. A
 * snapshot is never silently truncated: a projection that big is a defect, not
 * a payload to shrink.
 */
export const projectionSnapshotJson = (input: ProjectionInput): string => {
  const snapshot = canonicalJson(snapshotPayload(input));
  if (Buffer.byteLength(snapshot, "utf8") > PROJECTION_SNAPSHOT_MAX_BYTES) {
    throw new Error(
      `Projection snapshot exceeds ${PROJECTION_SNAPSHOT_MAX_BYTES} bytes; the projection is not storable as written.`,
    );
  }
  return snapshot;
};

/**
 * The fingerprint of a computed projection.
 *
 * Two projections with the same fingerprint describe the same facts, so a
 * rebuild that produces it again writes no revision and raises no event. A
 * changed fee, a changed exit attribution or changed evidence quality changes
 * the fingerprint; a changed label or note does not.
 */
export const fingerprintProjection = (input: ProjectionInput): string =>
  createHash("sha256").update(canonicalProjectionJson(input), "utf8").digest("hex");
