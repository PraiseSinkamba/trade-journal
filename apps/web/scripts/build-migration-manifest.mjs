#!/usr/bin/env node
/**
 * Generates the migration checksum manifest.
 *
 * Every file in `src/db/migrations` is hashed over its canonical source text and
 * the result is written to `src/db/migration-checksums.json`. The runtime reads
 * that artifact (never the migration source, which a packaged build does not
 * ship) so a journal can prove which source it was migrated from.
 *
 * Usage:
 *   node scripts/build-migration-manifest.mjs           # write the artifact
 *   node scripts/build-migration-manifest.mjs --check   # fail when it is stale
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../src/db/migrations");
const artifactPath = resolve(here, "../src/db/migration-checksums.json");

/**
 * Canonical form of a migration source: LF line endings, no trailing
 * whitespace, exactly one trailing newline. The checkout's line endings must
 * not change a checksum.
 */
export const canonical = (source) =>
  source
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n*$/, "\n");

/** Builds the manifest from the migration sources. */
export const buildManifest = () => {
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".ts"))
    .sort();

  const migrations = {};
  for (const file of files) {
    const match = /^(\d{4})-(.+)\.ts$/.exec(file);
    if (!match) throw new Error(`Migration file "${file}" must be named NNNN-name.ts.`);
    const version = Number(match[1]);
    const name = match[2];
    if (migrations[String(version)]) {
      throw new Error(`Migration version ${version} is claimed by more than one file.`);
    }
    const source = readFileSync(join(migrationsDir, file), "utf8");
    migrations[String(version)] = {
      file,
      name,
      checksum: createHash("sha256").update(canonical(source), "utf8").digest("hex"),
    };
  }
  return { formatVersion: 1, migrations };
};

const main = () => {
  const artifact = `${JSON.stringify(buildManifest(), null, 2)}\n`;

  if (process.argv.includes("--check")) {
    const current = existsSync(artifactPath) ? readFileSync(artifactPath, "utf8") : "";
    if (current === artifact) {
      console.log("migration-checksums.json is up to date.");
      return;
    }
    let previous = {};
    try {
      previous = JSON.parse(current || "{}").migrations ?? {};
    } catch {
      previous = {};
    }
    const changed = Object.entries(JSON.parse(artifact).migrations)
      .filter(([version, entry]) => previous[version]?.checksum !== entry.checksum)
      .map(([version, entry]) => `${version}-${entry.name}`);
    console.error(
      `migration-checksums.json is out of date${changed.length ? ` (${changed.join(", ")})` : ""}. Run \`pnpm --filter web migrations:build\`.`,
    );
    process.exit(1);
  }

  writeFileSync(artifactPath, artifact);
  console.log(`Wrote ${artifactPath}.`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
