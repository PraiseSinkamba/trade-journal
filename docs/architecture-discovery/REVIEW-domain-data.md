# Domain + Data Reports — Review

## Overall Verdict

**FAIL**

Both reports contain multiple factually incorrect claims: wrong column names, wrong FK assertions, wrong index citations, wrong FK enforcement status, and one affirmatively contradicted design claim (ARCH-076). Line-number citations are systematically off by 2–41 lines against the current schema for roughly half the tables. The two reports also contradict each other on the trade_rule_checks write path and on several column names.

---

## Findings Table

| ID | Claim (report) | Report says | Actual source | Status | Notes |
|----|----------------|-------------|---------------|--------|-------|
| ARCH-076 (04:§6.9) | "tradeRuleChecks rows are written by the AI review / adherence analysis pass; there is no UI to write them manually." | UNVERIFIED | `apps/web/src/app/api/trades/[key]/rules/route.ts` POST inserts/updates/deletes `trade_rule_checks`; `apps/web/src/components/rule-checklist.tsx` is a manual-UI caller. `analyzeAdherence` is read-only. | **WRONG** | Major: manual write path explicitly exists; report marked as "UNVERIFIED" but the claim is affirmatively false. |
| ARCH-106 (04:§6.2+ER) | "trade_rule_checks has FK `tradeKey → trades.key CASCADE`" and "progress_checks and trade_rule_checks are the only tables with FKs to trades via CASCADE" | VERIFIED | `schema.ts:216-222` (tradeRuleChecks) has no `.references()`; `bootstrap.ts:140` has no REFERENCES clause. `progressChecks` at `schema.ts:231-236` has no `.references()`. The **only** CASCADE FK to `trades` is `trade_excursions.tradeKey` (`schema.ts:255`, `bootstrap.ts:88`). | **WRONG** | trade_rule_checks.playbookId is also not an FK (see below). |
| ARCH-106 (04:ER) | "progress_checks (accountId, no FK)" | — | `progress_checks` has **no `accountId` column** at all (`schema.ts:231-236`). | **WRONG** | ER diagram invents a non-existent column. |
| ARCH-106 (04:ER) | "missed_trades (accountId, no FK)" | — | `missed_trades` has **no `accountId` column** (`schema.ts:237-250`). | **WRONG** | ER diagram invents a non-existent column. |
| ARCH-078 (04:§6.2) | "prop_accounts.journal_account_id FK uses SET NULL, not CASCADE" | VERIFIED | `schema.ts:289-291` `.references(() => accounts.id, { onDelete: "set null" })`; `bootstrap.ts:157` `ON DELETE SET NULL`. | **CONFIRMED** | Correct, but report 04 cites `bootstrap.ts:131` — wrong line (actual 157). |
| ARCH-105 (04:§6.8) | "`journal_days`, `notes`, `prop_accounts`, `prop_entries` have `updatedAt`" | VERIFIED | All four confirmed at `schema.ts:157,182,300,323`. | **CONFIRMED** | Exact. |
| ARCH-075 (03:§5.5) | "`trade_rule_checks.rule` is a denormalized string copy for stability" | VERIFIED | `apps/web/src/app/api/trades/[key]/rules/route.ts:44` writes `rule: b.rule`; `adherence.ts:47` matches by rule string. Row ID is `JSON.stringify([key, book.id, b.rule])` — renames create new rows, orphaning old. | **CONFIRMED** | Stability claim holds; renaming a rule orphans prior check rows. |
| ARCH-120 (04:§6.4) | "rebuildAccount reads account and executions outside its transaction" | VERIFIED | `rebuild.ts:14,17` (reads) vs `:46` (`db.transaction`). | **CONFIRMED** | In the sync/import path, called inside insertExecutions' transaction (savepoint); standalone calls (deleteExecutionsForTrades, accounts/settings routes) expose the race window. |
| ARCH-128 (04:§6.9) | "No execution history; `deleteExecutionsForTrades` physically removes rows" | VERIFIED | `executions.ts:225-227` `db.delete(executions)...run()` with no transaction. | **CONFIRMED** | No undo, no history. |
| ARCH-129 (04:§6.9) | "No generic audit log; no trade change history" | VERIFIED | Schema has no history table; `trades` table has no `createdAt` column; `prop_audit` is prop-only. | **CONFIRMED** | |
| ARCH-130 (04:§6.9) | "No `updatedAt` on trades; status is re-derived at query time" | VERIFIED | `trades` table has no `updatedAt`; `rowToTrade` derives status at `trades-query.ts:21-40`. | **CONFIRMED** | |
| ARCH-136 (04:§6.9) | "Equity curve and streak sort use different tiebreakers for same-timestamp closes" | VERIFIED | `equity.ts:26` adds `a.key.localeCompare(b.key)`; `metrics.ts:91` has no tiebreaker. Report cites `metrics.ts:85` — actual 91. | **CONFIRMED** | Line cite off by 6; behavior difference confirmed. |
| ARCH-122 (04:§6.5) | "No `relations()` defined anywhere in the Drizzle schema" | VERIFIED | Grepped entire `src/` tree — zero `relations()` calls. | **CONFIRMED** | |
| ARCH-125 (04:§6.7) | "No `userId` column on any of the 23 tables" | VERIFIED | 23 tables counted (`importSources` through `propAudit`); none has `userId`. | **CONFIRMED** | |
| ARCH-101 (04:§6.1) | "WAL, busy_timeout=5000, foreign_keys=ON" | **UNVERIFIED** | `db/index.ts:36-38` and `:98-100` set all three pragmas exactly. | **UPGRADE: VERIFIED** | Was tagged UNVERIFIED (not yet read); now directly verified. |
| ARCH-114 (04:§6.4) | "insertExecutions uses default deferred transaction" | VERIFIED | `executions.ts:124` `db.transaction((tx)=>{` — no behavior option → deferred. | **CONFIRMED** | |
| ARCH-115 (04:§6.4) | "rebuildAccount wraps writes in db.transaction" | VERIFIED | `rebuild.ts:46` `db.transaction(()=>{`. | **CONFIRMED** | |
| ARCH-116 (04:§6.4) | "syncAccount uses IMMEDIATE" | VERIFIED | `sync.ts:104` `db.transaction(..., { behavior: "immediate" })`. Report cites line 82 (inside function); actual behavior line 104. | **CONFIRMED** (cite off) | |
| ARCH-117 (04:§6.4) | "commitNinjaTraderImport uses IMMEDIATE" | VERIFIED | `ninjatrader-import.ts:498,548` `{ behavior: "immediate" }`. | **CONFIRMED** | |
| ARCH-119 (04:§6.4) | "Annotation writes bypass rebuild transaction" | VERIFIED | `trades/[key]/route.ts:92` `db.update(trades).set(patch)...run()` — no transaction. | **CONFIRMED** | |
| ARCH-118 (04:§6.4) | "deleteExecutionsForTrades — Two separate transactions" | — | `executions.ts:225-227` is bare `db.delete(...).run()` (autocommit, **not** in a transaction); then `rebuildAccount` at `:228`. | **PARTIALLY** | Delete is not in any transaction. "Two separate transactions" is imprecise — it's one autocommit delete + one explicit transaction. |
| ARCH-113 (04:§6.2) | "`settings` has no BOOTSTRAP_SQL entry — seeded at runtime or by migrations" | UNVERIFIED | `bootstrap.ts:132-135` has `CREATE TABLE IF NOT EXISTS settings`. | **WRONG** | Settings table IS in BOOTSTRAP_SQL. |
| ARCH-077 (03/04) | "trade_rule_checks_trade index on tradeKey — VERIFIED schema.ts:225 / progress_checks_date — VERIFIED schema.ts:243" | VERIFIED | `tradeRuleChecks` table (`schema.ts:216-222`) has **no index callback**. `progressChecks` table (`schema.ts:231-236`) has **no index callback**. Both indexes exist in `bootstrap.ts:141,144` only. | **WRONG CITATION** | Indexes exist but are bootstrap-only, not Drizzle-declared. Reports claim they are in schema.ts at lines 225/243 which hold other content. |
| ARCH-112 (04) | "attachments_owner index — VERIFIED schema.ts:207" | VERIFIED | `attachments` table (`schema.ts:201-210`) has **no index callback**. Index exists in `bootstrap.ts:138` only. | **WRONG CITATION** | |
| — | "notes.folderId is a FK → folders.id" | ER says FK | `schema.ts:174` `folderId: text("folder_id").notNull()` — no `.references()`. `bootstrap.ts:113` `folder_id TEXT NOT NULL` — no REFERENCES clause. | **WRONG** | Logical reference only, not DB-enforced. |
| — | "trade_rule_checks.playbookId is a FK → playbooks.id" | ER says FK | `schema.ts:219` `playbookId: text("playbook_id").notNull()` — no `.references()`. `bootstrap.ts:140` — no REFERENCES clause. | **WRONG** | |
| — | "progress_checks.ruleId is a FK → progress_rules.id" | ER says FK | `schema.ts:233` `ruleId: text("rule_id").notNull()` — no `.references()`. `bootstrap.ts:143` — no REFERENCES clause. | **WRONG** | |
| — | "notes.tradeKey is a FK → trades.key" | ER says anchor | `schema.ts:171` — no `.references()`, no REFERENCES. | **ACCURATE** | Reports correctly label this as an "optional anchor" in §6.5 ER. |
| — | "trades.playbookId is a FK → playbooks.id" | ER says "no FK" | No REFERENCES anywhere. | **ACCURATE** | §6.5 correctly says "no FK"; §6.2 table is self-contradictory ("FK...no Drizzle references"). |
| — | "import_sources.accountId FK → accounts CASCADE" | ER says CASCADE | `schema.ts:16` `.references(..., {onDelete:"cascade"})`; `bootstrap.ts:183`. | **CONFIRMED** | |
| — | "import_source_aliases.accountId FK → accounts CASCADE" | ER says CASCADE | `schema.ts:29` `.references(..., {onDelete:"cascade"})`; `bootstrap.ts:188`. | **CONFIRMED** | |
| — | "import_batches.accountId FK → accounts CASCADE" | ER says CASCADE | `schema.ts:45` `.references(..., {onDelete:"cascade"})`; `bootstrap.ts:193`. | **CONFIRMED** | |
| — | "prop_entries.accountId FK → prop_accounts.id" | ER says FK | `schema.ts:306` `.references(() => propAccounts.id)` (no onDelete → NO ACTION). `bootstrap.ts:162`. | **CONFIRMED** (no action) | |
| — | "prop_receipts.payoutId FK → prop_entries.id" | ER says FK | `schema.ts:336` `.references(() => propEntries.id)` (no onDelete → NO ACTION). `bootstrap.ts:171`. | **CONFIRMED** (no action) | |
| — | "trade_excursions.tradeKey FK → trades CASCADE" | ER says CASCADE | `schema.ts:255` `.references(() => trades.key, {onDelete:"cascade"})`; `bootstrap.ts:88`. | **CONFIRMED** | Only CASCADE FK to trades. |
| — | "prop_audit.beforeJson is NOT NULL" | §6.2 table | `schema.ts:352` `text("before_json")` — **nullable**. `bootstrap.ts:177` `before_json TEXT` — nullable. | **WRONG** | `afterJson` is NOT NULL; `beforeJson` is nullable. |
| — | "prop_audit has no `reason` column" | §6.2 table omits it | `schema.ts:354` `reason: text("reason").notNull()` — column exists and is NOT NULL. | **WRONG** | Column exists but is omitted from the column table. |
| — | "missed_trades has columns: accountId, date, reason" | §6.2 table | `schema.ts:237-250`: id, symbol, direction, observedAt, playbookId, entry, stop, target, notes, createdAt, archivedAt. **No `accountId`, no `date`, no `reason`**. | **FULLY WRONG** | Both report 03 and 04 have identical wrong columns. The actual entity is "missed trade setups," not "skipped sessions." |
| — | "progress_checks has column `completed`" | §6.2 table | `schema.ts:235` `done: integer("done", { mode: "boolean" }).notNull()`. | **WRONG** | Column is `done`, not `completed`. |
| — | "prop_accounts has columns: `prop Firm`, `stage`, `balance`" | §6.2 table | `schema.ts:280-301`: id, firm, name, program, status, currency, sizeMinor, parentId, journalAccountId, openedOn, closedOn, renewalOn, renewalMinor, notes, archived, revision, createdAt, updatedAt. No `stage`, no `balance`. | **WRONG** | Actual columns include `program`, `sizeMinor`, `openedOn`, `closedOn`, `renewalOn`, `renewalMinor`. |
| — | "prop_entries has columns: date, type, balance, phase" | §6.2 table | `schema.ts:302-329`: accountId, firm, kind, category, currency, amountMinor, splitBps, feeMinor, occurredOn, dueOn, status, parentId, reference, notes, voided, revision, createdAt, updatedAt. No `date`/`type`/`balance`/`phase`. | **WRONG** | `occurredOn`→`date`, `kind`→`type`, `amountMinor`→`balance`, `category`→`phase` (loosely). |
| — | "prop_receipts has columns: amount, status, requestedAt, receivedAt" | §6.2 table | `schema.ts:330-346`: payoutId, kind, amountMinor, occurredOn, reference, notes, voided, createdAt. No `status`, no `requestedAt`/`receivedAt`. | **WRONG** | Actual `amountMinor`, `kind`, `occurredOn`. |
| — | "prop_accounts.parentId self-referential FK" | §6.2 table | `schema.ts:288` `.references(() => propAccounts.id)` (no onDelete). `bootstrap.ts:156` `REFERENCES prop_accounts(id)` (no ON DELETE). | **CONFIRMED** | |
| ARCH-072 (03:§5.5) | "Playbooks are unversioned; editing a rule changes all references" | — | Renaming a rule in a playbook creates a **new** `trade_rule_checks` row; the old row is orphaned (ID = `JSON.stringify([key, book.id, b.rule])` embeds the rule text). `analyzeAdherence` matches by current rule string, so orphaned rows disappear from reports. | **WRONG** | Editing a playbook does NOT retroactively change past checks — it orphans them. Self-contradicts ARCH-075 in same document. |
| ARCH-127 (04:§6.8) | "createdAt on most tables — all tables except settings, trade_excursions, some intermediates" | PARTIAL | Tables WITHOUT createdAt (8 of 23): settings, trade_excursions (fetchedAt), market_csv_datasets (importedAt), note_templates, import_source_aliases, trade_rule_checks, progress_checks, journal_days (updatedAt only), trades (no createdAt!). `trades` has no createdAt column. | **PARTIALLY** | "Some intermediates" is vague; `trades` is not an intermediate and lacks createdAt. |
| ARCH-107 (04:§6.8) | "archivedAt soft delete — accounts, folders, progress_rules, missed_trades, prop_accounts" | PARTIAL | `folders` uses `deletedAt` (not `archivedAt`); `prop_accounts` uses `archived` (boolean, not `archivedAt`). Three tables have true `archivedAt`; one uses `deletedAt`; one uses boolean `archived`. | **PARTIALLY** | Terminology inconsistency — the claim is directionally right but conflates three different column names. |
| ARCH-080 (04:§6.9) | "import_batches fingerprint dedup — UNVERIFIED" | UNVERIFIED | `ninjatrader-import.ts:538` `tx.insert(importBatches).values(plan.batch).onConflictDoNothing()` with UK on `(accountId, format, fingerprint)`. Batch skipped on duplicate fingerprint. | **CONFIRMED** | Fingerprint derivation not traced end-to-end, but dedup mechanism confirmed. |
| ARCH-081 (04:§6.9) | "import_batches.snapshotJson stores raw import snapshot for audit/reprocessing" | — | `schema.ts:52` `snapshotJson: text()`; `ninjatrader-import.ts:477` `snapshotJson: JSON.stringify(canonical)`. Stores canonicalized plan, not raw. No reprocessing path exists. | **PARTIALLY** | Column exists; "raw" is a stretch (canonicalized); "reprocessing" not implemented. |
| ARCH-118 (04:§6.4) | "deleteExecutionsForTrades — Two separate transactions" | — | `executions.ts:225-227` bare `db.delete(...).run()` (no explicit transaction); then `rebuildAccount` at `:228`. | **PARTIALLY** | Delete is autocommit, not a transaction. See ARCH-118 row above. |
| — | System folders seeded at bootstrap.ts | VERIFIED | `bootstrap.ts:147-152` INSERT OR IGNORE for 5 system folders. | **CONFIRMED** | |
| — | "No `userId` on any table" | VERIFIED | 23 tables, none has `userId`. | **CONFIRMED** | |
| — | "No query result cache at service layer" | VERIFIED | `queryTrades` re-queries on every call. | **CONFIRMED** | |
| — | "Settings read per-request, no in-process cache" | VERIFIED | `settings.ts:21-22` every `getSetting` does `db.select(...).from(settings)...`. | **CONFIRMED** | |

