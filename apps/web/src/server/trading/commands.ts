import { and, eq, inArray } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { accounts, executionEvidence, executions, trades, tradeIdentities } from "@/db/schema";
import { dataDir } from "@/db/connection";
import { withJournalTransaction } from "@/db/transaction";
import { AI_PROVIDERS, isAiProvider, type AiProvider } from "@/lib/ai-settings";
import type { CurrencyConversion } from "@/lib/currencies";
import {
  deleteAccountExecutionsInTx,
  deleteExecutionsForTradesInTx,
  insertExecutionsInTx,
  type InsertResult,
} from "../executions";
import { nowIso } from "../ids";
import { ibkrTransferTimeZone, isIbkrSyncAccount } from "../ibkr-sync-timezone";
import {
  forgetPurgeLedger,
  purgeAccountIntelligence,
  recordPurgeLedger,
  requestAccountIntelligenceRebuildInTx,
  resetAccountIntelligenceInTx,
} from "../intelligence/infrastructure/retention";
import { requireValue } from "../request-error";
import {
  aiModelSetting,
  getImportTimeZoneInTx,
  getSettingInTx,
  setAiKeyInTx,
  setCompatibleBaseUrlInTx,
  setCurrentAccountIdInTx,
  setSettingInTx,
} from "../settings";
import { changeContext, reconcileAccountInTx, type ChangeContext } from "./reconcile";
import { executionMembershipKey } from "./identity";

/**
 * The trading command layer (Phase 05, extended in Phase 07).
 *
 * A command owns one transaction and one change context. The API routes call
 * these; the routes never open a transaction themselves.
 *
 * Every command below reads and writes through the transaction handle it was
 * given, so the fills, the projections, the projection revisions, the domain
 * events, the annotations, the settings and the account bookkeeping commit
 * together or not at all.
 */

export type { ChangeContext } from "../domain-events";

/**
 * Records manual fills the user entered.
 *
 * A manual trade is a live statement by the user: a position the journal has
 * not seen before is `opened`, not `discovered`.
 */
export const recordManualTrades = (
  accountId: string,
  rows: ImportedExecution[],
  manualNotes?: string,
): InsertResult =>
  withJournalTransaction((tx) =>
    insertExecutionsInTx(tx, accountId, rows, "manual", changeContext("user", "live"), manualNotes),
  );

/**
 * Records fills imported from a statement.
 *
 * An import is a reconstruction of what already happened, so a trade the journal
 * has not seen before is `discovered`, never a live closure.
 */
export const importGenericExecutions = (
  accountId: string,
  rows: ImportedExecution[],
  options?: { preserveFees?: boolean },
): InsertResult =>
  withJournalTransaction((tx) =>
    insertExecutionsInTx(
      tx,
      accountId,
      rows,
      "import",
      changeContext("import", "historical"),
      undefined,
      options,
    ),
  );

/** SQLite's bind-parameter limit. Every statement below stays under it. */
const ID_CHUNK = 500;

/** The settings a caller may change, as the route validated them. */
export interface SettingsPatch {
  timeZone?: string;
  importTimeZone?: string;
  multipliers?: Record<string, number>;
  currencyConversion?: CurrencyConversion;
  /** `null` clears the persisted single-account default. */
  currentAccountId?: string | null;
  /** Written only when the request carried a provider. */
  aiProvider?: AiProvider;
  /** The provider whose model setting `aiModel` belongs to. */
  aiModelProvider?: AiProvider;
  aiModel?: string;
  /** `null` clears the saved key of that provider. */
  aiKeys?: { anthropic?: string | null; openai?: string | null; compatible?: string | null };
  compatibleBaseUrl?: string;
}

/** The account fields a caller may change, as the route validated them. */
export interface AccountPatch {
  name?: string;
  broker?: string;
  currency?: string;
  initialBalance?: number;
  autoSync?: boolean;
  profitCalcMethod?: "fifo" | "lifo" | "wavg";
}

