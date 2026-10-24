# 0007 — Supervise a durable SQLite worker with fenced claims

- Status: Proposed
- Date: 2026-10-22
- Deciders: Maintainer approval pending; proposed by Codex

## Context

The self-hosted journal must continue operating without cloud infrastructure or an AI provider.
Background work must survive process death without retaining locks forever or repeating user
visible effects. Web, container and desktop deployments need the same recovery behavior.

The database already supports concurrent bootstrap. Introducing another writer makes explicit
process ownership, migration ordering, backup discipline and native-runtime packaging essential.

## Decision

Use the existing SQLite database for a transactional outbox, per-handler deliveries, durable
jobs and a single-worker lease. Make claims atomic, recover expired leases, and fence completion
by owner and generation. Commit deterministic effects and acknowledgement together. Use an
explicit Node supervisor with HTTP and worker children, parent-disconnect shutdown, bounded
restart and graceful termination. Never start a worker from a route import or build.

Extend the shared bootstrap with ordered checksummed additive migrations. Require independent
connections, safe SQLite close behavior, full backup/restore verification and packaged startup
tests. See [the contract review](../superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md)
for exact schema constraints, leases, retry limits and deployment gates.

The [2026-10-23 phase guide](../superpowers/plans/2026-10-23-ai-native-journal-phases.md)
requires the migration runner and frozen legacy baseline as a standalone early deliverable.
All future schema changes MUST append immutable migrations with history/checksum validation,
fresh-versus-upgrade parity tests and rollback documentation. Latest bootstrap DDL MUST NOT
run ahead of migration validation or bypass a pending migration.

## Consequences

- Positive: one local volume, no mandatory queue service, recoverable at-least-once execution.
- Negative: multiple processes still share one SQLite writer; large transactions delay claims.
- Negative: independent worker assets/native modules require explicit build and packaging checks.
- Forbidden: claims without fencing, network calls inside write transactions, deleting live WAL
  sidecars, automatic destructive down migrations, or assuming AI requests execute exactly once.

Alternatives rejected: an in-memory queue (not durable), implicit Next startup hooks (lifecycle
and build ambiguity), and mandatory Redis/Postgres (deployment cost without a present need).
An in-process worker is simpler to launch but allows synchronous jobs to block HTTP; the
supervised process is selected. The storage choice can be replaced behind ports later; migrating
outstanding work is required, so reversal has a cost.