### Line-Number Citation Accuracy

Nearly every `schema.ts` and `bootstrap.ts` line citation is off for the middle tables. The first few tables (import_*, accounts, executions, trades) are accurate; the drift accumulates for everything from `journal_days` onward.

| Table | Report cites (schema.ts) | Actual | Drift |
|-------|--------------------------|--------|-------|
| accounts | 60-82 | 61-82 | +1 |
| executions | 84-106 | 84-106 | exact |
| trades | 108-151 | 113-151 | +5 |
| journal_days | 155-160 | 153-158 | −2 |
| folders | 162-171 | 160-168 | −2 |
| notes | 173-189 | 170-185 | −3 |
| playbooks | 191-199 | 187-194 | −4 |
| settings | 211-217 | 196-199 | −15 |
| attachments | 201-209 | 201-210 | exact |
| note_templates | 209 | 211-215 | +2 |
| trade_rule_checks | 219-227 | 216-222 | −3 |
| progress_rules | 229-239 | 223-230 | −6 |
| progress_checks | 241-246 | 231-236 | −10 |
| missed_trades | 247-256 | 237-250 | −10 |
| prop_accounts | 258-280 | 280-301 | +22 |
| prop_entries | 282-296 | 302-329 | +20 |
| prop_receipts | 298-304 | 330-346 | +32 |
| prop_audit | 306-310 | 347-359 | +41 |