/**
 * Deletes the fills of the given trades and rebuilds every affected account.
 *
 * The trades are read inside the transaction, so the fills that go are the
 * fills the journal holds. A key that names no trade is ignored, and every
 * affected account is reconciled exactly once.
 */
export const deleteTrades = (keys: readonly string[], context: ChangeContext): void => {
  if (keys.length === 0) return;
  withJournalTransaction((tx) => {
    const rows: (typeof trades.$inferSelect)[] = [];
    for (let i = 0; i < keys.length; i += ID_CHUNK) {
      rows.push(
        ...tx
          .select()
          .from(trades)
          .where(inArray(trades.key, keys.slice(i, i + ID_CHUNK)))
          .all(),
      );
    }
    const byAccount = new Map<string, string[]>();
    for (const row of rows) {
      const ids = JSON.parse(row.executionIdsJson) as string[];
      byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), ...ids]);
    }
    for (const [accountId, executionIds] of byAccount) {
      deleteExecutionsForTradesInTx(tx, accountId, executionIds);
    }
    for (const accountId of byAccount.keys()) {
      reconcileAccountInTx(tx, accountId, context);
    }
  });
};

/**
 * Empties one account: its fills go, its projections become removal tombstones.
 *
 * The account itself survives, and so do the annotations on other objects.
 *
 * The evidence of the deleted fills is invalidated, not deleted: the evidence
 * sidecar has no foreign key to the fill, so its rows would otherwise survive
 * and claim a source quality for a fill that no longer exists. The membership
 * evidence is untouched — it must survive ordinary source-fill deletion.
 */
export const clearAccount = (id: string, context: ChangeContext): void => {
  withJournalTransaction((tx) => {
    const account = tx.select().from(accounts).where(eq(accounts.id, id)).get();
    requireValue(account, "Account not found.");
    const fillIds = tx
      .select({ id: executions.id })
      .from(executions)
      .where(eq(executions.accountId, id))
      .all()
      .map((row) => row.id);
    deleteAccountExecutionsInTx(tx, id);
    // The evidence of a fill that is gone can no longer claim what the source
    // proved about it.
    for (const fillId of fillIds) {
      tx.update(executionEvidence)
        .set({ timingQuality: "unknown", sourceKind: "cleared" })
        .where(eq(executionEvidence.executionId, fillId))
        .run();
    }
    // The projections disappear, so their identities are retired and their
    // removals are recorded.
    reconcileAccountInTx(tx, id, context);
    // The emptied account has no statement timezone left to keep.
    tx.update(accounts).set({ ibkrSyncTimeZone: null }).where(eq(accounts.id, id)).run();
  });
};

/**
 * Deletes one account and purges its intelligence in the same transaction.
 *
 * The account's intelligence is purged first: the evidence sidecar of its
 * fills is found through them. The identities, revisions, memberships and
 * links of the account go with the account row's own cascade.
 *
 * The deletion is recorded in the ledger, so a restore of an older backup
 * cannot bring the account back: the ledger lives beside the database and
 * survives the database being replaced.
 *
 * Deleting an account that does not exist does nothing.
 */
export const deleteAccount = (id: string, context: ChangeContext): void => {
  // The account's events are purged with the account, so this context names
  // no event that outlives the deletion.
  void context;
  const account = withJournalTransaction((tx) =>
    tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get(),
  );
  if (!account) return;

  // The ledger entry is written before the purge, so a journal that was purged
  // is never restored without the ledger that says so. A purge that then
  // fails takes its entry back.
  recordPurgeLedger(dataDir(), id, "deleted");
  try {
    withJournalTransaction((tx) => {
      purgeAccountIntelligence(tx, id);
      tx.delete(trades).where(eq(trades.accountId, id)).run();
      deleteAccountExecutionsInTx(tx, id);
      tx.delete(accounts).where(eq(accounts.id, id)).run();
      // Clear the persisted default if it pointed at the deleted account, so
      // the next picker's auto-fill falls back to the single-account rule
      // instead of a stale id.
      if (getSettingInTx(tx, "currentAccountId") === id) setCurrentAccountIdInTx(tx, null);
    });
  } catch (error) {
    forgetPurgeLedger(dataDir(), id, "deleted");
    throw error;
  }
};

