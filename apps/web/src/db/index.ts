/**
 * Public journal entry point.
 *
 * Connection lifecycle lives in `./connection` and the synchronous transaction
 * seam in `./transaction`; this module only re-exports them so existing
 * `import { db, accounts } from "@/db"` call sites keep working unchanged.
 */

export * from "./connection";
export * from "./transaction";
export * from "./schema";
