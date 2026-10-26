import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExitAttribution } from "@luxalgo/journal-core";
import type { ProjectionInput } from "../src/server/trading/projection";
import type { IdentityResolution } from "../src/server/trading/identity";

/**
 * Projection identity, fingerprints and immutable revisions (Phase 03).
 *
 * Every case runs against a disposable journal. The invariants defended here are
 * product rules: a re-computed trade must not look like a different trade, a
 * changed fee must be visible, an uncertain identity must never be guessed, and
 * recorded evidence must not change under us.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-trade-identity-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const {
  db,
  accounts,
  executions,
  journalMigrations,
  tradeIdentities,
  tradeIdentityLinks,
  tradeProjectionRevisions,
  tradeRevisionExecutions,
  withJournalTransaction,
} = await import("../src/db");
const { canonicalProjectionJson, fingerprintProjection, projectionSnapshotJson } =
  await import("../src/server/trading/projection");
const { recordProjectionRevision, resolveIdentity, retireIdentity } =
  await import("../src/server/trading/identity");

const ACCOUNT = "acct-1";
const OTHER_ACCOUNT = "acct-2";
const KEY_A = `${ACCOUNT}|EURUSD|long|2026-01-02T00:00:00Z`;
const KEY_B = `${ACCOUNT}|EURUSD|long|2026-01-03T00:00:00Z`;
const KEY_C = `${ACCOUNT}|EURUSD|long|2026-01-04T00:00:00Z`;

/** A computed rebuild row with two fills and one exit. */
const projection = (overrides: Partial<ProjectionInput> = {}): ProjectionInput => ({
  accountId: ACCOUNT,
  tradeKey: KEY_A,
  symbol: "EURUSD",
  assetClass: null,
  direction: "long",
  status: "win",
  openedAt: "2026-01-02T00:00:00Z",
  closedAt: "2026-01-02T04:00:00Z",
  quantity: 10,
  openQuantity: 0,
  avgEntry: 1.1,
  avgExit: 1.2,
  grossPnl: 1,
  fees: 0.1,
  netPnl: 0.9,
  executionCount: 2,
  executionIds: ["fill-1", "fill-2"],
  exits: [{ executionId: "fill-2", grossPnl: 1, quantity: 10 }] satisfies ExitAttribution[],
  durationMs: 14_400_000,
  currency: "USD",
  timingQuality: "source_reported",
  ...overrides,
});

/** Resolves the identity of a projection the way a reconciliation pass would. */
const resolve = (tradeKey: string, executionIds: string[], sourceId?: string): IdentityResolution =>
  withJournalTransaction((tx) =>
    resolveIdentity(tx, {
      accountId: ACCOUNT,
      tradeKey,
      executionIds,
      operationId: "op-1",
      explicitTransferSourceId: sourceId ?? null,
    }),
  );

/** Records the immutable revision for a resolved projection. */
const record = (resolution: IdentityResolution, tradeKey: string, input: ProjectionInput): void => {
  if (resolution.kind === "ambiguous") throw new Error("an ambiguous resolution has no revision");
  withJournalTransaction((tx) =>
    recordProjectionRevision(tx, {
      resolution,
      accountId: ACCOUNT,
      tradeKey,
      projection: input,
      operationId: "op-1",
    }),
  );
};

/** Creates an account row so identity rows can reference it. */
const addAccount = (id: string): void => {
  db.insert(accounts)
    .values({ id, name: id, kind: "manual", createdAt: "2026-01-01" })
    .onConflictDoNothing()
    .run();
};

