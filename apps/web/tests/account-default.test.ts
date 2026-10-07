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
const { DELETE } = await import("../src/app/api/accounts/[id]/route");
const { POST: accountAction } = await import("../src/app/api/accounts/[id]/actions/route");

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

const deleteRequest = (id: string) =>
  new Request(`http://localhost/api/accounts/${id}`, { method: "DELETE" });
const archiveRequest = (id: string) =>
  new Request(`http://localhost/api/accounts/${id}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "archive" }),
  });
const debug = async (res: Response) => {
  if (res.status === 200) return res;
  const body = await res.text();
  throw new Error(`status ${res.status}: ${body}`);
};
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("currentAccountId cleanup on account changes", () => {
  it("clears the persisted default when the matching account is deleted", async () => {
    seedAccount("acct-del", "Doomed");
    setCurrentAccountId("acct-del");
    expect(getCurrentAccountId()).toBe("acct-del");
    const res = await debug(await DELETE(deleteRequest("acct-del"), params("acct-del")));
    expect(res.status).toBe(200);
    expect(getCurrentAccountId()).toBeNull();
  });

  it("leaves the persisted default alone when deleting a different account", async () => {
    seedAccount("acct-keep", "Keep");
    seedAccount("acct-other", "Other");
    setCurrentAccountId("acct-keep");
    const res = await debug(await DELETE(deleteRequest("acct-other"), params("acct-other")));
    expect(res.status).toBe(200);
    expect(getCurrentAccountId()).toBe("acct-keep");
  });

  it("clears the persisted default when the matching account is archived", async () => {
    seedAccount("acct-arc", "Archive me");
    setCurrentAccountId("acct-arc");
    const res = await debug(await accountAction(archiveRequest("acct-arc"), params("acct-arc")));
    expect(res.status).toBe(200);
    expect(getCurrentAccountId()).toBeNull();
  });

  it("leaves the persisted default alone when archiving a different account", async () => {
    seedAccount("acct-keep2", "Keep2");
    seedAccount("acct-arc-other", "Archive other");
    setCurrentAccountId("acct-keep2");
    const res = await debug(
      await accountAction(archiveRequest("acct-arc-other"), params("acct-arc-other")),
    );
    expect(res.status).toBe(200);
    expect(getCurrentAccountId()).toBe("acct-keep2");
  });
});
