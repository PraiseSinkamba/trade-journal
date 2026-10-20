# Backup manifest — shadcn adoption

Captured: 2026-10-20

## apps/web/src/components/ui/

| File | Customisations to restore after `shadcn add` |
|------|------------------------------------------------|
| `skeleton.tsx` | Plain wrapper. Restore as-is. |
| `label.tsx` | Radix passthrough. Restore as-is. |
| `input.tsx` | Plain input. Restore as-is. |
| `textarea.tsx` | Plain textarea. Restore as-is. |
| `badge.tsx` | Adds `profit` and `loss` variants to `badgeVariants`. |
| `checkbox.tsx` | Indeterminate state via `Minus` icon + `group/checkbox` data-state. |
| `table.tsx` | Wrapped in `overflow-x-auto`; tabular-nums in CSS. |
| `dropdown-menu.tsx` | Minimal export set; consumers depend on the trimmed surface. |
| `select.tsx` | Custom trigger styling using `--radix-*` vars; ScrollUp/Down present. |
| `card.tsx` | Adds `card-sheen` utility class; `CardHeader` carries `data-slot="card-header"`; `CardTitle` is small/uppercase (not h3). |
| `tabs.tsx` | `TabsList` in `overflow-x-auto`; triggers stack on narrow widths. |
| `dialog.tsx` | Adds `CardTitle`-style title (small/uppercase); Close button built into `DialogContent`. |
| `tooltip.tsx` | Exports `Tooltip*` + `HoverHint` + `HelpHint`. `HoverHint` short-circuits when `content` is null. |
| `button.tsx` | Wraps body in `HoverHint` when `title` is set or icon-only without `aria-label`. Uses `asChild` Slot. |
| `calendar.tsx` | Wraps `react-day-picker` v9 with `journal-calendar-*` utility classes. |
| `date-picker.tsx` | Radix `Popover` + `Input` + lazy Calendar; min/max validation; `aria-invalid` + `role="alert"` error span; Clear/Today actions. |
| `option-select.tsx` | Declarative `<option>` list; `"All"` empty-string choice encoded as `option:<value>`. |

## apps/web/src/components/

| File | Customisations to restore after Sidebar rewrite |
|------|-------------------------------------------------|
| `shell.tsx` | Privacy toggle, theme toggle, dictation/voice-notes triggers, dashboard customizer mount, brand/logo, custom nav entries, `SidebarFooter` anchor. |

## Restoration policy

After each `shadcn add`, open the backup file, start from the new registry version, and merge in the project customisations. Keep every import path consumers already use.
