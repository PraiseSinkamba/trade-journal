# Phase 10 — Node supervisor and independent worker

Base: `5093db1068715aa104f342c5b8bd0eaa3a554d4f`. Coordinator explicitly reuses Phase 09 checkout before its combined integration; no separate integration-09 report is required for this dispatch.

## Contract and ownership

All writers share this checkout, have exclusive paths, run no checks or Git mutations, and never delegate recursively. Consolidation owns formatting, generated outputs, verification, commits and this plan/report. No schema, migration, lockfile or dependency changes.

- Lifecycle writer: `apps/web/scripts/run-journal.mjs`, `apps/web/scripts/http-child.mjs`, `apps/web/tests/intelligence-supervisor.test.ts`.
- Worker writer: `apps/web/src/server/intelligence/composition.ts`, `apps/web/src/server/intelligence/worker-entry.ts`.
- Bundle writer: `apps/web/scripts/build-worker.mjs`, `apps/web/package.json`, `apps/web/tests/intelligence-packaging.test.ts`.
- Deployment writer: `apps/web/scripts/copy-static-build.js`, `apps/web/next.config.ts`, `Dockerfile`.

Supervisor CLI: `--mode dev|production --host HOST --port PORT --data-dir ABSOLUTE --worker enabled|disabled`. Environment equivalents HOSTNAME/PORT/JOURNAL_DATA_DIR; worker defaults disabled in dev, enabled in production. Supervisor lives under `apps/web/scripts`, resolves app root relative to itself, forks `http-child.mjs` and `../worker/worker-entry.cjs`. Production HTTP uses standalone `../server.js`. Development uses Next programmatic startup. Both child environments carry identical explicit absolute data directory, host and port.

IPC messages use `{type: 'ready'|'health'|'shutdown'|'stopped'}`. Health carries worker state. Supervisor emits newline JSON ready only after successful HTTP probe and forwards health to its own IPC parent/stdout. Parent disconnect, SIGINT and SIGTERM trigger shutdown; children stop claims and close handles, never unlink WAL/SHM. Supervisor allows ten seconds before forced termination. HTTP exit stops worker and fails supervisor. Worker crash keeps HTTP alive, restarts at exponential bounded delays, and stops restarting after five crashes within ten minutes with unhealthy health. Only worker entry main starts WorkerService; importing composition does not start consumers.

Composition exports `createIntelligenceWorker({db, clock?, enabled?, owner?})` using existing fenced worker, jobs/effects/outbox and seed/observation handlers. Existing lease constants remain authoritative: worker 30s/10s renewal, jobs 60s/15s renewal. Worker entry exports `main`, validates absolute data directory, opens/migrates before start, supports IPC health/shutdown and parent disconnect, closes every imported/owned handle.

Bundle script uses installed tsup's esbuild, emits `.next/worker-dist/worker-entry.cjs`, externalizes better-sqlite3, copies its native module and runtime dependencies under that directory. No Next, routes or React in bundle. Build script runs worker build before copy-static-build. Copy script places complete worker directory at standalone/tauri-dist `apps/web/worker` and both lifecycle scripts at `apps/web/scripts`. Docker runs supervisor, preserves nonroot single volume, explicitly ships independent assets.

## Execution and evidence

Write named lifecycle and packaging tests during implementation. Cover startup/import separation, actual IPC child shutdown/disconnect, readiness, restart cap, HTTP failure, portable native bundle and clean directory paths containing spaces. No broad checks during active writer wave.

After join: resolve interfaces once; format changed files; run targeted Vitest suites, filtered package typechecks (desktop RC2175 excluded per coordinator), changed-file Prettier check, license check, production build and full tests. Exercise packaged startup/shutdown with disposable absolute data directory and ports other than 3000/3001. Run Docker scratch-volume smoke if real Docker available; otherwise report deployment gate blocked, never mocked. Read coordinator mailbox after checks and before final report. Review changes and commit phase report with commands, exit codes, runtime, limitations and exact source commit. Stop after required worker_done.
