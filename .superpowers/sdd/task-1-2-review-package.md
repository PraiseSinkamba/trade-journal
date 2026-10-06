# Task 1.2 Review Package

## Commit
- Range: `5a1f0c7..2538e6b`
- Subject: `feat(importers): propagate skip reasons through rowsToFills consumers`
- Stat: 4 files, +29/-19

## Files touched

- `packages/importers/src/formats/fills.ts` — `rowsToFills` signature widened; loop refactored to track row index; reasons pushed at both skip sites; `makeFillsFormat` consumer forwarded reasons.
- `packages/importers/src/formats/generic.ts` — destructure + forward.
- `packages/importers/src/formats/ninjatrader.ts` — local `skippedReasons` array, appends `rowsToFills` reasons, forwarded.
- `packages/importers/src/formats/thinkorswim.ts` — destructure + forward + early-return literal updated.

## Plan section

```markdown
### Task 1.2: Update `rowsToFills` to emit reasons
...
returns { executions, skippedRows, skippedReasons: SkippedReason[] }
```

## Key diff (fills.ts loop body)

```ts
if (!symbolRaw || !side || !executedAt || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price)) {
  skippedRows++;
  const reason = !symbolRaw
    ? "missing symbol"
    : !side
      ? "unrecognised side value"
      : !executedAt
        ? "unparseable timestamp"
        : quantity <= 0
          ? "non-positive quantity"
          : "non-positive price";
  skippedReasons.push({ row: i + 2, reason });
  continue;
}
```

Reason strings are user-facing; no parser internals.

## Implementer report path

`.superpowers/sdd/task-1-2-report.md`

## Expected typecheck state

- Clean: `fills.ts`, `generic.ts`, `ninjatrader.ts`, `thinkorswim.ts`
- Still failing (Tasks 1.3-1.4): `history.ts` (2), `ibkr.ts` (2), `metatrader.ts` (1), `tradezella.ts` (1)

## Global constraints

- `packages/importers` purity: no fetch/axios/http., no apps/web imports. ✓
- No new dependencies. ✓
- Human-facing strings only. ✓