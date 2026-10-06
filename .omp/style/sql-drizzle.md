# SQL & Drizzle Style Guide

Database authoring for `apps/web/src/db/`. SQLite with Drizzle ORM, WAL mode, foreign key enforcement at the connection level.

---

## Schema Definition — `schema.ts`

Use Drizzle's typed query builder. **Never write raw SQL** for application queries — raw SQL is permitted only in `BOOTSTRAP_SQL` in `db/bootstrap.ts`.

```ts
// apps/web/src/db/schema.ts pattern
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const executions = sqliteTable('executions', {
  id:           text('id').primaryKey(),
  accountId:    text('account_id').notNull(),
  symbol:       text('symbol').notNull(),
  direction:    text('direction').notNull(),   // 'buy' | 'sell'
  openedAt:     text('opened_at').notNull(),    // ISO 8601 UTC
  closedAt:     text('closed_at'),
  quantity:     integer('quantity').notNull(),
  price:        integer('price').notNull(),      // cents — integer, never float
  netAmount:    integer('net_amount'),           // signed cents
  importGroup:  text('import_group'),
  contentHash:  text('content_hash').notNull(), // dedup key
  importOrder:  integer('import_order').notNull(),
}, (table) => ({
  // Composite unique index for dedup — (account_id, content_hash)
  accountContentIdx: uniqueIndex('exec_account_content_idx')
    .on(table.accountId, table.contentHash),
  // Trade key for UPSERT — see Trade Key Format below
  tradeKeyIdx: index('exec_trade_key_idx').on(table.accountId, table.symbol, table.direction, table.openedAt),
}));
```

---

## Connection — `db/index.ts`

WAL mode and `foreign_keys=ON` are set **once per connection** in `db/index.ts`. Do not toggle these per-call.

```ts
// apps/web/src/db/index.ts
const driver = drizzle({
  connection: {
    filename: dbPath,
    open: (conn) => {
      conn.pragma('journal_mode = WAL');
      conn.pragma('foreign_keys = ON');
    },
  },
});
```

Every migration and query runs under these defaults. If a specific operation needs to bypass a constraint, use an explicit `pragma` in the query scope only — never at the connection level.

---

## Bootstrap — `db/bootstrap.ts`

`BOOTSTRAP_SQL` creates the initial schema. It is **idempotent** — every `CREATE` uses `IF NOT EXISTS`, every `CREATE INDEX` uses `IF NOT EXISTS`.

```sql
-- apps/web/src/db/bootstrap.ts
CREATE TABLE IF NOT EXISTS executions (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  ...
);
CREATE INDEX IF NOT EXISTS idx_exec_trade_key ON executions(account_id, symbol, direction, opened_at);
CREATE INDEX IF NOT EXISTS idx_exec_account_content ON executions(account_id, content_hash);
```

Running bootstrap twice on an empty database must succeed without error.

---

## Additive Migrations — `db/index.ts`

ALTER migrations are **additive-only**. Guards check `sqlite_schema` before altering.

```ts
// apps/web/src/db/index.ts — additive ALTER pattern
async function runAdditiveMigrations(db: Database) {
  const rows = await db.all(sql`SELECT name FROM sqlite_schema WHERE type='table'`);
  const tableNames = new Set(rows.map((r: any) => r.name));

  if (tableNames.has('executions') && !tableNames.has('new_column')) {
    await db.run(sql`ALTER TABLE executions ADD COLUMN new_column TEXT`);
  }
}
```

**Never** use `DROP COLUMN` or `DROP TABLE` in migration code. Column removal requires a schema version bump and a new bootstrap.

---

## Trade Key Format

The trade key is the UPSERT deduplication anchor for rebuilds. Format:

```
{accountId}|{symbol}|{direction}|{openedAt}[|{importGroup}][|{N}]
```

Defined in `packages/core/src/round-trips.ts`. The index on `(account_id, symbol, direction, opened_at)` supports fast lookups for the UPSERT.

```ts
// packages/core/src/round-trips.ts — buildTradeKey
export function buildTradeKey(
  accountId: string,
  symbol: string,
  direction: 'buy' | 'sell',
  openedAt: string,  // ISO 8601 UTC
  importGroup?: string,
  seq?: number,
): string { ... }
```

**Always** use `buildTradeKey` to construct trade keys — never concatenate manually.

---

## Content Hash — Deduplication Index

`(account_id, content_hash)` has a unique composite index for deduplication. When inserting executions, check the hash first to avoid duplicate rows.

