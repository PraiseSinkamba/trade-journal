#!/usr/bin/env node
/**
 * The operator entry point for the journal's backup and restore.
 *
 * The backup and the restore are server functions, and a server function an
 * operator cannot call is not a backup. This script is the surface that calls
 * them: it bundles the shipped module with the repository's own toolchain and
 * hands the operator's explicit inputs to `backupJournal` and `restoreJournal`.
 *
 * It reimplements nothing. Every shipped refusal is reachable through it: a
 * missing or relative path, a source and a destination that are the same, a
 * missing quiescence acknowledgement, a journal that still holds a worker
 * lease, a source that does not hold the journal's own key, a destination that
 * already holds a journal, and a source that does not hold a backup manifest.
 *
 * The command adds two preconditions of its own, and they are preconditions
 * rather than refusals of the backup: `JOURNAL_DATA_DIR` must name the journal
 * the operator owns, because that is where the key that travels with the
 * backup comes from.
 *
 * A backup is only valid on a quiescent journal, so the writers are stopped
 * before this runs. That is why this is a script and not a route: the web
 * process that would serve a route is one of the writers, and a route would
 * also let a key file be written to any path on the machine over the network.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(appRoot, "package.json"));

const USAGE = `Usage:
  node scripts/intelligence-operations.mjs backup --source <journal directory> --destination <backup directory> --acknowledge-quiescence
  node scripts/intelligence-operations.mjs restore --source <backup directory> --destination <scratch directory>`;

/**
 * Reads the operator's arguments.
 *
 * Nothing is defaulted: an omitted source or destination stays empty and the
 * shipped function refuses it, and the quiescence acknowledgement is a flag
 * the operator has to type. A separator a package manager forwards is skipped,
 * so the same command works with and without it.
 */
export const parseArguments = (args) => {
  const operands = args[0] === "--" ? args.slice(1) : args;
  const operation = operands[0];
  if (operation !== "backup" && operation !== "restore") {
    throw new Error(`Unknown operation "${operation ?? ""}".\n${USAGE}`);
  }
  const values = { source: "", destination: "", quiesced: false };
  for (let index = 1; index < operands.length; index += 1) {
    const argument = operands[index];
    if (argument === "--acknowledge-quiescence") {
      values.quiesced = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    if (flag !== "--source" && flag !== "--destination") {
      throw new Error(`Unknown argument "${argument}".\n${USAGE}`);
    }
    const value = separator === -1 ? operands[++index] : argument.slice(separator + 1);
    if (value === undefined) throw new Error(`${flag} needs a directory.\n${USAGE}`);
    if (flag === "--source") values.source = value;
    else values.destination = value;
  }
  return { operation, ...values };
};

/**
 * The journal the operator owns.
 *
 * The shipped backup judges the source against the key of this journal, so the
 * journal and the source are two things an operator names: a stale copy of
 * another journal is refused because its key does not match.
 */
const journalYouOwn = () => {
  const directory = process.env.JOURNAL_DATA_DIR;
  if (!directory || !isAbsolute(directory)) {
    throw new Error("JOURNAL_DATA_DIR must be an absolute path to the journal you own.");
  }
  if (!existsSync(join(directory, "journal.db"))) {
    throw new Error(`JOURNAL_DATA_DIR does not hold a journal: ${directory}`);
  }
  return directory;
};

/**
 * Loads the shipped backup and restore.
 *
 * The module is TypeScript with path aliases, so it is bundled with the same
 * toolchain the worker bundle uses. The bundle lives under the application so
 * that the native database driver resolves from the application's own
 * dependencies.
 */
const loadOperations = async (outfile) => {
  const esbuild = createRequire(require.resolve("tsup"))("esbuild");
  const result = await esbuild.build({
    absWorkingDir: appRoot,
    stdin: {
      contents: [
        'export { backupJournal, restoreJournal } from "@/server/intelligence/infrastructure/retention";',
        'export { db } from "@/db/connection";',
      ].join("\n"),
      resolveDir: appRoot,
      loader: "ts",
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["better-sqlite3"],
    metafile: true,
    write: false,
    tsconfig: join(appRoot, "tsconfig.json"),
  });
  for (const output of result.outputFiles) writeFileSync(output.path, output.contents);
  for (const input of Object.keys(result.metafile.inputs)) {
    const normalized = input.split("\\").join("/");
    if (
      /(?:^|\/)node_modules\/(?:next|react|react-dom)(?:\/|$)/.test(normalized) ||
      /(?:^|\/)src\/app\//.test(normalized)
    ) {
      throw new Error(`The operations bundle contains an HTTP or UI dependency: ${input}`);
    }
  }
  return require(outfile);
};

const main = async (args) => {
  const { operation, source, destination, quiesced } = parseArguments(args);
  // The journal the operator owns is the one whose key travels with the
  // backup; the restore works on a backup directory and never on it.
  const live = operation === "backup" ? journalYouOwn() : null;
  // The module opens the journal it is loaded against, so it is loaded against
  // a scratch directory: the command never opens the journal it copies, and a
  // journal that cannot be opened does not stop a restore.
  const scratch = mkdtempSync(join(tmpdir(), "journal-operations-"));
  const outdir = join(appRoot, ".next", "intelligence-ops");
  mkdirSync(outdir, { recursive: true });
  const outfile = join(outdir, `operations-${process.pid}.cjs`);
  const previous = process.env.JOURNAL_DATA_DIR;
  process.env.JOURNAL_DATA_DIR = scratch;
  try {
    const operations = await loadOperations(outfile);
    try {
      if (live) process.env.JOURNAL_DATA_DIR = live;
      const result =
        operation === "backup"
          ? operations.backupJournal({ source, destination, quiesced })
          : operations.restoreJournal({ source, destination });
      console.log(JSON.stringify(result));
    } finally {
      operations.db.$client.close();
    }
  } finally {
    process.env.JOURNAL_DATA_DIR = previous;
    rmSync(scratch, { recursive: true, force: true });
    rmSync(outfile, { force: true });
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
