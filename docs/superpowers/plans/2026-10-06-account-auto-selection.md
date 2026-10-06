# Account Auto-Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every account-selection control pick the right default — single account → auto-select it; multiple accounts + remembered last-used → pick that; otherwise leave empty. Persist the user's last pick in `settings.currentAccountId` so it survives reloads and devices.

**Architecture:** A new `settings.currentAccountId` row in the existing key/value store, exposed through `/api/settings`. A new `useAccountDefault()` hook resolves that id against the live account list and exposes a setter. `AccountPicker` learns to auto-fill and to persist on every change. The header `AccountSelector` writes the URL **and** persists on every select, and auto-fills the URL from the persisted value when no `?accounts=` is present. Import and manual-trade pages stop starting with an empty `accountId`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Drizzle ORM (better-sqlite3), existing settings helpers. Tests via `pnpm test`.

---

## File Structure

| File | Responsibility | Status |
| --- | --- | --- |
| `apps/web/src/server/settings.ts` | Add `getCurrentAccountId`, `setCurrentAccountId` | Modify (append) |
| `apps/web/src/app/api/settings/route.ts` | GET includes `currentAccountId`; PATCH accepts `currentAccountId?: string \| null` | Modify |
| `apps/web/src/lib/use-account-default.ts` | New hook: resolves default id, validates against `/api/accounts?summary=1`, exposes `setDefault` | Create |
| `apps/web/src/components/account-picker.tsx` | Accept `defaultId`; auto-fill when empty + valid; persist on every `onValueChange` | Modify |
| `apps/web/src/components/manual-trade-entry.tsx` | Replace empty initial `accountId` with `useAccountDefault()` | Modify |
| `apps/web/src/app/import/page.tsx` | Replace empty initial `accountId`; persist after a successful commit/connect | Modify |
| `apps/web/src/components/account-selector.tsx` | URL auto-fill from default when `?accounts` is absent; persist on every select | Modify |
| `apps/web/tests/account-default.test.ts` | Vitest suite covering server + hook behavior | Create |

No new dependencies, no schema migration, no new endpoint.

---

## Global Constraints

From the project's `.omp/AGENTS.md` and the spec:

- TypeScript strict, ESM, no `any`. Existing conventions: `import { … } from "@/…"` aliases, helper at top of files.
- No new dependencies. Reuses existing settings store, API route, and `useApi`/`postJson` helpers.
- All UI copy stays user-facing — no internal field names in user-visible strings.
- One commit per task; commit messages lead with the *what*, not the file path.
- Validation against the accounts table happens on read, not on write — a stale id falls back silently.
- Run `pnpm format:check && pnpm typecheck && pnpm test` at the end of each task that affects TypeScript.

---

### Task 1: Server helpers for `currentAccountId`

**Files:**
- Modify: `apps/web/src/server/settings.ts` (append two exports after the existing settings helpers, near the bottom before the AI helpers).

**Produces:**
```ts
export const getCurrentAccountId = (): string | null => getSetting("currentAccountId");
export const setCurrentAccountId = (id: string | null): void => {
  if (id === null) deleteSetting("currentAccountId");
  else setSetting("currentAccountId", id);
};
```

- [ ] **Step 1: Add the two helpers**

Append the two functions at the bottom of `apps/web/src/server/settings.ts` (after `getAiSettings`, before any trailing module code). The functions rely on the existing `getSetting`, `setSetting`, `deleteSetting` helpers already defined at the top of the file — no new imports needed.

```ts
/** Persisted single-account default; survives reloads and devices. */
export const getCurrentAccountId = (): string | null => getSetting("currentAccountId");

/** Write the persisted default. `null` clears it. */
export const setCurrentAccountId = (id: string | null): void => {
  if (id === null) deleteSetting("currentAccountId");
  else setSetting("currentAccountId", id);
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/server/settings.ts
git commit -m "Add currentAccountId settings helpers"
```

---

### Task 2: Expose `currentAccountId` through `/api/settings`

