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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set before any other import can run
process.env.JOURNAL_DATA_DIR = mkdtempSync(join(tmpdir(), "journal-test-"));
