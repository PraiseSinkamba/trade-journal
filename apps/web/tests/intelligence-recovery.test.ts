import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JournalDb } from "../src/db/connection";
import type * as Settings from "../src/server/settings";

const providerGuard = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Recovery must not resolve a provider.");
  }),
);
vi.mock("../src/server/settings", async (original) => ({
  ...(await original<typeof Settings>()),
  resolveAiConfiguration: providerGuard,
}));

const scratch = mkdtempSync(join(tmpdir(), "journal-intelligence-recovery-"));
process.env.JOURNAL_DATA_DIR = join(scratch, "parent");

// Import only after selecting disposable storage; application imports open a singleton.
const { db: parentDb, openConnection } = await import("../src/db");
const { resolveAiConfiguration } = await import("../src/server/settings");
const { createIntelligenceServices, OBSERVATION_HANDLER_ID, OBSERVATION_HANDLER_VERSION } =
  await import("../src/server/intelligence/composition");
const { createJobStore, createEffectStore, JOB_LEASE_MS } =
  await import("../src/server/intelligence/infrastructure/jobs");
const { createWorkerService } = await import("../src/server/intelligence/infrastructure/worker");
const { createOutboxDispatcher } = await import("../src/server/intelligence/infrastructure/outbox");

const NOW = 1_800_000_000_000;
const RECOVERED_AT = NOW + JOB_LEASE_MS + 1;
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = join(webRoot, "src");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);
const childBundle = join(scratch, "recovery-child.cjs");
const READY = "RECOVERY_READY ";

const queries = {
  trades: "SELECT * FROM trades ORDER BY key",
  revisions: "SELECT * FROM trade_projection_revisions ORDER BY id",
  events: "SELECT * FROM domain_outbox ORDER BY id",
  jobs: "SELECT * FROM intelligence_jobs ORDER BY id",
  deliveries: "SELECT * FROM event_deliveries ORDER BY event_id, handler_id, handler_version",
  checkpoints: "SELECT * FROM intelligence_seed_checkpoints ORDER BY account_id",
  observations: "SELECT * FROM intelligence_observations ORDER BY id",
  evidence: "SELECT * FROM observation_evidence ORDER BY observation_id, revision_id",
};
type Row = Record<string, unknown>;
type State = {
  trades: (Row & { key: string })[];
  revisions: (Row & { id: string })[];
  events: (Row & { id: string; payload_json: string; correlation_id: string })[];
  jobs: (Row & {
    id: string;
    type: string;
    status: string;
    idempotency_key: string;
    payload_json: string;
    fence: number;
    attempts: number;
  })[];
  deliveries: (Row & { event_id: string; job_id: string; state: string })[];
  checkpoints: (Row & {
    status: string;
    last_trade_key: string;
    baseline_operation_id: string;
  })[];
  observations: (Row & { id: string; status: string })[];
  evidence: (Row & { observation_id: string; revision_id: string })[];
};
type Boundary = {
  boundary: string;
  providerGuardArmed: boolean;
  providerAccesses: number;
  jobId: string | null;
  state: State;
  firstBatch: State | null;
};
type RunningChild = {
  process: ChildProcess;
  ready: Promise<Boundary>;
  closed: Promise<void>;
};
const children = new Set<RunningChild>();

/** Reads all durable identities, including columns whose accidental mutation would be data loss. */
const stateOf = (journal: JournalDb): State =>
  Object.fromEntries(
    Object.entries(queries).map(([name, query]) => [name, journal.$client.prepare(query).all()]),
  ) as State;

