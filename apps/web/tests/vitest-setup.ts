/**
 * Per-fork test setup.
 *
 * With the `forks` pool each test file runs in its own Node.js process.
 * This module runs before the test file's static imports, so we can set
 * `JOURNAL_DATA_DIR` here and the db module will use it when it evaluates.
 *
 * Each fork gets its own temp directory, so test files that set different
 * `JOURNAL_DATA_DIR` values at module scope all get isolated storage.
 */
import { afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set before any other import can run
const testDataDir = mkdtempSync(join(tmpdir(), "journal-test-"));
process.env.JOURNAL_DATA_DIR = testDataDir;

// Remove the temp directory after all tests close their database connections.
// Retry a few times on Windows where delayed handle release can cause EPERM.
afterAll(async () => {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(testDataDir, { recursive: true, force: true });
      return;
    } catch {
      // eslint-disable-next-line ts-promise-with-resolvers -- one-shot cleanup, Promise.withResolvers more verbose here
      await new Promise((r) => setTimeout(r, 100)).catch(() => {});
    }
  }
});
