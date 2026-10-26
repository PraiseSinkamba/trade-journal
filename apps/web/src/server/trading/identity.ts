import { and, desc, eq, inArray } from "drizzle-orm";
import { newUuid } from "../ids";
import {
  tradeIdentities,
  tradeIdentityLinks,
  tradeProjectionRevisions,
  tradeRevisionExecutions,
} from "@/db/schema";
import type { JournalTx } from "@/db/transaction";
import { requireValue } from "@/server/request-error";
import { fingerprintProjection, projectionSnapshotJson, type ProjectionInput } from "./projection";

/**
 * How an identity was resolved. Mirrors the contract review's resolution union:
 * the same active key, a proven explicit transfer, a fresh identity, or an
 * unresolved mapping that must never be guessed.
 */
export type IdentityResolutionKind = "exact_key" | "explicit_transfer" | "new" | "ambiguous";

export interface IdentityInput {
  /** The account the projection belongs to. */
  accountId: string;
  /** The rebuild-stable key of the projection. */
  tradeKey: string;
  /** The fills that make up the projection. */
  executionIds: readonly string[];
  /** The operation that produced this projection. */
  operationId: string;
  /**
   * The identity the caller claims this projection continues. Retained only when
   * a unique full membership match proves it.
   */
  explicitTransferSourceId?: string | null;
}

export type IdentityResolution =
  | Readonly<{ kind: "exact_key"; tradeId: string; nextRevision: number }>
  | Readonly<{ kind: "explicit_transfer"; tradeId: string; nextRevision: number }>
  | Readonly<{ kind: "new"; tradeId: string; nextRevision: number }>
  | Readonly<{ kind: "ambiguous"; candidateIds: readonly string[] }>;

/** Why one identity supersedes another. */
export type IdentityLinkReason = "superseded" | "ambiguous";

export interface ProjectionRevisionInput {
  /** The resolution this revision belongs to. Ambiguity never carries a revision. */
  readonly resolution: Exclude<IdentityResolution, { kind: "ambiguous" }>;
  readonly accountId: string;
  readonly tradeKey: string;
  readonly projection: ProjectionInput;
  readonly operationId: string;
  /** Epoch milliseconds. Defaults to now. */
  readonly recordedAt?: number;
}

export interface RecordedRevision {
  readonly revisionId: string;
  readonly tradeId: string;
  readonly revision: number;
  readonly fingerprint: string;
  /** False when the current revision already carried this fingerprint. */
  readonly changed: boolean;
}

/** One identity with the membership of its current revision. */
interface IdentityMembership {
  readonly tradeId: string;
  readonly state: "active" | "tombstoned";
  /** The revision the identity is currently at. */
  readonly revision: number;
  /** The key the identity's current revision was computed for. */
  readonly tradeKey: string;
  readonly executionIds: ReadonlySet<string>;
}

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((member) => right.has(member));

const overlaps = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  [...left].some((member) => right.has(member));

/**
 * The current membership of the given identities, read inside the caller's
 * transaction.
 *
 * Only the identities named are read: a journal with many trades must not load
 * every identity's membership to answer one question.
 */
const membershipsOf = (
  tx: JournalTx,
  tradeIds: readonly string[],
): Map<string, IdentityMembership> => {
  const memberships = new Map<string, IdentityMembership>();
  if (tradeIds.length === 0) return memberships;

  const rows = tx
    .select({
      tradeId: tradeIdentities.id,
      state: tradeIdentities.state,
      revision: tradeIdentities.revision,
      tradeKey: tradeProjectionRevisions.tradeKey,
      executionId: tradeRevisionExecutions.executionId,
    })
    .from(tradeIdentities)
    .innerJoin(
      tradeProjectionRevisions,
      and(
        eq(tradeProjectionRevisions.tradeId, tradeIdentities.id),
        eq(tradeProjectionRevisions.revision, tradeIdentities.revision),
      ),
    )
    .innerJoin(
      tradeRevisionExecutions,
      eq(tradeRevisionExecutions.revisionId, tradeProjectionRevisions.id),
    )
    .where(inArray(tradeIdentities.id, [...tradeIds]))
    .all();

  for (const row of rows) {
    const existing = memberships.get(row.tradeId);
    const executionIds = new Set(existing?.executionIds);
    executionIds.add(row.executionId);
    memberships.set(row.tradeId, {
      tradeId: row.tradeId,
      state: row.state,
      revision: row.revision,
      tradeKey: row.tradeKey,
      executionIds,
    });
  }
  return memberships;
};

/**
 * The identities in one account whose current revision holds at least one of
 * the given executions.
 *
 * These are the identities that share evidence with the projection: the only
 * ones a transfer proof or an ambiguity report may speak about. The account
 * bounds the search, because the same fill in another account belongs to a
 * different trade.
 */