// This entry imports the real application. Only the provider resolver is replaced;
// SQLite triggers pause the real worker at transaction boundaries without replacing it.
const childSource = `
import { writeSync } from "node:fs";
import { db, accounts, withConnectionTransaction } from "@/db";
import { insertExecutionsInTx } from "@/server/executions";
import { changeContext } from "@/server/trading/reconcile";
import { resolveAiConfiguration } from "@/server/settings";
import { createIntelligenceServices } from "@/server/intelligence/composition";
import { createJobStore, createEffectStore } from "@/server/intelligence/infrastructure/jobs";
import { createWorkerService } from "@/server/intelligence/infrastructure/worker";
import { createOutboxDispatcher } from "@/server/intelligence/infrastructure/outbox";

async function main() {
  const scenario = process.argv[2];
  const now = ${NOW};
  const queries = ${JSON.stringify(queries)};
  const snapshot = () => Object.fromEntries(Object.entries(queries).map(
    ([name, query]) => [name, db.$client.prepare(query).all()]
  ));
  // Native callbacks cannot re-enter better-sqlite3. Let SQLite serialize its
  // uncommitted view before entering the blocking callback.
  const snapshotSql = "json_object(" + Object.entries(queries).map(([name, query]) => {
    const table = query.match(/FROM ([a-z_]+)/)[1];
    const columns = db.$client.pragma("table_info(" + table + ")").map(
      (column) => "'" + column.name + "'," + '"' + column.name + '"'
    ).join(",");
    return "'" + name + "',json((SELECT json_group_array(json_object(" + columns +
      ")) FROM (" + query + ")))";
  }).join(",") + ")";
  // Prove the throwing guard is active before excluding this deliberate probe.
  let armed = false;
  try { resolveAiConfiguration(); } catch (error) {
    armed = error.message === "Recovery must not resolve a provider.";
  }
  if (!armed || globalThis.__recoveryProviderAccesses !== 1) {
    throw new Error("The child provider guard is not active.");
  }
  globalThis.__recoveryProviderAccesses = 0;
  let firstBatch = null;
  const pause = (boundary, jobId, state) => {
    const message = Buffer.from(${JSON.stringify(READY)} + JSON.stringify({
      boundary, jobId, providerGuardArmed: armed,
      providerAccesses: globalThis.__recoveryProviderAccesses,
      state, firstBatch,
    }) + "\\n");
    for (let offset = 0; offset < message.length;) {
      offset += writeSync(1, message, offset, message.length - offset);
    }
    // Blocking the JS thread keeps the SQLite transaction open until SIGKILL.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    throw new Error("The recovery boundary was released without killing the child.");
  };

  db.insert(accounts).values({
    id: "recovery-account", name: "Recovery fixture", kind: "manual", createdAt: "2026-01-01",
  }).run();
  process.env.JOURNAL_EVENT_CAPTURE = scenario === "seed" ? "0" : "1";
  const symbols = scenario === "seed" ? ["RECOVERY-A", "RECOVERY-B", "RECOVERY-C"] : ["RECOVERY-A"];
  const fills = symbols.flatMap((symbol) => [
    { symbol, side: "buy", quantity: 2, price: 100, fee: 0, executedAt: "2026-09-01T10:00:00Z" },
    { symbol, side: "sell", quantity: 2, price: 103, fee: 0, executedAt: "2026-09-01T11:00:00Z" },
  ]);
  withConnectionTransaction(db, (tx) => {
    insertExecutionsInTx(tx, "recovery-account", fills, "import", changeContext("user", "historical"));
  });
  const services = createIntelligenceServices({ db, clock: () => now, seedBatchSize: 1 });
  const jobs = createJobStore(db);
  const worker = createWorkerService({
    db, jobs, effects: createEffectStore(),
    dispatcher: createOutboxDispatcher({ db, jobs, handlers: services.outboxHandlers }),
    handlers: services.handlers, clock: () => now, owner: "killed-worker",
  });

  if (scenario === "seed") {
    services.seedAccount("recovery-account", "recovery-baseline");
    firstBatch = snapshot();
  }
  db.$client.function("recovery_pause", (jobId, stateJson) => {
    pause(scenario === "event" ? "committed-event-before-dispatch" :
      scenario === "seed" ? "seed-effect-before-ack" : "observation-effect-before-ack",
      jobId, JSON.parse(stateJson));
    return 0;
  });
  if (scenario === "event") {
    db.$client.exec(
      "CREATE TRIGGER recovery_boundary BEFORE INSERT ON intelligence_jobs " +
      "BEGIN SELECT recovery_pause(NEW.id," + snapshotSql + "); END;"
    );
  } else {
    db.$client.exec(
      "CREATE TRIGGER recovery_boundary BEFORE UPDATE OF status ON intelligence_jobs " +
      "WHEN NEW.status = 'completed' AND NEW.type = '" +
      (scenario === "seed" ? "seed_account" : "evaluate_trade") + "' " +
      "BEGIN SELECT recovery_pause(NEW.id," + snapshotSql + "); END;"
    );
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await worker.tick(now))) break;
  }
  throw new Error("The worker did not reach the recovery boundary.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
`;

