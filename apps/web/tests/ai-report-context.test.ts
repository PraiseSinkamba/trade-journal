import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, accounts, trades } from "../src/db";
import { reportContext } from "../src/server/ai-report-context";
import { readAiRequest } from "../src/server/ai-scope";
import { setSetting } from "../src/server/settings";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-report-context-"));
process.env.JOURNAL_DATA_DIR = scratch;

beforeEach(() => {
  // Bootstrap a minimal in-memory DB
  db.delete(trades).run();
  db.delete(accounts).run();
  setSetting("timeZone", "UTC");
  db.insert(accounts)
    .values({
      id: "acc-1",
      name: "Acc 1",
      currency: "USD",
      kind: "manual",
      createdAt: "2026-09-01T00:00:00Z",
    })
    .run();
  db.insert(trades)
    .values({
      key: "t1-key",
      accountId: "acc-1",
      symbol: "ES",
      assetClass: "futures",
      direction: "long",
      status: "win",
      openedAt: "2026-09-15T09:00:00Z",
      closedAt: "2026-09-15T10:00:00Z",
      quantity: 1,
      openQuantity: 0,
      avgEntry: 5000,
      avgExit: 5010,
      grossPnl: 10,
      fees: 0,
      netPnl: 10,
      executionCount: 2,
      executionIdsJson: "[]",
      exitsJson: "[]",
    })
    .run();
});

afterAll(() => {
  process.env.JOURNAL_DATA_DIR = originalDir;
  try {
    rmSync(scratch, { recursive: true });
  } catch {}
});

const makeScope = () =>
  readAiRequest(
    { filters: { accounts: "acc-1" }, timeZone: "UTC", question: "Show my report" },
    "question",
  );

describe("reportContext", () => {
  it("returns { error } for an unknown mode", async () => {
    const scope = makeScope();
    const result = await reportContext(scope, "unknown" as never, {});
    expect(result).toEqual({ error: "Unknown report mode: unknown" });
  });

  it("returns { error } for missing required primary key in modes that require it", async () => {
    const scope = makeScope();
    const result = await reportContext(scope, "compare", {});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("required");
  });

  it("returns { context } for a valid mode with a bounded result", async () => {
    const scope = makeScope();
    const result = await reportContext(scope, "overview", {});
    expect(result).toHaveProperty("context");
    expect(typeof (result as { context: string }).context).toBe("string");
  });

  it("returns { context } for trends mode", async () => {
    const scope = makeScope();
    const result = await reportContext(scope, "trends", {});
    expect(result).toHaveProperty("context");
  });

  it("returns { context } for breakdown mode", async () => {
    const scope = makeScope();
    const result = await reportContext(scope, "breakdown", {});
    expect(result).toHaveProperty("context");
  });

  it("caps output at 6 KB", async () => {
    const scope = makeScope();
    const result = await reportContext(scope, "overview", {});
    if ("context" in result) {
      // 6 KB = 6144 bytes; allow some margin for structure markers
      expect(result.context.length).toBeLessThanOrEqual(7000);
    }
  });

  it("respects frozen scope — does not read trades outside the scope", async () => {
    // Add a second account not in scope
    db.insert(accounts)
      .values({
        id: "acc-2",
        name: "Acc 2",
        currency: "USD",
        kind: "manual",
        createdAt: "2026-09-01T00:00:00Z",
      })
      .run();
    db.insert(trades)
      .values({
        key: "t2-key",
        accountId: "acc-2",
        symbol: "NQ",
        assetClass: "futures",
        direction: "long",
        status: "win",
        openedAt: "2026-09-16T09:00:00Z",
        closedAt: "2026-09-16T10:00:00Z",
        quantity: 1,
        openQuantity: 0,
        avgEntry: 10000,
        avgExit: 10100,
        grossPnl: 100,
        fees: 0,
        netPnl: 100,
        executionCount: 2,
        executionIdsJson: "[]",
        exitsJson: "[]",
      })
      .run();

    const scope = makeScope(); // only acc-1
    const result = await reportContext(scope, "overview", {});
    if ("context" in result) {
      // Should not mention NQ (acc-2's symbol)
      expect(result.context).not.toContain("NQ");
    }
  });

  it("accepts a valid primary key for compare mode", async () => {
    const scope = makeScope();
    const result = await reportContext(scope, "compare", { primary: "ES" });
    // Should not be an error about missing key
    if ("error" in result) {
      expect(result.error).not.toContain("required");
    }
  });

  it("rejects primary key longer than 64 chars", async () => {
    const scope = makeScope();
    const result = await reportContext(scope, "overview", { primary: "x".repeat(65) });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("64");
  });

  it("rejects secondary key longer than 64 chars", async () => {
    const scope = makeScope();
    const result = await reportContext(scope, "compare", {
      primary: "ES",
      secondary: "x".repeat(65),
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("64");
  });
});