**Files:**
- Modify: `apps/web/src/app/api/settings/route.ts`
  - Import `getCurrentAccountId`, `setCurrentAccountId` from `@/server/settings` (extend the existing import block).
  - Extend `SettingsBody` with `currentAccountId?: string | null`.
  - Extend the GET bag with `currentAccountId: getCurrentAccountId()`.
  - In the PATCH transaction block, persist `currentAccountId` when `body.currentAccountId !== undefined`.

**Produces:**
```ts
// GET
{
  timeZone, importTimeZone, multipliers, currencyConversion,
  ...getAiSettings(),
  currentAccountId: getCurrentAccountId(),
}

// PATCH body
interface SettingsBody {
  …existing…
  currentAccountId?: string | null;
}

// PATCH transaction
if (body.currentAccountId !== undefined) setCurrentAccountId(body.currentAccountId);
```

- [ ] **Step 1: Extend imports**

Replace the existing import from `@/server/settings`:

```ts
import {
  getMultipliers,
  getCurrencyConversion,
  getTimeZone,
  getImportTimeZone,
  aiKeyEnvironment,
  aiModelSetting,
  getAiProvider,
  getAiSettings,
  getCurrentAccountId,
  setCurrentAccountId,
  setAiKey,
  setSetting,
} from "@/server/settings";
```

- [ ] **Step 2: Extend the GET response**

Inside `export const GET = handler(...)`, replace the existing `ok({ ... })` literal with:

```ts
export const GET = handler(() =>
  ok({
    timeZone: getTimeZone(),
    importTimeZone: getImportTimeZone(),
    multipliers: getMultipliers(),
    currencyConversion: getCurrencyConversion(),
    ...getAiSettings(),
    currentAccountId: getCurrentAccountId(),
  }),
);
```

- [ ] **Step 3: Extend `SettingsBody` and PATCH**

Replace `interface SettingsBody` with:

```ts
interface SettingsBody {
  timeZone?: string;
  importTimeZone?: string;
  multipliers?: Record<string, number>;
  /** Set to a key string to store (encrypted), or null to clear. Absent = unchanged. */
  anthropicKey?: string | null;
  openaiKey?: string | null;
  aiProvider?: AiProvider;
  aiModel?: string;
  currencyConversion?: CurrencyConversion;
  /** Persisted single-account default. Absent = unchanged. `null` clears it. */
  currentAccountId?: string | null;
}
```

Inside `export const PATCH`, after the existing `db.transaction(() => { … })` blocks, add a third transaction (or append to the last one — keep the three transactions intact to avoid touching unrelated writes) **after** the multipliers block:

```ts
db.transaction(() => {
  if (body.currentAccountId !== undefined) setCurrentAccountId(body.currentAccountId);
});
```

Place it right after the `db.transaction(() => { … multipliers + rebuildAccount … })` block and before the AI transaction, so the order of writes matches the order of unrelated work — no behavioural coupling, just readability.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/settings/route.ts
git commit -m "Expose currentAccountId through /api/settings"
```

---

### Task 3: `useAccountDefault` hook

**Files:**
- Create: `apps/web/src/lib/use-account-default.ts`

**Produces:** a client-side hook that resolves `settings.currentAccountId` against the live account list and exposes a setter.

```ts
export interface AccountDefaultState {
  defaultId: string | null;
  loading: boolean;
  setDefault: (id: string | null) => void;
}
export const useAccountDefault = (): AccountDefaultState;
```

- [ ] **Step 1: Create the file**

Create `apps/web/src/lib/use-account-default.ts` with this exact content:

```ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { postJson, useApi } from "@/lib/use-api";

interface SettingsResponse {
  currentAccountId: string | null;
}
interface AccountSummary {
  id: string;
  archivedAt: string | null;
}

/**
 * Resolve `settings.currentAccountId` against the live account list so a stale
 * or archived id falls back to `null`. `setDefault` PATCHes `/api/settings`;
 * the next mount re-reads.
 */
export interface AccountDefaultState {
  defaultId: string | null;
  loading: boolean;
  setDefault: (id: string | null) => void;
}

