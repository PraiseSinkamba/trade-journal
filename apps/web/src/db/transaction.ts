import { db, type JournalDb } from "./connection";

/** The Drizzle transaction handle handed to a journal transaction callback. */
export type JournalTx = Parameters<Parameters<JournalDb["transaction"]>[0]>[0];

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

/**
 * Runs `fn` inside one immediate transaction on the app's journal connection.
 *
 * Transactions are synchronous by contract: the callback type rejects a
 * promise-returning function at compile time, and the runtime guard rolls the
 * transaction back when one shows up anyway. The discarded promise's rejection
 * is consumed so it can never surface as an unhandled rejection.
 */
export function withJournalTransaction<T>(
  fn: (tx: JournalTx) => T extends PromiseLike<unknown> ? never : T,
): T {
  return db.transaction(
    (tx) => {
      const result: unknown = fn(tx);
      if (isThenable(result)) {
        Promise.resolve(result).catch(() => {});
        throw new Error(
          "Journal transactions must be synchronous; async callbacks are not supported.",
        );
      }
      return result as T;
    },
    { behavior: "immediate" },
  );
}