const identitiesSharing = (
  tx: JournalTx,
  executionIds: readonly string[],
  accountId: string,
): string[] => {
  if (executionIds.length === 0) return [];
  return tx
    .selectDistinct({ tradeId: tradeIdentities.id })
    .from(tradeIdentities)
    .innerJoin(
      tradeProjectionRevisions,
      and(
        eq(tradeProjectionRevisions.tradeId, tradeIdentities.id),
        eq(tradeProjectionRevisions.revision, tradeIdentities.revision),
      ),
    )
    .innerJoin(
      tradeRevisionExecutions,
      eq(tradeRevisionExecutions.revisionId, tradeProjectionRevisions.id),
    )
    .where(
      and(
        inArray(tradeRevisionExecutions.executionId, [...executionIds]),
        eq(tradeIdentities.accountId, accountId),
      ),
    )
    .all()
    .map((row) => row.tradeId);
};

/**
 * The retired identity that last projected this trade key, most recently
 * retired first.
 *
 * The successor of a reappearing key is the identity that held it last, not
 * the first one that ever held it.
 */
const retiredPredecessor = (tx: JournalTx, tradeKey: string): { tradeId: string } | undefined =>
  tx
    .select({ tradeId: tradeIdentities.id })
    .from(tradeIdentities)
    .innerJoin(
      tradeProjectionRevisions,
      and(
        eq(tradeProjectionRevisions.tradeId, tradeIdentities.id),
        eq(tradeProjectionRevisions.revision, tradeIdentities.revision),
      ),
    )
    .where(
      and(eq(tradeIdentities.state, "tombstoned"), eq(tradeProjectionRevisions.tradeKey, tradeKey)),
    )
    .orderBy(desc(tradeIdentities.updatedAt), desc(tradeIdentities.createdAt))
    .get();

/**
 * Resolves the immutable identity of a projection.
 *
 * The same active key keeps its identity. A claimed transfer is retained only
 * when a unique, full execution-membership match proves it. Everything else
 * that cannot be decided returns the candidate identities instead of a guess.
 */
export const resolveIdentity = (tx: JournalTx, input: IdentityInput): IdentityResolution => {
  requireValue(input.accountId, "An identity needs an account.");
  requireValue(input.tradeKey, "An identity needs a trade key.");
  requireValue(input.operationId, "An identity needs an operation id.");

  const wanted = new Set(input.executionIds);
  const claimed = input.explicitTransferSourceId ?? null;

  // The identity that currently holds this key, if any.
  const keyOwner = tx
    .select()
    .from(tradeIdentities)
    .where(and(eq(tradeIdentities.currentKey, input.tradeKey), eq(tradeIdentities.state, "active")))
    .get();

  if (claimed) {
    // An explicit claim is honored or refused — never quietly downgraded to a
    // different identity than the one the caller proved.
    const source = tx.select().from(tradeIdentities).where(eq(tradeIdentities.id, claimed)).get();
    // The claim is judged in the account it came from: the same fill in
    // another account belongs to a different trade.
    const scope = source?.accountId ?? input.accountId;
    const candidates = identitiesSharing(tx, input.executionIds, scope);
    const memberships = membershipsOf(tx, [...new Set([...candidates, claimed])]);
    const sourceMembership = memberships.get(claimed);
    const matches = [...memberships.values()].filter(
      (membership) => membership.state === "active" && sameSet(membership.executionIds, wanted),
    );
    const keyFree = !keyOwner || keyOwner.id === claimed;
    if (
      sourceMembership?.state === "active" &&
      sameSet(sourceMembership.executionIds, wanted) &&
      matches.length === 1 &&
      keyFree
    ) {
      return {
        kind: "explicit_transfer",
        tradeId: sourceMembership.tradeId,
        nextRevision: sourceMembership.revision + 1,
      };
    }
    // A shared execution proves nothing: crossing-flat fills belong to two
    // cycles at once. Report the candidates and let the caller decide.
    const candidateIds = new Set(
      [...memberships.values()]
        .filter(
          (membership) =>
            membership.state === "active" && overlaps(membership.executionIds, wanted),
        )
        .map((membership) => membership.tradeId),
    );
    // The refused claim and the identity holding the key are evidence too:
    // a conflict that names nothing cannot be acted on.
    candidateIds.add(claimed);
    if (keyOwner) candidateIds.add(keyOwner.id);
    return { kind: "ambiguous", candidateIds: [...candidateIds].sort() };
  }

  if (keyOwner) {
    // A key belongs to the account that mapped it. A key owned by another
    // account is not this projection's identity, and adopting it would move a
    // trade between accounts without a proven transfer.
    if (keyOwner.accountId !== input.accountId) {
      return { kind: "ambiguous", candidateIds: [keyOwner.id] };
    }
    return { kind: "exact_key", tradeId: keyOwner.id, nextRevision: keyOwner.revision + 1 };
  }

  return { kind: "new", tradeId: newUuid(), nextRevision: 1 };
};

