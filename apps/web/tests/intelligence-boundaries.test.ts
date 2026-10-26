import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Import-graph guards for the AI-native journal modernization (Phase 01, Subtask 3).
 *
 * The rules encoded here are the dependency-direction contract of the repo:
 *   1. public packages stay pure (packages/core, packages/importers);
 *   2. server domain code cannot reach Next, React or route files;
 *   3. the client layer (lib/, components/) cannot reach server code or the db;
 *   4. only the infrastructure layer (apps/web/src/db/) wires the concrete driver;
 *   5. sibling private adapters inside the intelligence tree stay private.
 *
 * The graph is built from the real source tree with node:fs only — no new
 * dependency. Rule 2 is computed over the TRANSITIVE import closure, because
 * `@/db` -> db/index.ts -> db/connection.ts -> db/bootstrap.ts and a direct
 * specifier scan would miss that path.
 */

const ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

const WEB_SRC = "apps/web/src";
const SERVER_DIR = `${WEB_SRC}/server`;
const DB_DIR = `${WEB_SRC}/db`;
const APP_DIR = `${WEB_SRC}/app`;
const LIB_DIR = `${WEB_SRC}/lib`;
const COMPONENTS_DIR = `${WEB_SRC}/components`;
const CORE_SRC = "packages/core/src";
const IMPORTERS_SRC = "packages/importers/src";
const INTELLIGENCE_DIR = `${SERVER_DIR}/intelligence`;

/** The one permitted Next-facing request boundary. */
const REQUEST_BOUNDARY = `${SERVER_DIR}/api.ts`;

/** Workspace package name -> package entry point. */
const WORKSPACE_PACKAGES: Record<string, string> = {
  "@luxalgo/journal-core": `${CORE_SRC}/index.ts`,
  "@luxalgo/journal-importers": `${IMPORTERS_SRC}/index.ts`,
};

/**
 * Every import form we care about: `import`, `import type`, `export … from`,
 * `export type … from`, `export * from`, side-effect `import "x"` and
 * dynamic `import("x")`. `require("x")` is included for completeness.
 */
const IMPORT_RE = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"'\n]+)["']/g;

type Edge = {
  /** File the import statement lives in. */
  from: string;
  /** Raw specifier as written in the source. */
  spec: string;
  /** Repo-relative file the specifier resolves to, or null for external packages. */
  to: string | null;
};

const relFromRoot = (absolute: string): string =>
  path.relative(ROOT, absolute).split(path.sep).join("/");

/** All source files that take part in the graph. */
const collectFiles = async (): Promise<string[]> => {
  const roots = [WEB_SRC, CORE_SRC, IMPORTERS_SRC];
  const files = new Set<string>();
  for (const root of roots) {
    for await (const file of glob(path.join(ROOT, root, "**/*.ts"))) {
      files.add(relFromRoot(file));
    }
    for await (const file of glob(path.join(ROOT, root, "**/*.tsx"))) {
      files.add(relFromRoot(file));
    }
  }
  return [...files].sort();
};

/**
 * Resolve a specifier to a repo-relative file.
 *
 * Handles the `@/` alias (including directory targets such as `@/db` ->
 * apps/web/src/db/index.ts), relative specifiers and the two workspace
 * packages. Bare specifiers stay external and resolve to null.
 */
const resolveSpecifier = (
  spec: string,
  fromFile: string,
  files: ReadonlySet<string>,
): string | null => {
  let base: string | null = null;
  if (spec.startsWith("@/")) {
    base = path.posix.normalize(`${WEB_SRC}/${spec.slice(2)}`);
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  } else if (WORKSPACE_PACKAGES[spec]) {
    base = WORKSPACE_PACKAGES[spec];
  }
  if (base === null) return null;

  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  for (const candidate of candidates) {
    if (files.has(candidate)) return candidate;
  }
  return null;
};

const extractSpecifiers = (source: string): string[] => {
  const specs: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (spec) specs.push(spec);
  }
  return specs;
};

type Graph = { files: Set<string>; edges: Edge[] };

/** Build the import graph of the whole source tree. */
const buildGraph = async (): Promise<Graph> => {
  const fileList = await collectFiles();
  const files = new Set(fileList);
  const edges: Edge[] = [];
  for (const file of fileList) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    for (const spec of extractSpecifiers(source)) {
      edges.push({ from: file, spec, to: resolveSpecifier(spec, file, files) });
    }
  }
  return { files, edges };
};

let graphPromise: Promise<Graph> | undefined;

