import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArguments, probeHttp } from "./run-journal.mjs";

/** Host Next in one directly owned child; never start an intelligence consumer here. */
export async function main() {
  const config = parseArguments(["--mode", process.env.JOURNAL_MODE ?? "production"]);
  const appRoot = fileURLToPath(new URL("../", import.meta.url));
  let server;
  let app;
  let stopping = false;
  let initialized = false;
  let closing = false;
  let readinessTimer;
  let shutdownTimer;

  /** IPC heartbeat proves the child event loop remains responsive. */
  function send(message) {
    if (process.connected) process.send(message, () => {});
  }

  /** Next standalone owns its server; use its installed graceful termination handlers. */
  async function shutdown(forwardSignal = true) {
    // Parent may already be gone, so the child also bounds its own drain.
    shutdownTimer ??= setTimeout(() => process.exit(1), 10_000);
    stopping = true;
    clearInterval(readinessTimer);
    if (!initialized || closing) return;
    closing = true;
    if (config.mode === "production") {
      // Native signals already visit installed Next listeners. Startup signals need forwarding
      // once Next has both a listening server and a cleanup handler; import alone proves neither.
      if (!forwardSignal) return;
      let handlers;
      for (;;) {
        handlers = process.listeners("SIGTERM").filter((listener) => listener !== onSignal);
        if (handlers.length > 0 && (await probeHttp(config.host, config.port))) break;
        // The shutdown deadline above also bounds startup after the parent disconnects.
        await delay(25);
      }
      await Promise.all(handlers.map((handler) => handler("SIGTERM")));
      // Next exits after closing its server. Only that exit acknowledges production shutdown;
      // a signal handler returning does not prove its asynchronous server.close has completed.
      return;
    }
    if (server)
      await new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    await app?.close();
    clearTimeout(shutdownTimer);
    send({ type: "stopped" });
    process.exitCode = 0;
    if (process.connected) process.disconnect();
  }

  /** Shutdown errors are fatal; the supervisor still enforces its outer deadline. */
  function stop(forwardSignal = true) {
    void shutdown(forwardSignal).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  }
  const onSignal = (signal) =>
    stop(!process.listeners(signal).some((listener) => listener !== onSignal));
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("disconnect", stop);
  process.on("message", (message) => {
    if (message?.type === "shutdown") stop();
    else if (message?.type === "health")
      send({ type: "health", state: stopping ? "stopping" : "running" });
  });

  if (config.mode === "production") {
    // The standalone entry supplies its serialized Next config and runtime paths.
    await import(new URL("../server.js", import.meta.url).href);
  } else {
    const { default: next } = await import("next");
    app = next({ dev: true, dir: appRoot, hostname: config.host, port: config.port });
    await app.prepare();
    server = createServer(app.getRequestHandler());
    await new Promise((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, resolveListen);
    });
  }
  initialized = true;
  if (stopping) {
    await shutdown();
    return;
  }
  // Standalone import returns before listen completes. Probe before announcing ready.
  let probing = false;
  readinessTimer = setInterval(async () => {
    if (probing || stopping) return;
    probing = true;
    try {
      if (await probeHttp(config.host, config.port)) {
        clearInterval(readinessTimer);
        if (!stopping) send({ type: "ready" });
      }
    } finally {
      probing = false;
    }
  }, 100);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