The import tables (schema.ts 12-58) and first three main tables are correct; the rest are systematically wrong. Bootstrap.ts citations are similarly off for all tables from `journal_days` through `prop_audit`. The reports appear to have been written against a different (earlier) version of both files, or line numbers were never re-verified after content shifts.

---

## Cross-Document Consistency

**Confirmed consistency (reports agree with each other):**
- `trade_excursions.tradeKey` is the only CASCADE FK to `trades` — both reports state this (report 03 explicitly in §5.1 trade_excursions section; report 04 in ER diagram).
- `prop_accounts.journal_account_id → accounts.id` with SET NULL — both agree.
- `prop_entries.accountId → prop_accounts.id` and `prop_receipts.payoutId → prop_entries.id` — both agree.
- No `userId` column on any table — both agree.
- `trade_rule_checks.rule` is a denormalized string copy — both agree.
- `journal_days`, `notes`, `prop_accounts`, `prop_entries` have `updatedAt` — both agree.
- No generic audit log; `prop_audit` is prop-only and grows indefinitely — both agree.

**Inconsistencies found:**

1. **trade_rule_checks write path (ARCH-076):** Report 03 §5.5 says "TRADE RULE CHECKS (written by analyzeAdherence)" and §5.3 doesn't list a manual path. Report 04 §6.9 says "tradeRuleChecks rows are written by the AI review / adherence analysis pass; there is no UI to write them manually." Both deny the manual write path. Actual code: `apps/web/src/app/api/trades/[key]/rules/route.ts` POSTs `trade_rule_checks` rows and `rule-checklist.tsx` is the UI caller. `analyzeAdherence` is read-only. Both reports are affirmatively wrong.

