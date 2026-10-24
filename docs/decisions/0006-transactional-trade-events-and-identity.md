# 0006 — Commit trade events with reconciliation and preserve derived keys

- Status: Proposed
- Date: 2026-10-22
- Deciders: Maintainer approval pending; proposed by Codex

## Context

Reliable background intelligence must describe committed financial changes and survive retries.
Some operations currently span separate writes, while historical imports can discover trades
that closed long before the journal observed them. Treating every import as a fresh closure
would create misleading notifications.

Existing review annotations and links depend on derived trade keys. Corrections, transfers,
splits and merges do not necessarily have a one-to-one identity mapping, and a single fill may
contribute to more than one cycle.

## Decision

Commit execution mutations, reconciliation, immutable projection evidence, identity revisions
and outbox events in one immediate SQLite transaction. Pass the transaction explicitly; do not
perform external work inside it. Preserve derived trade keys and existing public responses.
Introduce separate immutable intelligence IDs; retain them for unchanged active keys and proven
one-to-one explicit transfers only. Record ambiguity and tombstones for other rekeys. Emit no
event for an unchanged projection. Distinguish historical discovery from observed closure.

Enforce this with reconciliation/rollback tests and the mutation-path matrix in
[the contract review](../superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md).
This coexists with ADR 0001 and ADR 0002; neither broker transport boundary changes.

## Consequences

- Positive: financial facts and notifications share a commit boundary; annotations and URLs keep their keys.
- Negative: full rebuilds hold the write lock longer; synthetic-volume benchmarks gate release.
- Negative: conservative mapping leaves explicit unresolved continuity rather than guessing.
- Forbidden: fuzzy identity matching, financial writes by models, after-commit-only publication,
  and implied live closure for historical imports.

Alternatives rejected: replacing the public key (migration blast radius), matching by shared
execution overlap (crossing-flat ambiguity), and in-memory publication (crash loss).
Rollback is additive but requires reconciliation after any period without event capture; this
decision is not cost-free to reverse once observations reference identities.