```ts
// apps/web/src/server/executions.ts — dedup check before insert
const existing = await db
  .select({ id: executions.id })
  .from(executions)
  .where(
    and(
      eq(executions.accountId, accountId),
      eq(executions.contentHash, contentHash),
    ),
  )
  .limit(1);

if (existing.length > 0) {
  return { skipped: 1, inserted: 0 };
}
```

The unique index enforces this at the DB level as a backstop.

---

## Money Columns — Integer Cents

Prefer integer cents for money columns. If a float is necessary (e.g. a broker delivers only float prices), document the decision with a comment naming the precision ceiling.

```ts
// Correct — integer cents
price:      integer('price').notNull(),     // cents
netAmount:  integer('net_amount'),          // signed cents

// Float with documented ceiling — only when broker provides no integer alternative
// ponytail: float precision ceiling ±0.01, acceptable for low-frequency price data
brokerPrice: real('broker_price').notNull(),
```

Never use `real` for a money column without a comment explaining why integer cents is not feasible.

---

## Booleans — INTEGER 0/1

SQLite stores booleans as `INTEGER 0/1`. Drizzle maps them transparently to `boolean` in TypeScript.

```ts
// schema
isActive:   integer('is_active').notNull().default(1),

// TypeScript — reads as boolean
const row = await db.select().from(tables).where(eq(tables.isActive, true));
```

Do not use `text('t')` or `text('true')` for booleans.

---

## Timestamps — TEXT ISO 8601 UTC

All timestamps stored as `TEXT` in ISO 8601 UTC. The `closedAt` column for executions is nullable — `null` means open position.

```ts
openedAt:  text('opened_at').notNull(),  // ISO 8601 UTC
closedAt:  text('closed_at'),            // null = open position
```

Never store Unix epoch integers for user-visible timestamps. Display timezone is the UI's responsibility.

---

## JSON Blobs — TEXT + parse at boundary

`importMetadata` and similar flexible blobs are stored as `TEXT` and parsed at the application boundary. **Never use `json_extract` in user-facing queries** — it bypasses the ORM type system.

```ts
// Store as TEXT
importMetadata: text('import_metadata'),

// Parse at read boundary
const row = await db.select().from(executions).where(...);
const meta = row.importMetadata ? JSON.parse(row.importMetadata) : null;
```

If you need to query across JSON fields at scale, add a dedicated indexed column — do not use `json_extract` in high-frequency paths.

---

## Transactions

Every write spanning more than one table uses `db.transaction()` with `{ behavior: 'immediate' }` for write ordering. Pass the transaction explicitly to nested operations.

```ts
// apps/web/src/server/executions.ts — multi-table transaction
await db.transaction(async (tx) => {
  await tx.insert(executions).values(enriched);
  await tx.update(imports)
    .set({ processedAt: new Date().toISOString() })
    .where(eq(imports.id, importId));
}, { behavior: 'immediate' });
```

Read-only operations do not need transactions. `immediate` lock behavior is used because SQLite serializes writes at the DB level anyway — `immediate` avoids long-lived exclusive locks.

---

## Cite

- `apps/web/src/db/schema.ts` — Drizzle table definitions, column types, indexes
- `apps/web/src/db/bootstrap.ts` — `BOOTSTRAP_SQL`, idempotent CREATE IF NOT EXISTS
- `apps/web/src/db/index.ts` — WAL pragma, foreign_keys pragma, additive ALTER guards
- `packages/core/src/round-trips.ts` — `buildTradeKey`, trade key format

---

## Checklist before PR

- [ ] All application queries use Drizzle query builder; raw SQL only in `BOOTSTRAP_SQL`
- [ ] WAL mode and `foreign_keys = ON` set once in `db/index.ts`; never toggled per-call
- [ ] `BOOTSTRAP_SQL` uses `IF NOT EXISTS` on every CREATE and INDEX; bootstrap is idempotent
- [ ] ALTER migrations are additive-only; no `DROP COLUMN` or destructive ALTER
- [ ] Trade key built with `buildTradeKey` from `packages/core/src/round-trips.ts`; never manual concatenation
- [ ] `(account_id, content_hash)` unique index exists and is checked before insert for dedup
- [ ] Money columns use `integer` (cents); `real` only with a comment naming the precision ceiling
- [ ] All timestamps are ISO 8601 UTC TEXT; never Unix epoch integers for user-facing values