beforeAll(async () => {
  expect(() => resolveAiConfiguration()).toThrow("Recovery must not resolve a provider.");
  expect(providerGuard).toHaveBeenCalledOnce();
  providerGuard.mockClear();

  // Resolve the already-installed transitive bundler, not a new test dependency.
  const bundlerRequire = createRequire(require.resolve("tsup"));
  const { build } = bundlerRequire("esbuild") as {
    build(options: Record<string, unknown>): Promise<unknown>;
  };
  const settingsPath = join(sourceRoot, "server", "settings.ts");
  const nativePath = require.resolve("better-sqlite3", { paths: [webRoot] });
  await build({
    stdin: {
      contents: childSource,
      resolveDir: webRoot,
      sourcefile: "recovery-child.ts",
      loader: "ts",
    },
    outfile: childBundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    alias: {
      "@": sourceRoot,
      "@luxalgo/journal-core": join(root, "packages/core/src/index.ts"),
      "@luxalgo/journal-importers": join(root, "packages/importers/src/index.ts"),
    },
    banner: {
      js: `globalThis.__recoveryProviderAccesses = 0;
globalThis.__recoveryProviderGuard = () => {
  globalThis.__recoveryProviderAccesses++;
  throw new Error("Recovery must not resolve a provider.");
};`,
    },
    plugins: [
      {
        name: "recovery-provider-guard",
        setup(builder: {
          onLoad(
            options: { filter: RegExp },
            callback: (args: { path: string }) => { contents: string; loader: string } | undefined,
          ): void;
          onResolve(
            options: { filter: RegExp },
            callback: () => { path: string; external: boolean },
          ): void;
        }) {
          // An absolute external keeps native addon lookup independent of the scratch bundle location.
          builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({
            path: nativePath,
            external: true,
          }));
          builder.onLoad({ filter: /[\\/]server[\\/]settings\.ts$/ }, ({ path }) => {
            if (
              path !== settingsPath &&
              path.replaceAll("\\", "/") !== settingsPath.replaceAll("\\", "/")
            ) {
              return;
            }
            const original = readFileSync(path, "utf8");
            const resolver = /export const resolveAiConfiguration = \(\): \{[\s\S]*?\n\};/g;
            const matches = original.match(resolver);
            if (matches?.length !== 1) throw new Error("Cannot install the child provider guard.");
            return {
              contents: original.replace(
                resolver,
                "export const resolveAiConfiguration = () => globalThis.__recoveryProviderGuard();",
              ),
              loader: "ts",
            };
          });
        },
      },
    ],
  });
}, 60_000);

/** Starts a key-free child and waits for a synchronous readiness record, never a timing guess. */
const startChild = (
  directory: string,
  scenario: "event" | "observation" | "seed",
): RunningChild => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", JOURNAL_DATA_DIR: directory };
  // Retain OS plumbing only. No provider keys, credentials, NODE_OPTIONS or dotenv hooks survive.
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "ComSpec",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const child = spawn(process.execPath, [childBundle, scenario], {
    cwd: webRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  let errors = "";
  const { promise: closed, resolve: close } = Promise.withResolvers<void>();
  child.once("close", close);
  const { promise: ready, resolve, reject } = Promise.withResolvers<Boundary>();
  // This watchdog only bounds a broken child; readiness always comes from its stdout handshake.
  const timer = setTimeout(() => reject(new Error(`Child readiness timed out: ${errors}`)), 20_000);
  child.stdout!.setEncoding("utf8");
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    errors = (errors + chunk).slice(-8000);
  });
  child.stdout!.on("data", (chunk: string) => {
    output += chunk;
    // A pipe may split even a short record; parse only newline-terminated records.
    const lines = output.split("\n");
    output = lines.pop()!;
    const line = lines.find((value) => value.startsWith(READY));
    if (!line) return;
    clearTimeout(timer);
    try {
      resolve(JSON.parse(line.slice(READY.length)) as Boundary);
    } catch (error) {
      reject(error);
    }
  });
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once("close", (code, signal) => {
    clearTimeout(timer);
    reject(new Error(`Child exited before recovery boundary (${code}, ${signal}): ${errors}`));
  });
  const running = { process: child, ready, closed };
  children.add(running);
  return running;
};

/** Kills the blocked process and waits for handle release before opening its exact SQLite file. */
const killAtBoundary = async (directory: string, scenario: "event" | "observation" | "seed") => {
  const child = startChild(directory, scenario);
  const boundary = await child.ready;
  expect(boundary.providerGuardArmed).toBe(true);
  expect(boundary.providerAccesses).toBe(0);
  expect(child.process.kill("SIGKILL")).toBe(true);
  await child.closed;
  children.delete(child);
  return boundary;
};

