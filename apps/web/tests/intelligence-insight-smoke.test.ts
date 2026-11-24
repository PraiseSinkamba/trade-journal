/**
 * The shipped worker, end to end (Phase 24).
 *
 * This suite drives the ARTIFACT, not the source: it builds the worker
 * bundle the way the release does, starts that bundle as its own process
 * against a synthetic journal, and points the journal at a loopback provider
 * stub. The worker must start, consume the capability job, store the
 * question, and the app's scoped GET must then serve it.
 *
 * It catches what a unit test cannot: a dependency the source resolves but
 * the independent bundle does not.
 *
 * The bundle is built here because the CI gate runs the tests BEFORE the
 * application build, so no prebuilt artifact exists when this runs.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ImportedExecution } from "@luxalgo/journal-importers";

const execute = promisify(execFile);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const QUESTION = "BUNDLED WORKER QUESTION: what would you change about this entry?";
const ACCOUNT = "acct-bundled";
const MODEL = "bundled-fixture";

const entry: ImportedExecution = {
  symbol: "TEST",
  side: "buy",
  quantity: 10,
  price: 100,
  fee: 0,
  executedAt: "2026-09-01T10:00:00Z",
};
const exit: ImportedExecution = {
  symbol: "TEST",
  side: "sell",
  quantity: 10,
  price: 102,
  fee: 0,
  executedAt: "2026-09-01T11:00:00Z",
};

let scratch: string;
let artifact: string;

/** The journal the synthetic case writes into. */
const journalDir = () => join(scratch, "journal data");

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "journal-bundled-smoke-"));
  artifact = join(scratch, "worker artifact");
  // The bundle is built the way the release builds it.
  await execute(
    process.execPath,
    [join(appRoot, "scripts/build-worker.mjs"), "--out-dir", artifact],
    {
      cwd: scratch,
      timeout: 90_000,
    },
  );
}, 120_000);

afterAll(() => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* the worker holds the file */
  }
});

it("the shipped worker stores the question and the app serves it", async () => {
  // The journal the synthetic case writes into: the same directory the
  // worker is started against.
  process.env.JOURNAL_DATA_DIR = journalDir();

  // The journal module opens the database when it is first evaluated, so it
  // can only be imported after the data directory is set.
  const journal = await import("../src/db");
  const { accounts, intelligenceInsights, intelligenceObservations, intelligenceWorkerLease } =
    journal;
  const db = journal.db;
  const { withJournalTransaction } = await import("../src/db/transaction");
  const { insertExecutionsInTx } = await import("../src/server/executions");
  const { changeContext } = await import("../src/server/trading/reconcile");
  const serverSettings = await import("../src/server/settings");
  const composition = await import("../src/server/intelligence/composition");
  const { GET: getObservations, POST: postObservations } =
    await import("../src/app/api/intelligence/observations/route");

  // The loopback provider stub: the only outbound call the journal may make.
  let providerCalls = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      providerCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl_bundled",
          object: "chat.completion",
          created: 1,
          model: MODEL,
          choices: [
            { index: 0, message: { role: "assistant", content: QUESTION }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  // The synthetic journal: an account, the provider settings, the background
  // policy and one live trade change.
  db.insert(accounts)
    .values({ id: ACCOUNT, name: ACCOUNT, kind: "manual", createdAt: "2026-01-01" })
    .run();
  serverSettings.setSetting("aiProvider", "compatible");
  serverSettings.setSetting("compatibleModel", MODEL);
  serverSettings.setSetting("compatibleBaseUrl", `http://127.0.0.1:${port}/v1`);
  composition.saveBackgroundPolicy({
    enabled: true,
    accounts: [ACCOUNT],
    capabilities: { tools: false, structuredOutput: false },
    maxInputCharacters: 8000,
  });
  withJournalTransaction((tx) => {
    insertExecutionsInTx(tx, ACCOUNT, [entry, exit], "import", changeContext("user", "live"));
  });

  // The SHIPPED artifact, started as its own process.
  const child = spawn(process.execPath, [join(artifact, "worker-entry.cjs")], {
    cwd: artifact,
    env: { ...process.env, JOURNAL_DATA_DIR: journalDir(), JOURNAL_WORKER_ENABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout?.on("data", (chunk) => {
    out += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    err += String(chunk);
  });

  // The worker polls the journal on its own interval, in its own process.
  // No deterministic time control can reach it, so the waits below are real
  // waits on the platform clock.
  const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    // 1. The worker starts.
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt++) {
      await waitFor(500);
      ready = out.includes('"type":"ready"');
    }
    expect(ready, `the worker never reported ready. stdout=${out} stderr=${err}`).toBe(true);

    // 2. The worker consumes the job and stores the question.
    let stored = 0;
    for (let attempt = 0; attempt < 120 && stored === 0; attempt++) {
      await waitFor(500);
      stored = db.select().from(intelligenceInsights).all().length;
    }
    expect(stored, `no question was stored. stdout=${out} stderr=${err}`).toBe(1);
    expect(db.select().from(intelligenceInsights).all()[0]!.question).toBe(QUESTION);

    // The provider was asked exactly ONCE, and it stays asked once: the
    // question is durable, so a later read must not spend another call.
    expect(providerCalls).toBe(1);
    await waitFor(2000);
    expect(providerCalls).toBe(1);
    expect(db.select().from(intelligenceInsights).all()).toHaveLength(1);

    // The worker took its lease: the bundle runs as a real consumer, not as
    // a process that merely opened the journal.
    const lease = db.select().from(intelligenceWorkerLease).all();
    expect(lease.length).toBeGreaterThan(0);
    expect(lease[0]!.owner).toBeTruthy();

    // 3. The app serves the stored result through the scoped GET. The review
    // is started first, because the question is served where a review waits.
    const observation = db.select().from(intelligenceObservations).all()[0]!;
    const start = await postObservations(
      new Request("http://localhost/api/intelligence/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ observationId: observation.id }),
      }),
    );
    expect(start.status).toBe(200);
    const served = await getObservations(
      new Request(`http://localhost/api/intelligence/observations?scope=${ACCOUNT}`),
    );
    expect(served.status).toBe(200);
    const body = (await served.json()) as {
      intents: { kind: string; insight?: { question: string } }[];
    };
    expect(body.intents).toHaveLength(1);
    expect(body.intents[0]!.insight?.question).toBe(QUESTION);
  } finally {
    // The child may already be gone — it dies early exactly when the bundle
    // is broken, which is when this cleanup runs. `once` would never settle
    // on an exited child, so the exit is awaited only while it is alive.
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 120_000);
