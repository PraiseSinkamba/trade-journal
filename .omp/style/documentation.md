# Documentation Style Guide — trade-journal

## Voice

Terse. Evidence-first. Every sentence does work.

Commit subjects read as a complete sentence a non-engineer can understand.
This is not a guideline — it is the rule in `AGENTS.md`:
"what was solved, not what was edited."

**Bad:** `fix: handle flat split in buildRoundTrips`
**Good:** `Fixes two trades appearing when a fill crosses through flat`

User-facing docs describe symptoms, not mechanisms. Never mention a file path,
symbol name, or line number in user-facing guides.

---

## File Structure

One topic per file under `docs/`. Filename is the topic.

| Topic | File |
|---|---|
| Edge Score | `docs/edge-score.md` |
| Broker importers | `docs/importers.md` |
| Market data | `docs/market-data.md` |
| Prop firms | `docs/prop-firms.md` |
| Calendar | `docs/calendar-insights.md` |
| Performance | `docs/performance-trends.md` |
| Trade explorer | `docs/trade-explorer.md` |
| AI features | `docs/ai-scope.md` |
| Design decisions | `docs/design.md` |
| Anonymized samples | `docs/samples/` |

Never create a new doc file without a corresponding feature or contract to describe.

---

## Per-File Anatomy

Every public guide contains, in order:

1. **What it is** — one sentence.
2. **When to use it** — bullet list of the specific user task.
3. **Formula or contract** — exact math, schema, or behavioural contract.
4. **Worked example** — a concrete input/output walkthrough.
5. **Edge cases** — what breaks and at what boundary.
6. **Version stamp** — `v1`, `v2`, etc. Bumped on every change to the contract.

Do not add sections that serve no purpose. A guide that fits in three paragraphs
needs three paragraphs, not a template.

---

## Edge Score — Versioning Rule

Edge Score weights and full-marks thresholds live in `packages/core/src/edge-score.ts`
as `EDGE_SCORE_WEIGHTS` and documented comment. The current version is
`EDGE_SCORE_VERSION = 2`.

**Any weight or threshold change** bumps `EDGE_SCORE_VERSION` AND updates
`docs/edge-score.md` in the same PR. Both changes are required together.
A PR that touches one without the other is blocked.

The Edge Score contract is pinned: the same metrics always produce the same
score. Users can verify it. No hidden smoothing or magic numbers.

---

## Samples

`docs/samples/` holds anonymized broker exports only.

Never include a real account, real broker credentials, or real P&L data.
Demo data in the app is synthetic and separate from `docs/samples/`.

---

## Cross-Linking

Every guide links to the engine doc or symbol it depends on.

- `docs/edge-score.md` → `packages/core/src/edge-score.ts` (`computeEdgeScore`)
- `docs/importers.md` → `packages/importers/src/detect.ts` (`parseAuto`, `detectFormat`)
- `docs/importers.md` → `packages/importers/src/formats/fills.ts` (`makeFillsFormat`)

Links use relative paths from `docs/` to the source file.

---

## New Feature Documentation Requirement

A new feature ships with a docs entry in the same PR, unless the change
is entirely internal (no user-visible behaviour change, no new API contract,
no new metric).

Internal-only changes: refactors, test additions, CI tooling, dependency updates.

---

## ADR / Decision Records

When changing the **trade key format**, **broker boundaries**, or **scoring weights**,
write a decision record at `docs/decisions/NNNN-<topic>.md` before merging.

Use an incrementing number. File the ADR before the code lands — it is not
retroactive documentation.

---

## When in doubt

- If a section has no concrete example, delete the section.
- If a doc file cannot summarise its topic in eight sentences, split it.
- If you cannot name the file without a verb, it is not a topic.
- When describing a metric, ask: "can the user compute this by hand from their trade log?" If not, add the formula.
- When adding a new doc, ask: does this describe user-facing behaviour or internal design? Internal → code comment. User-facing → doc file.
