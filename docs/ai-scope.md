# AI account and filter scope

Ask your journal and daily recaps use the account selection and analysis filters shown on the page. The client sends the computed date range, rather than asking the server to reinterpret a relative range. The server validates that snapshot, then uses the same trade query and timezone as the journal before building any AI context.

## Execution boundary (current foundation)

The current AI surface in this repository is the **server-only execution foundation** shipped by the plan in `docs/superpowers/plans/2026-10-08-ai-foundation-refactor.md`:

- Provider, model, and key resolution happen **only** inside
  `apps/web/src/server/ai-runtime.ts` and `apps/web/src/server/settings.ts`
  via `resolveAiConfiguration()`. Feature routes never receive a key, model
  ID, or provider ID from the client and never read raw `process.env` values.
- Every AI execution returns **redacted** `AiExecutionMeta` to the server
  caller: feature ID, provider, model ID, prompt version, duration, finish
  reason, input/output tokens, and retry count. Prompt text, response text,
  and the resolved key never appear in metadata.
- `AI_FEATURE_POLICIES` fixes the per-feature `maxOutputTokens`,
  `maxRetries`, and optional `timeoutMs`. `statementImport` is
  `maxRetries: 0` and time-bounded at 120 seconds; `reflection` is
  bounded for `maxOutputTokens`; `askJournalAgent` is time-bounded and
  additionally fixes four model steps and four tool calls. The closed
  `AiFeature` union prevents unreviewed features from inheriting unsafe defaults.
- Ask Journal runs one provider-neutral, read-only tool loop over the immutable
  route-created account/filter/timezone scope. It starts with the aggregate
  context, then can request that same summary, up to five scoped trade summaries,
  or one verified scoped trade with up to fifty fills. Tool inputs cannot choose
  accounts, filters, dates, timezone, provider, model, or settings.
- Errors are normalized to `AiRuntimeError` with safe, user-facing
  categories (`missing_key`, `authentication`, `billing`, `rate_limited`,
  `model_unavailable`, `timeout`, `provider`). Raw provider response text
  never reaches the client.
- Prompt construction lives in `apps/web/src/server/ai-prompts.ts` with
  explicit `AI_PROMPT_VERSIONS` per feature. Route handlers stay thin and
  contain no embedded prompt text.
- The import request body is now `{ ai: true }` only; the import
  preview/commit endpoints resolve credentials on the server and the
  commit step never calls a model.
- Privacy boundary (the account/filter rules below) is unchanged. The
  foundation adds a server-only execution boundary **on top of** that
  privacy boundary; it does not relax it.

## Future assistant/UI architecture (not in this foundation)

The contextual assistant, scoped sessions, draft cards, and side-sheet UI
described in
`docs/superpowers/specs/2026-10-08-contextual-ai-workspace-design.md`
remain intentionally out of scope. They will land in a later plan and must
re-validate the foundation checklist rather than assume any of it.

## Account and filter scope (privacy boundary)

- All accounts remains the default when no account filter is selected. An explicitly malformed or unknown account selection is rejected; it never falls back to all accounts.
- No matching trades produces a data-specific message without a provider call. A daily recap also requires closed trades on the requested local calendar day.
- Context includes the scope and per-account totals with account names and currencies. Mixed-currency sums are explicitly described as unconverted.
- Answers are labeled with their scope. Changing filters clears the answer and invalidates pending responses, including a switch away from and back to the same account. Leaving a page also invalidates pending responses.
- A daily note is still shared by date across accounts. Recaps for an account or other trade subset do not include that shared note in the provider context. An all-account, otherwise unfiltered day recap can still use the note. Date range filters alone do not narrow that day's trades further.
- A completed recap appends a labeled section to the latest draft, preserving edits made during generation. A response from an obsolete scope cannot append or save a recap.
- Single-trade critique continues to use the trade key and is unchanged.

## API contract

Both routes require a `filters` object using the journal's `AnalysisFilters` string fields; `{}` explicitly requests all trades. Ask also requires `question`, and recap requires a valid `date` in `YYYY-MM-DD` format. The UI sends `timeZone`; a mismatch with the server setting requires a page refresh. The routes reject unknown request fields, invalid filters, reversed ranges and missing account IDs.

Successful responses retain `answer` or `recap` and add `scope: { label, timeZone }`. The display label masks monetary filter amounts, consistent with private filter descriptions. The provider receives the actual numeric filters and matching aggregates.

## Verification without an AI connection

Run `pnpm test apps/web/tests/ai-ask-agent.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-runtime.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-feedback.test.ts`.

The route and Ask-agent tests use an isolated SQLite database. They prove that
every tool read remains inside the selected account/date/filter scope, unsupported
arguments expose no journal data, fabricated or excluded keys cannot reveal a
trade, and tools do not write journal rows. Runtime tests verify the finite
step/tool-call policy and the single provider-neutral tool-loop invocation.

The React DOM tests use controlled delayed responses to exercise the actual Ask component and daily journal page. They verify outgoing filter snapshots, scope labels, account/date/timezone changes, returning to an earlier scope, obsolete errors, duplicate clicks, retries, unmounting and edits made while a recap is pending.

These checks verify data selection and UI behavior, not provider connectivity or generated prose quality. The normal local app still requires a configured AI provider to generate real answers. No mock-provider mode is included in the application. Existing shared-note writes from separate browser tabs remain last-write-wins; this change protects edits made in the active editor during generation.
