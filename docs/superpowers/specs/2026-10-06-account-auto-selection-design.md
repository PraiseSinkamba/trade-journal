# Auto-select accounts everywhere

**Status:** Draft — awaiting user review
**Date:** 2026-10-06
**Owner:** TBD
**Scope:** `apps/web` only; no schema migration required.

## Problem

Today every account-selection control asks the user to pick — even when the
answer is obvious:

- If exactly one non-archived account exists, the user shouldn't be asked at all.
- If the user has used one account recently, that's almost always the one they want again.

The current code does not remember "last used" anywhere. The header dropdown
sends a `?accounts=` URL parameter; the import and manual-trade pickers start
empty and only resolve when the user clicks. Picking the right thing by default
is a small UX win that compounds on every visit.

## Goals

- Anywhere the app asks for an account:
  - **One non-archived account** → pick it automatically.
  - **Multiple accounts + remembered last-used** → pick that one automatically.
  - Otherwise → leave empty so the user still chooses.
- The selection the user just made becomes "last used" for next time.
- The header dropdown auto-fills the URL with the persisted account when no
  `?accounts=` is present (so filtered views stay consistent across navigation).
- Multi-account selection in the filter dialog still works (URL is still the source
  of truth for the route).

## Non-goals

- New schema or migrations. The existing `settings` key/value store is the home
  for `currentAccountId`.
- No new endpoints. Reuses `/api/settings` GET + PATCH.
- No browser-localStorage fallback. Server-side only — keeps truth in one place
  and syncs across devices.
- Demo account selection flow (`/api/demo`) keeps its own selection path but
  writes the resulting account id to the new key.

## Behavior

### 1. Single source of truth: `settings.currentAccountId`

Stored as a string account id in the existing settings table (`apps/web/src/db/schema.ts`
→ `settings`). Read via a new helper, written via the existing PATCH endpoint.

```ts
// apps/web/src/server/settings.ts
export const getCurrentAccountId = (): string | null => getSetting("currentAccountId");
export const setCurrentAccountId = (id: string | null): void => {
  if (id === null) deleteSetting("currentAccountId");
  else setSetting("currentAccountId", id);
};
```

`/api/settings` GET extends its bag to include `currentAccountId`.
PATCH accepts `currentAccountId?: string | null`:

- `undefined` → leave unchanged.
- `null` → clear.
- string → store (no validation against the accounts table on write; the
  consumers validate on read so a deleted id falls back gracefully).

### 2. New hook `useAccountDefault`

`apps/web/src/lib/use-account-default.ts` exposes one resolved default id:

```ts
export function useAccountDefault(): {
  defaultId: string | null;
  loading: boolean;
  setDefault: (id: string | null) => void;
};
```

- Reads `/api/settings` once; picks `currentAccountId` if set.
- Cross-checks `/api/accounts?summary=1` to ensure the id is non-archived.
  Invalid → returns `null`.
- `setDefault` PATCHes `/api/settings { currentAccountId }` (fire-and-forget;
  the next mount re-reads). Used by pickers when the user picks or when the
  single-account rule auto-picks one.

### 3. `AccountPicker` (`apps/web/src/components/account-picker.tsx`)

Becomes a thin wrapper that:

1. Renders the current Select UI unchanged.
2. On mount, after both `/api/accounts` and `/api/settings` resolve:
   - If `value` is empty **and** exactly one non-archived account exists:
     call `onChange(onlyId)` and `setDefault(onlyId)` once.
   - Else if `value` is empty **and** `defaultId` is a non-archived account:
     call `onChange(defaultId)` once.
3. When `onValueChange` fires from the user, call `setDefault(newId)`.

Parent components (`app/import/page.tsx`, `manual-trade-entry.tsx`) stop
initialising `accountId` from empty; they pass an explicit `defaultId` from
`useAccountDefault()` and use the `value` controlled by the picker.

### 4. Import page (`apps/web/src/app/import/page.tsx`)

