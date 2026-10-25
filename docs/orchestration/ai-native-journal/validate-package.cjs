const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const repo = path.resolve(__dirname, "../../..");
const base = path.relative(repo, __dirname).replaceAll("\\", "/");
const read = (p) => fs.readFileSync(path.join(repo, p), "utf8");
const exists = (p) => fs.existsSync(path.join(repo, p));
const git = (...args) => cp.execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const hash = (s) => crypto.createHash("sha256").update(s.replace(/\r\n/g, "\n")).digest("hex");
const m = JSON.parse(read(base + "/execution-manifest.json"));
const errors = [];
const assert = (b, s) => {
  if (!b) errors.push(s);
};
const ids = new Set(m.tasks.map((t) => t.id));
assert(ids.size === 21 && m.tasks.length === 21, "Expected 21 unique tasks");
const seen = new Set(),
  visiting = new Set();
function visit(id) {
  if (visiting.has(id)) {
    errors.push("Cycle: " + id);
    return;
  }
  if (seen.has(id)) return;
  const task = m.tasks.find((t) => t.id === id);
  if (!task) {
    errors.push("Missing dependency: " + id);
    return;
  }
  visiting.add(id);
  task.dependsOn.forEach(visit);
  visiting.delete(id);
  seen.add(id);
}
m.tasks.forEach((t) => visit(t.id));
for (const s of m.sources) {
  assert(exists(s.path), "Missing source: " + s.path);
  if (!exists(s.path)) continue;
  assert(hash(read(s.path)) === s.sha256, "Source drift: " + s.path);
  try {
    assert(
      hash(
        cp.execFileSync("git", ["show", m.sourceBaseline + ":" + s.path], {
          cwd: repo,
          encoding: "utf8",
        }),
      ) === s.sha256,
      "Baseline source mismatch: " + s.path,
    );
  } catch {
    errors.push("Source absent from baseline commit: " + s.path);
  }
}
const detailed = read("docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md");
const expand = (s) => {
  const a = s.match(/\{([^{}]+)\}/);
  return a
    ? a[1]
        .split(",")
        .flatMap((v) => expand(s.slice(0, a.index) + v + s.slice(a.index + a[0].length)))
    : [s];
};
const futureTests = new Set(
  [...detailed.matchAll(/`([^`]*\.test\.ts)`/g)].flatMap((a) => expand(a[1])),
);
for (const t of m.tasks) {
  assert(exists(t.packet), "Missing packet: " + t.id);
  const packet = read(t.packet);
  for (const h of [
    "Assignment and outcome",
    "Authority and required reading",
    "Placement and prerequisites",
    "Ownership and boundaries",
    "Contracts, schema and implementation",
    "Acceptance and verification",
    "Delivery, review and integration",
    "Native progress and escalation",
  ])
    assert(packet.includes("## " + h), "Packet section missing: " + t.id + " " + h);
  assert(
    t.acceptance.length > 15 && t.contracts.length > 15 && t.verification.length > 0,
    "Incomplete task: " + t.id,
  );
  assert(
    m.waves.some((w) => w.tasks.includes(t.id)),
    "Task has no wave: " + t.id,
  );
  assert(
    t.specSections.every((s) => s >= 1 && s <= 21),
    "Invalid design reference: " + t.id,
  );
  for (const p of t.contextPaths)
    assert(p.status === "planned" || exists(p.path), "Missing existing context: " + p.path);
  for (const p of t.testPaths)
    assert(
      exists(p.path) || futureTests.has(p.path),
      "Test not present or planned by authority: " + p.path,
    );
  for (const d of t.dependsOn)
    assert(m.tasks.find((x) => x.id === d)?.wave < t.wave, "Impossible wave: " + t.id);
  assert(
    t.worktree.integrationDestination === "codex/ai-native-journal",
    "Unexpected merge destination",
  );
}
const graph = read(base + "/dependency-graph.md");
for (const t of m.tasks)
  for (const d of t.dependsOn)
    assert(
      graph.includes(d.replace("-", "") + " --> " + t.id.replace("-", "")),
      "Mermaid edge missing: " + d + " -> " + t.id,
    );
// All currently dispatched implementation ownership is serial; reject a future wave
// change unless exclusive allocation has been reviewed separately.
assert(
  m.waves.every((w) => w.tasks.length === 1),
  "Parallel phase ownership needs revalidation",
);
assert(m.concurrency.concurrentPhases === false, "Unexpected cross-phase concurrency");
let links = 0;
for (const file of fs.readdirSync(__dirname).filter((p) => p.endsWith(".md"))) {
  const text = read(base + "/" + file);
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    links++;
    assert(
      fs.existsSync(path.resolve(__dirname, target)),
      "Broken link: " + file + " -> " + target,
    );
  }
}
let committed = false;
if (process.argv.includes("--require-committed")) {
  try {
    const ref = git(
      "log",
      "--diff-filter=A",
      "-1",
      "--format=%H",
      "--",
      base + "/execution-manifest.json",
    );
    assert(/^[a-f0-9]{40}$/.test(ref), "No handoff commit exists");
    if (ref) {
      git("merge-base", "--is-ancestor", m.sourceBaseline, ref);
      const files = git("ls-files", base).split("\n").filter(Boolean);
      for (const p of files) git("cat-file", "-e", ref + ":" + p);
      for (const s of m.sources) git("cat-file", "-e", ref + ":" + s.path);
      assert(git("status", "--porcelain", "--", base) === "", "Package has uncommitted changes");
      committed = true;
    }
  } catch (e) {
    errors.push("Committed readiness failed: " + e.message);
  }
}
console.log(
  JSON.stringify(
    {
      tasks: m.tasks.length,
      waves: m.waves.length,
      dependencyEdges: m.tasks.reduce((n, t) => n + t.dependsOn.length, 0),
      sources: m.sources.length,
      localLinks: links,
      acyclic: errors.every((e) => !e.startsWith("Cycle")),
      committed,
      errors,
    },
    null,
    2,
  ),
);
process.exitCode = errors.length ? 1 : 0;