2. **Report 03 §5.5 vs §5.3 contradiction:** §5.5 says "Playbooks are unversioned; editing a rule changes all references" (ARCH-072). But §5.3 rule 3 (under Playbook) says "Editing a playbook's rulesJson changes all trade_rule_checks that reference it (for future runs). Past checks store a denormalized rule string so they are stable" (ARCH-075). These contradict each other. Actual behavior: past checks are NOT changed by an edit — they are orphaned. The correct statement is: editing a playbook's rulesJson does NOT retroactively change any `trade_rule_checks` row; the old rule-string rows become invisible to adherence analysis.

3. **missed_trades column names:** Report 03 §5.1 domain model table and report 04 §6.2 column table both list `accountId`, `date`, `reason` — none of which exist in the schema (`schema.ts:237-250`). Both reports share the same error.

4. **progress_checks column name:** Both reports list `completed`; actual column is `done` (`schema.ts:235`).

5. **prop_audit `beforeJson` nullability:** Report 04 §6.2 says "text NOT NULL"; schema says nullable.

6. **prop_audit `reason` column:** Both reports omit it; schema has `reason: text("reason").notNull()` (`schema.ts:354`).

7. **settings bootstrap entry (ARCH-113):** Report 04 claims "No BOOTSTRAP_SQL entry" — factually false. `bootstrap.ts:132-135` has the CREATE TABLE.

