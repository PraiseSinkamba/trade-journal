import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { repairBrokenLinks } from "../scripts/repair-links.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execute = promisify(execFile);
let scratch: string;
let artifact: string;
const children = new Set<ChildProcess>();

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "journal portable worker "));
  artifact = join(scratch, "build output");
  await execute(
    process.execPath,
    [join(appRoot, "scripts/build-worker.mjs"), "--out-dir", artifact],
    {
      cwd: scratch,
      timeout: 90_000,
    },
  );
}, 100_000);

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

async function nativeArtifacts(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return nativeArtifacts(path);
      return entry.name.endsWith(".node") ? [path] : [];
    }),
  );
  return nested.flat();
}

async function startPortable(name: string) {
  const directory = join(scratch, name);
  await cp(artifact, directory, { recursive: true, dereference: true });
  const data = join(directory, "fresh journal data");
  const env: NodeJS.ProcessEnv = { ...process.env, JOURNAL_DATA_DIR: data };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  const child = fork(join(directory, "worker-entry.cjs"), [], {
    cwd: directory,
    env,
    execArgv: [],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.add(child);
  const messages: Array<{ type?: string }> = [];
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const ready = Promise.withResolvers<void>();
  child.on("message", (message) => {
    if (typeof message !== "object" || message === null || !("type" in message)) return;
    if (typeof message.type !== "string") return;
    messages.push({ type: message.type });
    if (message.type === "ready") ready.resolve();
  });
  child.once("error", ready.reject);
  child.once("exit", (code) => {
    ready.reject(new Error(`Worker exited before readiness (${code}): ${stderr}`));
  });
  await ready.promise;
  return { child, messages, data, directory };
}

describe("independent worker deployment artifact", () => {
  it("ships native SQLite and starts from a clean path with spaces, then shuts down over IPC", async () => {
    const { child, messages, data, directory } = await startPortable(
      "isolated deployment with spaces",
    );
    expect(
      (await nativeArtifacts(join(directory, "node_modules"))).some((path) =>
        path.endsWith("better_sqlite3.node"),
      ),
    ).toBe(true);
    expect((await stat(join(data, "journal.db"))).size).toBeGreaterThan(0);
    const exited = once(child, "exit");
    child.send({ type: "shutdown" });
    expect(await exited).toEqual([0, null]);
    expect(messages.some((message) => message.type === "stopped")).toBe(true);
  }, 120_000);

  it("closes the real native database when its IPC parent disconnects", async () => {
    const { child, data } = await startPortable("disconnected deployment with spaces");
    const exited = once(child, "exit");
    child.disconnect();
    expect(await exited).toEqual([0, null]);
    expect((await stat(join(data, "journal.db"))).size).toBeGreaterThan(0);
  }, 120_000);
});

describe("packaged dependency links", () => {
  it("re-points links the host cannot resolve at the target they name", async () => {
    const directory = await mkdtemp(join(tmpdir(), "journal link repair "));
    const target = join(directory, "target");
    await mkdir(target);
    await writeFile(join(target, "marker.txt"), "content");
    const link = join(directory, "link");
    await symlink(target, link, "junction");
    // A host that cannot follow the link must still end up with a resolvable one.
    const repaired = repairBrokenLinks(directory, () => false);
    expect(repaired).toBe(1);
    expect(await readFile(join(link, "marker.txt"), "utf8")).toBe("content");
    await rm(directory, { recursive: true, force: true });
  });

  it("leaves links that already resolve untouched", async () => {
    const directory = await mkdtemp(join(tmpdir(), "journal link repair "));
    const target = join(directory, "target");
    await mkdir(target);
    const link = join(directory, "link");
    await symlink(target, link, "junction");
    expect(repairBrokenLinks(directory)).toBe(0);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect((await stat(link)).isDirectory()).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps a link whose target is gone instead of inventing one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "journal link repair "));
    const link = join(directory, "link");
    await symlink(join(directory, "absent"), link, "junction");
    expect(repairBrokenLinks(directory, () => false)).toBe(0);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps the content of a file link the host cannot follow", async (ctx) => {
    const directory = await mkdtemp(join(tmpdir(), "journal link repair "));
    const target = join(directory, "target.txt");
    await writeFile(target, "content");
    const link = join(directory, "link.txt");
    try {
      await symlink(target, link, "file");
    } catch (error) {
      // Windows only permits file symlinks with elevated rights.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        ctx.skip();
        return;
      }
      throw error;
    }
    expect(repairBrokenLinks(directory, () => false)).toBe(1);
    expect(await readFile(link, "utf8")).toBe("content");
    await rm(directory, { recursive: true, force: true });
  });
});
