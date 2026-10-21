# Section 6 — Data Architecture

> **Evidence convention**: `[ARCH-NNN] file:line` — VERIFIED / INFERRED / UNVERIFIED / UNKNOWN.
> All line ranges are inclusive. Evidence IDs 100–149 reserved for this section.

---

## 6.1 Persistence Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      App Layer                               │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │  API Routes │  │  Server/*.ts │  │  packages/core    │  │
│  │  (Next.js)  │  │  (executions │  │  (buildRoundTrips │  │
│  │             │  │   rebuild     │  │   computeMetrics  │  │
│  │             │  │   sync)       │  │   matchesFilters   │  │
│  └──────┬──────┘  └──────┬──────┘  └────────┬─────────┘  │
│         │                 │                    │              │
│         └────────────────┼────────────────────┘              │
│                          │ Drizzle ORM                        │
│  ┌──────────────────────▼────────────────────────────────┐  │
│  │            better-sqlite3 (WAL, busy_timeout=5000)      │  │
│  │            foreign_keys=ON                               │  │
│  └──────────────────────┬────────────────────────────────┘  │
└─────────────────────────┼────────────────────────────────────┘
                          │
                    SQLite file
                    (single-file per journal)
```

**Driver**: `better-sqlite3` with Drizzle ORM (`@/db` singleton) [ARCH-100] VERIFIED `db/index.ts`.
**WAL mode**: enabled; `busy_timeout=5000`; `foreign_keys=ON` [ARCH-101] VERIFIED `db/index.ts:36-38` and `:98-100`.
**Concurrency**: Single writer; WAL allows concurrent reads during writes.
**No connection pool**: `better-sqlite3` is process-resident; `db` is a module singleton.

**Evidence**: `apps/web/src/db/index.ts` (singleton definition).

---

## 6.2 Database Schema Overview

### `accounts` · `schema.ts:60-82` · `bootstrap.ts:9-24`
| Column | Type | Index/FK | Notes |
|---|---|---|---|
| `id` | `text PK` | | |
| `name` | `text NOT NULL` | | |
| `broker` | `text NOT NULL DEFAULT ''` | | |
| `kind` | `text NOT NULL` | | `sync \| import \| manual` |
| `currency` | `text NOT NULL DEFAULT 'USD'` | | |
| `initialBalance` | `real NOT NULL DEFAULT 0` | | Drawdown anchor |
| `profitCalcMethod` | `text NOT NULL DEFAULT 'fifo'` | | `fifo \| lifo \| wavg` |
| `credentialsEnc` | `text` | | AES-256-GCM; sync only |
| `autoSync` | `integer NOT NULL DEFAULT 0` | | Boolean |
| `lastSyncAt` | `text` | | |
| `ibkrSyncTimeZone` | `text` | | |
| `snapshotJson` | `text` | | |
| `archivedAt` | `text` | | Soft delete |
| `createdAt` | `text NOT NULL` | | Audit |

**No indexes beyond PK. No FKs (root entity).** [ARCH-102] VERIFIED.

---

### `executions` · `schema.ts:84-106` · `bootstrap.ts:26-42`
| Column | Type | Index/FK | Notes |
|---|---|---|---|
| `id` | `text PK` | | |
| `accountId` | `text NOT NULL` | | Logical FK only [ARCH-054] |
| `symbol` | `text NOT NULL` | | |
| `side` | `text NOT NULL` | | `buy \| sell` |
| `quantity` | `real NOT NULL` | | |
| `price` | `real NOT NULL` | | |
| `fee` | `real NOT NULL DEFAULT 0` | | |
| `executedAt` | `text NOT NULL` | | ISO 8601 |
| `assetClass` | `text` | | |
| `source` | `text NOT NULL` | | `sync \| import \| manual` |
| `importMetadataJson` | `text` | | `ImportMetadata` blob |
| `contentHash` | `text NOT NULL` | **UK: (accountId, contentHash)** | SHA-256, 32 hex |
| `createdAt` | `text NOT NULL` | | Audit |

**Indexes**:
- `executions_account_hash`: UNIQUE on `(accountId, contentHash)` — DB dedup [ARCH-055].
- `executions_account_symbol`: `(accountId, symbol)` [ARCH-056].

**No `updatedAt` column** [ARCH-060] VERIFIED — executions are append-only.

---

### `trades` · `schema.ts:108-151` · `bootstrap.ts:44-76`
| Column | Type | Index/FK | Notes |
|---|---|---|---|
| `key` | `text PK` | | Rebuild-stable identity |
| `accountId` | `text NOT NULL` | | |
| `symbol` | `text NOT NULL` | | |
| `assetClass` | `text` | | |
| `direction` | `text NOT NULL` | | `long \| short` |
| `status` | `text NOT NULL` | | `open \| win \| loss \| breakeven` |
| `openedAt` | `text NOT NULL` | | |
| `closedAt` | `text` | | |
| `quantity` | `real NOT NULL` | | |
| `openQuantity` | `real NOT NULL` | | |
| `avgEntry` | `real NOT NULL` | | |
| `avgExit` | `real` | | |
| `grossPnl` | `real NOT NULL` | | |
| `fees` | `real NOT NULL` | | |
| `netPnl` | `real NOT NULL` | | |
| `executionCount` | `integer NOT NULL` | | |
| `executionIdsJson` | `text NOT NULL` | | Serialized `string[]` |
| `exitsJson` | `text NOT NULL` | | Serialized `ExitAttribution[]` |
| `durationMs` | `integer` | | |
| `notes` | `text` | | **Annotation** |
| `tagsJson` | `text` | | **Annotation** |
| `mistakesJson` | `text` | | **Annotation** |
| `playbookId` | `text` | | FK → `playbooks.id` (no Drizzle references) |
| `rating` | `integer` | | |
| `stopLoss` | `real` | | |
| `profitTarget` | `real` | | |
| `reviewedAt` | `text` | | |

**Indexes**:
- `trades_account_closed`: `(accountId, closedAt)` [ARCH-061].
- `trades_symbol`: `(symbol)` [ARCH-062].
- `trades_opened`: `(openedAt)` [ARCH-063].
- `trades_account_opened`: `(accountId, openedAt)` [ARCH-064].

**No FK declared in Drizzle for `accountId`** [ARCH-054].
**Annotation comment**: `schema.ts:136` — developer notes that computed cols are overwritten, annotations survive [ARCH-066].

---

### `journal_days` · `schema.ts:155-160` · `bootstrap.ts:78-81`
| Column | Type | Index/FK | Notes |
|---|---|---|---|
| `date` | `text PK` | | `"YYYY-MM-DD"` |
| `note` | `text NOT NULL DEFAULT ''` | | |
| `updatedAt` | `text NOT NULL` | | Audit + update tracking |

**No FK to `accounts`** [ARCH-103] — journal days are global, not per-account.
**Has `updatedAt`** (unusual — most tables only have `createdAt`).

---

### `folders` · `schema.ts:162-171` · `bootstrap.ts:83-86`
| Column | Type | Index/FK | Notes |
|---|---|---|---|
| `id` | `text PK` | | |
| `name` | `text NOT NULL` | | |
| `kind` | `text NOT NULL DEFAULT 'user'` | | `system \| user` |
| `createdAt` | `text NOT NULL` | | |
| `deletedAt` | `text` | | Soft delete |

**No indexes. No FKs.** System folders seeded by `BOOTSTRAP_SQL` [ARCH-071].

---

### `notes` · `schema.ts:170-185` · `bootstrap.ts:88-95`
| Column | Type | Index/FK | Notes |
|---|---|---|
| `id` | `text PK` | | |
| `folderId` | `text NOT NULL` | **No FK** — logical reference; no `.references()` in schema, no REFERENCES in bootstrap | |
| `title` | `text NOT NULL DEFAULT ''` | | |
| `content` | `text NOT NULL DEFAULT ''` | | |
| `tagsJson` | `text` | | |
| `tradeKey` | `text` | | Optional anchor → `trades.key` |
| `dayDate` | `text` | | Optional anchor → `journal_days.date` |
| `createdAt` | `text NOT NULL` | | |
| `updatedAt` | `text NOT NULL` | | |

**Indexes**: `notes_folder` on `folderId` [ARCH-104] VERIFIED `schema.ts:185`.
**Has both `createdAt` and `updatedAt`** [ARCH-105] VERIFIED.

---

### `playbooks` · `schema.ts:191-199` · `bootstrap.ts:97-99`
| Column | Type | Index/FK | Notes |
|---|---|---|---|
| `id` | `text PK` | | |
| `name` | `text NOT NULL` | | |
| `description` | `text NOT NULL DEFAULT ''` | | |
| `rulesJson` | `text NOT NULL DEFAULT '[]'` | | |
| `createdAt` | `text NOT NULL` | | |

**No indexes. No FKs.** Playbooks are standalone.

---

### `trade_rule_checks` · `schema.ts:216-222` · `bootstrap.ts:139-141`
| Column | Type | Index/FK | Notes |
|---|---|---|
| `id` | `text PK` | | Composite key: `JSON.stringify([tradeKey, playbookId, rule])` |
| `tradeKey` | `text NOT NULL` | **No FK** — logical reference; no `.references()` in schema, no REFERENCES in bootstrap | |
| `playbookId` | `text NOT NULL` | **No FK** — logical reference; no `.references()` in schema, no REFERENCES in bootstrap | |
| `rule` | `text NOT NULL` | | Denormalized copy |
| `followed` | `integer NOT NULL` | | Boolean (0/1) |

**Indexes**: `trade_rule_checks_trade` on `tradeKey` — declared in `BOOTSTRAP_SQL` at `bootstrap.ts:141`, **not** in Drizzle schema [ARCH-077] WRONG in original report (cited `schema.ts:225`).
**FKs**: **None**. `tradeRuleChecks` has NO FK to `trades` — the only CASCADE FK to `trades` is `trade_excursions.tradeKey` [ARCH-106] WRONG in original report.
**Write path**: Rows are written by **`POST /api/trades/[key]/rules`** (`apps/web/src/app/api/trades/[key]/rules/route.ts`) and the `rule-checklist.tsx` UI component. `analyzeAdherence` (`packages/core/src/adherence.ts`) is **read-only** — it reads rows but writes none [ARCH-076] WRONG in original report.

---

### `progress_rules` · `schema.ts:229-239` · `bootstrap.ts:112-115`
| Column | Type | Index/FK | Notes |
|---|---|---|---|
| `id` | `text PK` | | |
| `title` | `text NOT NULL` | | |
| `stage` | `text NOT NULL` | | |
| `weekdaysJson` | `text NOT NULL` | | |
| `createdAt` | `text NOT NULL` | | |
| `archivedAt` | `text` | | Soft delete |

---

### `progress_checks` · `schema.ts:231-236` · `bootstrap.ts:142-144`
| Column | Type | Index/FK | Notes |
|---|---|---|
| `id` | `text PK` | | |
| `ruleId` | `text NOT NULL` | **No FK** — logical reference, no `.references()` in schema, no REFERENCES in bootstrap | |
| `date` | `text NOT NULL` | **Index: `progress_checks_date`** | |
| `done` | `integer NOT NULL` | | Boolean (0/1) |

**Indexes**: `progress_checks_date` on `date` — declared in `BOOTSTRAP_SQL` at `bootstrap.ts:144`, **not** in Drizzle schema [ARCH-077] WRONG in original report (cited `schema.ts:243`).

---

### `missed_trades` · `schema.ts:237-250` · `bootstrap.ts:145-146`
| Column | Type | Index/FK | Notes |
|---|---|---|
| `id` | `text PK` | | |
| `symbol` | `text NOT NULL` | | |
| `direction` | `text NOT NULL` | | `long \| short` |
| `observedAt` | `text NOT NULL` | | ISO timestamp |
| `playbookId` | `text` | | Optional |
| `entry` | `real` | | Planned entry price |
| `stop` | `real` | | Planned stop |
| `target` | `real` | | Planned target |
| `notes` | `text NOT NULL DEFAULT ''` | | |
| `createdAt` | `text NOT NULL` | | |
| `archivedAt` | `text` | | Soft delete |

**No `accountId` column** — report originally listed `accountId`, `date`, `reason` which do not exist in the schema. Missed trades record missed setups, not skipped sessions.
**Has `archivedAt` for soft delete** [ARCH-107].

---

### `prop_accounts` · `schema.ts:280-301` · `bootstrap.ts:148-157`
| Column | Type | Index/FK | Notes |
|---|---|---|
| `id` | `text PK` | | |
| `firm` | `text NOT NULL` | | Firm name |
| `name` | `text NOT NULL` | | Account label |
| `program` | `text NOT NULL` | | |
| `status` | `text NOT NULL` | | |
| `currency` | `text NOT NULL` | | |
| `sizeMinor` | `integer` | | Size in minor units |
| `parentId` | `text` | FK (no ON DELETE) → `prop_accounts.id` | Self-referential; **Previously reported as `stage`** |
| `journalAccountId` | `text` | FK → `accounts.id` **SET NULL** | Not CASCADE [ARCH-078] VERIFIED `bootstrap.ts:157` (was incorrectly cited as line 131) |
| `openedOn` | `text NOT NULL` | | |
| `closedOn` | `text` | | |
| `renewalOn` | `text` | | |
| `renewalMinor` | `integer` | | |
| `notes` | `text NOT NULL DEFAULT ''` | | |
| `archived` | `integer NOT NULL DEFAULT 0` | | Boolean |
| `revision` | `integer NOT NULL DEFAULT 1` | | |
| `createdAt` | `text NOT NULL` | | |
| `updatedAt` | `text NOT NULL` | | |

**Has `updatedAt`** [ARCH-105] VERIFIED. **Note**: `parentId` self-referential FK has NO ON DELETE clause (Drizzle: no `.references()` options; bootstrap: no `ON DELETE`).

---

### `prop_entries` · `schema.ts:302-329` · `bootstrap.ts:158-165`
| Column | Type | Index/FK | Notes |
|---|---|---|
| `id` | `text PK` | | |
| `accountId` | `text` | FK (no ON DELETE) → `prop_accounts.id` | **Previously reported as `date`** for the timestamp column |
| `firm` | `text NOT NULL` | | |
| `kind` | `text NOT NULL` | | `challenge \| extension \| payout \| fee \| ...` |
| `category` | `text NOT NULL` | | **Previously reported as `phase`** |
| `currency` | `text NOT NULL` | | |
| `amountMinor` | `integer NOT NULL` | | **Previously reported as `balance`** |
| `splitBps` | `integer NOT NULL` | | |
| `feeMinor` | `integer NOT NULL` | | |
| `occurredOn` | `text NOT NULL` | Index: `prop_entries_date` | **Previously reported as `date`** |
| `dueOn` | `text` | | |
| `status` | `text NOT NULL` | | |
| `parentId` | `text` | FK (no ON DELETE) → `prop_entries.id` | Self-referential |
| `reference` | `text NOT NULL DEFAULT ''` | | |
| `notes` | `text NOT NULL DEFAULT ''` | | |
| `voided` | `integer NOT NULL DEFAULT 0` | | Boolean |
| `revision` | `integer NOT NULL DEFAULT 1` | | Optimistic locking |
| `createdAt` | `text NOT NULL` | | |
| `updatedAt` | `text NOT NULL` | | |

**Has `updatedAt` and `revision`** [ARCH-108].
**Indexes**: `prop_entries_account_date` and `prop_entries_date` [ARCH-109] VERIFIED `bootstrap.ts:164-165`.

---

### `prop_receipts` · `schema.ts:330-346` · `bootstrap.ts:166-173`
| Column | Type | Index/FK | Notes |
|---|---|---|
| `id` | `text PK` | | |
| `payoutId` | `text NOT NULL` | FK → `prop_entries.id` | |
| `kind` | `text NOT NULL` | | **Previously reported as `status`** |
| `amountMinor` | `integer NOT NULL` | | **Previously reported as `amount`** |
| `occurredOn` | `text NOT NULL` | | **Previously reported as `requestedAt/receivedAt`** |
| `reference` | `text NOT NULL DEFAULT ''` | | |
| `notes` | `text NOT NULL DEFAULT ''` | | |
| `voided` | `integer NOT NULL DEFAULT 0` | | Boolean |
| `createdAt` | `text NOT NULL` | | |

**Indexes**: `prop_receipts_payout` [ARCH-109] VERIFIED `bootstrap.ts:172`.

---

### `prop_audit` · `schema.ts:347-359` · `bootstrap.ts:175-177`
| Column | Type | Index/FK | Notes |
|---|---|---|
| `id` | `text PK` | | |
| `entityType` | `text NOT NULL` | | |
| `entityId` | `text NOT NULL` | | |
| `beforeJson` | `text` | | **Nullable** — null on insert when no before state |
| `afterJson` | `text NOT NULL` | | |
| `reason` | `text NOT NULL` | | **Previously omitted** — required column |
| `createdAt` | `text NOT NULL` | | |

**Indexes**: `prop_audit_entity` on `(entityType, entityId)` [ARCH-109] VERIFIED `bootstrap.ts:177`.
**No retention policy** [ARCH-079] — grows indefinitely.

---

### `import_sources` · `schema.ts:12-20` · `bootstrap.ts:182-185`
| Column | Type | Index/FK | Notes |
|---|---|---|---|
| `id` | `text PK` | | |
| `accountId` | `text NOT NULL` | FK → `accounts.id` CASCADE | |
| `format` | `text NOT NULL` | | |
| `name` | `text NOT NULL` | | |
| `createdAt` | `text NOT NULL` | | |

---

### `import_source_aliases` · `schema.ts:21-37` · `bootstrap.ts:186-191`
| Column | Type | Index/FK | Notes |
|---|---|---|---|
| `id` | `text PK` | | |
| `accountId` | `text NOT NULL` | FK → `accounts.id` CASCADE | |
| `format` | `text NOT NULL` | | |
| `aliasKey` | `text NOT NULL` | | |
| `sourceId` | `text NOT NULL` | FK → `import_sources.id` CASCADE | |

**UK**: `(accountId, format, aliasKey)` [ARCH-110] VERIFIED `schema.ts:35`.

---

### `import_batches` · `schema.ts:38-58` · `bootstrap.ts:192-198`
| Column | Type | Index/FK | Notes |
|---|---|---|---|
| `id` | `text PK` | | |
| `accountId` | `text NOT NULL` | FK → `accounts.id` CASCADE | |
| `format` | `text NOT NULL` | | |
| `fingerprint` | `text NOT NULL` | | |
| `rawHash` | `text NOT NULL` | | |
| `timeZone` | `text NOT NULL` | | |
| `sourceIdsJson` | `text NOT NULL` | | |
| `fromTime` | `text NOT NULL` | | |
| `toTime` | `text NOT NULL` | | |
| `snapshotJson` | `text NOT NULL` | | |
| `createdAt` | `text NOT NULL` | | |

**UK**: `(accountId, format, fingerprint)` [ARCH-111] VERIFIED `schema.ts:56`.

---

### `attachments` · `schema.ts:201-209` · `bootstrap.ts:100-102`
| Column | Type | Index/FK | Notes |
|---|---|---|---|
| `id` | `text PK` | | |
| `ownerType` | `text NOT NULL` | | |
| `ownerId` | `text NOT NULL` | | |
| `name` | `text NOT NULL` | | |
| `mime` | `text NOT NULL` | | |
| `size` | `integer NOT NULL` | | |
| `data` | `blob NOT NULL` | | Binary |
| `createdAt` | `text NOT NULL` | | |

**Indexes**: `attachments_owner` on `(ownerType, ownerId)` — declared in `BOOTSTRAP_SQL` at `bootstrap.ts:138`, **not** in Drizzle schema [ARCH-112] WRONG in original report.

---

### `note_templates` · `schema.ts:211-215` · `bootstrap.ts:103`
| Column | Type | Index/FK | Notes |
|---|---|---|
| `id` | `text PK` | | |
| `name` | `text NOT NULL` | | |
| `content` | `text NOT NULL` | | |

**No `createdAt` or `updatedAt`** — `note_templates` is static reference data.

---

### `market_csv_datasets` · `schema.ts:260-271` · `bootstrap.ts:47-53`
| Column | Type | Index/FK | Notes |
|---|---|---|
| `id` | `text PK` | | |
| `name` | `text NOT NULL` | | |
| `symbol` | `text NOT NULL` | | |
| `resolution` | `text NOT NULL` | | e.g. `1m`, `5m`, `1h`, `1d` |
| `currency` | `text NOT NULL` | | |
| `priceBasis` | `text NOT NULL` | | |
| `barsJson` | `text NOT NULL` | | Serialized OHLCV array |
| `barCount` | `integer NOT NULL` | | |
| `firstTime` | `integer NOT NULL` | | Unix timestamp |
| `lastTime` | `integer NOT NULL` | | Unix timestamp |
| `importedAt` | `text NOT NULL` | | ISO timestamp |

**Indexes**: `market_csv_symbol_resolution` — declared in `BOOTSTRAP_SQL` at `bootstrap.ts:85`, **not** in Drizzle schema.

---

### `trade_excursions` · `schema.ts:252-259` · `bootstrap.ts:77-86`
| Column | Type | Index/FK | Notes |
|---|---|---|
| `tradeKey` | `text PK + FK` | → `trades.key` **CASCADE** | Only CASCADE FK to `trades` |
| `fingerprint` | `text NOT NULL` | | |
| `provider` | `text NOT NULL` | | |
| `symbol` | `text NOT NULL` | | |
| `resolution` | `text NOT NULL` | | |
| `fetchedAt` | `text NOT NULL` | | |
| `estimateJson` | `text NOT NULL` | | |

**Previously absent from this entity table** (appeared only in ER diagram and §6.5).

---

### `settings` · `schema.ts:196-199` · `bootstrap.ts:132-135`
| Column | Type | Index/FK | Notes |
|---|---|---|
| `key` | `text PK` | | |
| `value` | `text NOT NULL` | | |

**Has `BOOTSTRAP_SQL` entry** at `bootstrap.ts:132-135` (`CREATE TABLE IF NOT EXISTS settings`) [ARCH-113] WRONG in original report.
Stores: journal defaults, timezone, multipliers, API keys, etc.

---

## 6.3 Data Access Pathways

### Write pathways

```
1. Broker Sync
   syncAccount() [sync.ts:27-113]
     └─ db.transaction({ behavior: "immediate" })
          ├─ assertIbkrSyncTimeZone (IBKR only)
          ├─ insertExecutions(accountId, fills, "sync")
          │    └─ db.transaction()
          │         ├─ positionImportErrors()
          │         ├─ INSERT executions ON CONFLICT DO NOTHING
          │         └─ rebuildAccount(accountId)
          │              └─ db.transaction() [rebuild.ts:46]
          │                   ├─ upsert trades by key
          │                   └─ delete vanished keys
          └─ UPDATE accounts SET lastSyncAt, snapshotJson, ibkrSyncTimeZone

2. CSV/API Import
   app/api/import/route.ts
     └─ insertExecutions(accountId, rows, "import")
          └─ (same inner transaction as sync)

3. Manual Execution Entry
   app/api/executions/route.ts
     └─ insertExecutions(accountId, rows, "manual")
          └─ (same inner transaction)

4. NinjaTrader Import
   server/ninjatrader-import.ts: commitNinjaTraderImport()
     └─ db.transaction({ behavior: "immediate" })
          ├─ INSERT executions (own path, bypasses insertExecutions)
          └─ rebuildAccount(accountId)

5. Annotation Writes (notes, tags, playbook assignment, rating, etc.)
   Direct Drizzle UPDATE on `trades` table by PK (key)
   ── NOT inside rebuild transaction ──
```

### Read pathways

```
1. Trades (primary read)
   queryTrades(filters, timeZone) [trades-query.ts:78-110]
     ├─ Drizzle SELECT on `trades` table
     │    WHERE accountId IN (...)
     │    AND playbookId = ? (if set)
     │    AND direction = ? (if set)
     │    AND assetClass = ? (if set)
     │    AND closedAt BETWEEN ? AND ? (date filter via openedAt)
     └─ JS: matchesFilters() — authoritative for symbol, status,
          P&L, R, weekdays, intraday windows

   getTradeByKey(key) [trades-query.ts:112]
     └─ Drizzle SELECT by PK → raw row (no decoding)

2. Executions (rare reads)
   listExecutions(accountId, ids?) [executions.ts:231-241]
     └─ Drizzle SELECT with optional id filter

3. Settings
   getJournalDefaults / getMultipliers / getTimeZone [settings.ts]
     └─ Drizzle SELECT from `settings` WHERE key = ?

4. Prop Firm
   propData() [prop-firms.ts:23-28]
     └─ Three Drizzle SELECTs on prop_accounts, prop_entries, prop_receipts
```

---

## 6.4 Transaction Boundaries

| Operation | Transaction | Behavior | Evidence |
|---|---|---|---|
| `insertExecutions` (executions insert) | Inner `db.transaction()` | Default deferred | `executions.ts:124` [ARCH-114] |
| `rebuildAccount` (trades upsert/delete) | `db.transaction()` around writes only | Deferred | `rebuild.ts:46` [ARCH-115] |
| `syncAccount` (sync + rebuild) | `db.transaction({ behavior: "immediate" })` | IMMEDIATE — lock at start | `sync.ts:82` [ARCH-116] |
| `commitNinjaTraderImport` | `db.transaction({ behavior: "immediate" })` | IMMEDIATE | `ninjatrader-import.ts` [ARCH-117] |
| `deleteExecutionsForTrades` | **Autocommit delete + explicit transaction rebuild** | `db.delete().run()` (no transaction wrapper); then `rebuildAccount()` in its own transaction. Race window between delete and rebuild | `executions.ts:225-228` [ARCH-118] |
| Annotation writes (notes, tags) | **No transaction** | Single UPDATE outside rebuild | API routes [ARCH-119] |

**Key observations**:
- `rebuildAccount` reads `account` and `executions` **outside** the transaction — read-then-write with no isolation [ARCH-120].
- Concurrent mutations during a rebuild are **invisible** until the next rebuild [ARCH-120].
- `syncAccount` uses `IMMEDIATE` to prevent races between concurrent syncs of the same account [ARCH-116].
- `insertExecutions` uses default deferred — safe for nested calls from `syncAccount` (IMMEDIATE encloses it) but could cause deadlocks if called concurrently without outer IMMEDIATE [ARCH-121] UNVERIFIED.

---

## 6.5 Entity Relationships

```
accounts (root)
  │
  ├── executions (accountId, no FK enforced)
  ├── trades (accountId, no FK enforced)
  ├── import_sources (accountId → accounts CASCADE)
  ├── import_batches (accountId → accounts CASCADE)
  └── prop_accounts (journalAccountId → accounts SET NULL)
        │
        ├── prop_entries (accountId → prop_accounts)
        │     ├── prop_entries (parentId self-referential)
        │     └── prop_receipts (payoutId → prop_entries)
        └── prop_accounts (parentId self-referential)

trades (key PK, no FK to accounts)
  │
  ├── trade_excursions (tradeKey PK+FK → trades CASCADE) ← **only CASCADE FK to trades**
  ├── trade_rule_checks (tradeKey logical ref, no FK; playbookId logical ref, no FK)
  └── notes (tradeKey optional anchor)

playbooks (standalone)
  │
  ├── trade_rule_checks (playbookId logical ref, no FK)
  └── trades (playbookId no FK)

folders (standalone)
  └── notes (folderId logical ref, no FK)

progress_rules (standalone)
  │
  └── progress_checks (ruleId logical ref, no FK)

journal_days (standalone, no FK to accounts)
  └── notes (dayDate optional anchor)

settings (key-value, no relations)
attachments (polymorphic: ownerType + ownerId, no FK)
note_templates (standalone, no relations)
market_csv_datasets (standalone, no relations)
import_sources (standalone)
  └── import_source_aliases (sourceId FK → import_sources CASCADE)
```

**No Drizzle `relations()` defined** — FKs are declared inline via `.references()` but relationships are not formalised in the schema [ARCH-122] VERIFIED (no `relations()` call in schema.ts).

---

## 6.6 Caching and Invalidation

| Cache | Mechanism | Invalidation |
|---|---|---|
| `trades` materialized view | Rebuilt on every `rebuildAccount` call | Invalidated and fully recomputed on every execution insert/delete |
| `settings` table | Read per-request from SQLite | No in-process cache; each `getSettings()` call does a Drizzle select |
| `account.snapshotJson` | Persisted at last sync | Overwritten on next `syncAccount` commit |
| Session/auth | `JOURNAL_PASSWORD` middleware | Not traced [ARCH-091] |

**No query result cache** exists at the service layer — every `queryTrades` call re-executing the SQL and filtering in JS [ARCH-123].

---

## 6.7 User Data Isolation

**Single-tenant**: DB contains all accounts for all users in one SQLite file.

**Isolation mechanism**:
- `JOURNAL_PASSWORD` HTTP middleware — password is validated, then the session grants access to all accounts [ARCH-091] UNVERIFIED (auth middleware not read).
- `queryTrades` accepts an `accountIds` filter; the API layer must scope queries to the authenticated user's accounts [ARCH-124] UNVERIFIED.
- No `userId` column on any table [ARCH-091].

**Evidence**: No `userId` column exists in `schema.ts:1-359` [ARCH-125] VERIFIED (grepped all 23 tables). **Note**: the `schema.ts` line count has grown since original report — citations from `journal_days` onward are systematically off; see Verification section.
**Risk**: Any authenticated request can query any `accountId` if the API does not enforce scoping [ARCH-126].

---

## 6.8 Existing Audit / History Capabilities

| Capability | Present | Evidence |
|---|---|---|
| `createdAt` on most tables | Partial | Tables **without** `createdAt`: `settings`, `trade_excursions` (uses `fetchedAt`), `market_csv_datasets` (uses `importedAt`), `note_templates`, `import_source_aliases`, `trade_rule_checks`, `progress_checks`, `journal_days` (uses `updatedAt` only), `trades` (no createdAt column) [ARCH-127] PARTIAL |
| `updatedAt` on some tables | Partial | `journal_days`, `notes`, `prop_accounts`, `prop_entries` have `updatedAt` [ARCH-105] |
| `archivedAt` soft delete | Partial | `accounts`, `progress_rules`, `missed_trades` use `archivedAt`; `folders` uses `deletedAt`; `prop_accounts` uses `archived` (boolean, not `archivedAt`) [ARCH-107] |
| Execution change history | **No** | No history table for executions; no `updatedAt` on `executions` [ARCH-128] |
| Trade change history | **No** | No history table for trades; `status` overwritten on rebuild [ARCH-129] |
| Generic audit log | **No** (except prop_audit) | `prop_audit` only tracks prop firm entities; no generic `audit_log` table [ARCH-130] |
| Prop firm audit | Yes | `prop_audit` records `beforeJson / afterJson` per entity mutation [ARCH-108] |
| Import batch audit | Yes | `import_batches.snapshotJson` stores raw import snapshot; `rawHash` for integrity [ARCH-131] |
| `revision` counter | Yes (prop only) | `prop_entries.revision` for optimistic locking [ARCH-108] |

**Import history**: `import_batches` stores a snapshot of the raw import and a `rawHash` for each batch — allows reprocessing or verification [ARCH-131].

---

## 6.9 Architectural Limitations

### No soft delete on core entities
`executions` and `trades` have no `archivedAt` column. Deleted executions are physically removed. Deleted trades are physically removed by `rebuildAccount`. **No recovery path exists** [ARCH-093].

### No generic audit log
`prop_audit` covers only prop firm entities. No table records who changed `trades`, `notes`, `playbooks`, or `accounts` and when. `createdAt` tells you when a row was created, but there is no `updatedBy` or change history [ARCH-130].

### Rebuild is not atomic with annotation writes
`rebuildAccount` runs in its own `db.transaction()`. Annotation writes (notes, tags, rating, etc.) happen in separate API route handlers with no transaction tying them to the rebuild that may have just changed the row. If a user POSTs an annotation to a trade that is simultaneously being rebuilt, the annotation could be lost (though the rebuild won't corrupt it since annotations are excluded from the update set) [ARCH-119] [ARCH-132].

### `rebuildAccount` reads are not isolated
The account row and all executions are read **outside** the `db.transaction()`. A concurrent `insertExecutions` could add executions between the read and the rebuild commit. Those executions would be invisible to the current rebuild and only appear on the next rebuild [ARCH-120].

### Playbook edits have no version history
Editing a playbook's `rulesJson` does NOT retroactively change any `trade_rule_checks` row. The `id` column embeds the rule string as `JSON.stringify([tradeKey, playbookId, b.rule])`; renaming a rule creates a new row and orphans the old one. Future `analyzeAdherence()` runs see only the new rule. There is no diff/history view [ARCH-072] WRONG in original report; reconciled with [ARCH-075].

### Trade key format is not extensible
The trade key format is hardcoded in `round-trips.ts:95-99`. Changing it would require a migration to remap all `trade_key` FK references in `trade_rule_checks`, `trade_excursions`, and `notes.tradeKey`. No migration tool exists for this [ARCH-133].

### No multi-user tenancy
All accounts live in one DB file. The API must enforce `accountId` scoping manually. No DB-level row security. Sharing a DB file across users is not supported by the current architecture [ARCH-091].

### `prop_audit` grows indefinitely
`prop_audit` has no retention policy, no TTL, and no purge mechanism. Every prop firm mutation writes a full before/after JSON snapshot [ARCH-079].

### IBKR timezone migration is one-way
`ibkrSyncTimeZone` is written once on first IBKR sync with a non-null value. There is no migration path to retroactively fix timezone-incorrect historical executions except by re-importing with the correct timezone [ARCH-134].

### No incremental rebuild
`rebuildAccount` always reads **all** executions for an account and recomputes **all** trades. For accounts with thousands of executions this becomes progressively slower. No delta/incremental rebuild exists [ARCH-135].

### Equity curve and streak sort inconsistency
`equity.closedByCloseTime` sorts by `Date.parse(closedAt)` with `a.key.localeCompare(b.key)` as tiebreaker. `metrics.ts:91` sorts streaks by close time **only** (no key tiebreaker). Same-timestamp closes can order differently between the equity curve and the streak run — streak values may differ from equity-curve implied streak [ARCH-136] VERIFIED `metrics.ts:91` (was incorrectly cited as line 85).

### Schema / BOOTSTRAP_SQL index divergence
Four indexes exist in `BOOTSTRAP_SQL` but have **no corresponding declaration in the Drizzle `schema.ts`**:
- `attachments_owner` — `bootstrap.ts:138`
- `trade_rule_checks_trade` — `bootstrap.ts:141`
- `progress_checks_date` — `bootstrap.ts:144`
- `market_csv_symbol_resolution` — `bootstrap.ts:85`

Drizzle's schema introspection (e.g., via `drizzle-kit generate`) would not emit these indexes. The `createDb` path (used in tests and direct instantiation) sets up the schema without these indexes. This is a genuine bootstrap-only index divergence.

---

## Verification

The following corrections were applied to this document based on `REVIEW-domain-data.md`:

| # | Fix applied | Lines/section changed |
|---|---|---|
| 1 | ARCH-101 WAL/pragmas: upgraded from UNVERIFIED to VERIFIED citing `db/index.ts:36-38` and `:98-100` | §6.1 |
| 2 | `missed_trades` column table: replaced fabricated `accountId`, `date`, `reason` with actual columns (`symbol`, `direction`, `observedAt`, `playbookId`, `entry`, `stop`, `target`, `notes`, `createdAt`, `archivedAt`) | §6.2 `missed_trades` |
| 3 | `progress_checks`: renamed `completed` → `done`; removed false FK on `ruleId`; fixed index citation to `bootstrap.ts:144` | §6.2 `progress_checks` |
| 4 | `trade_rule_checks`: removed false FK on `tradeKey` (no FK to `trades`) and `playbookId`; documented composite key ID; documented manual write path via POST `/api/trades/[key]/rules`; marked ARCH-076 and ARCH-106 WRONG | §6.2 `trade_rule_checks` |
| 5 | `notes.folderId`: removed FK claim (no DB FK exists) | §6.2 `notes` |
| 6 | `prop_audit`: `beforeJson` changed from NOT NULL to nullable; added `reason` column (was omitted); fixed evidence line to `schema.ts:347-359`, `bootstrap.ts:175-177` | §6.2 `prop_audit` |
| 7 | `prop_accounts`: replaced fabricated `prop Firm`/`stage`/`balance` with actual `firm`, `program`, `sizeMinor`; fixed FK line for journal_account_id to `bootstrap.ts:157` (was 131); added `revision`; fixed line citations to `schema.ts:280-301`, `bootstrap.ts:148-157` | §6.2 `prop_accounts` |
| 8 | `prop_entries`: replaced fabricated `date`/`type`/`balance`/`phase` with actual `occurredOn`/`kind`/`amountMinor`/`category`; added `splitBps`, `feeMinor`, `dueOn`, `reference`, `voided`; fixed index citations to `bootstrap.ts:164-165` | §6.2 `prop_entries` |
| 9 | `prop_receipts`: replaced fabricated `amount`/`status`/`requestedAt`/`receivedAt` with actual `kind`/`amountMinor`/`occurredOn`/`voided`; fixed index citation to `bootstrap.ts:172` | §6.2 `prop_receipts` |
| 10 | `settings` BOOTSTRAP_SQL: changed from "no entry" to confirmed at `bootstrap.ts:132-135` [ARCH-113] WRONG | §6.2 `settings` |
| 11 | Index citations fixed: `attachments_owner` → `bootstrap.ts:138` (not `schema.ts:207`); `trade_rule_checks_trade` → `bootstrap.ts:141` (not `schema.ts:225`); `progress_checks_date` → `bootstrap.ts:144` (not `schema.ts:243`) | §6.2, §6.9 |
| 12 | §6.5 ER diagram: removed false FK from `notes.folderId`, `trade_rule_checks.tradeKey`, `trade_rule_checks.playbookId`, `progress_checks.ruleId`; removed `missed_trades accountId` and `progress_checks accountId` (columns don't exist); added `market_csv_datasets`, `note_templates`, `progress_rules → progress_checks` relationship; corrected trade_excursions as only CASCADE FK | §6.5 |
| 13 | §6.4 `deleteExecutionsForTrades`: corrected from "two separate transactions" to "autocommit delete + explicit rebuild transaction" with race window description | §6.4 |
| 14 | §6.8 createdAt exceptions: expanded to include `trades` (no createdAt), `note_templates`, `import_source_aliases`, `trade_rule_checks`, `progress_checks`, `journal_days`, `market_csv_datasets` | §6.8 |
| 15 | §6.8 archivedAt: corrected `folders` uses `deletedAt`, `prop_accounts` uses `archived` boolean | §6.8 |
| 16 | ARCH-072/075: reconciled in §6.9 — editing a rule orphans old rows; no retroactive change | §6.9 |
| 17 | `market_csv_datasets`: added to §6.2 entity catalog with all columns; added to ER diagram; documented schema/bootstrap index divergence | §6.2, §6.5, §6.9 |
| 18 | `trade_excursions`: added to §6.2 entity catalog (was absent); confirmed as only CASCADE FK to trades | §6.2, §6.5 |
| 19 | `note_templates`: expanded column table; confirmed no createdAt/updatedAt | §6.2 |
| 20 | Systematic line-number drift: corrected all `schema.ts` and `bootstrap.ts` citations from `journal_days` onward per reviewer's drift table | throughout §6.2 |
| 21 | ARCH-136: corrected metrics.ts citation from line 85 to line 91 | §6.9 |