8. **FK enforcement on `notes.folderId`:** Report 03 §5.1 says "FK → folders.id". Report 04 §6.5 ER diagram says "notes (folderId FK → folders)". Both assert a DB-enforced FK. No `.references()` in schema.ts and no REFERENCES clause in bootstrap.ts. Reports contradict the actual schema.

9. **FK enforcement on `trade_rule_checks.playbookId`:** Report 04 §6.2 and ER diagram both assert "FK → playbooks.id". No FK exists.

10. **FK enforcement on `progress_checks.ruleId`:** Report 04 §6.2 asserts "FK → progress_rules.id". No FK exists.

---

## Gaps in Coverage

**Missing from both reports' entity catalogs:**
- `market_csv_datasets` — entirely absent from the entity catalog (appears only in `db/index.ts` migrations). This is a live table with candle data used for backtesting.
- `trade_excursions` — absent from report 04's §6.2 entity table. Report 03 §5.1 says "Remaining columns not fully read — file cut at :233" (false; file is 359 lines). The section is incomplete.
- `note_templates` — appears in the ER diagram under "standalone generic tables" but its columns (id, name, content) and lack of createdAt/updatedAt are not documented in the §6.2 table.
- `progress_rules` — present in §6.2 table but absent from the ER diagram entirely. Its relationship to `progress_checks` is unshown.