/**
 * Records the provenance of one identity superseding another.
 */
export const recordIdentityLink = (
  tx: JournalTx,
  input: {
    readonly oldId: string;
    readonly newId: string;
    readonly operationId: string;
    readonly reason: IdentityLinkReason;
    readonly recordedAt?: number;
  },
): void => {
  tx.insert(tradeIdentityLinks)
    .values({
      oldId: input.oldId,
      newId: input.newId,
      operationId: input.operationId,
      reason: input.reason,
      recordedAt: input.recordedAt ?? Date.now(),
    })
    .onConflictDoNothing()
    .run();
};

/**
 * Appends the immutable revision of a projection and its normalized execution
 * membership.
 *
 * The same fingerprint writes no revision: an unchanged projection leaves the
 * evidence exactly as it was.
 */
export const recordProjectionRevision = (
  tx: JournalTx,
  input: ProjectionRevisionInput,
): RecordedRevision => {
  const fingerprint = fingerprintProjection(input.projection);
  const recordedAt = input.recordedAt ?? Date.now();
  const { tradeId, nextRevision } = input.resolution;

  const identity = tx.select().from(tradeIdentities).where(eq(tradeIdentities.id, tradeId)).get();
  const current = identity
    ? tx
        .select()
        .from(tradeProjectionRevisions)
        .where(
          and(
            eq(tradeProjectionRevisions.tradeId, tradeId),
            eq(tradeProjectionRevisions.revision, identity.revision),
          ),
        )
        .get()
    : undefined;

  if (identity) {
    requireValue(
      input.resolution.kind !== "new",
      "A new resolution cannot continue an existing identity.",
    );
    requireValue(
      nextRevision === identity.revision + 1,
      `Revision ${nextRevision} does not follow identity revision ${identity.revision}.`,
    );
    if (input.resolution.kind !== "explicit_transfer") {
      // Only a proven transfer may move an identity to another account.
      requireValue(
        identity.accountId === input.accountId,
        "An identity stays in its account unless a proven transfer moves it.",
      );
    }
    if (current?.fingerprint === fingerprint) {
      // The projection did not change: no revision, no event.
      return {
        revisionId: current.id,
        tradeId,
        revision: current.revision,
        fingerprint,
        changed: false,
      };
    }
  } else {
    requireValue(input.resolution.kind === "new", "Only a new resolution may create an identity.");
  }

  if (identity) {
    tx.update(tradeIdentities)
      .set({
        accountId: input.accountId,
        currentKey: input.tradeKey,
        revision: nextRevision,
        updatedAt: recordedAt,
      })
      .where(eq(tradeIdentities.id, tradeId))
      .run();
  } else {
    tx.insert(tradeIdentities)
      .values({
        id: tradeId,
        accountId: input.accountId,
        currentKey: input.tradeKey,
        revision: nextRevision,
        state: "active",
        createdAt: recordedAt,
        updatedAt: recordedAt,
      })
      .run();
  }

  const revisionId = newUuid();
  tx.insert(tradeProjectionRevisions)
    .values({
      id: revisionId,
      tradeId,
      accountId: input.accountId,
      revision: nextRevision,
      tradeKey: input.tradeKey,
      fingerprint,
      resolution: input.resolution.kind,
      snapshotJson: projectionSnapshotJson(input.projection),
      recordedAt,
    })
    .run();
  for (const executionId of new Set(input.projection.executionIds)) {
    tx.insert(tradeRevisionExecutions).values({ revisionId, executionId }).run();
  }

  if (!identity) {
    // A key that reappears gets a new identity. The retired identity that
    // last held this key is recorded as its predecessor, whether or not the
    // fills changed: the succession is about the key, not the fill set.
    const predecessor = retiredPredecessor(tx, input.tradeKey);
    if (predecessor) {
      recordIdentityLink(tx, {
        oldId: predecessor.tradeId,
        newId: tradeId,
        operationId: input.operationId,
        reason: "superseded",
        recordedAt,
      });
    }
  }

  return { revisionId, tradeId, revision: nextRevision, fingerprint, changed: true };
};

/**
 * Ends the mapping of an identity: the trade it described is gone.
 *
 * The key is released, so a later reappearance of the same key gets a new
 * identity and the conclusions attached to the retired one never revive.
 */
export const retireIdentity = (
  tx: JournalTx,
  input: { readonly tradeId: string; readonly recordedAt?: number },
): void => {
  const identity = tx
    .select()
    .from(tradeIdentities)
    .where(eq(tradeIdentities.id, input.tradeId))
    .get();
  requireValue(identity, "Cannot retire an unknown trade identity.");
  tx.update(tradeIdentities)
    .set({ state: "tombstoned", currentKey: null, updatedAt: input.recordedAt ?? Date.now() })
    .where(eq(tradeIdentities.id, input.tradeId))
    .run();
};
