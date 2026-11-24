import { z } from "zod";

/**
 * The domain event contract (Phase 04).
 *
 * A committed trade change is described by a `TradeChanged` event: a strict,
 * versioned envelope with a bounded payload. The event carries only references
 * — the account, the trade key and the projection revision — never raw broker
 * data, so a durable record stays small and safe to store.
 *
 * This module holds the contract only. Persistence lives in
 * `./domain-event-store.ts`.
 */

/** Where a change came from. */
export type ChangeOrigin = "user" | "broker_sync" | "import" | "system" | "workflow";

/** Whether the change describes live trading or a reconstruction. */
export type ChangeMode = "live" | "historical" | "maintenance";

/** What happened to the trade. */
export type TradeChangedKind = "discovered" | "opened" | "closed" | "revised" | "removed";

/**
 * The context a change was made in.
 *
 * `operationId` identifies the mutation, `recordedAt` is the commit time (never
 * the broker's close time) and `mode` separates a live change from a
 * historical reconstruction.
 */
export interface ChangeContext {
  readonly operationId: string;
  readonly origin: ChangeOrigin;
  readonly mode: ChangeMode;
  readonly recordedAt: string;
}

/** The envelope of a committed trade change. */
export interface TradeChanged {
  readonly id: string;
  readonly type: "trade.projection_changed";
  readonly schemaVersion: 1;
  readonly aggregate: { readonly type: "trade"; readonly id: string; readonly revision: number };
  readonly correlationId: string;
  readonly causationId?: string;
  readonly origin: ChangeOrigin;
  readonly recordedAt: string;
  readonly occurredAt?: string;
  readonly payload: {
    readonly accountId: string;
    readonly tradeKey: string;
    readonly kind: TradeChangedKind;
    readonly mode: ChangeMode;
    readonly projectionRevisionId: string;
  };
}

/**
 * The largest event payload the journal stores, in bytes.
 *
 * A payload is references only; anything larger is a sign that raw data
 * leaked into the envelope.
 */
export const MAX_EVENT_PAYLOAD_BYTES = 16 * 1024;

const changeOriginSchema = z.enum(["user", "broker_sync", "import", "system", "workflow"]);
const changeModeSchema = z.enum(["live", "historical", "maintenance"]);
const tradeChangedKindSchema = z.enum(["discovered", "opened", "closed", "revised", "removed"]);

const tradeChangedObjectSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("trade.projection_changed"),
    schemaVersion: z.literal(1),
    aggregate: z
      .object({
        type: z.literal("trade"),
        id: z.string().min(1),
        revision: z.number().int().nonnegative(),
      })
      .strict(),
    correlationId: z.string().min(1),
    causationId: z.string().min(1).optional(),
    origin: changeOriginSchema,
    recordedAt: z.string().min(1),
    occurredAt: z.string().min(1).optional(),
    payload: z
      .object({
        accountId: z.string().min(1),
        tradeKey: z.string().min(1),
        kind: tradeChangedKindSchema,
        mode: changeModeSchema,
        projectionRevisionId: z.string().min(1),
      })
      .strict(),
  })
  .strict();

/**
 * The strict schema of a trade change.
 *
 * Unknown keys are rejected, so a caller cannot smuggle extra data into the
 * durable envelope.
 */
export const tradeChangedSchema: z.ZodType<TradeChanged> = tradeChangedObjectSchema;

/**
 * Parses an untrusted value into a trade change.
 *
 * @throws {z.ZodError} when the value does not satisfy the strict schema.
 */
export function parseTradeChanged(raw: unknown): TradeChanged {
  return tradeChangedObjectSchema.parse(raw) as TradeChanged;
}

/**
 * The source-change contract (Phase 14).
 *
 * A user-authored source — a trade annotation, a trade rule check, a
 * playbook, a journal day note or a note — changes in two ways: it is
 * revised, or it is deleted. The change names the source, the revision it
 * carries and the account scope it belongs to.
 *
 * The revision is the **knowledge revision** of that source: a per-source
 * counter that advances independently of any financial or projection
 * revision. The journal day note, the notes and the playbooks are shared
 * across accounts and carry no account scope; the trade annotation and the
 * trade rule check belong to the account of the trade.
 */

/** The kinds of user-authored source the journal keeps. */
export type SourceKind = "annotation" | "rule_check" | "playbook" | "journal" | "note";

/** What happened to the source. */
export type SourceAction = "revised" | "deleted";

/** The fields every source change carries. */
interface SourceChangeBase {
  /** The identity of the source inside its kind. */
  readonly sourceId: string;
  /** The knowledge revision of that source. */
  readonly revision: number;
  /** The id of the request that produced the change. */
  readonly correlationId: string;
}

/**
 * A committed change to one user-authored source.
 *
 * The union discriminates on the kind, so the account scope is part of the
 * member: an account-scoped source always names its account, and a shared
 * source always carries `null`.
 */
export type SourceChange =
  | (SourceChangeBase & {
      readonly kind: "annotation" | "rule_check";
      readonly action: SourceAction;
      readonly accountId: string;
    })
  | (SourceChangeBase & {
      readonly kind: "playbook" | "journal" | "note";
      readonly action: SourceAction;
      readonly accountId: null;
    });

/** The source kinds that belong to one account. */
export const ACCOUNT_SCOPED_SOURCE_KINDS: readonly SourceKind[] = ["annotation", "rule_check"];

/** The source kinds the journal shares across accounts. */
export const SHARED_SOURCE_KINDS: readonly SourceKind[] = ["playbook", "journal", "note"];

const sourceChangeBaseShape = {
  sourceId: z.string().min(1),
  revision: z.number().int().positive(),
  correlationId: z.string().min(1),
};

const accountScopedSourceChangeSchema = z
  .object({
    kind: z.enum(["annotation", "rule_check"]),
    action: z.enum(["revised", "deleted"]),
    ...sourceChangeBaseShape,
    accountId: z.string().min(1),
  })
  .strict();

const sharedSourceChangeSchema = z
  .object({
    kind: z.enum(["playbook", "journal", "note"]),
    action: z.enum(["revised", "deleted"]),
    ...sourceChangeBaseShape,
    accountId: z.null(),
  })
  .strict();

/**
 * The strict schema of a source change.
 *
 * Unknown keys are rejected, and the account scope is part of the member, so
 * a shared source can never claim an account and an account-scoped source can
 * never omit one.
 */
export const sourceChangeSchema: z.ZodType<SourceChange> = z.union([
  accountScopedSourceChangeSchema,
  sharedSourceChangeSchema,
]) as z.ZodType<SourceChange>;

/**
 * Parses an untrusted value into a source change.
 *
 * @throws {z.ZodError} when the value does not satisfy the strict schema.
 */
export function parseSourceChange(raw: unknown): SourceChange {
  return sourceChangeSchema.parse(raw) as SourceChange;
}
