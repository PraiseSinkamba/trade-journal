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
const { db, accounts, trades, settings } = await import("../src/db");
const { recordManualTrades } = await import("../src/server/trading/commands");
const { PATCH } = await import("../src/app/api/settings/route");

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
  db.delete(accounts).run();
  db.delete(settings).run();
  vi.stubEnv("JOURNAL_PASSWORD", "");
  seedAccount(ACCOUNT);
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
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