- FileImport and BrokerConnect now read `useAccountDefault()` and pass the
  resolved id down. The current `useState("")` becomes `useState<string>(defaultId)`.
- After a successful import commit (the existing `router.push("/?accounts=…")`
  at line 330), the page also calls `setDefault(accountId)`. The successful
  broker-connect branch at line 932 does the same with the newly created account
  id.
- The "Into account" picker no longer starts blank.

### 5. Manual trade dialog (`apps/web/src/components/manual-trade-entry.tsx`)

- Replace `useState("")` with `useState(defaultId)`. `defaultId` comes from
  `useAccountDefault()`. Picker's auto-fill rules above ensure single-account
  case still works.

### 6. Header `AccountSelector` (`apps/web/src/components/account-selector.tsx`)

- Read order on each render:
  1. URL `?accounts=`. If present → use it as today.
  2. Else if `useAccountDefault().defaultId` resolves to a non-archived account
     → write `?accounts=<id>` via `router.replace` (auto-fill the URL).
  3. Else if exactly one non-archived account exists → write `?accounts=<id>`
     and `setDefault(id)`.
  4. Else → leave "All accounts" as the default.
- On user picking an account: write the URL **and** `setDefault(id)`.
- On user picking "All accounts": write URL **and** `setDefault(null)`.
- On user picking "Account settings": no settings write (navigates to `/accounts`).
- On user picking the demo row (or loading demo): `setDefault(demoAccountId)`
  after the POST `/api/demo` returns `{ accountId }`.

## Error handling

- Stale `currentAccountId` (account deleted or archived) → `useAccountDefault`
  returns `null`; UI behaves as if nothing was remembered. No error surfaced;
  this is a quiet fallback.
- `/api/settings` PATCH failure → swallow; the picker still works, the next
  reload just won't remember the last-used. Same UX as localStorage being wiped.
- Single-account race (account created mid-load) → re-renders handle it; the
  hook returns `null` until the new list resolves, the picker still defaults
  on the next render.

## Files to change

| File | Change |
|---|---|
| `apps/web/src/server/settings.ts` | add `getCurrentAccountId`, `setCurrentAccountId` |
| `apps/web/src/app/api/settings/route.ts` | GET returns `currentAccountId`; PATCH accepts `currentAccountId?: string \| null` |
| `apps/web/src/lib/use-account-default.ts` | **new** hook |
| `apps/web/src/components/account-picker.tsx` | accept `defaultId`; auto-fill + persist on change |
| `apps/web/src/components/manual-trade-entry.tsx` | replace empty initial state with `useAccountDefault()` |
| `apps/web/src/app/import/page.tsx` | same; persist after successful commit/connect |
| `apps/web/src/components/account-selector.tsx` | URL auto-fill from persisted; persist on every select |

No schema migration; no new endpoint; no new dependencies.

## Verification

1. **Server** — manual smoke:
   - `GET /api/settings` returns `currentAccountId: null` initially.
   - `PATCH /api/settings { currentAccountId: "<id>" }` persists; GET reflects it.
   - `PATCH /api/settings { currentAccountId: null }` clears it.
2. **Single-account path** — delete all but one non-archived account, open
   `/import` → picker is pre-selected; commit succeeds with that account.
3. **Multi-account path** — open `/import`, select Account A, commit; reopen
   `/import` → picker is pre-selected to A.
5. **Header dropdown** — visit `/trades` with no `?accounts=` and one persisted
   account → URL becomes `?accounts=<id>` automatically.
6. **Stale id** — set `currentAccountId` to a non-existent id, restart dev
   server; header dropdown stays "All accounts", picker is empty (no error).
7. **Demo** — load demo data via header; persisted account id becomes the demo.

## Out of scope / future

- Per-user selection (single-user local app today; settings table is shared).
- Multi-account default list (header multi-select already covers this through
  URL; picker is single-select by design).
- Showing the persisted account as a separate "last used" hint in the picker UI
  — could be a follow-up if the label "Choose an account" is too vague.