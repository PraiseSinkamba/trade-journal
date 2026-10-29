import { isAbsolute } from "node:path";
import type { JournalDb } from "@/db/connection";
import type { IntelligenceWorker, WorkerHandle, WorkerStatus } from "./composition";

type LifecycleMessage = {
  readonly type: "ready" | "health" | "stopped";
  readonly role: "worker";
  readonly worker?: WorkerStatus;
  readonly errorCode?: string;
};

/** Emit sanitized lifecycle records over IPC when connected, otherwise stdout. */
const report = (message: LifecycleMessage): void => {
  if (process.connected && process.send) {
    try {
      process.send(message, () => {
        // A disconnected supervisor cannot receive the final lifecycle record.
      });
    } catch {
      // Parent disconnect races are handled by the shutdown listener.
    }
  } else {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }
};

/** Owns this process's consumer and every connection loaded by its composition. */
export const main = async (): Promise<void> => {
  const directory = process.env.JOURNAL_DATA_DIR;
  if (!directory || !isAbsolute(directory)) {
    throw new Error("JOURNAL_DATA_DIR must be an explicit absolute path");
  }

  const controller = new AbortController();
  // ES2022's Promise API has no withResolvers; retain the shutdown resolver here.
  let requestShutdown!: () => void;
  const shutdownRequested = new Promise<void>((resolve) => {
    requestShutdown = () => {
      controller.abort();
      resolve();
    };
  });
  const onMessage = (message: unknown): void => {
    if (typeof message !== "object" || message === null || !("type" in message)) return;
    if (message.type === "shutdown") requestShutdown();
    if (message.type === "health" && worker) {
      report({ type: "health", role: "worker", worker: worker.status() });
    }
  };
  let ownedDb: JournalDb | undefined;
  let singletonDb: JournalDb | undefined;
  let worker: IntelligenceWorker | undefined;
  let handle: WorkerHandle | undefined;
  let healthTimer: ReturnType<typeof setInterval> | undefined;

  process.on("SIGINT", requestShutdown);
  process.on("SIGTERM", requestShutdown);
  process.on("disconnect", requestShutdown);
  process.on("message", onMessage);

  try {
    // Static imports would open the singleton before validating JOURNAL_DATA_DIR.
    // Retain both migrated handles so shutdown closes every loaded connection.
    const connection = await import("@/db/connection");
    singletonDb = connection.db;
    ownedDb = connection.openConnection(directory);
    const { createIntelligenceWorker } = await import("./composition");
    worker = createIntelligenceWorker({ db: ownedDb });
    if (controller.signal.aborted) return;
    handle = await worker.start(controller.signal);
    report({ type: "ready", role: "worker", worker: worker.status() });
    healthTimer = setInterval(() => {
      report({ type: "health", role: "worker", worker: worker!.status() });
    }, 1_000);
    await shutdownRequested;
  } finally {
    clearInterval(healthTimer);
    try {
      // Await the running loop before closing SQLite; stop() alone does not join it.
      if (handle) await handle.stop();
      else if (worker) await worker.stop();
    } finally {
      try {
        if (ownedDb?.$client.open) ownedDb.$client.close();
      } finally {
        try {
          if (singletonDb?.$client.open) singletonDb.$client.close();
        } finally {
          process.off("SIGINT", requestShutdown);
          process.off("SIGTERM", requestShutdown);
          process.off("disconnect", requestShutdown);
          process.off("message", onMessage);
          report({
            type: "stopped",
            role: "worker",
            ...(worker ? { worker: worker.status() } : {}),
          });
          if (process.connected) process.disconnect();
        }
      }
    }
  }
};

// The standalone artifact is CommonJS. Imports expose main without starting consumers.
if (typeof require !== "undefined" && require.main === module) {
  void main().catch(() => {
    report({ type: "health", role: "worker", errorCode: "worker_start_failed" });
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
}