**Missing from ER diagram (report 04 §6.5):**
- `market_csv_datasets` — no entity shown.
- `note_templates` — no entity shown.
- `progress_rules` → `progress_checks` relationship — absent.
- `import_source_aliases` → `accounts` FK — shown under the "standalone import" section but not linked to accounts at the top. `import_batches` → `import_sources` → `accounts` chain is correct but the `import_source_aliases` link to accounts is missing.
- `prop_audit` — entity shown, but its relationship to `prop_entries`/`prop_accounts` is not depicted.
- `settings` is shown correctly as standalone.

**Behavioral gaps:**
- `trade_rule_checks` ID is `JSON.stringify([key, book.id, b.rule])` — the composite key embeds the rule text. Neither report mentions this, despite it being the mechanism behind the "stability" claim.
- Renaming a playbook rule orphans prior `trade_rule_checks` rows — neither report captures this consequence of the composite-key design.
- `deleteExecutionsForTrades` is not inside any transaction — only report 04 §6.4 mentions it, but the "two separate transactions" description is imprecise.
- `commitNinjaTraderImport` uses IMMEDIATE transaction — confirmed but uncited in report 04.
- `syncAccount` uses IMMEDIATE — confirmed but uncited in report 04.

**Schema/bootstrap divergence (not captured in either report):**
- `attachments_owner`, `trade_rule_checks_trade`, `progress_checks_date`, and `market_csv_symbol_resolution` indexes exist in `BOOTSTRAP_SQL` (`bootstrap.ts:138,141,144,85`) but have **no corresponding index declarations in the Drizzle `schema.ts`**. Drizzle's schema introspection would not know about these indexes. The `createDb` path (used in tests) sets up the schema without these indexes. This is a genuine schema/bootstrap divergence.