/** Reclaims expired work using a deterministic clock, then drains real handlers and outbox deliveries. */
const recovery = (journal: JournalDb) => {
  const services = createIntelligenceServices({
    db: journal,
    clock: () => RECOVERED_AT,
    seedBatchSize: 1,
  });
  const jobs = createJobStore(journal);
  const worker = createWorkerService({
    db: journal,
    jobs,
    effects: createEffectStore(),
    dispatcher: createOutboxDispatcher({ db: journal, jobs, handlers: services.outboxHandlers }),
    handlers: services.handlers,
    clock: () => RECOVERED_AT,
    owner: "reopened-worker",
  });
  return {
    ...services,
    async drain() {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (!(await worker.tick(RECOVERED_AT))) return;
      }
      throw new Error("Recovered worker did not settle.");
    },
  };
};

/** Explicit replay and another connection must preserve completed business-effect identities byte for byte. */
const assertStableReopen = async (directory: string, before: State): Promise<void> => {
  const reopened = openConnection(directory);
  try {
    expect(stateOf(reopened)).toEqual(before);
    const services = recovery(reopened);
    for (const event of before.events) {
      const job = before.jobs.find((row) => {
        const payload = JSON.parse(row.payload_json) as { eventId?: string };
        return payload.eventId === event.id;
      });
      expect(job).toBeDefined();
      const id = services.requestReplay(
        event.id,
        OBSERVATION_HANDLER_ID,
        OBSERVATION_HANDLER_VERSION,
      );
      expect(id).toBe(job!.id);
      expect(
        services.requestReplay(event.id, OBSERVATION_HANDLER_ID, OBSERVATION_HANDLER_VERSION),
      ).toBe(id);
    }
    await services.drain();
    const replayed = stateOf(reopened);
    expect(replayed.observations).toEqual(before.observations);
    expect(replayed.evidence).toEqual(before.evidence);
    expect(replayed.events).toEqual(before.events);
    expect(replayed.trades).toEqual(before.trades);
    expect(replayed.revisions).toEqual(before.revisions);
    expect(replayed.jobs.map((row) => row.id)).toEqual(before.jobs.map((row) => row.id));
    expect(replayed.deliveries.every((row) => row.state === "delivered")).toBe(true);
    expect(replayed.jobs.every((row) => row.status === "completed")).toBe(true);
  } finally {
    reopened.$client.close();
  }
};

afterEach(async () => {
  try {
    for (const child of children) {
      if (child.process.exitCode === null && child.process.signalCode === null) {
        child.process.kill("SIGKILL");
      }
      await child.closed;
    }
    children.clear();
    expect(providerGuard).not.toHaveBeenCalled();
  } finally {
    providerGuard.mockClear();
  }
});

