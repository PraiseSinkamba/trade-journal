import { afterEach, describe, expect, it } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

type Message = {
  type: string;
  worker?: string;
  crashes?: number;
  at?: number;
  [key: string]: unknown;
};
const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));
const runs: {
  directory: string;
  child: ChildProcess;
  messages: Message[];
  exited: Promise<number | null>;
}[] = [];

/** Await observable process behavior, with a useful bounded failure instead of fixed sleeps. */
// These tests cross real process/IPC boundaries; virtual timers cannot drive child event loops.
async function until<T>(read: () => T | undefined, timeout = 6000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    const pause = Promise.withResolvers<void>();
    setTimeout(pause.resolve, 10);
    await pause.promise;
  }
  throw new Error("Timed out awaiting subprocess behavior");
}

/** Allocate an OS-selected port outside the project's reserved development ports. */
async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing allocated port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port === 3000 || address.port === 3001 ? unusedPort() : address.port;
}

/** Generate isolated subprocess fixtures; no fixture artifacts survive the test. */
async function launch(
  settings: Record<string, unknown> = {},
  env: Record<string, string> = {},
  worker: "enabled" | "disabled" = "enabled",
) {
  const directory = mkdtempSync(join(tmpdir(), "journal supervisor spaces "));
  const port = await unusedPort();
  const eventsPath = join(directory, "events.jsonl");
  const fixturePath = join(directory, "child.mjs");
  writeFileSync(
    fixturePath,
    `
import { createServer } from 'node:http';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const role = process.argv[1].includes('worker') ? 'worker' : 'http';
const marker = process.env.EVENTS + '.stopped-marker';
let misbehave = role === 'worker' && process.env.STOPPED_WORKER === '1' && !existsSync(marker);
if(misbehave) writeFileSync(marker,'stopped');
const log = (event) => appendFileSync(process.env.EVENTS, JSON.stringify({role,event,at:Date.now(),pid:process.pid,data:process.env.JOURNAL_DATA_DIR,host:process.env.HOSTNAME,port:process.env.PORT})+'\\n');
log('start');
let server;
const send = (message) => { if(process.connected) process.send(message); };
const stop = () => {
  if(process.env.IGNORE_STOP === role) return;
  log('stop');
  if(server) server.close(() => process.exit(0)); else process.exit(0);
};
process.on('disconnect', stop);
process.on('message', message => {
  if(message.type === 'shutdown') stop();
  if(message.type === 'health' && process.env.SILENT_ROLE !== role) {
    if(role === 'worker' && misbehave) {
      misbehave = false;
      send({type:'health',role,worker:{state:'stopped'}});
    } else {
      send(role === 'worker' ? {type:'health',role,worker:{state:'idle'}} : {type:'health',state:'running'});
    }
  }
});
if(role === 'http') {
  send({type:'ready'});
  setTimeout(() => {
    server=createServer((request,response)=>response.end('available'));
    server.listen(Number(process.env.PORT),process.env.HOSTNAME,()=>log('listening'));
    if(process.env.HTTP_EXIT_MS) setTimeout(()=>process.exit(2),Number(process.env.HTTP_EXIT_MS));
  }, Number(process.env.LISTEN_DELAY_MS || 0));
} else {
  send({type:'ready',pid:process.pid});
  if(process.env.CRASH_WORKER === '1') setTimeout(()=>process.exit(2),20);
}
`,
  );
  const workerPath = join(directory, "worker.mjs");
  copyFileSync(fixturePath, workerPath);
  const driverPath = join(directory, "driver.mjs");
  const options = {
    httpPath: fixturePath,
    workerPath,
    heartbeatMs: 25,
    livenessMs: 1500,
    shutdownMs: 300,
    startupMs: 4000,
    restartBaseMs: 20,
    restartMaxMs: 80,
    ...settings,
  };
  writeFileSync(
    driverPath,
    `
import { startSupervisor } from ${JSON.stringify(pathToFileURL(join(scripts, "run-journal.mjs")).href)};
const supervisor=startSupervisor(${JSON.stringify({ mode: "production", host: "127.0.0.1", port, dataDir: directory, worker })},${JSON.stringify(options)});
process.exitCode=await supervisor.done;
if(process.connected) process.disconnect();
`,
  );
  const child = fork(driverPath, [], {
    execArgv: [],
    env: { ...process.env, ...env, EVENTS: eventsPath },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const messages: Message[] = [];
  child.on("message", (message) => messages.push({ ...(message as Message), at: Date.now() }));
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  const run = { directory, child, messages, exited };
  runs.push(run);
  const events = (): {
    role: string;
    event: string;
    at: number;
    pid: number;
    data: string;
    host: string;
    port: string;
  }[] => {
    try {
      return readFileSync(eventsPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  };
  return { ...run, events, port };
}

afterEach(async () => {
  for (const run of runs.splice(0)) {
    if (run.child.connected) run.child.send({ type: "shutdown" });
    if (run.child.exitCode === null && run.child.signalCode === null) await run.exited;
    rmSync(run.directory, { recursive: true, force: true });
  }
});

describe("journal supervisor subprocess lifecycle", () => {
  it("validates CLI and environment settings without launching consumers on import", async () => {
    const moduleUrl = pathToFileURL(join(scripts, "run-journal.mjs")).href;
    // Dynamic loading is the behavior under test: importing must not start child processes.
    const { parseArguments } = await import(moduleUrl);
    const dataDir = tmpdir();
    expect(
      parseArguments(["--mode", "production", "--worker", "disabled"], {
        HOSTNAME: "127.0.0.1",
        PORT: "43210",
        JOURNAL_DATA_DIR: dataDir,
      }),
    ).toEqual({ mode: "production", host: "127.0.0.1", port: 43210, dataDir, worker: "disabled" });
    expect(parseArguments(["--mode", "dev"], {}).worker).toBe("disabled");
    expect(parseArguments(["--mode", "production"], {}).worker).toBe("enabled");
    expect(() => parseArguments(["--data-dir", "relative"], {})).toThrow("absolute");
    expect(() => parseArguments(["--port", "0"], {})).toThrow("Port");
    expect(() => parseArguments(["--worker", "maybe"], {})).toThrow("Worker");
    expect(() => parseArguments(["--unknown", "value"], {})).toThrow("Invalid supervisor argument");
  });

  it("keeps worker disabled without spawning a consumer", async () => {
    const run = await launch({}, {}, "disabled");
    const ready = await until(() => run.messages.find((message) => message.type === "ready"));
    expect(ready.worker).toBe("disabled");
    expect(
      run
        .events()
        .filter((event) => event.event === "start")
        .map((event) => event.role),
    ).toEqual(["http"]);
  });

  it("gates ready on actual HTTP and passes identical absolute settings to both children", async () => {
    const run = await launch({}, { LISTEN_DELAY_MS: "350" });
    const ready = await until(() => run.messages.find((message) => message.type === "ready"));
    const listening = await until(() => run.events().find((event) => event.event === "listening"));
    // Readiness follows a real HTTP answer, never the HTTP child's own ready claim.
    expect(ready.at).toBeGreaterThanOrEqual(listening.at);
    for (const event of run.events().filter((entry) => entry.event === "start")) {
      expect(event.data).toBe(run.directory);
      expect(event.host).toBe("127.0.0.1");
      expect(event.port).toBe(String(run.port));
    }
    run.child.send({ type: "shutdown" });
    expect(await run.exited).toBe(0);
    expect(run.events().filter((event) => event.event === "stop")).toHaveLength(2);
  });

  it("publishes worker status as a string while retaining the worker's nested health payload", async () => {
    const run = await launch();
    const health = await until(() =>
      run.messages.find(
        (message) =>
          message.type === "health" &&
          (message.workerHealth as { type?: string } | undefined)?.type === "health",
      ),
    );
    expect(health.worker).toBe("idle");
    expect(health.workerHealth).toMatchObject({
      type: "health",
      role: "worker",
      worker: { state: "idle" },
    });
    expect(run.messages.every((message) => typeof message.worker === "string")).toBe(true);
  });

  it("caps worker crashes at five while HTTP remains available", async () => {
    const run = await launch({}, { CRASH_WORKER: "1" });
    await until(() => run.messages.find((message) => message.worker === "unhealthy"));
    const starts = run
      .events()
      .filter((event) => event.role === "worker" && event.event === "start");
    expect(starts).toHaveLength(5);
    for (let index = 1; index < starts.length; index++) {
      // OS scheduling can add delay, but must never bypass the bounded exponential backoff.
      expect(starts[index]!.at - starts[index - 1]!.at).toBeGreaterThanOrEqual(
        Math.min(80, 20 * 2 ** (index - 1)),
      );
    }
    expect(run.child.exitCode).toBeNull();
    expect((await fetch(`http://127.0.0.1:${run.port}/`)).status).toBe(200);
    expect(
      run.messages.filter((message) => message.crashes).map((message) => message.crashes),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it("restarts a worker whose poll loop stopped while the process stayed alive", async () => {
    const run = await launch({}, { STOPPED_WORKER: "1" });
    await until(() => run.messages.find((message) => message.type === "ready"));
    const restart = await until(() =>
      run.messages.find(
        (message) =>
          message.type === "health" && message.crashes === 1 && message.worker === "restarting",
      ),
    );
    expect(restart.crashes).toBe(1);
    await until(() =>
      run.events().filter((event) => event.role === "worker" && event.event === "start").length >= 2
        ? true
        : undefined,
    );
    expect(
      run.events().filter((event) => event.role === "worker" && event.event === "start").length,
    ).toBeGreaterThanOrEqual(2);
    expect(run.child.exitCode).toBeNull();
    expect((await fetch(`http://127.0.0.1:${run.port}/`)).status).toBe(200);
  });

  it("HTTP failure stops worker and fails supervisor", async () => {
    const run = await launch({}, { HTTP_EXIT_MS: "150" });
    expect(await run.exited).toBe(1);
    expect(run.events().some((event) => event.role === "worker" && event.event === "stop")).toBe(
      true,
    );
  });

  it("parent IPC disconnect drains both children without orphans", async () => {
    const run = await launch();
    await until(() => run.messages.find((message) => message.type === "ready"));
    const pids = run
      .events()
      .filter((event) => event.event === "start")
      .map((event) => event.pid);
    run.child.disconnect();
    expect(await run.exited).toBe(0);
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  });

  it("forces a child that ignores shutdown after the shared deadline", async () => {
    const run = await launch({ shutdownMs: 150 }, { IGNORE_STOP: "worker" });
    await until(() => run.messages.find((message) => message.type === "ready"));
    const pid = run.events().find((event) => event.role === "worker")!.pid;
    const started = Date.now();
    run.child.send({ type: "shutdown" });
    expect(await run.exited).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(120);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("restarts workers that stop replying to IPC health", async () => {
    // A silent worker is killed and replaced until the crash budget is spent.
    const run = await launch({ livenessMs: 1000 }, { SILENT_ROLE: "worker" });
    await until(() => run.messages.find((message) => message.worker === "unhealthy"), 20_000);
    expect(
      run.messages.filter((message) => message.crashes).map((message) => message.crashes),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(run.child.exitCode).toBeNull();
    expect((await fetch(`http://127.0.0.1:${run.port}/`)).status).toBe(200);
  });

  it.each([
    ["shutdown", "imported"],
    ["disconnect", "imported"],
    ["signal", "imported"],
    ["shutdown", "handler"],
    ["disconnect", "handler"],
    ["signal", "handler"],
  ] as const)(
    "HTTP child handles %s after %s without reporting an open server stopped",
    async (action, stage) => {
      const directory = mkdtempSync(join(tmpdir(), "journal http child spaces "));
      mkdirSync(join(directory, "scripts"));
      copyFileSync(join(scripts, "http-child.mjs"), join(directory, "scripts", "http-child.mjs"));
      copyFileSync(join(scripts, "run-journal.mjs"), join(directory, "scripts", "run-journal.mjs"));
      writeFileSync(
        join(directory, "server.js"),
        `
const {createServer}=require('node:http');
const {appendFileSync}=require('node:fs');
const log=(event)=>{
  appendFileSync(process.env.EVENTS,event+'\\n');
  if(process.connected) process.send({type:event});
};
const server=createServer((request,response)=>response.end('available'));
// Dispatch through Node's signal event so this regression also runs on Windows.
process.on('message',message=>{
  if(message.type === 'signal') process.emit('SIGTERM','SIGTERM');
});
// Standalone startup returns before the server listens or installs its cleanup handler.
log('imported');
setTimeout(()=>{
  server.listen(Number(process.env.PORT),process.env.HOSTNAME,()=>log('listening'));
},150);
setTimeout(()=>{
  process.on('SIGTERM',()=>{
    log('closing');
    setTimeout(()=>server.close(()=>{
      log('closed');
      process.exit(0);
    }),150);
  });
  log('handler');
},350);
`,
      );
      const child = fork(join(directory, "scripts", "http-child.mjs"), [], {
        execArgv: [],
        env: {
          ...process.env,
          JOURNAL_MODE: "production",
          HOSTNAME: "127.0.0.1",
          PORT: String(await unusedPort()),
          JOURNAL_DATA_DIR: directory,
          EVENTS: join(directory, "events.log"),
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      const messages: Message[] = [];
      child.on("message", (message) => messages.push(message as Message));
      const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
      runs.push({ directory, child, messages, exited });
      await until(() => messages.find((message) => message.type === stage));
      if (action === "disconnect") child.disconnect();
      else child.send({ type: action });
      await until(() =>
        readFileSync(join(directory, "events.log"), "utf8").includes("closing\n")
          ? true
          : undefined,
      );
      expect(messages.some((message) => message.type === "stopped")).toBe(false);
      expect(await exited).toBe(0);
      expect(readFileSync(join(directory, "events.log"), "utf8").trim().split("\n")).toEqual([
        "imported",
        "listening",
        "handler",
        "closing",
        "closed",
      ]);
      expect(() => process.kill(child.pid!, 0)).toThrow();
    },
  );
});
