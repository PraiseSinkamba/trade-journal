# Task 8-11 Report — shadcn primitive restores (skeleton, label, input, textarea)

## Summary

| # | Task | Primitive | Commit SHA | Subject | Typecheck | Restore summary |
|---|------|----------|-----------|---------|-----------|----------------|
| 8 | Task 8 | skeleton | `7d02e6c` | Restore skeleton primitive on shadcn registry | PASS | Merged `data-slot="skeleton"` from registry into backup (plain wrapper); fixed import from bare `cn` → `@/lib/utils` |
| 9 | Task 9 | label | `dc8b437` | Restore label primitive on shadcn registry | PASS | Kept Radix `LabelPrimitive.Root` from backup; added `data-slot="label"` from registry; fixed import |
| 10 | Task 10 | input | `0ab0f92` | Restore input primitive on shadcn registry | PASS | Kept plain `<input>` from backup; added `data-slot="input"` from registry; shadcn wanted `@base-ui/react/input` dep — skipped |
| 11 | Task 11 | textarea | `6f32b52` | Restore textarea primitive on shadcn registry | PASS | Kept plain `<textarea>` from backup; added `data-slot="textarea"` from registry; fixed import |

## Observations

- **Import path bug**: shadcn CLI v4 writes `import { cn } from "cn"` in all generated files — a placeholder that never resolves. All four files were corrected to `import { cn } from "@/lib/utils"`.
- **input dep shift**: shadcn now ships input backed by `@base-ui/react/input` rather than a plain `<input>`. The restore preserves the project's plain `<input>` (no new dep), which is the correct trade-off given the no-new-dep constraint.
- **Radix for label**: The backup uses `@radix-ui/react-label`; shadcn v4 ships a plain `<label>`. The restore keeps Radix (per backup) and adds `data-slot` — the expected "project customisation" for label.
- **Backup files**: All four backups are plain wrappers with no extra variants or customisations — restore was minimal for all four.

## Typecheck evidence

All four `pnpm --filter web typecheck` runs returned exit code 0.

## Report path

```
.superpowers/sdd/task-8-11-report.md
```