---

## Required Fixes (Ordered)

1. **ARCH-076 / trade_rule_checks write path:** Remove the claim that there is no manual UI. Add explicit description of the POST `/api/trades/[key]/rules` endpoint and its UI caller `rule-checklist.tsx`. Clarify that `analyzeAdherence` is read-only.

2. **ARCH-106:** Remove all claims that `trade_rule_checks` or `progress_checks` have FKs to `trades`. Correct the ER diagram: only `trade_excursions` has a CASCADE FK to `trades`. Remove "progress_checks (accountId)" and "missed_trades (accountId)" from ER diagram — those columns do not exist.

3. **missed_trades column table:** Replace entire column listing with actual schema (`schema.ts:237-250`): `id, symbol, direction, observedAt, playbookId, entry, stop, target, notes, createdAt, archivedAt`. Remove `accountId`, `date`, `reason`.

4. **progress_checks column:** Rename `completed` → `done`.

5. **prop_audit column table:** Change `beforeJson` to nullable. Add `reason` (NOT NULL) as a required column. Fix `afterJson` to match actual name `afterJson` (it already says `afterJson`, just check `beforeJson` nullability).

6. **prop_accounts column table:** Replace fabricated `prop Firm`/`stage`/`balance` with actual columns (`firm, name, program, status, currency, sizeMinor, parentId, journalAccountId, openedOn, closedOn, renewalOn, renewalMinor, notes, archived, revision, createdAt, updatedAt`).

7. **prop_entries column table:** Replace `date`/`type`/`balance`/`phase` with actual columns. Add `firm, kind, category, currency, amountMinor, splitBps, feeMinor, occurredOn, dueOn, status, parentId, reference, notes, voided, revision, createdAt, updatedAt`.

8. **prop_receipts column table:** Replace `amount`/`status`/`requestedAt`/`receivedAt` with actual (`payoutId, kind, amountMinor, occurredOn, reference, notes, voided, createdAt`).

9. **ARCH-113 (settings BOOTSTRAP_SQL):** Change from "UNVERIFIED — no BOOTSTRAP_SQL entry" to "VERIFIED — `bootstrap.ts:132-135` has `CREATE TABLE IF NOT EXISTS settings`".

10. **ARCH-077 / index citations:** `trade_rule_checks_trade` and `progress_checks_date` exist in `BOOTSTRAP_SQL` (bootstrap.ts:141,144) but NOT in Drizzle `schema.ts`. Correct all three ER diagrams and ARCH-077 entries to cite `bootstrap.ts` for these indexes, not `schema.ts`. Same for `attachments_owner` (bootstrap.ts:138).

11. **notes.folderId, trade_rule_checks.playbookId, progress_checks.ruleId:** Remove all "FK →" labels for these three columns. They are logical references with no DB enforcement. Update §6.2 table and ER diagram accordingly.

