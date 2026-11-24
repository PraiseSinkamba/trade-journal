#!/usr/bin/env node
import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * The packaged supervisor the benchmark starts.
 *
 * It is a path, not a fixed location, so the same script can measure the
 * baseline build and the candidate build on the same machine: the gate is a
 * comparison between two builds, not between two worker modes.
 */
const defaultSupervisorPath = join(
  repositoryRoot,
  "apps",
  "web",
  ".next",
  "standalone",
  "apps",
  "web",
  "scripts",
  "run-journal.mjs",
);
const BATCH_SIZE = 500;
const P95_REGRESSION_LIMIT_PERCENT = 20;
const QUEUE_DRAIN_TIMEOUT_MS = 10 * 60_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * The worker modes the benchmark measures.
 *
 * The idle mode runs no consumer, so it has no queue to drain: its queue
 * state is not applicable and must never be reported as a failed drain.
 */
const WORKER_MODES = {
  idle: { worker: "disabled", hasQueue: false },
  active: { worker: "enabled", hasQueue: true },
};

/**
 * Whether the journal's capture switch is on for a configured value.
 *
 * The rule mirrors the journal's own check, so the benchmark reports what
 * the journal would do with the value the run was actually given.
 */
function eventCaptureEnabled(value) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

/** Parse and validate the benchmark command line. */
export function parseArguments(args = process.argv.slice(2)) {
  const options = {
    volumes: [1000, 10000, 100000],
    dataDir: undefined,
    port: undefined,
    out: resolve("benchmark-intelligence.json"),
    keep: false,
    samples: 30,
    repetitions: 3,
    supervisor: defaultSupervisorPath,
    compareSupervisor: undefined,
    compareLabel: "baseline",
    label: "candidate",
  };
  const valueFlags = new Set([
    "volumes",
    "data-dir",
    "port",
    "out",
    "samples",
    "repetitions",
    "supervisor",
    "compare-supervisor",
    "compare-label",
    "label",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const name = flag?.replace(/^--/, "");
    if (flag === "--keep") {
      options.keep = true;
      continue;
    }
    if (!flag?.startsWith("--") || !valueFlags.has(name)) {
      throw new Error(`Invalid benchmark argument: ${flag}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    index += 1;
    if (name === "volumes") {
      options.volumes = value.split(",").map((part) => Number(part));
    } else if (name === "data-dir") {
      options.dataDir = value;
    } else if (name === "port") {
      options.port = Number(value);
    } else if (name === "out") {
      options.out = resolve(value);
    } else if (name === "samples") {
      options.samples = Number(value);
    } else if (name === "repetitions") {
      options.repetitions = Number(value);
    } else if (name === "supervisor") {
      options.supervisor = resolve(value);
    } else if (name === "compare-supervisor") {
      options.compareSupervisor = resolve(value);
    } else if (name === "compare-label") {
      options.compareLabel = value;
    } else if (name === "label") {
      options.label = value;
    }
  }
  if (!options.dataDir) throw new Error("--data-dir is required");
  if (!isAbsolute(options.dataDir)) throw new Error("--data-dir must be an absolute path");
  if (
    options.volumes.length === 0 ||
    options.volumes.some((volume) => !Number.isSafeInteger(volume) || volume <= 0)
  ) {
    throw new Error("--volumes must contain positive integers");
  }
  if (!Number.isSafeInteger(options.samples) || options.samples <= 0) {
    throw new Error("--samples must be a positive integer");
  }
  if (!Number.isSafeInteger(options.repetitions) || options.repetitions <= 0) {
    throw new Error("--repetitions must be a positive integer");
  }
  if (
    options.port !== undefined &&
    (!Number.isSafeInteger(options.port) ||
      options.port <= 1024 ||
      options.port > 65535 ||
      options.port === 3000 ||
      options.port === 3001)
  ) {
    throw new Error("--port must be an unreserved port from 1025 to 65535");
  }
  options.dataDir = resolve(options.dataDir);
  options.volumes = [...new Set(options.volumes)];
  return options;
}

/**
 * Resolve the baseline's real entrypoint. Builds before intelligence shipped
 * server.js, not the supervisor or worker; never borrow the candidate's runtime.
 */
function resolveComparisonLaunch(supervisor, pathExists = existsSync) {
  if (pathExists(supervisor)) {
    return { supervisor, standalone: basename(supervisor) === "server.js" };
  }
  const server = resolve(dirname(supervisor), "..", "server.js");
  if (basename(supervisor) === "run-journal.mjs" && pathExists(server)) {
    return { supervisor: server, standalone: true };
  }
  throw new Error(
    `Baseline launcher not found: ${supervisor}; standalone server not found: ${server}`,
  );
}

/** Return an interpolated percentile for measured millisecond values. */
export function percentile(values, percent) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (percent / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

const rounded = (value) =>
  value === null || value === undefined ? null : Math.round(value * 1000) / 1000;

/** Return a measured latency distribution without inventing a value for an empty set. */
function latencyDistribution(values) {
  return {
    sampleCount: values.length,
    p50: rounded(percentile(values, 50)),
    p95: rounded(percentile(values, 95)),
  };
}

/** Consume the first actual read as warmup; summarize every remaining read in place. */
function summarizeReadLatency(loadDurations, restDurations) {
  // Load reads happen first; only a run without them needs a rest-read warmup.
  const warm = loadDurations.length > 0 ? loadDurations.shift() : restDurations.shift();
  return {
    ...latencyDistribution([...loadDurations, ...restDurations]),
    warmupMs: rounded(warm),
    loadSampleCount: loadDurations.length,
    restSampleCount: restDurations.length,
  };
}

/** Find an available loopback port, preferring the requested base when present. */
async function findFreePort(base) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const requested = base === undefined ? 0 : base + attempt;
    if (requested > 65535) break;
    if (requested === 3000 || requested === 3001) continue;
    const server = createServer();
    try {
      await new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(requested, "127.0.0.1", resolveListen);
      });
      const address = server.address();
      if (address && typeof address === "object") {
        await new Promise((resolveClose) => server.close(resolveClose));
        return address.port;
      }
    } catch (error) {
      await new Promise((resolveClose) => server.close(resolveClose));
      if (error?.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("No free loopback port is available");
}

/**
 * Collect the worker's own error codes while it runs.
 *
 * A busy journal is classified in the worker's memory and published in its
 * health payload; it never reaches a row's `last_error`, because the work
 * stays pending and is retried. This watch is therefore the only place the
 * busy classification can be counted.
 */
function createBusyWatch() {
  const codes = new Map();
  return {
    record(code) {
      if (typeof code !== "string" || code === "null") return;
      codes.set(code, (codes.get(code) ?? 0) + 1);
    },
    counts() {
      return Object.fromEntries(codes);
    },
    busy() {
      return codes.get("journal_busy") ?? 0;
    },
  };
}

/** Wait for the supervisor's HTTP-backed readiness and, when active, worker readiness. */
function waitForReady(child, requireWorker, busyWatch, standaloneUrl) {
  return new Promise((resolveReady, rejectReady) => {
    let stdout = "";
    let stderr = "";
    let httpReady = false;
    let workerReady = !requireWorker;
    let probeTimer;
    let probing = false;
    const timer = setTimeout(() => {
      cleanup();
      rejectReady(new Error(`Journal startup timed out: ${stderr || stdout}`));
    }, 60_000);
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(probeTimer);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const onStdout = (chunk) => {
      stdout += String(chunk);
      for (const line of stdout.split(/\r?\n/)) {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        // The worker reports a busy journal in its health payload; that is the
        // only place the classification exists, so it is counted here.
        if (message.type === "health" && message.workerHealth?.worker?.lastErrorCode) {
          busyWatch?.record(message.workerHealth.worker.lastErrorCode);
        }
        if (message.type === "ready") {
          httpReady = true;
          if (message.worker === "ready") workerReady = true;
        }
        if (message.type === "health" && message.worker === "ready") workerReady = true;
        if (httpReady && workerReady) {
          cleanup();
          resolveReady(message);
          return;
        }
      }
    };
    const onStderr = (chunk) => {
      stderr += String(chunk);
    };
    const onExit = (code) => {
      cleanup();
      rejectReady(new Error(`Journal exited before readiness (${code}): ${stderr || stdout}`));
    };
    const onError = (error) => {
      cleanup();
      rejectReady(error);
    };
    // Old standalone builds have no readiness IPC. Probe the same real HTTP
    // endpoint used to create the benchmark account before starting the load.
    if (standaloneUrl) {
      probeTimer = setInterval(async () => {
        if (probing) return;
        probing = true;
        try {
          const response = await fetch(`${standaloneUrl}/api/accounts`, {
            signal: AbortSignal.timeout(1000),
          });
          await response.body?.cancel();
          if (response.status === 200) {
            cleanup();
            resolveReady({ type: "ready", worker: "unavailable" });
          }
        } catch {
          // Connection refusal while Next starts is expected until the deadline.
        } finally {
          probing = false;
        }
      }, 100);
    }
    // The stdout listener stays attached after readiness: the busy
    // classification is published only while the worker runs.
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

/** Stop a supervised tree via IPC, or an older standalone server via SIGTERM. */
async function stopSupervisor(child, standalone = false) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  if (standalone) child.kill("SIGTERM");
  else if (child.connected) child.send({ type: "shutdown" }, () => {});
  const timer = setTimeout(() => {
    if (process.platform === "win32") {
      spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  }, SHUTDOWN_TIMEOUT_MS);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

/** Send one JSON HTTP request and return its status, body, and elapsed duration. */
async function requestJson(url, init = {}) {
  const started = performance.now();
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10 * 60_000),
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await response.text();
  const durationMs = performance.now() - started;
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body, durationMs };
}

/** Create the one account used by a benchmark run. */
async function createAccount(baseUrl, volume, mode) {
  const response = await requestJson(`${baseUrl}/api/accounts`, {
    method: "POST",
    body: JSON.stringify({
      name: `bench ${volume} ${mode}`,
      kind: "manual",
      currency: "USD",
    }),
  });
  if (response.status !== 200 || typeof response.body?.id !== "string") {
    throw new Error(
      `Account creation failed (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }
  return response.body.id;
}

/** Build one unique execution batch. Each batch opens and closes one complete round trip. */
function executionBatch(start, count) {
  const executions = [];
  const baseTime = Date.UTC(2026, 0, 1);
  for (let offset = 0; offset < count; offset += 1) {
    const index = start + offset;
    const isExit = count === BATCH_SIZE && offset === count - 1;
    executions.push({
      symbol: "BENCH",
      side: isExit ? "sell" : "buy",
      quantity: isExit ? count - 1 : 1,
      price: 100 + index * 0.01,
      fee: 0,
      executedAt: new Date(baseTime + index * 1000).toISOString(),
      assetClass: "equity",
    });
  }
  return executions;
}

/** Ingest every fill through the production HTTP route and time each write transaction. */
async function ingestExecutions(baseUrl, accountId, volume, onBatch) {
  const requestDurations = [];
  let reportedInserted = 0;
  const failures = [];
  for (let start = 0; start < volume; start += BATCH_SIZE) {
    const count = Math.min(BATCH_SIZE, volume - start);
    const response = await requestJson(`${baseUrl}/api/executions`, {
      method: "POST",
      body: JSON.stringify({ accountId, executions: executionBatch(start, count) }),
    });
    requestDurations.push(response.durationMs);
    if (response.status !== 200) {
      // A refused or failed batch is evidence, not noise: keep the first
      // failures verbatim so the report can name the cause.
      failures.push({
        status: response.status,
        fills: count,
        error: typeof response.body === "string" ? response.body : (response.body?.error ?? null),
      });
      continue;
    }
    reportedInserted += response.body?.inserted ?? 0;
    // The read is taken at the batch boundary, so both worker modes read the
    // same sequence of journal sizes. Sampling on a wall clock instead would
    // compare one mode's early journal against the other's late journal.
    if (onBatch) await onBatch();
  }
  return { requestDurations, reportedInserted, failures };
}

/**
 * Read the trade list once and return how long it took.
 *
 * The read is issued against the journal as it stands, so the caller decides
 * when it happens: at a batch boundary, or after the load.
 */
async function readOnce(baseUrl, accountId) {
  const started = performance.now();
  const response = await fetch(
    `${baseUrl}/api/trades?view=list&accounts=${encodeURIComponent(accountId)}`,
    { signal: AbortSignal.timeout(10 * 60_000) },
  );
  await response.arrayBuffer();
  if (response.status !== 200) {
    throw new Error(`Trade read failed (${response.status})`);
  }
  return performance.now() - started;
}

/** Read one scalar from the journal's own SQLite database. */
function scalar(database, sql, ...parameters) {
  return database.prepare(sql).get(...parameters)?.value ?? null;
}

/** Read one numeric series from the journal's own SQLite database. */
function series(database, sql, ...parameters) {
  return database
    .prepare(sql)
    .all(...parameters)
    .map((row) => row.value)
    .filter((value) => Number.isFinite(value));
}

/** Wait until the active worker has consumed the committed event backlog. */
async function waitForQueueDrain(databasePath) {
  const deadline = Date.now() + QUEUE_DRAIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const database = new DatabaseSync(databasePath, { timeout: 5000 });
    try {
      const pendingEvents = scalar(
        database,
        "SELECT COUNT(*) AS value FROM domain_outbox WHERE dispatched_at IS NULL",
      );
      const pendingJobs = scalar(
        database,
        "SELECT COUNT(*) AS value FROM intelligence_jobs WHERE status IN ('pending', 'running', 'retry_wait')",
      );
      if (pendingEvents === 0 && pendingJobs === 0) return true;
    } finally {
      database.close();
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  return false;
}

/** Read all persisted gate counters and queue timings from the stopped journal. */
function readDatabaseMetrics(
  databasePath,
  accountId,
  requestedFills,
  ingest,
  requestDurations,
  busyWatch,
  intelligence = true,
) {
  const database = new DatabaseSync(databasePath, { timeout: 5000 });
  try {
    const databaseExecutions = scalar(
      database,
      "SELECT COUNT(*) AS value FROM executions WHERE account_id = ?",
      accountId,
    );
    const lostEffects = {
      requestedFills,
      reportedInserted: ingest.reportedInserted,
      databaseExecutions,
      missing: databaseExecutions === null ? null : requestedFills - databaseExecutions,
      acceptedButNotStored:
        databaseExecutions === null ? null : ingest.reportedInserted - databaseExecutions,
    };
    // A pre-intelligence baseline has no outbox, jobs, or worker. Read only
    // counters it really stores; its comparison still requires every fill.
    if (!intelligence) return { lostEffects };
    const jobBusyRows = scalar(
      database,
      "SELECT COUNT(*) AS value FROM intelligence_jobs WHERE last_error GLOB 'SQLITE_BUSY*'",
    );
    const deliveryBusyRows = scalar(
      database,
      "SELECT COUNT(*) AS value FROM event_deliveries WHERE last_error GLOB 'SQLITE_BUSY*'",
    );
    const outboxLatencies = series(
      database,
      "SELECT dispatched_at - recorded_at AS value FROM domain_outbox WHERE dispatched_at IS NOT NULL",
    );
    const jobLatencies = series(
      database,
      "SELECT updated_at - created_at AS value FROM intelligence_jobs",
    );
    // A failed request is a busy escape only when the journal says so. The
    // response body carries the driver's own message, so the count is read
    // from the evidence rather than assumed from the status code.
    const busyFailures = ingest.failures.filter((failure) =>
      /SQLITE_BUSY|database is locked/i.test(String(failure.error ?? "")),
    );
    const otherFailures = ingest.failures.filter(
      (failure) => !/SQLITE_BUSY|database is locked/i.test(String(failure.error ?? "")),
    );
    const busyTotal =
      jobBusyRows === null || deliveryBusyRows === null
        ? null
        : jobBusyRows + deliveryBusyRows + busyFailures.length + busyWatch.busy();
    const observedMaximumMs = requestDurations.length ? Math.max(...requestDurations) : null;
    return {
      sqliteBusyEscapes: {
        intelligenceJobRows: jobBusyRows,
        eventDeliveryRows: deliveryBusyRows,
        busyFailedRequests: busyFailures.length,
        // The worker classifies a busy journal in memory and republishes it
        // in its health payload; the count comes from that stream.
        workerBusyReports: busyWatch.busy(),
        workerErrorCodes: busyWatch.counts(),
        failedRequests: ingest.failures.length,
        otherFailedRequests: otherFailures.length,
        firstFailures: ingest.failures.slice(0, 5),
        total: busyTotal,
      },
      lostEffects,
      queueLatencyMs: {
        domainOutbox: {
          count: outboxLatencies.length,
          p50: rounded(percentile(outboxLatencies, 50)),
          p95: rounded(percentile(outboxLatencies, 95)),
        },
        intelligenceJobs: {
          count: jobLatencies.length,
          p50: rounded(percentile(jobLatencies, 50)),
          p95: rounded(percentile(jobLatencies, 95)),
        },
      },
      rebuildLockDuration: {
        observedMaximumMs: rounded(observedMaximumMs),
        requestCount: requestDurations.length,
        unit: "milliseconds",
      },
    };
  } finally {
    database.close();
  }
}

/** Run one volume in one worker mode against a fresh journal. */
async function runMode(volume, mode, options, scratchRoot) {
  const modeSpec = WORKER_MODES[mode];
  const standalone = options.standalone === true;
  const worker = modeSpec.worker;
  const dataDirectory = await mkdtemp(join(scratchRoot, `volume-${volume}-${mode}-`));
  const port = await findFreePort(options.port);
  const environment = { ...process.env };
  delete environment.JOURNAL_PASSWORD;
  // Both modes capture events, so both modes hold the same data and write the
  // same WAL. The only difference between them is the worker: "idle" runs no
  // consumer, "active" runs one. Without this, the comparison would measure
  // the cost of capturing events rather than the cost of the worker.
  environment.JOURNAL_EVENT_CAPTURE = "1";
  if (standalone) {
    environment.NODE_ENV = "production";
    environment.HOSTNAME = "127.0.0.1";
    environment.PORT = String(port);
    environment.JOURNAL_DATA_DIR = dataDirectory;
  }
  const child = fork(
    options.supervisor,
    standalone
      ? []
      : [
          "--mode",
          "production",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--data-dir",
          dataDirectory,
          "--worker",
          worker,
        ],
    {
      cwd: repositoryRoot,
      env: environment,
      execArgv: [],
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  try {
    const busyWatch = createBusyWatch();
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForReady(
      child,
      modeSpec.hasQueue && !standalone,
      busyWatch,
      standalone ? baseUrl : undefined,
    );
    const accountId = await createAccount(baseUrl, volume, mode);
    // The read path is measured at every ingest batch boundary, so both worker
    // modes read the same sequence of journal sizes. A wall-clock sampler
    // would compare one mode's early journal against the other's late journal.
    const loadDurations = [];
    const ingest = await ingestExecutions(baseUrl, accountId, volume, async () => {
      loadDurations.push(await readOnce(baseUrl, accountId));
    });
    // The remaining samples are taken against the finished journal.
    const restDurations = [];
    for (let index = 0; index < options.samples; index += 1) {
      restDurations.push(await readOnce(baseUrl, accountId));
    }
    // Exclude the first actual read, not an already-warm read after ingestion.
    const readLatencyMs = summarizeReadLatency(loadDurations, restDurations);
    let queueDrained = null;
    if (modeSpec.hasQueue && !standalone) {
      // Queue latency is captured from committed rows after the worker consumes
      // them; the read series above measures the active HTTP path under load.
      queueDrained = await waitForQueueDrain(join(dataDirectory, "journal.db"));
    }
    await stopSupervisor(child, standalone);
    const databaseMetrics = readDatabaseMetrics(
      join(dataDirectory, "journal.db"),
      accountId,
      volume,
      ingest,
      ingest.requestDurations,
      busyWatch,
      !standalone,
    );
    return {
      worker: standalone ? "unavailable" : worker,
      // Old baseline builds predate event capture; the candidate always enables it.
      eventCapture: !standalone && eventCaptureEnabled(environment.JOURNAL_EVENT_CAPTURE),
      ingest: {
        requestedFills: volume,
        reportedInserted: ingest.reportedInserted,
        requestCount: ingest.requestDurations.length,
        failedRequests: ingest.failures.length,
        firstFailures: ingest.failures.slice(0, 5),
      },
      readLatencyMs,
      queueDrained,
      ...databaseMetrics,
    };
  } catch (error) {
    await stopSupervisor(child, standalone);
    throw error;
  } finally {
    if (!options.keep) await rm(dataDirectory, { recursive: true, force: true });
  }
}

/** Return a failed run with no invented counters. */
function failedMode(error) {
  return {
    error: error instanceof Error ? error.message : String(error),
    ingest: {
      requestedFills: null,
      reportedInserted: null,
      requestCount: null,
      failedRequests: null,
      firstFailures: [],
    },
    readLatencyMs: { sampleCount: 0, p50: null, p95: null },
    queueDrained: null,
    sqliteBusyEscapes: {
      intelligenceJobRows: null,
      eventDeliveryRows: null,
      busyFailedRequests: null,
      workerBusyReports: null,
      workerErrorCodes: {},
      failedRequests: null,
      otherFailedRequests: null,
      firstFailures: [],
      total: null,
    },
    lostEffects: {
      requestedFills: null,
      reportedInserted: null,
      databaseExecutions: null,
      missing: null,
      acceptedButNotStored: null,
    },
    queueLatencyMs: {
      domainOutbox: { count: null, p50: null, p95: null },
      intelligenceJobs: { count: null, p50: null, p95: null },
    },
    rebuildLockDuration: { observedMaximumMs: null, requestCount: null, unit: "milliseconds" },
  };
}

/** A run that never drained its queue cannot report a meaningful queue latency. */
function mode_gate(drained) {
  return drained === true;
}

/**
 * Summarize the repetitions of one worker mode.
 *
 * A single run of a latency measurement on a shared machine is noisy, so the
 * mode's number is the median of its repetitions. The threshold is unchanged;
 * only the estimator is made robust.
 *
 * The mode decides what the summary may report: a mode without a consumer
 * has no queue, so its queue state is not applicable and is reported as null
 * instead of as a queue that failed to drain.
 */
function summarizeMode(runs, mode) {
  const p95s = runs
    .map((run) => run.readLatencyMs?.p95)
    .filter((value) => typeof value === "number");
  const p50s = runs
    .map((run) => run.readLatencyMs?.p50)
    .filter((value) => typeof value === "number");
  const busyTotals = runs
    .map((run) => run.sqliteBusyEscapes?.total)
    .filter((value) => typeof value === "number");
  const failedRequests = runs
    .map((run) => run.ingest?.failedRequests)
    .filter((value) => typeof value === "number");
  const missing = runs
    .map((run) => run.lostEffects?.missing)
    .filter((value) => typeof value === "number");
  const notStored = runs
    .map((run) => run.lostEffects?.acceptedButNotStored)
    .filter((value) => typeof value === "number");
  const rebuildMaxima = runs
    .map((run) => run.rebuildLockDuration?.observedMaximumMs)
    .filter((value) => typeof value === "number");
  const workerBusy = runs
    .map((run) => run.sqliteBusyEscapes?.workerBusyReports)
    .filter((value) => typeof value === "number");
  const workerCodes = runs.flatMap((run) =>
    Object.keys(run.sqliteBusyEscapes?.workerErrorCodes ?? {}),
  );
  const captureFlags = runs.map((run) => run.eventCapture);
  return {
    repetitions: runs.length,
    errors: runs.flatMap((run) => (run.error ? [run.error] : [])),
    completedRepetitions: runs.filter(
      (run) =>
        !run.error &&
        Number.isFinite(run.readLatencyMs?.p95) &&
        run.ingest?.failedRequests === 0 &&
        run.lostEffects?.missing === 0 &&
        run.lostEffects?.acceptedButNotStored === 0,
    ).length,
    // The capture flag the runs actually ran with, not one inferred from the
    // mode's name. Every run of a mode shares the mode's environment, so one
    // observed flag settles the mode; a mode whose runs all failed before
    // they could report one leaves it unknown.
    eventCapture: captureFlags.some((value) => value === false)
      ? false
      : captureFlags.some((value) => value === true)
        ? true
        : null,
    readLatencyMs: {
      p50: p50s.length ? rounded(percentile(p50s, 50)) : null,
      p95: p95s.length ? rounded(percentile(p95s, 50)) : null,
      p95PerRepetition: p95s.map((value) => rounded(value)),
    },
    sqliteBusyEscapes: {
      total: busyTotals.length ? Math.max(...busyTotals) : null,
      perRepetition: busyTotals,
      workerBusyReports: workerBusy.length ? Math.max(...workerBusy) : null,
      workerErrorCodes: [...new Set(workerCodes)],
    },
    ingest: {
      failedRequests: failedRequests.length ? Math.max(...failedRequests) : null,
    },
    lostEffects: {
      missing: missing.length ? Math.max(...missing) : null,
      acceptedButNotStored: notStored.length ? Math.max(...notStored) : null,
    },
    rebuildLockDuration: {
      observedMaximumMs: rebuildMaxima.length ? rounded(Math.max(...rebuildMaxima)) : null,
      unit: "milliseconds",
    },
    // A mode without a consumer has no queue to drain, so its queue state is
    // not applicable: it is reported as null, never as a queue that failed.
    queueDrained: WORKER_MODES[mode].hasQueue
      ? runs.every((run) => run.queueDrained === true)
      : null,
  };
}

/**
 * Assert the reporting rules the benchmark's own output must satisfy.
 *
 * The idle mode has no consumer and therefore no queue to drain, the active
 * mode's queue state is a real boolean, and the capture flag is the one the
 * run was configured with rather than the one its mode name suggests.
 *
 * With a benchmark result path, the produced result is checked as well: the
 * reported flags must match what the runs actually did.
 */
async function runSelfCheck(resultPath) {
  const checks = [];
  const check = (name, passed) => checks.push({ name, passed });
  // Distinct durations prove exactly which reads survive the warmup exclusion.
  const loadDurations = [1000, 2, 3];
  const restDurations = [4, 5];
  const reads = summarizeReadLatency(loadDurations, restDurations);
  check(
    "only the cold first load read is excluded; all later load and rest reads remain",
    reads.warmupMs === 1000 &&
      reads.sampleCount === 4 &&
      reads.loadSampleCount === 2 &&
      reads.restSampleCount === 2 &&
      reads.p50 === 3.5 &&
      reads.p95 === 4.85 &&
      JSON.stringify(loadDurations) === "[2,3]" &&
      JSON.stringify(restDurations) === "[4,5]",
  );
  const restOnly = summarizeReadLatency([], [1000, 2, 3]);
  check(
    "without load reads, only the first rest read warms the route",
    restOnly.warmupMs === 1000 &&
      restOnly.sampleCount === 2 &&
      restOnly.loadSampleCount === 0 &&
      restOnly.restSampleCount === 2 &&
      restOnly.p50 === 2.5 &&
      restOnly.p95 === 2.95,
  );
  const noReads = summarizeReadLatency([], []);
  check(
    "an empty read series invents no measurements",
    noReads.sampleCount === 0 &&
      noReads.warmupMs === null &&
      noReads.p50 === null &&
      noReads.p95 === null,
  );
  const idle = summarizeMode([{ eventCapture: true, queueDrained: null }], "idle");
  const active = summarizeMode([{ eventCapture: true, queueDrained: true }], "active");
  const undrained = summarizeMode([{ eventCapture: true, queueDrained: false }], "active");
  const uncaptured = summarizeMode([{ eventCapture: false }], "active");
  check("the idle queue is not applicable", idle.queueDrained === null);
  check("the active queue is a boolean", active.queueDrained === true);
  check("an undrained active queue is false", undrained.queueDrained === false);
  check("the idle mode reports the capture flag of its run", idle.eventCapture === true);
  check("an uncaptured run is not reported as captured", uncaptured.eventCapture === false);
  check("capture enabled by 1", eventCaptureEnabled("1") === true);
  check("capture disabled by 0", eventCaptureEnabled("0") === false);
  const comparisonSupervisor = join(repositoryRoot, "baseline", "scripts", "run-journal.mjs");
  const comparisonServer = resolve(dirname(comparisonSupervisor), "..", "server.js");
  const legacyLaunch = resolveComparisonLaunch(
    comparisonSupervisor,
    (path) => path === comparisonServer,
  );
  check(
    "a pre-supervisor baseline launches its own standalone server",
    legacyLaunch.supervisor === comparisonServer && legacyLaunch.standalone === true,
  );
  const supervisedLaunch = resolveComparisonLaunch(comparisonSupervisor, () => true);
  check(
    "a supervised baseline retains its own launcher",
    supervisedLaunch.supervisor === comparisonSupervisor && supervisedLaunch.standalone === false,
  );
  let missingLaunchRejected = false;
  try {
    resolveComparisonLaunch(comparisonSupervisor, () => false);
  } catch {
    missingLaunchRejected = true;
  }
  check("a missing baseline build is rejected", missingLaunchRejected);
  const explicitServer = resolveComparisonLaunch(comparisonServer, () => true);
  check("an explicit standalone baseline is recognized", explicitServer.standalone === true);
  const completeRun = {
    readLatencyMs: { p95: 100 },
    ingest: { failedRequests: 0 },
    lostEffects: { missing: 0, acceptedButNotStored: 0 },
  };
  const complete = summarizeMode([completeRun], "idle");
  const atLimit = summarizeMode([{ ...completeRun, readLatencyMs: { p95: 120 } }], "idle");
  const aboveLimit = summarizeMode([{ ...completeRun, readLatencyMs: { p95: 121 } }], "idle");
  check(
    "the unchanged p95 regression limit accepts 20 percent",
    compareVolumes(1000, complete, complete, atLimit, atLimit).passed === true,
  );
  check(
    "a real p95 regression still fails",
    compareVolumes(1000, complete, complete, aboveLimit, aboveLimit).passed === false,
  );
  const incomplete = summarizeMode([completeRun, failedMode(new Error("baseline exited"))], "idle");
  const completePair = summarizeMode([completeRun, completeRun], "idle");
  const failedComparison = compareVolumes(
    1000,
    incomplete,
    completePair,
    completePair,
    completePair,
  );
  check("a failed baseline repetition cannot disappear from its median", !failedComparison.passed);
  check(
    "baseline startup errors remain visible in comparison output",
    failedComparison.rows[0].baselineErrors.includes("baseline exited"),
  );
  const missing = summarizeMode([failedMode(new Error("baseline launcher missing"))], "idle");
  check(
    "missing baseline measurements fail rather than become zero latency",
    compareVolumes(1000, missing, missing, complete, complete).passed === false,
  );
  if (resultPath) {
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    for (const volume of result.volumes ?? []) {
      const idleMode = volume.modes?.idle ?? {};
      const activeMode = volume.modes?.active ?? {};
      check(
        `volume ${volume.volume}: the idle mode reports that it captured events`,
        idleMode.eventCapture === true,
      );
      check(
        `volume ${volume.volume}: the idle queue is not applicable`,
        idleMode.queueDrained === null,
      );
      check(
        `volume ${volume.volume}: the active mode reports that it captured events`,
        activeMode.eventCapture === true,
      );
      check(
        `volume ${volume.volume}: the active queue is a boolean`,
        typeof activeMode.queueDrained === "boolean",
      );
    }
  }
  const failed = checks.filter((entry) => !entry.passed);
  console.log(JSON.stringify({ passed: failed.length === 0, checks }, null, 2));
  if (failed.length) process.exitCode = 1;
}

/**
 * Compare the candidate build against the comparison build for one volume.
 *
 * The two builds were measured back to back under the same host conditions,
 * so the difference is the build's and not the machine's.
 */
function compareVolumes(volume, baselineIdle, baselineActive, candidateIdle, candidateActive) {
  const rows = [
    ["idle", baselineIdle, candidateIdle],
    ["active", baselineActive, candidateActive],
  ].map(([mode, baseline, candidate]) => {
    const baselineP95 = baseline.readLatencyMs?.p95 ?? null;
    const candidateP95 = candidate.readLatencyMs?.p95 ?? null;
    const regressionPercent =
      typeof baselineP95 === "number" && baselineP95 > 0 && typeof candidateP95 === "number"
        ? ((candidateP95 - baselineP95) / baselineP95) * 100
        : null;
    // A median over surviving runs must not hide a failed launch or dropped
    // ingest. Both builds must complete every requested repetition.
    const complete =
      baseline.repetitions > 0 &&
      baseline.repetitions === candidate.repetitions &&
      baseline.completedRepetitions === baseline.repetitions &&
      candidate.completedRepetitions === candidate.repetitions;
    return {
      volume,
      mode,
      baselineP95Ms: baselineP95,
      candidateP95Ms: candidateP95,
      baselineErrors: baseline.errors,
      candidateErrors: candidate.errors,
      baselineCompletedRepetitions: baseline.completedRepetitions,
      candidateCompletedRepetitions: candidate.completedRepetitions,
      regressionPercent:
        regressionPercent === null ? null : Math.round(regressionPercent * 1000) / 1000,
      passed:
        complete && regressionPercent !== null && regressionPercent <= P95_REGRESSION_LIMIT_PERCENT,
    };
  });
  return { volume, rows, passed: rows.every((row) => row.passed) };
}

/**
 * Build the reproducible verdict for one volume.
 *
 * The volume's own gate is the absolute one: no busy escape, no lost effect,
 * no failed request, and a drained queue. The p95 regression is a comparison
 * between two builds on the same machine, so it is computed by the comparison
 * step, not from the two worker modes of one build.
 */
function evaluateVolume(volume, idleRuns, activeRuns) {
  const idle = summarizeMode(idleRuns, "idle");
  const active = summarizeMode(activeRuns, "active");
  const idleP95 = idle.readLatencyMs?.p95 ?? null;
  const activeP95 = active.readLatencyMs?.p95 ?? null;
  const workerOverheadPercent =
    typeof idleP95 === "number" && idleP95 > 0 && typeof activeP95 === "number"
      ? ((activeP95 - idleP95) / idleP95) * 100
      : null;
  const gates = {
    sqliteBusyEscapes: {
      passed: idle.sqliteBusyEscapes?.total === 0 && active.sqliteBusyEscapes?.total === 0,
      idle: idle.sqliteBusyEscapes?.total ?? null,
      active: active.sqliteBusyEscapes?.total ?? null,
      required: 0,
    },
    lostEffects: {
      // A fill the journal was asked to store must be in the journal, and a
      // fill the journal accepted must still be there.
      passed:
        idle.lostEffects?.missing === 0 &&
        idle.lostEffects?.acceptedButNotStored === 0 &&
        active.lostEffects?.missing === 0 &&
        active.lostEffects?.acceptedButNotStored === 0,
      idleMissing: idle.lostEffects?.missing ?? null,
      idleAcceptedButNotStored: idle.lostEffects?.acceptedButNotStored ?? null,
      activeMissing: active.lostEffects?.missing ?? null,
      activeAcceptedButNotStored: active.lostEffects?.acceptedButNotStored ?? null,
      required: 0,
    },
    failedRequests: {
      passed: idle.ingest?.failedRequests === 0 && active.ingest?.failedRequests === 0,
      idle: idle.ingest?.failedRequests ?? null,
      active: active.ingest?.failedRequests ?? null,
      required: 0,
    },
    queueDrained: {
      // The active run must have consumed its own backlog before the queue
      // latency is meaningful; an undrained queue fails the volume.
      passed: mode_gate(active.queueDrained),
      idle: idle.queueDrained ?? null,
      active: active.queueDrained ?? null,
    },
  };
  return {
    volume,
    modes: { idle, active },
    workerOverhead: {
      idleP95Ms: idleP95,
      activeP95Ms: activeP95,
      percent: rounded(workerOverheadPercent),
    },
    gates,
    passed: Object.values(gates).every((gate) => gate.passed),
  };
}

/** Run every requested volume and write the machine-readable result. */
async function main() {
  const options = parseArguments();
  const comparisonLaunch = options.compareSupervisor
    ? resolveComparisonLaunch(options.compareSupervisor)
    : undefined;
  await mkdir(options.dataDir, { recursive: true });
  const scratchRoot = join(options.dataDir, `benchmark-intelligence-${Date.now()}-${process.pid}`);
  await mkdir(scratchRoot, { recursive: true });
  const result = {
    schemaVersion: 1,
    benchmark: "intelligence",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    configuration: {
      label: options.label,
      comparison: comparisonLaunch
        ? {
            label: options.compareLabel,
            entrypoint: comparisonLaunch.supervisor,
            runtime: comparisonLaunch.standalone ? "standalone-without-worker" : "supervised",
          }
        : null,
      volumes: options.volumes,
      samples: options.samples,
      repetitions: options.repetitions,
      batchSize: BATCH_SIZE,
      dataDirectory: options.dataDir,
      output: options.out,
      keepScratchDirectories: options.keep,
      platform: process.platform,
      node: process.version,
    },
    volumes: [],
    gates: {
      sqliteBusyEscapes: { passed: true, failedVolumes: [] },
      lostEffects: { passed: true, failedVolumes: [] },
      failedRequests: { passed: true, failedVolumes: [] },
      queueDrained: { passed: true, failedVolumes: [] },
      // The p95 regression is a comparison between two builds. Without a
      // comparison build there is nothing to compare, so the gate is not met:
      // it starts unmet and only the comparison can meet it.
      p95Regression: { passed: false, failedVolumes: [] },
    },
    passed: false,
  };
  const p95FailedVolumes = [];
  try {
    for (const volume of options.volumes) {
      const idleRuns = [];
      const activeRuns = [];
      const baselineIdleRuns = [];
      const baselineActiveRuns = [];
      for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
        // The comparison build runs immediately before the candidate's run, so
        // both face the same host conditions. Two builds measured hours apart
        // on a shared machine differ by the machine, not by the code.
        if (options.compareSupervisor) {
          const compareOptions = { ...options, ...comparisonLaunch };
          try {
            baselineIdleRuns.push(await runMode(volume, "idle", compareOptions, scratchRoot));
          } catch (error) {
            baselineIdleRuns.push(failedMode(error));
          }
        }
        try {
          idleRuns.push(await runMode(volume, "idle", options, scratchRoot));
        } catch (error) {
          idleRuns.push(failedMode(error));
        }
        if (options.compareSupervisor) {
          const compareOptions = { ...options, ...comparisonLaunch };
          try {
            baselineActiveRuns.push(await runMode(volume, "active", compareOptions, scratchRoot));
          } catch (error) {
            baselineActiveRuns.push(failedMode(error));
          }
        }
        try {
          activeRuns.push(await runMode(volume, "active", options, scratchRoot));
        } catch (error) {
          activeRuns.push(failedMode(error));
        }
      }
      const evaluated = evaluateVolume(volume, idleRuns, activeRuns);
      if (options.compareSupervisor) {
        evaluated.comparison = compareVolumes(
          volume,
          summarizeMode(baselineIdleRuns, "idle"),
          summarizeMode(baselineActiveRuns, "active"),
          summarizeMode(idleRuns, "idle"),
          summarizeMode(activeRuns, "active"),
        );
      }
      result.volumes.push(evaluated);
      for (const gateName of Object.keys(evaluated.gates)) {
        if (!evaluated.gates[gateName].passed && result.gates[gateName]) {
          result.gates[gateName].passed = false;
          result.gates[gateName].failedVolumes.push(volume);
        }
      }
      // The p95 regression is met only when this volume's comparison passed.
      // A volume without a comparison build cannot meet it, so the gate is
      // decided once every volume has been measured.
      if (!evaluated.comparison || !evaluated.comparison.passed) {
        p95FailedVolumes.push(volume);
      }
    }
  } finally {
    if (!options.keep) await rm(scratchRoot, { recursive: true, force: true });
    result.finishedAt = new Date().toISOString();
    // The p95 gate is decided by the volumes that failed it, so a run with
    // no comparison build cannot report it as met.
    result.gates.p95Regression.passed = p95FailedVolumes.length === 0;
    result.gates.p95Regression.failedVolumes = p95FailedVolumes;
    result.passed = Object.values(result.gates).every((gate) => gate.passed);
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  console.log(
    JSON.stringify({
      passed: result.passed,
      label: options.label,
      output: options.out,
      gates: result.gates,
      volumes: result.volumes.map((volume) => ({
        volume: volume.volume,
        idleP95Ms: volume.workerOverhead.idleP95Ms,
        activeP95Ms: volume.workerOverhead.activeP95Ms,
        workerOverheadPercent: volume.workerOverhead.percent,
        passed: volume.passed,
        comparison: volume.comparison ?? null,
      })),
    }),
  );
  process.exitCode = result.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selfCheckIndex = process.argv.indexOf("--self-check");
  if (selfCheckIndex !== -1) {
    const resultPath = process.argv[selfCheckIndex + 1];
    runSelfCheck(resultPath && !resultPath.startsWith("--") ? resultPath : undefined).catch(
      (error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      },
    );
  } else {
    main().catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
