import { fork } from "node:child_process";
import { request } from "node:http";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../", import.meta.url));

/** Resolve CLI settings once so both children receive identical explicit settings. */
export function parseArguments(args = process.argv.slice(2), env = process.env) {
  const values = {};
  const names = new Set(["mode", "host", "port", "data-dir", "worker"]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]?.replace(/^--/, "");
    const value = args[index + 1];
    if (!args[index]?.startsWith("--") || !names.has(name) || !value || value.startsWith("--")) {
      throw new Error(`Invalid supervisor argument: ${args[index]}`);
    }
    values[name] = value;
  }
  const mode = values.mode ?? (env.NODE_ENV === "production" ? "production" : "dev");
  const host = values.host ?? env.HOSTNAME ?? "127.0.0.1";
  const portText = values.port ?? env.PORT ?? "3000";
  const port = Number(portText);
  const dataDir = values["data-dir"] ?? env.JOURNAL_DATA_DIR ?? resolve(appRoot, "data");
  const worker = values.worker ?? (mode === "production" ? "enabled" : "disabled");
  if (!["dev", "production"].includes(mode)) throw new Error("Mode must be dev or production");
  if (!host.trim()) throw new Error("Host must not be empty");
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be an integer from 1 to 65535");
  }
  if (!isAbsolute(dataDir)) throw new Error("JOURNAL_DATA_DIR must be absolute");
  if (!["enabled", "disabled"].includes(worker))
    throw new Error("Worker must be enabled or disabled");
  return { mode, host, port, dataDir, worker };
}

/** Probe HTTP, not merely an IPC claim; authenticated responses still prove availability. */
export function probeHttp(host, port, timeoutMs = 1000) {
  const address = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  return new Promise((resolveProbe) => {
    const req = request({ hostname: address, port, path: "/", method: "GET" }, (response) => {
      response.resume();
      resolveProbe(response.statusCode >= 200 && response.statusCode < 500);
    });
    req.on("error", () => resolveProbe(false));
    req.setTimeout(timeoutMs, () => req.destroy(new Error("HTTP readiness probe timed out")));
    req.end();
  });
}