/** The graph is identical for every rule — build it once per test file. */
const graph = (): Promise<Graph> => (graphPromise ??= buildGraph());

/**
 * Transitive import closure of `entry`, following resolved files only.
 * Returns every visited file plus the external specifiers found on the way.
 */
const closureOf = (
  entry: string,
  edgesByFile: ReadonlyMap<string, Edge[]>,
): { visited: Set<string>; externals: { file: string; spec: string }[] } => {
  const visited = new Set<string>();
  const externals: { file: string; spec: string }[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const edge of edgesByFile.get(current) ?? []) {
      if (edge.to === null) {
        externals.push({ file: current, spec: edge.spec });
      } else if (!visited.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }
  return { visited, externals };
};

/* ---------------------------------------------------------------------------
 * Rule 5 detector — sibling private adapters stay private.
 *
 * A module in one intelligence domain may import only `contracts/` from its
 * siblings (never another domain's private files, never `infrastructure/`),
 * and only `composition.ts` may wire concrete infrastructure adapters.
 * ------------------------------------------------------------------------ */

const intelligenceDomain = (file: string): string => {
  const rest = file.slice(INTELLIGENCE_DIR.length + 1);
  const slash = rest.indexOf("/");
  return slash === -1 ? "" : rest.slice(0, slash);
};

const detectIntelligenceViolations = (edges: Edge[]): string[] => {
  const violations: string[] = [];
  for (const edge of edges) {
    if (!edge.from.startsWith(`${INTELLIGENCE_DIR}/`)) continue;
    // composition.ts is the single wiring point for concrete infrastructure.
    if (edge.from === `${INTELLIGENCE_DIR}/composition.ts`) continue;
    if (edge.to === null || !edge.to.startsWith(`${INTELLIGENCE_DIR}/`)) continue;
    const fromDomain = intelligenceDomain(edge.from);
    const toDomain = intelligenceDomain(edge.to);
    if (fromDomain === toDomain) continue;
    // `contracts/` is the only public surface between sibling domains.
    if (toDomain === "contracts") continue;
    violations.push(
      `${edge.from} imports "${edge.spec}" -> ${edge.to} (sibling domain "${toDomain}")`,
    );
  }
  return violations;
};

describe("intelligence import boundaries", () => {
  it("resolves the known edges (directory targets and the api.ts request boundary)", async () => {
    const { files, edges } = await graph();
    const edgeOf = (from: string, spec: string): Edge | undefined =>
      edges.find((edge) => edge.from === from && edge.spec === spec);

    // @/db must resolve through the directory barrel, not vanish from the graph.
    expect(edgeOf(`${SERVER_DIR}/executions.ts`, "@/db")?.to).toBe(`${DB_DIR}/index.ts`);
    // A relative specifier must resolve to its file.
    expect(edgeOf(`${SERVER_DIR}/executions.ts`, "./ids")?.to).toBe(`${SERVER_DIR}/ids.ts`);
    // The request boundary is the only Next-facing server module: the edge
    // exists, but `next/server` is external, so it resolves to no file.
    const nextEdge = edgeOf(REQUEST_BOUNDARY, "next/server");
    expect(nextEdge).toBeDefined();
    expect(nextEdge?.to).toBeNull();
    expect(files.has(`${DB_DIR}/index.ts`)).toBe(true);
  });

  it("rule 1: public packages stay pure", async () => {
    const { edges } = await graph();
    const violations: string[] = [];
    for (const edge of edges) {
      const inCore = edge.from.startsWith(`${CORE_SRC}/`);
      const inImporters = edge.from.startsWith(`${IMPORTERS_SRC}/`);
      if (!inCore && !inImporters) continue;
      if (edge.spec.includes("intelligence")) {
        violations.push(
          `${edge.from} imports "${edge.spec}" (intelligence path in a public package)`,
        );
      }
      if (edge.to !== null && edge.to.startsWith(`${WEB_SRC}/`)) {
        violations.push(
          `${edge.from} imports "${edge.spec}" -> ${edge.to} (app code in a public package)`,
        );
      }
      if (inCore && edge.to !== null && edge.to.startsWith(`${IMPORTERS_SRC}/`)) {
        violations.push(
          `${edge.from} imports "${edge.spec}" -> ${edge.to} (core reaches importers)`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it("rule 2: server domain code cannot reach Next, React or routes", async () => {
    const { edges } = await graph();
    const edgesByFile = new Map<string, Edge[]>();
    for (const edge of edges) {
      const list = edgesByFile.get(edge.from);
      if (list) list.push(edge);
      else edgesByFile.set(edge.from, [edge]);
    }

    const violations: string[] = [];
    const offenders: string[] = [];
    for (const file of edgesByFile.keys()) {
      if (!file.startsWith(`${SERVER_DIR}/`)) continue;
      if (file === REQUEST_BOUNDARY) continue;
      const { visited, externals } = closureOf(file, edgesByFile);
      const nextReact = externals.filter(
        (entry) =>
          entry.spec === "next" ||
          entry.spec.startsWith("next/") ||
          entry.spec === "react" ||
          entry.spec === "react-dom" ||
          entry.spec.startsWith("react-dom/"),
      );
      const routes = [...visited].filter((visitedFile) => visitedFile.startsWith(`${APP_DIR}/`));
      if (nextReact.length === 0 && routes.length === 0) continue;
      offenders.push(file);
      for (const entry of nextReact) {
        violations.push(`${file} reaches "${entry.spec}" via ${entry.file}`);
      }
      for (const route of routes) {
        violations.push(`${file} reaches route file ${route}`);
      }
    }
    expect(
      violations,
      `server modules reaching Next/React/routes: ${offenders.length}\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("rule 3: the client layer cannot reach server code", async () => {
    const { edges } = await graph();
    const violations: string[] = [];
    for (const edge of edges) {
      const fromClient =
        edge.from.startsWith(`${LIB_DIR}/`) || edge.from.startsWith(`${COMPONENTS_DIR}/`);
      if (!fromClient) continue;
      if (edge.to === null) continue;
      if (edge.to.startsWith(`${SERVER_DIR}/`) || edge.to.startsWith(`${DB_DIR}/`)) {
        violations.push(`${edge.from} imports "${edge.spec}" -> ${edge.to}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("rule 4: only the infrastructure layer wires the concrete driver", async () => {
    const { edges } = await graph();
    const drivers = ["better-sqlite3", "drizzle-orm/better-sqlite3"];
    const violations: string[] = [];
    for (const edge of edges) {
      if (!drivers.includes(edge.spec)) continue;
      if (!edge.from.startsWith(`${DB_DIR}/`)) {
        violations.push(`${edge.from} imports "${edge.spec}" (outside ${DB_DIR}/)`);
      }
    }
    expect(violations).toEqual([]);
  });

  // Live self-test: the detector must report a violation on a fixture that
  // breaks the rule. Never skipped — it proves the detector is not a no-op.
  it("rule 5: the sibling-private detector reports a violating fixture", () => {
    const violating = detectIntelligenceViolations([
      {
        from: `${INTELLIGENCE_DIR}/knowledge/reader.ts`,
        spec: "@/server/intelligence/runtime/private-adapter",
        to: `${INTELLIGENCE_DIR}/runtime/private-adapter.ts`,
      },
    ]);
    expect(violating).toHaveLength(1);
    expect(violating[0]).toContain("knowledge/reader.ts");
    expect(violating[0]).toContain("runtime/private-adapter.ts");
  });

  it("rule 5: the sibling-private detector allows contracts and composition wiring", () => {
    const allowed = detectIntelligenceViolations([
      {
        from: `${INTELLIGENCE_DIR}/knowledge/reader.ts`,
        spec: "@/server/intelligence/contracts/types",
        to: `${INTELLIGENCE_DIR}/contracts/types.ts`,
      },
      {
        from: `${INTELLIGENCE_DIR}/knowledge/reader.ts`,
        spec: "./local-helper",
        to: `${INTELLIGENCE_DIR}/knowledge/local-helper.ts`,
      },
      {
        from: `${INTELLIGENCE_DIR}/composition.ts`,
        spec: "@/server/intelligence/infrastructure/sqlite-adapter",
        to: `${INTELLIGENCE_DIR}/infrastructure/sqlite-adapter.ts`,
      },
    ]);
    expect(allowed).toEqual([]);
  });

  // The intelligence tree arrives in a later phase. Until then this block
  // reports as skipped, so the dormant rule is visibly dormant.
  describe.skipIf(!existsSync(path.join(ROOT, INTELLIGENCE_DIR)))(
    "rule 5 application: intelligence tree",
    () => {
      it("no domain imports a sibling's private file", async () => {
        const { edges } = await graph();
        const violations = detectIntelligenceViolations(edges);
        expect(violations).toEqual([]);
      });
    },
  );
});
