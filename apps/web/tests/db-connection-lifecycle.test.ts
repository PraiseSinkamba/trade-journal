import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JournalDb } from "../src/db/connection";
import type { JournalTx } from "../src/db/transaction";

/**
 * Records every `unlinkSync` call so the WAL sidecar rule (ADR 0007) can be
 * asserted platform-independently: on POSIX an open `-wal`/`-shm` file is
 * unlinked silently, on Windows the unlink fails, so a file-existence
 * assertion alone does not detect the regression everywhere.
 */
const { unlinked } = vi.hoisted(() => ({ unlinked: [] as string[] }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    unlinkSync: (path: string) => {
      unlinked.push(String(path));
      return actual.unlinkSync(path);
    },
  };
});

/** Scratch directories; never a live journal directory. */
const scratchDirs: string[] = [];
const scratch = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
};

/** Every connection this file opened, so `afterAll` can close them. */
const opened: JournalDb[] = [];

/**
 * Imports the journal seams with a fresh module registry so the app singleton
 * is (re)created for `dir`. The dynamic imports are deliberate: the test
 * exercises the module-re-evaluation boundary that `vi.resetModules()` creates.
 * The seams are imported through the `@/db` barrel, the public path every
 * consumer uses, so this test also proves the barrel exports them and that the
 * transaction seam binds the same singleton generation.
 */
const loadApp = async (dir: string) => {
  process.env.JOURNAL_DATA_DIR = dir;
  vi.resetModules();
  const app = await import("../src/db");
  opened.push(app.db);
  return app;
};

const accountRow = (id: string) => ({
  id,
  name: `Account ${id}`,
  kind: "manual" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("journal connection lifecycle", () => {
  it("lets two independently opened connections see committed state", async () => {
    const app = await loadApp(scratch("journal-lifecycle-app-"));
    const dir = scratch("journal-lifecycle-two-");
    const a = app.openConnection(dir);
    const b = app.openConnection(dir);
    opened.push(a, b);

    a.insert(app.accounts).values(accountRow("two-connections")).run();

    const seen = b.select().from(app.accounts).all();
    expect(seen.map((row) => row.id)).toContain("two-connections");
  });

  it("leaves the other connection's WAL sidecars alone when one connection closes", async () => {
    const app = await loadApp(scratch("journal-lifecycle-app-"));
    const dir = scratch("journal-lifecycle-close-");
    const a = app.openConnection(dir);
    const b = app.openConnection(dir);
    opened.push(a, b);

    a.insert(app.accounts).values(accountRow("before-close")).run();
    expect(existsSync(join(dir, "journal.db-wal"))).toBe(true);

    a.$client.close();

    expect(existsSync(join(dir, "journal.db-wal"))).toBe(true);
    expect(existsSync(join(dir, "journal.db-shm"))).toBe(true);
    expect(
      b
        .select()
        .from(app.accounts)
        .all()
        .map((row) => row.id),
    ).toContain("before-close");

    b.insert(app.accounts).values(accountRow("after-close")).run();
    expect(
      b
        .select()
        .from(app.accounts)
        .all()
        .map((row) => row.id),
    ).toContain("after-close");
  });

  it("does not delete a live connection's WAL sidecars when the app singleton resets", async () => {
    const dirA = scratch("journal-lifecycle-singleton-a-");
    const dirB = scratch("journal-lifecycle-singleton-b-");

    const appA = await loadApp(dirA);
    const independent = appA.openConnection(dirA);
    opened.push(independent);
    independent.insert(appA.accounts).values(accountRow("singleton-a")).run();

    // A different data directory must reset the singleton without touching the
    // WAL sidecars of the directory the independent connection still holds.
    const appB = await loadApp(dirB);
    expect(appB.db).not.toBe(appA.db);

    expect(existsSync(join(dirA, "journal.db-wal"))).toBe(true);
    expect(existsSync(join(dirA, "journal.db-shm"))).toBe(true);
    expect(
      independent
        .select()
        .from(appA.accounts)
        .all()
        .map((row) => row.id),
    ).toContain("singleton-a");

    // ADR 0007: WAL sidecars of a live connection are never unlinked.
    expect(unlinked.filter((path) => path.endsWith("-wal") || path.endsWith("-shm"))).toEqual([]);
  });

  it("commits on success and rolls back on failure", async () => {
    const app = await loadApp(scratch("journal-lifecycle-transaction-"));

    const committed = app.withJournalTransaction((tx) => {
      tx.insert(app.accounts).values(accountRow("committed")).run();
      return "done";
    });
    expect(committed).toBe("done");
    expect(
      app.db
        .select()
        .from(app.accounts)
        .all()
        .map((row) => row.id),
    ).toContain("committed");

    expect(() =>
      app.withJournalTransaction((tx) => {
        tx.insert(app.accounts).values(accountRow("rolled-back")).run();
        throw new Error("boom");
      }),
    ).toThrow(/boom/);
    expect(
      app.db
        .select()
        .from(app.accounts)
        .all()
        .map((row) => row.id),
    ).not.toContain("rolled-back");
  });

  it("rejects a promise-returning callback at runtime, rolls back and consumes its rejection", async () => {
    const app = await loadApp(scratch("journal-lifecycle-async-"));
    const late = Promise.withResolvers<void>();

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      // Typed escape hatch: the conditional return type rejects an async callback
      // at compile time (see the compile-time case below), so this runtime case
      // has to step around the type system on purpose.
      const callback = (async (tx: JournalTx) => {
        tx.insert(app.accounts).values(accountRow("async-callback")).run();
        await late.promise;
      }) as unknown as (tx: JournalTx) => void;

      expect(() => app.withJournalTransaction(callback)).toThrow(/synchronous/i);
      expect(
        app.db
          .select()
          .from(app.accounts)
          .all()
          .map((row) => row.id),
      ).not.toContain("async-callback");

      // Reject only now, so the rejection lands after the transaction returned.
      late.reject(new Error("late rejection"));
      // Two macrotask boundaries give Node a chance to report an unhandled
      // rejection; no duration is guessed, the event is simply awaited.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("rejects a callable thenable as well as a promise", async () => {
    const app = await loadApp(scratch("journal-lifecycle-callable-"));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      // A thenable may be a function, not only an object. The callback RETURNS
      // it, so the guard sees a callable thenable rather than its result, and
      // the rejection arrives after the transaction has already returned.
      const callable = Object.assign(() => undefined, {
        then: (_resolve: unknown, reject: (reason: unknown) => void) => {
          setImmediate(() => reject(new Error("late callable rejection")));
        },
      });

      expect(() =>
        app.withJournalTransaction((() => callable) as unknown as (tx: JournalTx) => void),
      ).toThrow(/synchronous/i);

      // Two macrotask boundaries give Node a chance to report the rejection.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("rejects an async callback at compile time", async () => {
    const app = await loadApp(scratch("journal-lifecycle-compile-"));

    // Never executed: the @ts-expect-error directive is the assertion. An unused
    // directive is itself a type error, so `pnpm --filter web typecheck` proves
    // the conditional return type rejects promise-returning callbacks.
    const compileTimeOnly = () => {
      // @ts-expect-error async callbacks are not valid journal transactions
      app.withJournalTransaction(async () => undefined);
    };
    expect(typeof compileTimeOnly).toBe("function");
  });
});

afterAll(() => {
  for (const connection of opened) {
    try {
      connection.$client.close();
    } catch {
      // already closed
    }
  }
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});