/** Own child lifetimes. Injectable paths/timings allow real subprocess tests without app builds. */
export function startSupervisor(config, options = {}) {
  const {
    httpPath = fileURLToPath(new URL("./http-child.mjs", import.meta.url)),
    workerPath = fileURLToPath(new URL("../worker/worker-entry.cjs", import.meta.url)),
    shutdownMs = 10_000,
    startupMs = 60_000,
    heartbeatMs = 5_000,
    livenessMs = 30_000,
    restartBaseMs = 1_000,
    restartMaxMs = 30_000,
    crashWindowMs = 600_000,
    env = process.env,
    publish = (message) => {
      process.stdout.write(`${JSON.stringify(message)}\n`);
      if (process.connected) process.send(message, () => {});
    },
  } = options;
  const childEnv = {
    ...env,
    NODE_ENV: config.mode === "production" ? "production" : "development",
    JOURNAL_MODE: config.mode,
    HOSTNAME: config.host,
    PORT: String(config.port),
    JOURNAL_DATA_DIR: config.dataDir,
    JOURNAL_WORKER_ENABLED: config.worker === "enabled" ? "1" : "0",
  };
  const children = new Set();
  const crashes = [];
  let ready = false;
  let stopping = false;
  let http;
  const { promise: done, resolve: finish } = Promise.withResolvers();
  let restartTimer;
  let workerState = config.worker === "enabled" ? "starting" : "disabled";

  /** IPC delivery failures become child failures through disconnect/exit handling. */
  function send(child, message) {
    if (child.connected) child.send(message, () => {});
  }

  /** Publish degradation separately: worker availability must never imply HTTP failure. */
  function health(extra = {}) {
    publish({ type: "health", http: ready ? "ready" : "starting", worker: workerState, ...extra });
  }

  /** One shared deadline bounds shutdown even when a child ignores IPC. */
  function shutdown(code = 0) {
    if (stopping) return done;
    stopping = true;
    clearTimeout(restartTimer);
    clearTimeout(startupTimer);
    clearInterval(heartbeat);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("disconnect", onDisconnect);
    process.off("message", onMessage);
    const pending = [...children];
    const deadline = setTimeout(() => {
      for (const child of children) child.kill("SIGKILL");
    }, shutdownMs);
    Promise.all(
      pending.map(
        (child) =>
          new Promise((resolveExit) => {
            child.once("exit", resolveExit);
            send(child, { type: "shutdown" });
            if (!child.connected) child.kill("SIGTERM");
          }),
      ),
    ).then(() => {
      clearTimeout(deadline);
      publish({ type: "stopped" });
      finish(code);
    });
    return done;
  }

  /** Fork directly, without shells, so shutdown owns every process it starts. */
  function launch(kind, path) {
    const child = fork(path, [], {
      cwd: appRoot,
      env: childEnv,
      execArgv: [],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    children.add(child);
    let lastSeen = Date.now();
    child.on("message", (message) => {
      if (!message || !["ready", "health", "stopped"].includes(message.type)) return;
      lastSeen = Date.now();
      if (stopping) return;
      if (kind === "worker") {
        const state = message.state ?? message.worker?.state;
        workerState =
          message.type === "ready" ? "ready" : typeof state === "string" ? state : "healthy";
        health({ workerHealth: message });
      } else if (message.type === "ready") {
        child.httpReady = true;
        void checkReady();
      }
    });
    child.on("error", (error) => {
      health({ error: `${kind} process error: ${error.message}` });
      // A failed spawn has no exit event; remove it before waiting for shutdown.
      if (!child.pid) {
        children.delete(child);
        if (kind === "http") void shutdown(1);
        else workerFailed();
      }
    });
    child.on("disconnect", () => {
      if (!stopping) child.kill("SIGKILL");
    });
    child.once("exit", () => {
      children.delete(child);
      if (stopping) return;
      if (kind === "http") void shutdown(1);
      else workerFailed();
    });
    child.isAlive = () => Date.now() - lastSeen <= livenessMs;
    return child;
  }

  /** A rolling crash budget prevents persistent failures from creating restart storms. */
  function workerFailed() {
    const now = Date.now();
    crashes.push(now);
    while (crashes[0] < now - crashWindowMs) crashes.shift();
    workerState = crashes.length >= 5 ? "unhealthy" : "restarting";
    health({ crashes: crashes.length });
    if (crashes.length >= 5 || stopping) return;
    const delay = Math.min(restartMaxMs, restartBaseMs * 2 ** (crashes.length - 1));
    restartTimer = setTimeout(() => {
      launch("worker", workerPath);
    }, delay);
  }

  /** Only a ready child plus an actual successful HTTP response opens the readiness gate. */
  async function checkReady() {
    if (ready || stopping || !http?.httpReady) return;
    if (await probeHttp(config.host, config.port)) {
      if (ready || stopping) return;
      ready = true;
      clearTimeout(startupTimer);
      publish({ type: "ready", host: config.host, port: config.port, worker: workerState });
    }
  }

  const onSignal = () => {
    void shutdown(0);
  };
  const onDisconnect = () => {
    void shutdown(0);
  };
  const onMessage = (message) => {
    if (message?.type === "shutdown") void shutdown(0);
    else if (message?.type === "health") health();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("disconnect", onDisconnect);
  process.on("message", onMessage);
  const startupTimer = setTimeout(() => {
    health({ error: "HTTP startup timed out" });
    void shutdown(1);
  }, startupMs);
  const heartbeat = setInterval(() => {
    for (const child of children) {
      if (!child.isAlive()) child.kill("SIGKILL");
      else send(child, { type: "health" });
    }
    void checkReady();
  }, heartbeatMs);
  http = launch("http", httpPath);
  if (config.worker === "enabled") launch("worker", workerPath);
  health();
  return { done, shutdown, children };
}

// Importing lifecycle helpers must not create children or attach signal handlers.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const supervisor = startSupervisor(parseArguments());
    process.exitCode = await supervisor.done;
    if (process.connected) process.disconnect();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
}
