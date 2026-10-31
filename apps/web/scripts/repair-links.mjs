import {
  copyFileSync,
  existsSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";

/** True when the host can follow a link to its target. */
const resolvable = (path) => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Re-point links that the host cannot resolve at the target they already name.
 *
 * Next copies pnpm's package links into the standalone output unchanged. On Windows
 * those links carry relative targets the host cannot follow, so `stat` fails with
 * EPERM and the packaged server dies before it serves anything. A junction with an
 * absolute target resolves everywhere. A file link is copied instead, because
 * Windows only permits creating file symlinks with elevated rights.
 *
 * `probe` exists so tests can drive the Windows failure on any host.
 */
export function repairBrokenLinks(directory, probe = resolvable) {
  let repaired = 0;
  if (!existsSync(directory)) return repaired;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (probe(path)) continue;
      const target = resolve(directory, readlinkSync(path));
      if (!existsSync(target)) continue;
      rmSync(path, { force: true });
      if (statSync(target).isDirectory()) {
        symlinkSync(target, path, "junction");
      } else {
        copyFileSync(target, path);
      }
      repaired++;
      continue;
    }
    if (entry.isDirectory()) repaired += repairBrokenLinks(path, probe);
  }
  return repaired;
}