/**
 * Purges one account's intelligence and suppresses its automatic reseed.
 *
 * The account survives; what the journal knew about it does not. The seed
 * checkpoint becomes `suppressed`, so the historical seed does not re-derive
 * the deleted observations and the replay seam refuses the account for the
 * same reason.
 *
 * The purge is recorded in the ledger with kind `reset`, so a restore of an
 * older backup purges the account's intelligence again instead of bringing it
 * back.
 */
export const resetAccountIntelligence = (id: string): void => {
  const account = withJournalTransaction((tx) =>
    tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get(),
  );
  requireValue(account, "Account not found.");

  // The ledger entry is written before the purge, so a journal that was purged
  // is never restored without the ledger that says so. A purge that then
  // fails takes its entry back.
  recordPurgeLedger(dataDir(), id, "reset");
  try {
    withJournalTransaction((tx) => resetAccountIntelligenceInTx(tx, id, Date.now()));
  } catch (error) {
    forgetPurgeLedger(dataDir(), id, "reset");
    throw error;
  }
};

/**
 * Asks for the intelligence of one account to be rebuilt.
 *
 * The seed checkpoint moves back to `pending` and the rebuild **enqueues the
 * seed job**, so the historical seed runs again and the account's observations
 * come back. The ledger forgets the reset: the reset has been undone.
 */
export const requestAccountIntelligenceRebuild = (id: string): void => {
  const account = withJournalTransaction((tx) =>
    tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get(),
  );
  requireValue(account, "Account not found.");
  withJournalTransaction((tx) => requestAccountIntelligenceRebuildInTx(tx, id, Date.now()));
  // The reset has been undone, so the ledger forgets it: the account's
  // intelligence is meant to come back. A deletion keeps its protection, so an
  // older backup still cannot bring a deleted account back.
  forgetPurgeLedger(dataDir(), id, "reset");
};

/**
 * Moves one account's history into another, keeping identity only where it is
 * proven.
 *
 * A trade keeps its identity only where a unique full execution-membership
 * match proves it. An ambiguous move — fills that merge with what the
 * destination already holds — is rejected before anything is written.
 */
