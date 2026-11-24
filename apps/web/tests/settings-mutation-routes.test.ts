import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImportedExecution } from "@luxalgo/journal-importers";

/**
 * The settings route (Phase 07, T-07.5).
 *
 * The route validates the request and hands one patch to the command layer;
 * the writes and the rebuilds happen in the command's transaction.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-settings-routes-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const { db, accounts, executions, trades, settings, domainOutbox, tradeProjectionRevisions } =
  await import("../src/db");
const { recordManualTrades } = await import("../src/server/trading/commands");
const { GET, PATCH } = await import("../src/app/api/settings/route");

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const ACCOUNT = "acct-one";
const OTHER = "acct-two";

const buy = (executedAt: string, price = 100, quantity = 1): ImportedExecution => ({
  symbol: "ES",
  side: "buy",
  quantity,
  price,
  fee: 0,
  executedAt,
});
const sell = (executedAt: string, price = 110, quantity = 1): ImportedExecution => ({
  symbol: "ES",
  side: "sell",
  quantity,
  price,
  fee: 0,
  executedAt,
});

const patch = (body: unknown) =>
  PATCH(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const settingRows = () => db.select().from(settings).all();
const settingValue = (key: string) => settingRows().find((row) => row.key === key)?.value ?? null;
const tradeRows = () => db.select().from(trades).all();

const seedAccount = (id: string, extra: Record<string, unknown> = {}) => {
  db.insert(accounts)
    .values({
      id,
      name: id,
      kind: "manual",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...extra,
    })
    .run();
};

beforeEach(() => {
  db.delete(trades).run();
  // Executions have no account foreign key; account deletion cannot clear deduplication state.
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  vi.stubEnv("JOURNAL_PASSWORD", "");
  seedAccount(ACCOUNT);
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("journal event capture settings", () => {
  it("defaults on without a stored setting and persists both boolean values", async () => {
    expect(await (await GET()).json()).toMatchObject({
      journalEventCapture: true,
    });
    expect(settingValue("journalEventCapture")).toBeNull();
    for (const enabled of [false, true]) {
      const response = await patch({ journalEventCapture: enabled });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ saved: true });
      expect(settingValue("journalEventCapture")).toBe(JSON.stringify(enabled));
      expect(await (await GET()).json()).toMatchObject({
        journalEventCapture: enabled,
      });
    }
  });

  it.each([null, "false", "true", 0, 1, [], {}].map((value) => [value]))(
    "rejects non-boolean %j before writing any part of the patch",
    async (journalEventCapture) => {
      const before = settingRows();
      const response = await patch({
        journalEventCapture,
        timeZone: "Europe/London",
        multipliers: { ES: 50 },
        backgroundAi: { enabled: true },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Choose whether journal event capture is enabled.",
      });
      expect(settingRows()).toEqual(before);
      expect(tradeRows()).toEqual([]);
    },
  );

  it("applies capture before multiplier reconciliation in the same patch", async () => {
    recordManualTrades(ACCOUNT, [buy("2026-09-01T10:00:00Z"), sell("2026-09-01T11:00:00Z")]);
    const eventsBefore = db.select().from(domainOutbox).all();
    const revisionsBefore = db.select().from(tradeProjectionRevisions).all().length;

    expect((await patch({ journalEventCapture: false, multipliers: { ES: 50 } })).status).toBe(200);
    expect(tradeRows()[0]?.netPnl).toBe(500);
    expect(db.select().from(domainOutbox).all()).toEqual(eventsBefore);
    expect(db.select().from(tradeProjectionRevisions).all()).toHaveLength(revisionsBefore + 1);

    expect((await patch({ journalEventCapture: true, multipliers: { ES: 25 } })).status).toBe(200);
    expect(tradeRows()[0]?.netPnl).toBe(250);
    expect(db.select().from(domainOutbox).all()).toHaveLength(eventsBefore.length + 1);
  });
});

describe("capture patch validation and transaction", () => {
  it("keeps the saved capture choice when omitted", async () => {
    expect((await patch({ journalEventCapture: false })).status).toBe(200);
    expect((await patch({ timeZone: "Europe/London" })).status).toBe(200);
    expect(settingValue("journalEventCapture")).toBe("false");
  });

  it("does not save capture when another setting is invalid", async () => {
    const response = await patch({
      journalEventCapture: false,
      timeZone: "Europe/London",
      backgroundAi: { enabled: "invalid" },
    });
    expect(response.status).toBe(400);
    expect(settingRows()).toEqual([]);
  });

  it("rolls back capture and multipliers if reconciliation fails", async () => {
    recordManualTrades(ACCOUNT, [buy("2026-09-01T10:00:00Z"), sell("2026-09-01T11:00:00Z")]);
    await patch({ journalEventCapture: false });
    const beforeTrades = tradeRows();
    const beforeSettings = settingRows();
    const beforeEvents = db.select().from(domainOutbox).all();
    db.$client.exec(
      "CREATE TRIGGER fail_capture_event BEFORE INSERT ON domain_outbox BEGIN SELECT RAISE(FAIL, 'test capture failure'); END",
    );
    try {
      expect((await patch({ journalEventCapture: true, multipliers: { ES: 50 } })).status).toBe(
        500,
      );
    } finally {
      db.$client.exec("DROP TRIGGER fail_capture_event");
    }
    expect(settingRows()).toEqual(beforeSettings);
    expect(tradeRows()).toEqual(beforeTrades);
    expect(db.select().from(domainOutbox).all()).toEqual(beforeEvents);
  });
});

describe("changing a multiplier through the settings route", () => {
  it("stores the multipliers, rebuilds every account and answers { saved: true }", async () => {
    seedAccount(OTHER);
    recordManualTrades(ACCOUNT, [buy("2026-09-01T10:00:00Z"), sell("2026-09-01T11:00:00Z")]);
    recordManualTrades(OTHER, [buy("2026-09-02T10:00:00Z"), sell("2026-09-02T11:00:00Z")]);
    expect(tradeRows().map((row) => row.netPnl)).toEqual([10, 10]);

    const response = await patch({ multipliers: { ES: 50 } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(settingValue("multipliers")).toBe(JSON.stringify({ ES: 50 }));
    // Every account is rebuilt with the new multiplier.
    expect(tradeRows().map((row) => row.netPnl)).toEqual([500, 500]);
  });
});

describe("changing the display time zone through the settings route", () => {
  it("stores the display zone and pins the legacy import default", async () => {
    const first = await patch({ timeZone: "Europe/London" });
    expect(first.status).toBe(200);
    expect(settingValue("timeZone")).toBe("Europe/London");
    // The import default is pinned to the value that was effective before the
    // display change, so a display-only change cannot alter it.
    expect(settingValue("importTimeZone")).toBe("UTC");

    await patch({ timeZone: "America/New_York" });

    expect(settingValue("timeZone")).toBe("America/New_York");
    expect(settingValue("importTimeZone")).toBe("UTC");
  });
});

describe("clearing the persisted default account through the settings route", () => {
  it("removes the stored default", async () => {
    db.insert(settings).values({ key: "currentAccountId", value: ACCOUNT }).run();

    const response = await patch({ currentAccountId: null });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(settingRows().filter((row) => row.key === "currentAccountId")).toHaveLength(0);
  });
});

describe("refusing an invalid settings change", () => {
  it("refuses a non-positive multiplier and writes nothing", async () => {
    const response = await patch({ multipliers: { ES: 0 } });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Contract multipliers must be positive numbers.",
    });
    expect(settingRows()).toHaveLength(0);
  });

  it("refuses an invalid display time zone and writes nothing", async () => {
    const response = await patch({ timeZone: "Not/AZone" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Enter a valid IANA display timezone.",
    });
    expect(settingRows()).toHaveLength(0);
  });

  it("refuses a missing conversion rate and writes nothing", async () => {
    db.delete(accounts).run();
    seedAccount(ACCOUNT, { currency: "EUR" });

    const response = await patch({
      currencyConversion: { enabled: true, reportingCurrency: "USD", rates: {} },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Enter conversion rates for EUR before enabling conversion.",
    });
    expect(settingRows()).toHaveLength(0);
  });
});
