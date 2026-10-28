import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImportedExecution } from "@luxalgo/journal-importers";

/**
 * The trade delete routes (Phase 07, T-07.3).
 *
 * The routes are thin dispatchers: they validate, they hand the deletion to
 * the command layer and they keep their response shapes.
 */

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-trade-delete-routes-"));
process.env.JOURNAL_DATA_DIR = scratch;

const { db, accounts, executions, trades } = await import("../src/db");
const { insertExecutions } = await import("../src/server/executions");
const { DELETE } = await import("../src/app/api/trades/[key]/route");
const { POST: bulkPost } = await import("../src/app/api/trades/bulk/route");

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const ACCOUNT = "acct-one";
const OTHER = "acct-two";

const fill = (executedAt: string, side: "buy" | "sell"): ImportedExecution => ({
  symbol: "TEST",
  side,
  quantity: 10,
  price: side === "buy" ? 100 : 102,
  fee: 0,
  executedAt,
});

/** One closed cycle: a buy and a sell on the same day. */
const cycle = (day: string): ImportedExecution[] => [
  fill(`${day}T10:00:00Z`, "buy"),
  fill(`${day}T11:00:00Z`, "sell"),
];

const tradeRows = () => db.select().from(trades).all();
const tradeKeys = () => tradeRows().map((row) => row.key);
const executionCount = () => db.select().from(executions).all().length;

const deleteTrade = (key: string) =>
  DELETE(new Request(`http://localhost/api/trades/${key}`, { method: "DELETE" }), {
    params: Promise.resolve({ key }),
  });

const bulk = (body: unknown) =>
  bulkPost(
    new Request("http://localhost/api/trades/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const seedAccount = (id: string) =>
  db
    .insert(accounts)
    .values({ id, name: id, kind: "manual", createdAt: "2026-01-01T00:00:00.000Z" })
    .run();

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  seedAccount(ACCOUNT);
  seedAccount(OTHER);
  insertExecutions(ACCOUNT, cycle("2026-09-01"), "manual");
  insertExecutions(ACCOUNT, cycle("2026-09-02"), "manual");
});

afterAll(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("deleting one trade through the route", () => {
  it("answers 404 when the trade is gone", async () => {
    const response = await deleteTrade("no-such-trade");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Trade not found" });
  });

  it("takes the trade's fills and its row and keeps the account's other trades", async () => {
    const target = tradeRows().find((row) => row.key.includes("2026-09-01"))!;
    const survivor = tradeRows().find((row) => row.key.includes("2026-09-02"))!;
    expect(executionCount()).toBe(4);

    const response = await deleteTrade(target.key);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    // The deleted trade's two fills are gone, the other trade's two remain.
    expect(executionCount()).toBe(2);
    expect(tradeKeys()).toEqual([survivor.key]);
  });
});

describe("deleting many trades through the bulk route", () => {
  it("removes the trades of both accounts in one request", async () => {
    insertExecutions(OTHER, cycle("2026-09-03"), "manual");
    const first = tradeRows().find((row) => row.key.includes("2026-09-01"))!;
    const second = tradeRows().find((row) => row.key.includes("2026-09-02"))!;
    const other = tradeRows().find((row) => row.key.includes("2026-09-03"))!;

    const response = await bulk({ action: "delete", keys: [first.key, other.key] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 2 });
    expect(tradeKeys()).toEqual([second.key]);
    expect(executionCount()).toBe(2);
  });

  it("changes nothing when a key names no trade", async () => {
    const before = { trades: tradeKeys(), executions: executionCount() };

    const response = await bulk({ action: "delete", keys: ["no-such-trade"] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 0 });
    expect(tradeKeys()).toEqual(before.trades);
    expect(executionCount()).toBe(before.executions);
  });

  it("refuses a request without keys", async () => {
    const response = await bulk({ action: "delete", keys: [] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "keys are required" });
  });
});

describe("the other bulk actions keep their behaviour", () => {
  it("reviews and unreviews the matched trades", async () => {
    const target = tradeRows()[0]!;

    const reviewed = await bulk({ action: "review", keys: [target.key] });
    expect(await reviewed.json()).toEqual({ updated: 1 });
    expect(db.select().from(trades).get()!.reviewedAt).not.toBeNull();

    const unreviewed = await bulk({ action: "unreview", keys: [target.key] });
    expect(await unreviewed.json()).toEqual({ updated: 1 });
    expect(db.select().from(trades).get()!.reviewedAt).toBeNull();
  });

  it("tags and untags the matched trades", async () => {
    const target = tradeRows()[0]!;

    const tagged = await bulk({ action: "tag", keys: [target.key], tag: "setup" });
    expect(await tagged.json()).toEqual({ updated: 1 });
    expect(db.select().from(trades).get()!.tagsJson).toBe(JSON.stringify(["setup"]));

    const untagged = await bulk({ action: "untag", keys: [target.key], tag: "setup" });
    expect(await untagged.json()).toEqual({ updated: 1 });
    expect(db.select().from(trades).get()!.tagsJson).toBe(JSON.stringify([]));
  });

  it("sets the playbook of the matched trades", async () => {
    const target = tradeRows()[0]!;

    const response = await bulk({ action: "playbook", keys: [target.key], playbookId: "pb-1" });

    expect(await response.json()).toEqual({ updated: 1 });
    expect(db.select().from(trades).get()!.playbookId).toBe("pb-1");
  });

  it("refuses an unknown action", async () => {
    const response = await bulk({ action: "nope", keys: [tradeRows()[0]!.key] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown action" });
  });
});
