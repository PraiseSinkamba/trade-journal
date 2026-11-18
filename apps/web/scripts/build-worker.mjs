#!/usr/bin/env node
import { createRequire } from "node:module";
import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(appRoot, "package.json"));

// pnpm keeps esbuild beneath tsup, not necessarily at the workspace root.
const esbuild = createRequire(require.resolve("tsup"))("esbuild");

/**
 * Packages that a dependency installs with but never loads at runtime.
 *
 * `prebuild-install` is a build-time helper: better-sqlite3 runs it from its
 * install script to fetch the prebuilt binary, and the runtime only loads the
 * compiled `better_sqlite3.node` through `bindings`. Shipping the helper drags
 * its whole transitive chain (tar-fs, tar-stream, readable-stream,
 * string_decoder, safe-buffer) into the artifact, and the nested tree pushes
 * paths past the Windows path limit, which fails the desktop installer build.
 */
const INSTALL_TIME_ONLY_PACKAGES = new Set(["prebuild-install"]);

async function copyRuntimePackage(name, parentRequire, destination, ancestors = new Set()) {
  const manifestPath = parentRequire.resolve(`${name}/package.json`);
  const source = await realpath(dirname(manifestPath));
  if (ancestors.has(source)) throw new Error(`Circular native runtime dependency: ${name}`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const target = join(destination, "node_modules", name);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    dereference: true,
    filter: (path) =>
      path === source || !["node_modules", ".git"].includes(path.split(/[\\/]/).at(-1)),
  });
  const nestedRequire = createRequire(manifestPath);
  const nextAncestors = new Set(ancestors).add(source);
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (INSTALL_TIME_ONLY_PACKAGES.has(dependency)) continue;
    await copyRuntimePackage(dependency, nestedRequire, target, nextAncestors);
  }
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
    if (INSTALL_TIME_ONLY_PACKAGES.has(dependency)) continue;
    try {
      nestedRequire.resolve(`${dependency}/package.json`);
    } catch (error) {
      if (error.code === "MODULE_NOT_FOUND") continue;
      throw error;
    }
    if (!(dependency in (manifest.dependencies ?? {}))) {
      await copyRuntimePackage(dependency, nestedRequire, target, nextAncestors);
    }
  }
}

async function hasNativeArtifact(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && (await hasNativeArtifact(path))) return true;
    if (entry.isFile() && entry.name === "better_sqlite3.node") return true;
  }
  return false;
}

export async function buildWorker(outdir = join(appRoot, ".next/worker-dist")) {
  outdir = resolve(outdir);
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  try {
    const result = await esbuild.build({
      absWorkingDir: appRoot,
      entryPoints: ["src/server/intelligence/worker-entry.ts"],
      outfile: join(outdir, "worker-entry.cjs"),
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      external: ["better-sqlite3"],
      metafile: true,
      write: false,
      tsconfig: join(appRoot, "tsconfig.json"),
    });
    for (const input of Object.keys(result.metafile.inputs)) {
      const normalized = input.replaceAll("\\", "/");
      if (
        /(?:^|\/)node_modules\/(?:next|react|react-dom)(?:\/|$)/.test(normalized) ||
        /(?:^|\/)src\/app\//.test(normalized) ||
        /(?:^|\/)route\.[cm]?[jt]sx?$/.test(normalized)
      ) {
        throw new Error(`Worker bundle contains HTTP/UI dependency: ${input}`);
      }
    }
    await copyRuntimePackage("better-sqlite3", require, outdir);
    if (!(await hasNativeArtifact(join(outdir, "node_modules", "better-sqlite3")))) {
      throw new Error(
        "Worker artifact is missing better_sqlite3.node; rebuild the installed native dependency.",
      );
    }
    for (const output of result.outputFiles) await writeFile(output.path, output.contents);
    return outdir;
  } catch (error) {
    await rm(outdir, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--out-dir" || !args[1])) {
    throw new Error("Usage: node scripts/build-worker.mjs [--out-dir DIRECTORY]");
  }
  await buildWorker(args[1]);
}