afterAll(() => {
  parentDb.$client.close();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

describe("file SQLite process-kill recovery without a provider", () => {
  it("recovers a committed trade event after killing the worker before dispatch commits", async () => {
    const directory = join(scratch, "committed-event");
    const boundary = await killAtBoundary(directory, "event");
    expect(boundary.boundary).toBe("committed-event-before-dispatch");
    expect(boundary.state.events).toHaveLength(1);
    expect(boundary.state.jobs).toEqual([]);
    const journal = openConnection(directory);
    let completed: State;
    try {
      const before = stateOf(journal);
      expect(before.events).toEqual(boundary.state.events);
      expect(before.jobs).toEqual([]);
      expect(before.observations).toEqual([]);
      expect(before.evidence).toEqual([]);
      journal.$client.exec("DROP TRIGGER recovery_boundary");
      await recovery(journal).drain();
      completed = stateOf(journal);
      expect(completed.observations).toHaveLength(1);
      expect(completed.evidence).toHaveLength(1);
      expect(completed.jobs).toHaveLength(1);
      expect(completed.jobs[0]).toMatchObject({ status: "completed", attempts: 1 });
      expect(completed.deliveries).toHaveLength(1);
      expect(completed.deliveries[0]).toMatchObject({
        event_id: before.events[0]!.id,
        job_id: completed.jobs[0]!.id,
        state: "delivered",
      });
      expect(completed.trades).toEqual(before.trades);
      expect(completed.revisions).toEqual(before.revisions);
    } finally {
      journal.$client.close();
    }
    await assertStableReopen(directory, completed!);
  }, 60_000);

  it("rolls back a real observation before acknowledgement and reclaims the same job after SIGKILL", async () => {
    const directory = join(scratch, "interrupted-observation");
    const boundary = await killAtBoundary(directory, "observation");
    expect(boundary.boundary).toBe("observation-effect-before-ack");
    expect(boundary.state.observations).toHaveLength(1);
    expect(boundary.state.evidence).toHaveLength(1);
    const interrupted = boundary.state.jobs.find((row) => row.id === boundary.jobId)!;
    expect(interrupted).toMatchObject({ status: "running", attempts: 1, fence: 1 });
    const journal = openConnection(directory);
    let completed: State;
    try {
      const before = stateOf(journal);
      expect(before.observations).toEqual([]);
      expect(before.evidence).toEqual([]);
      expect(before.jobs).toEqual(boundary.state.jobs);
      expect(before.events).toEqual(boundary.state.events);
      expect(before.deliveries[0]).toMatchObject({ job_id: interrupted.id, state: "pending" });
      journal.$client.exec("DROP TRIGGER recovery_boundary");
      await recovery(journal).drain();
      completed = stateOf(journal);
      expect(completed.jobs).toHaveLength(1);
      expect(completed.jobs[0]).toMatchObject({
        id: interrupted.id,
        idempotency_key: interrupted.idempotency_key,
        status: "completed",
        attempts: 2,
        fence: 2,
      });
      expect(completed.observations).toHaveLength(1);
      expect(completed.observations[0]!.status).toBe("active");
      expect(completed.evidence).toHaveLength(1);
      expect(completed.evidence[0]!.observation_id).toBe(completed.observations[0]!.id);
      expect(completed.evidence[0]!.revision_id).toBe(before.revisions[0]!.id);
      expect(completed.trades).toEqual(before.trades);
    } finally {
      journal.$client.close();
    }
    await assertStableReopen(directory, completed!);
  }, 60_000);

  it("keeps a committed historical seed batch and resumes its same continuation after kill and reopen", async () => {
    const directory = join(scratch, "interrupted-seed");
    const boundary = await killAtBoundary(directory, "seed");
    expect(boundary.boundary).toBe("seed-effect-before-ack");
    const first = boundary.firstBatch!;
    expect(first.events).toHaveLength(1);
    expect(first.checkpoints[0]).toMatchObject({
      status: "running",
      baseline_operation_id: "recovery-baseline",
    });
    expect(first.checkpoints[0]!.last_trade_key).toBe(first.trades[0]!.key);
    const continuation = first.jobs.find((row) => row.type === "seed_account")!;
    expect(continuation).toMatchObject({ status: "pending", attempts: 0 });
    expect(JSON.parse(continuation.payload_json)).toEqual({
      type: "seed_account",
      accountId: "recovery-account",
    });
    expect(boundary.jobId).toBe(continuation.id);
    expect(boundary.state.events).toHaveLength(2);
    expect(boundary.state.checkpoints[0]!.last_trade_key).not.toBe(
      first.checkpoints[0]!.last_trade_key,
    );
    const journal = openConnection(directory);
    let completed: State;
    try {
      const before = stateOf(journal);
      expect(before.events).toHaveLength(1);
      expect(before.events[0]!.id).toBe(first.events[0]!.id);
      expect(before.checkpoints).toEqual(first.checkpoints);
      expect(before.jobs.find((row) => row.id === continuation.id)).toMatchObject({
        status: "running",
        attempts: 1,
        fence: 1,
      });
      expect(before.trades).toEqual(first.trades);
      expect(before.revisions).toEqual(first.revisions);
      journal.$client.exec("DROP TRIGGER recovery_boundary");
      const services = recovery(journal);
      await services.drain();
      completed = stateOf(journal);
      expect(completed.checkpoints[0]).toMatchObject({
        status: "completed",
        baseline_operation_id: "recovery-baseline",
      });
      expect(completed.events).toHaveLength(3);
      expect(new Set(completed.events.map((row) => row.id)).size).toBe(3);
      for (const event of completed.events) {
        expect(JSON.parse(event.payload_json)).toMatchObject({
          kind: "discovered",
          mode: "historical",
        });
        expect(event.correlation_id).toBe("recovery-baseline");
      }
      expect(completed.jobs.find((row) => row.id === continuation.id)).toMatchObject({
        status: "completed",
        attempts: 2,
        fence: 2,
      });
      expect(completed.observations).toHaveLength(3);
      expect(completed.observations.every((row) => row.status === "active")).toBe(true);
      expect(completed.evidence).toHaveLength(3);
      expect(new Set(completed.evidence.map((row) => row.revision_id)).size).toBe(3);
      expect(completed.trades).toEqual(first.trades);
      expect(completed.revisions).toEqual(first.revisions);
      services.seedAccount("recovery-account", "must-not-restart-completed-baseline");
      expect(stateOf(journal)).toEqual(completed);
    } finally {
      journal.$client.close();
    }
    await assertStableReopen(directory, completed!);
  }, 60_000);
});
