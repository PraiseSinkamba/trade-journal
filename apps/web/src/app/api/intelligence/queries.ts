import { and, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  db,
  accounts,
  intelligenceConversations,
  intelligenceMessages,
  intelligenceObservations,
  intelligenceOpportunities,
  intelligenceWorkflows,
  observationEvidence,
} from "@/db";

/**
 * The read model of the interaction routes (Phase 18).
 *
 * One module, so the routes stay thin: they resolve the scope, ask for the
 * rows of that scope and hand them to the intent builders. The queries never
 * decide anything — the scope policy and the intent rules live elsewhere.
 */

/** The scope of one request: every account, or the accounts it names. */
export interface RequestScope {
  /** True when the request named no account: the scope is every account. */
  readonly all: boolean;
  /** The account ids the scope resolves to. */
  readonly accountIds: readonly string[];
}

/**
 * Resolves the scope a request names.
 *
 * A named account that does not exist is a revoked scope: the answer is null
 * and the route refuses the request. A request that names no account is about
 * every account.
 */
export const resolveScope = (named: readonly string[] | undefined): RequestScope | null => {
  const known = db
    .select({ id: accounts.id })
    .from(accounts)
    .all()
    .map((row) => row.id);
  if (named === undefined) return { all: true, accountIds: known };
  if (named.some((id) => !known.includes(id))) return null;
  return { all: false, accountIds: [...named] };
};

/**
 * The scope filter of one column.
 *
 * A row whose account is null is journal-wide and always in scope; a row of
 * an account the scope does not name is not.
 */
const inScope = (column: AnySQLiteColumn, scope: RequestScope): SQL | undefined => {
  if (scope.all) return undefined;
  if (scope.accountIds.length === 0) return isNull(column);
  return or(inArray(column, [...scope.accountIds]), isNull(column));
};

/** The scope a `?scope=` query parameter names. */
export const scopeParam = (url: URL): string[] | undefined => {
  const raw = url.searchParams.get("scope");
  if (raw === null) return undefined;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

/** The active observations of the scope, oldest first. */
export const listObservations = (scope: RequestScope) =>
  db
    .select()
    .from(intelligenceObservations)
    .where(
      and(
        eq(intelligenceObservations.status, "active"),
        inScope(intelligenceObservations.accountId, scope),
      ),
    )
    .all();

/** One observation by id. */
export const findObservation = (id: string) =>
  db.select().from(intelligenceObservations).where(eq(intelligenceObservations.id, id)).get() ??
  null;

/**
 * The statement the observation makes, for the operator to read.
 */
export const observationText = (row: {
  tradeStatus: string;
  netPnl: number;
  currency: string;
}): string => `${row.tradeStatus} trade, net ${row.netPnl} ${row.currency}.`;

/** The evidence links of the observations. */
export const evidenceOf = (observationIds: readonly string[]) =>
  observationIds.length === 0
    ? []
    : db
        .select()
        .from(observationEvidence)
        .where(inArray(observationEvidence.observationId, [...observationIds]))
        .all();

/** The observation the evidence revision belongs to, when it belongs to one. */
export const observationOfRevision = (revisionId: string) =>
  db
    .select({ observation: intelligenceObservations })
    .from(observationEvidence)
    .innerJoin(
      intelligenceObservations,
      eq(observationEvidence.observationId, intelligenceObservations.id),
    )
    .where(eq(observationEvidence.revisionId, revisionId))
    .get()?.observation ?? null;

/** The workflows of the scope that act on the given subjects. */
export const listWorkflows = (scope: RequestScope, subjectIds: readonly string[]) =>
  subjectIds.length === 0
    ? []
    : db
        .select()
        .from(intelligenceWorkflows)
        .where(
          and(
            eq(intelligenceWorkflows.subjectType, "observation"),
            inArray(intelligenceWorkflows.subjectId, [...subjectIds]),
            inScope(intelligenceWorkflows.accountId, scope),
          ),
        )
        .all();

/** One workflow by id. */
export const findWorkflow = (id: string) =>
  db.select().from(intelligenceWorkflows).where(eq(intelligenceWorkflows.id, id)).get() ?? null;

/** The opportunity statuses an opportunity is still live in. */
const LIVE_OPPORTUNITY_STATUSES = ["pending", "eligible", "suppressed"] as const;

/**
 * The live opportunities of the scope.
 *
 * Only the rows the operator may still act on are listed: a dismissed,
 * delivered, expired or time-expired opportunity is no longer offered, and
 * the dismissal record is not an opportunity at all.
 */
export const listOpportunities = (scope: RequestScope) =>
  db
    .select()
    .from(intelligenceOpportunities)
    .where(
      and(
        inArray(intelligenceOpportunities.status, [...LIVE_OPPORTUNITY_STATUSES]),
        gt(intelligenceOpportunities.expiresAt, Date.now()),
        inScope(intelligenceOpportunities.accountId, scope),
      ),
    )
    .all();

/** One opportunity, by id or by its stored key. */
export const findOpportunity = (target: string) =>
  db
    .select()
    .from(intelligenceOpportunities)
    .where(
      or(eq(intelligenceOpportunities.id, target), eq(intelligenceOpportunities.dedupKey, target)),
    )
    .get() ?? null;

/** The open conversations of the scope. */
export const listConversations = (scope: RequestScope) =>
  db
    .select()
    .from(intelligenceConversations)
    .where(
      and(
        eq(intelligenceConversations.status, "open"),
        inScope(intelligenceConversations.accountId, scope),
      ),
    )
    .all();

/** The messages of the conversations, oldest first. */
export const listMessages = (conversationIds: readonly string[]) =>
  conversationIds.length === 0
    ? []
    : db
        .select()
        .from(intelligenceMessages)
        .where(inArray(intelligenceMessages.conversationId, [...conversationIds]))
        .all();
