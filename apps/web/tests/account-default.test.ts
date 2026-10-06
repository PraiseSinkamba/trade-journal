import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-account-default-test-"));
process.env.JOURNAL_DATA_DIR = scratch;

const { db, settings, accounts } = await import("../src/db");
const { getCurrentAccountId, setCurrentAccountId, setSetting } =
  await import("../src/server/settings");
const { GET, PATCH } = await import("../src/app/api/settings/route");

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const patch = (body: unknown) =>
  PATCH(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const get = async () => (await GET()).json();

const seedAccount = (id: string, name: string, archived = false) => {
  db.insert(accounts)
    .values({
      id,
      name,
      broker: "",
      kind: "manual",
      archivedAt: archived ? "2025-01-01T00:00:00.000Z" : null,
      createdAt: "2025-01-01T00:00:00.000Z",
    })
    .run();
};

beforeEach(() => {
  db.delete(settings).run();
  db.delete(accounts).run();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("currentAccountId settings helpers", () => {
  it("starts unset and persists across reads", async () => {
    expect(getCurrentAccountId()).toBeNull();
    setCurrentAccountId("acct-1");
    expect(getCurrentAccountId()).toBe("acct-1");
    setCurrentAccountId(null);
    expect(getCurrentAccountId()).toBeNull();
  });

  it("round-trips through /api/settings GET and PATCH", async () => {
    expect((await get()).currentAccountId).toBeNull();
    const res = await patch({ currentAccountId: "acct-1" });
    expect(res.status).toBe(200);
    expect((await get()).currentAccountId).toBe("acct-1");
    const clear = await patch({ currentAccountId: null });
    expect(clear.status).toBe(200);
    expect((await get()).currentAccountId).toBeNull();
  });

  it("ignores unrelated PATCH bodies", async () => {
    setCurrentAccountId("acct-1");
    const res = await patch({ timeZone: "UTC" });
    expect(res.status).toBe(200);
    expect(getCurrentAccountId()).toBe("acct-1");
  });

  it("does not validate against the accounts table on write", async () => {
    // Stale ids are tolerated on write and resolved on read by the hook.
    const res = await patch({ currentAccountId: "ghost-id" });
    expect(res.status).toBe(200);
    expect(getCurrentAccountId()).toBe("ghost-id");
    setSetting("currentAccountId", "ghost-id");
    seedAccount("acct-live", "Live");
    expect(getCurrentAccountId()).toBe("ghost-id");
  });
});