beforeEach(() => {
  db.delete(executions).run();
  db.delete(accounts).run();
  addAccount(ACCOUNT);
  addAccount(OTHER_ACCOUNT);
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("trade projection fingerprints", () => {
  it("leaves the fingerprint equal when only an annotation changes", () => {
    const plain = fingerprintProjection(projection());
    const annotated = fingerprintProjection(
      projection({ annotations: { notes: "held too long", rating: 4, tags: ["a"] } }),
    );
    expect(annotated).toBe(plain);
  });

  it("changes the fingerprint when the fee changes", () => {
    const before = fingerprintProjection(projection());
    const after = fingerprintProjection(projection({ fees: 0.2 }));
    expect(after).not.toBe(before);
  });

  it("changes the fingerprint when the exit attribution changes but the total does not", () => {
    // The membership and the total stay fixed: only the split of the exit
    // attribution changes, so the difference can only come from the exits.
    const before = fingerprintProjection(
      projection({
        exits: [
          { executionId: "fill-2", grossPnl: 0.6, quantity: 6 },
          { executionId: "fill-3", grossPnl: 0.4, quantity: 4 },
        ],
        executionIds: ["fill-1", "fill-2", "fill-3"],
        executionCount: 3,
      }),
    );
    const after = fingerprintProjection(
      projection({
        exits: [
          { executionId: "fill-2", grossPnl: 0.4, quantity: 4 },
          { executionId: "fill-3", grossPnl: 0.6, quantity: 6 },
        ],
        executionIds: ["fill-1", "fill-2", "fill-3"],
        executionCount: 3,
      }),
    );
    expect(after).not.toBe(before);
  });

  it("gives the same fingerprint when two exits for one fill are reordered", () => {
    const ordered = projection({
      exits: [
        { executionId: "fill-2", grossPnl: 0.6, quantity: 6 },
        { executionId: "fill-2", grossPnl: 0.4, quantity: 4 },
      ],
      executionIds: ["fill-1", "fill-2"],
    });
    const reordered = projection({
      exits: [
        { executionId: "fill-2", grossPnl: 0.4, quantity: 4 },
        { executionId: "fill-2", grossPnl: 0.6, quantity: 6 },
      ],
      executionIds: ["fill-1", "fill-2"],
    });
    expect(fingerprintProjection(reordered)).toBe(fingerprintProjection(ordered));
  });

  it("gives the same fingerprint and the same canonical JSON for reordered keys", () => {
    const ordered = projection();
    const reordered: ProjectionInput = {
      timingQuality: ordered.timingQuality,
      currency: ordered.currency,
      durationMs: ordered.durationMs,
      exits: ordered.exits,
      executionCount: ordered.executionCount,
      executionIds: ordered.executionIds,
      netPnl: ordered.netPnl,
      fees: ordered.fees,
      grossPnl: ordered.grossPnl,
      avgExit: ordered.avgExit,
      avgEntry: ordered.avgEntry,
      openQuantity: ordered.openQuantity,
      quantity: ordered.quantity,
      closedAt: ordered.closedAt,
      openedAt: ordered.openedAt,
      status: ordered.status,
      direction: ordered.direction,
      assetClass: ordered.assetClass,
      symbol: ordered.symbol,
      tradeKey: ordered.tradeKey,
      accountId: ordered.accountId,
    };

    expect(canonicalProjectionJson(reordered)).toBe(canonicalProjectionJson(ordered));
    expect(fingerprintProjection(reordered)).toBe(fingerprintProjection(ordered));

    const keys = Object.keys(JSON.parse(canonicalProjectionJson(ordered)) as object);
    expect(keys).toEqual([...keys].sort());
  });

  it("keeps the snapshot free of execution membership and inside the size cap", () => {
    const snapshot = JSON.parse(projectionSnapshotJson(projection())) as Record<string, unknown>;
    expect(snapshot.executionIds).toBeUndefined();
    expect(snapshot.exits).toBeUndefined();
    expect(projectionSnapshotJson(projection()).length).toBeLessThanOrEqual(16 * 1024);
  });
});

describe("trade identity resolution", () => {
  it("keeps the identity of an active key and advances its revision", () => {
    const first = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (first.kind !== "new") throw new Error("expected a new identity");
    record(first, KEY_A, projection());

    const second = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (second.kind !== "exact_key") throw new Error("expected an exact key resolution");
    expect(second.tradeId).toBe(first.tradeId);
    expect(second.nextRevision).toBe(2);
  });

  it("gives a reappearing key a new identity and records the succession", () => {
    const first = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (first.kind !== "new") throw new Error("expected a new identity");
    record(first, KEY_A, projection());

    withJournalTransaction((tx) => retireIdentity(tx, { tradeId: first.tradeId }));

    const second = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (second.kind !== "new") throw new Error("expected a new identity");
    expect(second.tradeId).not.toBe(first.tradeId);
    record(second, KEY_A, projection());

    const links = db.select().from(tradeIdentityLinks).all();
    expect(links).toHaveLength(1);
    expect(links[0]?.oldId).toBe(first.tradeId);
    expect(links[0]?.newId).toBe(second.tradeId);
  });

  it("records the succession when a reappearing key comes back with different fills", () => {
    const first = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (first.kind !== "new") throw new Error("expected a new identity");
    record(first, KEY_A, projection());

    withJournalTransaction((tx) => retireIdentity(tx, { tradeId: first.tradeId }));

    // The key comes back, but the cycle is made of different fills now.
    const second = resolve(KEY_A, ["fill-3", "fill-4"]);
    if (second.kind !== "new") throw new Error("expected a new identity");
    record(second, KEY_A, projection({ executionIds: ["fill-3", "fill-4"], executionCount: 2 }));

    expect(second.tradeId).not.toBe(first.tradeId);

    // The retired identity stays retired, and the succession is recorded.
    const identities = db.select().from(tradeIdentities).all();
    const retired = identities.find((row) => row.id === first.tradeId);
    expect(retired?.state).toBe("tombstoned");
    expect(retired?.currentKey).toBeNull();

    const links = db.select().from(tradeIdentityLinks).all();
    expect(links).toHaveLength(1);
    expect(links[0]?.oldId).toBe(first.tradeId);
    expect(links[0]?.newId).toBe(second.tradeId);
  });

  it("refuses to continue an identity that only shares a crossing execution", () => {
    const first = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (first.kind !== "new") throw new Error("expected a new identity");
    record(first, KEY_A, projection());

    // A crossing fill belongs to both halves of the split cycle, so the two
    // cycles share one execution.
    const second = resolve(KEY_B, ["fill-2", "fill-3"]);
    if (second.kind !== "new") throw new Error("expected a new identity");
    record(second, KEY_B, projection({ tradeKey: KEY_B, executionIds: ["fill-2", "fill-3"] }));

    // Claiming the first identity for a projection that holds only the
    // crossing fill proves nothing: the shared fill belongs to two cycles.
    const claimed = resolve(KEY_C, ["fill-2"], first.tradeId);
    expect(claimed.kind).toBe("ambiguous");
    if (claimed.kind !== "ambiguous") throw new Error("expected an ambiguous resolution");
    expect(claimed.candidateIds).toEqual(expect.arrayContaining([first.tradeId, second.tradeId]));
  });

  it("keeps the identity when an explicit transfer has a unique full membership match", () => {
    const first = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (first.kind !== "new") throw new Error("expected a new identity");
    record(first, KEY_A, projection());

    const transfer = resolve(KEY_B, ["fill-1", "fill-2"], first.tradeId);
    expect(transfer.kind).toBe("explicit_transfer");
    if (transfer.kind !== "explicit_transfer") throw new Error("expected a proven transfer");
    expect(transfer.tradeId).toBe(first.tradeId);
    expect(transfer.nextRevision).toBe(2);
  });

  it("refuses to guess when a transfer matches more than one identity", () => {
    const first = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (first.kind !== "new") throw new Error("expected a new identity");
    record(first, KEY_A, projection());

    const twin = resolve(KEY_B, ["fill-1", "fill-2"]);
    if (twin.kind !== "new") throw new Error("expected a new identity");
    record(twin, KEY_B, projection({ tradeKey: KEY_B }));

    const claimed = resolve(KEY_C, ["fill-1", "fill-2"], first.tradeId);
    expect(claimed.kind).toBe("ambiguous");
    if (claimed.kind !== "ambiguous") throw new Error("expected an ambiguous resolution");
    expect(claimed.candidateIds).toEqual(expect.arrayContaining([first.tradeId, twin.tradeId]));
  });

  it("keeps the identity when the claimed transfer already holds the key", () => {
    const first = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (first.kind !== "new") throw new Error("expected a new identity");
    record(first, KEY_A, projection());

    // The same identity is claimed for the key it already holds.
    const again = resolve(KEY_A, ["fill-1", "fill-2"], first.tradeId);
    expect(again.kind).toBe("explicit_transfer");
    if (again.kind !== "explicit_transfer") throw new Error("expected a proven transfer");
    expect(again.tradeId).toBe(first.tradeId);
  });

  it("refuses a claimed transfer whose key is held by another identity", () => {
    const first = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (first.kind !== "new") throw new Error("expected a new identity");
    record(first, KEY_A, projection());

    // Another identity already holds KEY_B.
    const holder = resolve(KEY_B, ["fill-1", "fill-2"]);
    if (holder.kind !== "new") throw new Error("expected a new identity");
    record(holder, KEY_B, projection({ tradeKey: KEY_B }));

    // The first identity proves its membership, but KEY_B is taken.
    const claimed = resolve(KEY_B, ["fill-1", "fill-2"], first.tradeId);
    expect(claimed.kind).toBe("ambiguous");
    if (claimed.kind !== "ambiguous") throw new Error("expected an ambiguous resolution");
    expect(claimed.candidateIds).toEqual(expect.arrayContaining([first.tradeId, holder.tradeId]));
  });

  it("does not adopt a key that belongs to another account", () => {
    const first = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (first.kind !== "new") throw new Error("expected a new identity");
    record(first, KEY_A, projection());

    // The same key, presented under a different account, is not this
    // projection's identity: it must never move the trade between accounts.
    const foreign = withJournalTransaction((tx) =>
      resolveIdentity(tx, {
        accountId: OTHER_ACCOUNT,
        tradeKey: KEY_A,
        executionIds: ["fill-1", "fill-2"],
        operationId: "op-2",
        explicitTransferSourceId: null,
      }),
    );
    expect(foreign.kind).toBe("ambiguous");
    if (foreign.kind !== "ambiguous") throw new Error("expected an ambiguous resolution");
    expect(foreign.candidateIds).toEqual([first.tradeId]);

    // The identity is untouched: still owned by its own account.
    const owner = db.select().from(tradeIdentities).all();
    expect(owner).toHaveLength(1);
    expect(owner[0]?.accountId).toBe(ACCOUNT);
  });

  it("lets a proven transfer move an identity to the destination account", () => {
    const first = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (first.kind !== "new") throw new Error("expected a new identity");
    record(first, KEY_A, projection());

    const transferredKey = `${OTHER_ACCOUNT}|EURUSD|long|2026-01-02T00:00:00Z`;
    const transfer = withJournalTransaction((tx) =>
      resolveIdentity(tx, {
        accountId: OTHER_ACCOUNT,
        tradeKey: transferredKey,
        executionIds: ["fill-1", "fill-2"],
        operationId: "op-2",
        explicitTransferSourceId: first.tradeId,
      }),
    );
    expect(transfer.kind).toBe("explicit_transfer");
    if (transfer.kind !== "explicit_transfer") throw new Error("expected a proven transfer");
    expect(transfer.tradeId).toBe(first.tradeId);
  });

  it("ignores an identity in another account that shares the same membership", () => {
    const first = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (first.kind !== "new") throw new Error("expected a new identity");
    record(first, KEY_A, projection());

    // An unrelated account holds the same fills under its own key.
    const foreignKey = `${OTHER_ACCOUNT}|EURUSD|long|2026-01-02T00:00:00Z`;
    const foreign = withJournalTransaction((tx) =>
      resolveIdentity(tx, {
        accountId: OTHER_ACCOUNT,
        tradeKey: foreignKey,
        executionIds: ["fill-1", "fill-2"],
        operationId: "op-2",
        explicitTransferSourceId: null,
      }),
    );
    if (foreign.kind !== "new") throw new Error("expected a new identity");
    withJournalTransaction((tx) =>
      recordProjectionRevision(tx, {
        resolution: foreign,
        accountId: OTHER_ACCOUNT,
        tradeKey: foreignKey,
        projection: projection({ accountId: OTHER_ACCOUNT, tradeKey: foreignKey }),
        operationId: "op-2",
      }),
    );

    // The claimed transfer in the first account is still provable: the other
    // account's identity does not compete for it.
    const transfer = resolve(KEY_A, ["fill-1", "fill-2"], first.tradeId);
    expect(transfer.kind).toBe("explicit_transfer");
    if (transfer.kind !== "explicit_transfer") throw new Error("expected a proven transfer");
    expect(transfer.tradeId).toBe(first.tradeId);
  });
});

describe("immutable projection revisions", () => {
  it("keeps the recorded evidence after the source fills are deleted", () => {
    db.insert(executions)
      .values({
        id: "fill-1",
        accountId: ACCOUNT,
        symbol: "EURUSD",
        side: "buy",
        quantity: 10,
        price: 1.1,
        fee: 0,
        executedAt: "2026-01-02T00:00:00Z",
        source: "import",
        contentHash: "hash-1",
        createdAt: "2026-01-02",
      })
      .run();

    const resolution = resolve(KEY_A, ["fill-1", "fill-2"]);
    record(resolution, KEY_A, projection());

    db.delete(executions).run();

    const memberships = db.select().from(tradeRevisionExecutions).all();
    expect(memberships.map((row) => row.executionId).sort()).toEqual(["fill-1", "fill-2"]);
    const revisions = db.select().from(tradeProjectionRevisions).all();
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.fingerprint).toBe(fingerprintProjection(projection()));
  });

  it("refuses a second revision under the same identity and revision number", () => {
    const resolution = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (resolution.kind !== "new") throw new Error("expected a new identity");
    record(resolution, KEY_A, projection());

    const again = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (again.kind !== "exact_key") throw new Error("expected an exact key resolution");
    expect(() => {
      withJournalTransaction((tx) =>
        recordProjectionRevision(tx, {
          resolution: { kind: "exact_key", tradeId: again.tradeId, nextRevision: 1 },
          accountId: ACCOUNT,
          tradeKey: KEY_A,
          projection: projection(),
          operationId: "op-2",
        }),
      );
    }).toThrow();
  });

  it("writes no revision when the projection is unchanged", () => {
    const resolution = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (resolution.kind !== "new") throw new Error("expected a new identity");
    record(resolution, KEY_A, projection());

    const again = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (again.kind !== "exact_key") throw new Error("expected an exact key resolution");
    const recorded = withJournalTransaction((tx) =>
      recordProjectionRevision(tx, {
        resolution: { kind: "exact_key", tradeId: again.tradeId, nextRevision: again.nextRevision },
        accountId: ACCOUNT,
        tradeKey: KEY_A,
        projection: projection(),
        operationId: "op-2",
      }),
    );

    expect(recorded.changed).toBe(false);
    expect(db.select().from(tradeProjectionRevisions).all()).toHaveLength(1);
  });

  it("writes a new revision when the fee changes under the same key", () => {
    const resolution = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (resolution.kind !== "new") throw new Error("expected a new identity");
    record(resolution, KEY_A, projection());

    const again = resolve(KEY_A, ["fill-1", "fill-2"]);
    if (again.kind !== "exact_key") throw new Error("expected an exact key resolution");
    const recorded = withJournalTransaction((tx) =>
      recordProjectionRevision(tx, {
        resolution: { kind: "exact_key", tradeId: again.tradeId, nextRevision: again.nextRevision },
        accountId: ACCOUNT,
        tradeKey: KEY_A,
        projection: projection({ fees: 0.2 }),
        operationId: "op-2",
      }),
    );

    expect(recorded.changed).toBe(true);
    expect(recorded.revision).toBe(2);
    expect(db.select().from(tradeProjectionRevisions).all()).toHaveLength(2);
  });
});

describe("projection schema", () => {
  it("applies migration 0002 and creates the five projection tables", () => {
    const applied = db.select().from(journalMigrations).all();
    expect(applied.map((row) => row.version).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(applied.find((row) => row.version === 2)?.name).toBe("trade-projections");

    const tables = (
      db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "trade_identities",
        "trade_projection_revisions",
        "trade_revision_executions",
        "trade_identity_links",
        "execution_evidence",
      ]),
    );
    expect(db.select().from(tradeIdentities).all()).toEqual([]);
  });
});