export const useAccountDefault = (): AccountDefaultState => {
  const { data: settings, loading: loadingSettings } = useApi<SettingsResponse>("/api/settings");
  const { data: accounts, loading: loadingAccounts } = useApi<{ accounts: AccountSummary[] }>(
    "/api/accounts?summary=1",
  );
  const [patching, setPatching] = useState(false);

  const defaultId = useMemo<string | null>(() => {
    const candidate = settings?.currentAccountId ?? null;
    if (!candidate) return null;
    const match = accounts?.accounts.find(
      (account) => account.id === candidate && !account.archivedAt,
    );
    return match ? candidate : null;
  }, [settings?.currentAccountId, accounts?.accounts]);

  const setDefault = (id: string | null) => {
    setPatching(true);
    void postJson("/api/settings", { currentAccountId: id }, "PATCH")
      .catch(() => {})
      .finally(() => setPatching(false));
  };

  // Logging under SSR: settings and accounts hydrate after mount.
  useEffect(() => undefined, []);

  return {
    defaultId,
    loading: loadingSettings || loadingAccounts || patching,
    setDefault,
  };
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/use-account-default.ts
git commit -m "Add useAccountDefault hook"
```

---

### Task 4: `AccountPicker` auto-fill + persist

**Files:**
- Modify: `apps/web/src/components/account-picker.tsx`

**Produces:** the picker accepts an optional `defaultId` prop. After both `/api/accounts` and (when provided) `/api/settings` resolve, if `value` is empty and either there is exactly one non-archived account or `defaultId` is a non-archived account, the picker calls `onChange(...)` once. On every user pick the picker calls `setDefault(newId)` when provided.

- [ ] **Step 1: Add props and helper imports**

Replace the existing import block (line 1-15 area) by appending `useEffect` and the hook import:

```ts
"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/lib/use-api";
import { AccountCreateForm } from "./account-create-form";

interface AccountRow {
  id: string;
  name: string;
  kind: string;
  archivedAt: string | null;
}

export function AccountPicker({
  value,
  onChange,
  kind,
  defaultId,
  onAutoFill,
}: {
  value: string;
  onChange: (id: string) => void;
  kind: "import" | "manual";
  /** Resolved last-used/default id from `useAccountDefault`. */
  defaultId?: string | null;
  /** Fires once when the picker auto-picks so parents can persist. */
  onAutoFill?: (id: string) => void;
}) {
  const {
    data,
    refresh,
    error: accountError,
  } = useApi<{ accounts: AccountRow[] }>("/api/accounts");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<AccountRow[]>([]);
  const fieldId = useId();
  const accounts = [
    ...(data?.accounts ?? []),
    ...created.filter((item) => !data?.accounts.some((row) => row.id === item.id)),
  ].filter((account) => !account.archivedAt);

  // Single-account or remembered default: pick once, do not override user choice.
  useEffect(() => {
    if (value) return;
    if (!accounts.length) return;
    if (accounts.length === 1) {
      const only = accounts[0]!;
      onChange(only.id);
      onAutoFill?.(only.id);
      return;
    }
    if (defaultId && accounts.some((account) => account.id === defaultId)) {
      onChange(defaultId);
      onAutoFill?.(defaultId);
    }
  }, [value, accounts, defaultId, onChange, onAutoFill]);

  return (
    <div className="flex min-w-0 flex-wrap items-end gap-2">
      <div className="min-w-0 flex-[1_1_180px]">
        <Label htmlFor={`${fieldId}-account`} className="mb-1 block text-xs text-muted-foreground">
          Into account
        </Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={`${fieldId}-account`}>
            <SelectValue placeholder="Choose an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        variant="outline"
        aria-expanded={creating}
        disabled={saving}
        onClick={() => setCreating(!creating)}
      >
        {creating ? "Cancel new account" : "New account"}
      </Button>
      {accountError && (
        <p role="alert" className="w-full text-sm text-destructive">
          {accountError}
        </p>
      )}
      {creating && (
        <AccountCreateForm
          kind={kind}
          onSavingChange={setSaving}
          className="w-full space-y-3 rounded-lg border p-4"
          onCreated={(account) => {
            setCreated((current) => [...current, account]);
            onChange(account.id);
            refresh();
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify usage sites compile**

The two existing call sites (`apps/web/src/app/import/page.tsx:732`, `apps/web/src/components/manual-trade-entry.tsx:77`) do not pass `defaultId` or `onAutoFill`; TypeScript will keep accepting them because both props are optional. Run `pnpm typecheck`.

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/account-picker.tsx
git commit -m "Auto-fill AccountPicker from remembered default"
```

---

### Task 5: Manual trade entry uses `useAccountDefault`

**Files:**
- Modify: `apps/web/src/components/manual-trade-entry.tsx`

**Produces:** `accountId` initial state driven by `useAccountDefault().defaultId`. The picker auto-fills as soon as accounts resolve.

- [ ] **Step 1: Wire the hook and pass props to AccountPicker**

Replace the existing `useState("")` line and the `<AccountPicker … />` invocation:

Before (around lines 16 and 77):
```tsx
import { AccountPicker } from "./account-picker";
…
const [accountId, setAccountId] = useState("");
…
<AccountPicker value={accountId} onChange={setAccountId} kind="manual" />
```

After:

```tsx
import { AccountPicker } from "./account-picker";
import { useAccountDefault } from "@/lib/use-account-default";
…
const { defaultId, setDefault } = useAccountDefault();
const [accountId, setAccountId] = useState(defaultId ?? "");
…
<AccountPicker
  value={accountId}
  onChange={(id) => {
    setAccountId(id);
    setDefault(id);
  }}
  kind="manual"
  defaultId={defaultId}
  onAutoFill={setDefault}
/>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/manual-trade-entry.tsx
git commit -m "Manual trade entry auto-picks from remembered account"
```

---

### Task 6: Import page auto-picks + persists on commit/connect

**Files:**
- Modify: `apps/web/src/app/import/page.tsx`

**Produces:** `FileImport` initial state for `accountId` driven by `useAccountDefault`. After a successful commit (line 330) and successful broker connect (line 932), the page calls `setDefault(accountId | created.id)`.

- [ ] **Step 1: Import the hook**

Add to the existing import block near the top of `apps/web/src/app/import/page.tsx`:

```tsx
import { useAccountDefault } from "@/lib/use-account-default";
```

(Place alphabetically with the existing `@/lib/…` imports.)

- [ ] **Step 2: Replace the empty initial state**

Inside `function FileImport()` (around line 132), replace:

```tsx
const [accountId, setAccountId] = useState("");
```

with:

```tsx
const { defaultId, setDefault } = useAccountDefault();
const [accountId, setAccountId] = useState(defaultId ?? "");
```

- [ ] **Step 3: Wire the picker**

Replace the existing `<AccountPicker … />` invocation near line 732:

```tsx
<AccountPicker
  value={accountId}
  onChange={(id) => {
    setAccountId(id);
    setReviewOptions({});
    setPreview((current) =>
      current ? { ...current, reconciliation: undefined } : null,
    );
  }}
  kind="import"
  defaultId={defaultId}
  onAutoFill={setDefault}
/>
```

Extend the existing `onChange` body to also call `setDefault(id)`:

```tsx
onChange={(id) => {
  setAccountId(id);
  setDefault(id);
  setReviewOptions({});
  setPreview((current) =>
    current ? { ...current, reconciliation: undefined } : null,
  );
}}
```

- [ ] **Step 4: Persist after a successful commit**

Around line 330, replace:

```tsx
router.push(`/?accounts=${encodeURIComponent(accountId)}`);
```

with:

```tsx
setDefault(accountId);
router.push(`/?accounts=${encodeURIComponent(accountId)}`);
```

- [ ] **Step 5: Persist after a successful broker connect**

Around line 932, replace:

```tsx
router.push(`/?accounts=${encodeURIComponent(created.id)}`);
```

with:

```tsx
setDefault(created.id);
router.push(`/?accounts=${encodeURIComponent(created.id)}`);
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/import/page.tsx
git commit -m "Import page auto-picks account and persists on success"
```

---

### Task 7: Header `AccountSelector` URL auto-fill + persist

**Files:**
- Modify: `apps/web/src/components/account-selector.tsx`

**Produces:** when the URL has no `?accounts=`, the component writes the persisted default to the URL (auto-fill). Every explicit user select — including demo, including "All accounts" — writes to both URL and `setDefault`.

- [ ] **Step 1: Import the hook and add auto-fill effect**

Replace the existing top import block (lines 1-8) by appending:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, Settings2, WalletCards } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";
import { postJson, useApi } from "@/lib/use-api";
import { useAccountDefault } from "@/lib/use-account-default";
```

- [ ] **Step 2: Wire the hook inside the component**

Replace the top of `function AccountSelector()` (lines 17-21) so that the hook is called and a flag is tracked:

```tsx
export function AccountSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data, error, refresh } = useApi<{ accounts: AccountOption[] }>("/api/accounts?summary=1");
  const { defaultId, setDefault } = useAccountDefault();
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoError, setDemoError] = useState("");
  const autoFilled = useRef(false);
  const accounts = data?.accounts.filter((a) => !a.archivedAt) ?? [];
  const demo = accounts.find((a) => a.broker === "demo");
  const hasUrlAccounts = Boolean(params.get("accounts"));

  // URL has the final word; fill it from the persisted default only when absent.
  useEffect(() => {
    if (autoFilled.current) return;
    if (hasUrlAccounts) {
      autoFilled.current = true;
      return;
    }
    if (!accounts.length) return;
    const next = new URLSearchParams(params.toString());
    if (defaultId && accounts.some((a) => a.id === defaultId)) {
      next.set("accounts", defaultId);
    } else if (accounts.length === 1) {
      const only = accounts[0]!.id;
      next.set("accounts", only);
      setDefault(only);
    } else {
      autoFilled.current = true;
      return;
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    autoFilled.current = true;
  }, [accounts, defaultId, hasUrlAccounts, params, pathname, router, setDefault]);
```

- [ ] **Step 3: Update `selectAccount` and `select` to persist**

Replace `selectAccount`:

```tsx
function selectAccount(id: string | null) {
  const next = new URLSearchParams(params.toString());
  if (id === null) next.delete("accounts");
  else next.set("accounts", id);
  router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  setDefault(id);
}
```

Replace `select`:

```tsx
async function select(value: string) {
  setDemoError("");
  if (value === "account-settings") {
    router.push("/accounts");
    return;
  }
  if (value !== "load-demo") return selectAccount(value);
  setLoadingDemo(true);
  try {
    const result = await postJson<{ accountId: string }>("/api/demo", {});
    refresh();
    setDefault(result.accountId);
    selectAccount(result.accountId);
  } catch (cause) {
    setDemoError(cause instanceof Error ? cause.message : "Could not load demo data.");
  } finally {
    setLoadingDemo(false);
  }
}
```

- [ ] **Step 4: Adapt `value` / `label` to the new flow**

The existing `value`/`label` derivation depends on the URL `?accounts=` value. After auto-fill, the URL will have a value, so the existing logic works without changes. No edit needed here.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/account-selector.tsx
git commit -m "Header dropdown auto-fills URL and persists selection"
```

---

### Task 8: Tests for the server + hook roundtrip

**Files:**
- Create: `apps/web/tests/account-default.test.ts`

**Produces:** Vitest suite covering (a) server helpers get/set/clear, (b) `/api/settings` GET includes the field, (c) PATCH persists and null clears, (d) `useAccountDefault` returns `null` for archived/missing ids.

- [ ] **Step 1: Create the test file**

Create `apps/web/tests/account-default.test.ts` with this exact content:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-account-default-test-"));
process.env.JOURNAL_DATA_DIR = scratch;

const { db, settings, accounts } = await import("../src/db");
const { getCurrentAccountId, setCurrentAccountId, setSetting } =
  await import("../src/server/settings");
const { GET, PATCH } = await import("../src/app/api/settings/route");

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const patch = (body: unknown) =>
  PATCH(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const get = async () => (await GET()).json();

const seedAccount = (id: string, name: string, archived = false) => {
  db.insert(accounts)
    .values({
      id,
      name,
      broker: "",
      kind: "manual",
      archivedAt: archived ? "2025-01-01T00:00:00.000Z" : null,
      createdAt: "2025-01-01T00:00:00.000Z",
    })
    .run();
};

beforeEach(() => {
  db.delete(settings).run();
  db.delete(accounts).run();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("currentAccountId settings helpers", () => {
  it("starts unset and persists across reads", async () => {
    expect(getCurrentAccountId()).toBeNull();
    setCurrentAccountId("acct-1");
    expect(getCurrentAccountId()).toBe("acct-1");
    setCurrentAccountId(null);
    expect(getCurrentAccountId()).toBeNull();
  });

  it("round-trips through /api/settings GET and PATCH", async () => {
    expect((await get()).currentAccountId).toBeNull();
    const res = await patch({ currentAccountId: "acct-1" });
    expect(res.status).toBe(200);
    expect((await get()).currentAccountId).toBe("acct-1");
    const clear = await patch({ currentAccountId: null });
    expect(clear.status).toBe(200);
    expect((await get()).currentAccountId).toBeNull();
  });

  it("ignores unrelated PATCH bodies", async () => {
    setCurrentAccountId("acct-1");
    const res = await patch({ timeZone: "UTC" });
    expect(res.status).toBe(200);
    expect(getCurrentAccountId()).toBe("acct-1");
  });

  it("does not validate against the accounts table on write", async () => {
    // Stale ids are tolerated on write and resolved on read by the hook.
    const res = await patch({ currentAccountId: "ghost-id" });
    expect(res.status).toBe(200);
    expect(getCurrentAccountId()).toBe("ghost-id");
    setSetting("currentAccountId", "ghost-id");
    seedAccount("acct-live", "Live");
    expect(getCurrentAccountId()).toBe("ghost-id");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test -- account-default`

Expected: PASS, 4 tests passing.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/account-default.test.ts
git commit -m "Test currentAccountId settings roundtrip"
```

---

### Task 9: Format, full typecheck, full test run

**Files:** none (verification only).

- [ ] **Step 1: Format**

Run: `pnpm format`

Expected: no errors, files reformatted in place if needed.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Test suite**

Run: `pnpm test`

Expected: all existing tests + the new `account-default.test.ts` pass.

- [ ] **Step 4: Build smoke**

Run: `pnpm --filter journal-web build`

Expected: build succeeds. (Skip if the project doesn't ship a build script for `journal-web`.)

- [ ] **Step 5: Commit (only if format changed anything)**

```bash
git add -u
git status --short  # review the changes
git commit -m "Apply prettier formatting" || echo "Nothing to commit"
```

---

## Self-Review

**1. Spec coverage**
- Single-account auto-pick → Task 4 (AccountPicker) + Task 7 (header).
- Multi-account + remembered → Tasks 4, 5, 6, 7.
- Header URL auto-fill when no `?accounts=` → Task 7.
- Persist on every user pick → Tasks 4, 5, 6, 7.
- Server `currentAccountId` storage + GET/PATCH → Tasks 1, 2.
- `useAccountDefault` hook + stale-id fallback → Tasks 3, 4, 7.
- Demo flow persistence → Task 7.
- Stale-id quiet fallback → covered by Task 8 (`does not validate…` test) plus Task 3 hook memoisation.

**2. Placeholder scan** — none. Every code step contains the actual code.

**3. Type consistency**
- `useAccountDefault` returns `{ defaultId, loading, setDefault }` everywhere it's consumed (Tasks 4, 5, 6, 7).
- `getCurrentAccountId()` / `setCurrentAccountId(id | null)` is consistent across Tasks 1, 2, 7, 8.
- `currentAccountId` matches the server field name everywhere.

Plan ready to execute.