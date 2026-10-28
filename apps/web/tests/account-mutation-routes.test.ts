import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";

/**
 * The account mutation routes (Phase 07, T-07.4).
 *
 * The routes are thin dispatchers: they validate, hand the mutation to the
 * command layer and answer with the shapes they have always answered with.
 * These tests drive the route handlers themselves, so the whole route — the
 * validation, the dispatch and the answer — is covered.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-account-mutation-routes-"));
process.env.JOURNAL_DATA_DIR = scratch;

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const { db, accounts, executions, trades, settings } = await import("../src/db");
const { getCurrentAccountId, setCurrentAccountId } = await import("../src/server/settings");
const { recordManualTrades } = await import("../src/server/trading/commands");
const { PATCH, DELETE } = await import("../src/app/api/accounts/[id]/route");
const { POST: accountAction } = await import("../src/app/api/accounts/[id]/actions/route");

const ACCOUNT = "acct-source";
const DESTINATION = "acct-destination";

const buy = (executedAt: string, price = 100, quantity = 10): ImportedExecution => ({
  symbol: "TEST",
  side: "buy",
  quantity,
  price,
  fee: 0,
  executedAt,
});
const sell = (executedAt: string, price = 102, quantity = 10): ImportedExecution => ({
  symbol: "TEST",
  side: "sell",
  quantity,
  price,
  fee: 0,
  executedAt,
});

const seedAccount = (id: string, extra: Record<string, unknown> = {}) =>
  db
    .insert(accounts)
    .values({
      id,
      name: id,
      kind: "manual",
      broker: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...extra,
    })
    .run();

const accountRow = (id: string) => db.select().from(accounts).where(eq(accounts.id, id)).get();

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patchRequest = (id: string, body: unknown) =>
  new Request(`http://localhost/api/accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const deleteRequest = (id: string) =>
  new Request(`http://localhost/api/accounts/${id}`, { method: "DELETE" });
const actionRequest = (id: string, body: unknown) =>
  new Request(`http://localhost/api/accounts/${id}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const action = (id: string, body: unknown) => accountAction(actionRequest(id, body), params(id));

/** The account's history: one closed cycle of two fills. */
const seedHistory = (id: string) =>
  recordManualTrades(id, [buy("2026-09-01T10:00:00Z"), sell("2026-09-01T11:00:00Z")]);

beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("PATCH /api/accounts/[id]", () => {
  it("updates the account and answers { updated: true }", async () => {
    seedAccount(ACCOUNT);

    const response = await PATCH(
      patchRequest(ACCOUNT, { name: "Renamed", initialBalance: 5000, currency: "EUR" }),
      params(ACCOUNT),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: true });
    expect(accountRow(ACCOUNT)).toMatchObject({
      name: "Renamed",
      initialBalance: 5000,
      currency: "EUR",
    });
  });

  it("answers 404 Account not found for an account that is gone", async () => {
    const response = await PATCH(patchRequest("ghost", { name: "Nobody" }), params("ghost"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Account not found" });
  });
});

describe("DELETE /api/accounts/[id]", () => {
  it("removes the account with its history and clears the persisted default", async () => {
    seedAccount(ACCOUNT);
    seedHistory(ACCOUNT);
    setCurrentAccountId(ACCOUNT);

    const response = await DELETE(deleteRequest(ACCOUNT), params(ACCOUNT));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(accountRow(ACCOUNT)).toBeUndefined();
    expect(db.select().from(trades).all()).toHaveLength(0);
    expect(db.select().from(executions).all()).toHaveLength(0);
    expect(getCurrentAccountId()).toBeNull();
  });

  it("is a no-op for an account that does not exist", async () => {
    const response = await DELETE(deleteRequest("ghost"), params("ghost"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
  });
});

describe("the archive actions", () => {
  it("archives the account, clears the persisted default and answers { archived: true }", async () => {
    seedAccount(ACCOUNT);
    setCurrentAccountId(ACCOUNT);

    const response = await action(ACCOUNT, { action: "archive" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ archived: true });
    expect(accountRow(ACCOUNT)?.archivedAt).not.toBeNull();
    expect(getCurrentAccountId()).toBeNull();
  });

  it("unarchives the account and answers { archived: false }", async () => {
    seedAccount(ACCOUNT, { archivedAt: "2026-01-01T00:00:00.000Z" });

    const response = await action(ACCOUNT, { action: "unarchive" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ archived: false });
    expect(accountRow(ACCOUNT)?.archivedAt).toBeNull();
  });
});

describe("the clear action", () => {
  it("empties the account and answers { cleared: true }", async () => {
    seedAccount(ACCOUNT);
    seedHistory(ACCOUNT);

    const response = await action(ACCOUNT, { action: "clear" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cleared: true });
    expect(db.select().from(executions).all()).toHaveLength(0);
    expect(db.select().from(trades).all()).toHaveLength(0);
    // The account itself survives.
    expect(accountRow(ACCOUNT)).toBeDefined();
  });
});

describe("the transfer action", () => {
  it("moves the history and the annotations and answers { transferred: true }", async () => {
    seedAccount(ACCOUNT);
    seedAccount(DESTINATION);
    seedHistory(ACCOUNT);
    const source = db.select().from(trades).all()[0]!;
    db.update(trades)
      .set({ notes: "Held for the breakout.", rating: 4, tagsJson: JSON.stringify(["setup"]) })
      .where(eq(trades.key, source.key))
      .run();

    const response = await action(ACCOUNT, { action: "transfer", toAccountId: DESTINATION });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transferred: true });
    const moved = db.select().from(trades).all();
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      accountId: DESTINATION,
      notes: "Held for the breakout.",
      rating: 4,
      tagsJson: JSON.stringify(["setup"]),
    });
    expect(
      db
        .select()
        .from(executions)
        .all()
        .map((row) => row.accountId),
    ).toEqual([DESTINATION, DESTINATION]);
  });

  it("answers 400 and changes nothing when the move is ambiguous", async () => {
    seedAccount(ACCOUNT);
    seedAccount(DESTINATION);
    seedHistory(ACCOUNT);
    const source = db.select().from(trades).all()[0]!;
    db.update(trades)
      .set({ notes: "Held for the breakout." })
      .where(eq(trades.key, source.key))
      .run();
    // The destination already holds a fill of the same symbol: the moved
    // cycle merges with it and can no longer be matched.
    recordManualTrades(DESTINATION, [buy("2026-09-01T09:00:00Z", 99)]);
    const before = {
      executions: db.select().from(executions).all().length,
      trades: db.select().from(trades).all().length,
    };

    const response = await action(ACCOUNT, { action: "transfer", toAccountId: DESTINATION });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/merges with fills/);

    expect(db.select().from(executions).all()).toHaveLength(before.executions);
    expect(db.select().from(trades).all()).toHaveLength(before.trades);
    expect(
      db
        .select()
        .from(trades)
        .all()
        .find((row) => row.accountId === ACCOUNT)?.notes,
    ).toBe("Held for the breakout.");
  });

  it("answers 400 and changes nothing when the destination already holds the same fill", async () => {
    seedAccount(ACCOUNT);
    seedAccount(DESTINATION);
    seedHistory(ACCOUNT);
    // The destination holds a fill identical to one of the source's fills.
    recordManualTrades(DESTINATION, [buy("2026-09-01T10:00:00Z")]);
    const before = {
      executions: db.select().from(executions).all().length,
      trades: db.select().from(trades).all().length,
    };

    const response = await action(ACCOUNT, { action: "transfer", toAccountId: DESTINATION });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/destination account already holds/);
    expect(db.select().from(executions).all()).toHaveLength(before.executions);
    expect(db.select().from(trades).all()).toHaveLength(before.trades);
  });

  it("keeps its request validation", async () => {
    seedAccount(ACCOUNT);
    seedAccount(DESTINATION);

    const missing = await action(ACCOUNT, { action: "transfer" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "toAccountId is required" });

    const same = await action(ACCOUNT, { action: "transfer", toAccountId: ACCOUNT });
    expect(same.status).toBe(400);
    expect(await same.json()).toEqual({ error: "Choose a different destination account." });

    const unknown = await action(ACCOUNT, { action: "transfer", toAccountId: "ghost" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Destination account not found" });
  });
});

describe("the action dispatcher", () => {
  it("refuses an unknown action and a missing account", async () => {
    seedAccount(ACCOUNT);

    const unknown = await action(ACCOUNT, { action: "teleport" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "Unknown action" });

    const missing = await action("ghost", { action: "archive" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Account not found" });
  });
});