export const transferAccount = (
  sourceId: string,
  destinationId: string,
  context: ChangeContext,
): void => {
  withJournalTransaction((tx) => {
    requireValue(sourceId !== destinationId, "Choose a different destination account.");
    const source = tx.select().from(accounts).where(eq(accounts.id, sourceId)).get();
    const destination = tx.select().from(accounts).where(eq(accounts.id, destinationId)).get();
    requireValue(source && destination, "Account not found.");

    // The source's trades and the identity each of them holds today.
    const sourceTrades = tx.select().from(trades).where(eq(trades.accountId, sourceId)).all();
    const transfers = new Map<string, string>();
    const identityOfTrade = new Map<string, string>();
    for (const trade of sourceTrades) {
      const identity = tx
        .select()
        .from(tradeIdentities)
        .where(and(eq(tradeIdentities.currentKey, trade.key), eq(tradeIdentities.state, "active")))
        .get();
      if (!identity) continue;
      identityOfTrade.set(trade.key, identity.id);
      transfers.set(
        executionMembershipKey(JSON.parse(trade.executionIdsJson) as string[]),
        identity.id,
      );
    }

    // The IBKR provenance rule, under the lock. It comes first: its refusals
    // name the provenance the move would break, whatever the fills are.
    const timeZone = ibkrTransferTimeZone(source, destination);
    if (timeZone !== undefined) {
      tx.update(accounts)
        .set({ ibkrSyncTimeZone: timeZone })
        .where(eq(accounts.id, destinationId))
        .run();
    }

    // A fill is unique per account by its content hash, so a fill the
    // destination already holds cannot move there. The move would fail with a
    // raw database error, so the collision is refused with an actionable
    // message instead.
    const sourceHashes = tx
      .select({ hash: executions.contentHash })
      .from(executions)
      .where(eq(executions.accountId, sourceId))
      .all()
      .map((row) => row.hash);
    for (let i = 0; i < sourceHashes.length; i += ID_CHUNK) {
      const collision = tx
        .select({ id: executions.id })
        .from(executions)
        .where(
          and(
            eq(executions.accountId, destinationId),
            inArray(executions.contentHash, sourceHashes.slice(i, i + ID_CHUNK)),
          ),
        )
        .limit(1)
        .get();
      requireValue(
        !collision,
        "The moved history contains a fill the destination account already holds. Delete that duplicate fill, or choose a different destination account.",
      );
    }

    // The fills move.
    tx.update(executions)
      .set({ accountId: destinationId })
      .where(eq(executions.accountId, sourceId))
      .run();

    // The destination's projections, and the proven identities that continue.
    reconcileAccountInTx(tx, destinationId, context, { transfers });

    // Every moved trade must be matched unambiguously.
    const destinationTrades = tx
      .select()
      .from(trades)
      .where(eq(trades.accountId, destinationId))
      .all();
    for (const trade of sourceTrades) {
      const membership = executionMembershipKey(JSON.parse(trade.executionIdsJson) as string[]);
      const counterparts = destinationTrades.filter(
        (candidate) =>
          executionMembershipKey(JSON.parse(candidate.executionIdsJson) as string[]) === membership,
      );
      requireValue(
        counterparts.length === 1,
        "The moved history merges with fills the destination account already holds. Move or delete those fills first, or choose a different destination account.",
      );
      const counterpart = counterparts[0]!;
      const identityId = identityOfTrade.get(trade.key);
      if (identityId) {
        const identity = tx
          .select()
          .from(tradeIdentities)
          .where(eq(tradeIdentities.id, identityId))
          .get();
        requireValue(
          identity &&
            identity.accountId === destinationId &&
            identity.currentKey === counterpart.key,
          "The moved trade could not be matched to its history in the destination account. Nothing was changed.",
        );
      }
      // The annotations follow the trade. The destination's rows exist now and
      // the source's rows still do.
      tx.update(trades)
        .set({
          notes: trade.notes,
          tagsJson: trade.tagsJson,
          mistakesJson: trade.mistakesJson,
          playbookId: trade.playbookId,
          rating: trade.rating,
          stopLoss: trade.stopLoss,
          profitTarget: trade.profitTarget,
          reviewedAt: trade.reviewedAt,
        })
        .where(eq(trades.key, counterpart.key))
        .run();
    }

    // The source's projections disappear; the identities that moved with them
    // are not retired.
    reconcileAccountInTx(tx, sourceId, context);
    tx.update(accounts).set({ ibkrSyncTimeZone: null }).where(eq(accounts.id, sourceId)).run();
  });
};

/**
 * Applies the journal settings and rebuilds every affected account in one
 * transaction.
 *
 * The multipliers are written before the rebuild reads them, so a rebuild sees
 * the new multipliers. A multiplier change rebuilds every account, in the same
 * transaction, as a maintenance recomputation.
 */