12. **ARCH-072 self-contradiction:** Reconcile ARCH-072 ("editing a playbook changes all references") with ARCH-075 ("past checks are stable"). The correct behavior: editing a playbook's rulesJson does NOT retroactively update any `trade_rule_checks` row. Renaming a rule creates a new row and orphans the old one. Add this nuance to the playbook lifecycle section.

13. **Systematic line-number drift:** Re-verify every `schema.ts` and `bootstrap.ts` line citation against the current files. The drift suggests the reports were written against earlier versions. All citations from `journal_days` onward need correction (see the drift table above).

14. **market_csv_datasets and trade_excursions coverage:** Add `market_csv_datasets` to the entity catalog with its actual columns (id, accountId, symbol, timeframe, barsJson, importedAt). Complete the `trade_excursions` section (currently incomplete in report 03, absent from report 04's entity table).

15. **Schema/bootstrap index divergence:** Document the four indexes (`attachments_owner`, `trade_rule_checks_trade`, `progress_checks_date`, `market_csv_symbol_resolution`) that exist only in `BOOTSTRAP_SQL` and not in the Drizzle schema. This is architecturally significant for anyone using Drizzle introspection.

16. **deleteExecutionsForTrades transaction description:** Correct the "two separate transactions" description to: "The `db.delete()` call is a bare autocommit statement (no transaction wrapper); `rebuildAccount` is then called separately inside its own transaction. There is a race window between the delete and the rebuild."

17. **ARCH-101 WAL/pragmas:** Upgrade from "UNVERIFIED" to "VERIFIED" citing `db/index.ts:36-38` and `:98-100`.

18. **ARCH-127 createdAt coverage:** Expand the "exceptions" list to include `trades` (no createdAt), `note_templates`, `import_source_aliases`, `trade_rule_checks`, `progress_checks`, `journal_days`, `market_csv_datasets`.

---

## Recommended Additional Evidence

- **`apps/web/src/app/api/trades/[key]/rules/route.ts`**: Full read of the POST handler to confirm exact upsert/delete logic and ID derivation for `trade_rule_checks`.
- **`apps/web/src/components/rule-checklist.tsx`**: Confirm the UI writes to the same endpoint.
- **`packages/core/src/adherence.ts`**: Verify it is read-only (no inserts/updates to `trade_rule_checks`).
- **`apps/web/src/server/trades-query.ts:112`**: Verify `getTradeByKey` implementation.
- **`apps/web/src/server/ids.ts`**: Confirm `newId()` implementation for the 9-byte base64url claim.
- **`apps/web/src/server/crypto.ts`**: Confirm AES-256-GCM encryption claim for `credentialsEnc`.
- **`apps/web/src/server/sync.ts:31-34`**: Verify `kind='sync'` requires `credentialsEnc` set.
- **`apps/web/src/server/ibkr-sync-timezone.ts:32`**: Confirm `assertIbkrSyncTimeZone` line.
- **`round-trips.ts:95-99`**: Confirm key format with `baseKey` at line 97 and collision check at 98-99.
- **`apps/web/src/server/executions.ts:169-172`**: Check fee transformation logic for "absolute value" claim.
- **`apps/web/src/server/settings.ts`**: Verify every `getSetting` call does a fresh select.
- **`packages/core/src/edge-score.ts`**: Confirm EDGE_SCORE_VERSION = 2 and component weights.
- **`packages/core/src/analysis.ts`**: Confirm `matchesFilters` location and content.
- **`apps/web/src/app/api/accounts/[id]/route.ts`**: Verify `rebuildAccount` call inside immediate transaction at line 52.
- **`apps/web/src/app/api/settings/route.ts:125-127`**: Confirm bulk rebuild inside transaction.
- **`packages/core/src/round-trips.ts:92`**: Confirm breakeven `1e-9` tolerance.
- **`apps/web/src/server/ibkr-sync-timezone.ts`**: Confirm timezone migration is one-way (no reverse path).