export const updateSettings = (patch: SettingsPatch): void => {
  withJournalTransaction((tx) => {
    if (patch.multipliers !== undefined) {
      setSettingInTx(tx, "multipliers", JSON.stringify(patch.multipliers));
    }
    if (patch.currencyConversion !== undefined) {
      setSettingInTx(tx, "currencyConversion", JSON.stringify(patch.currencyConversion));
    }
    // A display-only change must not silently alter the legacy import default.
    if (patch.timeZone !== undefined || patch.importTimeZone !== undefined) {
      setSettingInTx(tx, "importTimeZone", patch.importTimeZone ?? getImportTimeZoneInTx(tx));
    }
    if (patch.timeZone !== undefined) setSettingInTx(tx, "timeZone", patch.timeZone);
    if (patch.currentAccountId !== undefined) setCurrentAccountIdInTx(tx, patch.currentAccountId);
    if (patch.aiProvider !== undefined) setSettingInTx(tx, "aiProvider", patch.aiProvider);
    if (patch.aiModel !== undefined) {
      // The request names the provider whose model setting this is; when it
      // does not, the provider the journal has selected owns the setting.
      const claimed = patch.aiModelProvider ?? patch.aiProvider;
      const stored = getSettingInTx(tx, "aiProvider");
      const provider: AiProvider = claimed ?? (isAiProvider(stored) ? stored : "anthropic");
      setSettingInTx(tx, aiModelSetting(provider), patch.aiModel.trim());
    }
    for (const provider of AI_PROVIDERS) {
      const key = patch.aiKeys?.[provider];
      if (key === undefined) continue;
      setAiKeyInTx(tx, provider, key);
    }
    if (patch.compatibleBaseUrl !== undefined) {
      setCompatibleBaseUrlInTx(tx, patch.compatibleBaseUrl, patch.aiKeys?.compatible !== undefined);
    }
    if (patch.multipliers !== undefined) {
      const context = changeContext("user", "maintenance");
      for (const account of tx.select({ id: accounts.id }).from(accounts).all()) {
        reconcileAccountInTx(tx, account.id, context);
      }
    }
  });
};

/**
 * Updates one account, rebuilding it when the profit method changed.
 *
 * A new profit-calc method changes the per-exit attribution, so the account's
 * projections are recomputed in the same transaction.
 */
export const updateAccount = (id: string, patch: AccountPatch): void => {
  withJournalTransaction((tx) => {
    const current = tx.select().from(accounts).where(eq(accounts.id, id)).get();
    requireValue(current, "Account not found.");
    if (
      patch.broker !== undefined &&
      patch.broker !== current.broker &&
      isIbkrSyncAccount(current)
    ) {
      const synced = tx
        .select({ id: executions.id })
        .from(executions)
        .where(and(eq(executions.accountId, id), eq(executions.source, "sync")))
        .limit(1)
        .get();
      requireValue(
        !synced,
        "An IBKR account with synced history cannot change brokers. Connect a separate account to preserve its timestamp history.",
      );
    }
    const values: Partial<typeof accounts.$inferInsert> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.broker !== undefined) values.broker = patch.broker;
    if (patch.currency !== undefined) values.currency = patch.currency;
    if (patch.initialBalance !== undefined) values.initialBalance = patch.initialBalance;
    if (patch.autoSync !== undefined) values.autoSync = patch.autoSync;
    if (patch.profitCalcMethod !== undefined) values.profitCalcMethod = patch.profitCalcMethod;
    if (Object.keys(values).length > 0) {
      tx.update(accounts).set(values).where(eq(accounts.id, id)).run();
    }
    if (patch.profitCalcMethod && patch.profitCalcMethod !== current.profitCalcMethod) {
      reconcileAccountInTx(tx, id, changeContext("user", "maintenance"));
    }
  });
};

/**
 * Archives or unarchives one account and keeps the persisted default
 * consistent.
 *
 * Archived accounts are filtered out by the auto-fill hook, so a persisted
 * default pointing at one would silently disable auto-select.
 */
export const setAccountArchived = (id: string, archived: boolean): void => {
  withJournalTransaction((tx) => {
    tx.update(accounts)
      .set({ archivedAt: archived ? nowIso() : null })
      .where(eq(accounts.id, id))
      .run();
    if (archived && getSettingInTx(tx, "currentAccountId") === id)
      setCurrentAccountIdInTx(tx, null);
  });
};
