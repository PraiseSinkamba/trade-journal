# Contextual AI Workspace Assistant

**Status:** Draft for user review

## Goal
Make AI a native, conversational assistant within Trade Journal workspaces while preserving explicit user control over every persisted change.

## Product boundary
The assistant works with every supported account and journal workflow: personal accounts, funded/evaluation accounts, broker-connected accounts, imported history, and manually entered data. It is not a prop-firm-only feature.

The assistant may reason over authorized journal context and prepare typed drafts. It does not persist financial or journal data directly. Existing validated forms and APIs remain the only mutation path.

## Selected surface
Use the **focused side-sheet** interaction from `.planning/sketches/001-contextual-ai-assistant/index.html` variant B.

- The workspace remains primary.
- A contextual trigger opens the assistant over the current page rather than navigating to a separate AI product.
- The sheet can support a real multi-turn conversation without permanently consuming workspace width.
- A compact global **Recent AI work** entry point resumes active drafts and previous scoped threads. It is not unrestricted global chat.

## Conversation scope
A conversation begins with explicit, server-derived context from the workspace currently being viewed.

Example header:

> Viewing: ES long · 8 Oct 2026  
> Context: trade record · executions · journal note

The assistant shows supplemental attached context as removable chips. The server-owned primary workspace record remains the thread's minimum validated scope; it cannot be removed from the thread.

### Portable, scoped sessions

- Navigation to a related record—such as a trade's journal note or linked playbook—can retain the conversation after announcing the added context.
- Navigation to an unrelated trade, notebook, account, or workspace starts a separate thread.
- The prior thread and all unsaved drafts remain resumable through Recent AI work.
- Any draft stays attached to the entity it changes. A conversation that spans a trade and a note produces separate review cards.
- Removing every supplemental chip returns the conversation to its primary record. To remove that record, the user ends the thread or explicitly starts a new one; no scope-less or all-accounts fallback exists.

## Interaction model

### Conversation
Users describe intent naturally:

- “Add the scaling entry I missed.”
- “Turn this into a missed-trade record.”
- “Make this journal note clearer.”
- “Create a playbook from these notes.”

The assistant uses existing attached facts before asking questions. It asks focused follow-ups only for missing or ambiguous values and distinguishes confirmed, inferred, and unknown values.

### Action cards
The assistant produces typed, visible draft cards instead of relying on prose alone:

- trade-create or trade-edit draft;
- missed-trade draft;
- journal note refinement;
- notebook draft or revision;
- playbook proposal or edit.

Every card has:

- a clear **Not saved** state;
- field-level proposed values and change summary;
- validation warnings and unresolved fields;
- source or confidence metadata where a value was inferred or extracted;
- **Refine**, **Discard**, and a destination-specific review action.

### Review and persistence
AI does not become a second form system. A review action such as **Review in trade form**, **Open in notebook**, or **Review playbook** opens the existing editing surface with the typed draft prefilled. The user may correct, reject, or submit it there. Existing validation, authorization, and persistence behavior applies unchanged.

## AI capability boundary
The assistant receives application capabilities through typed, permission-scoped server interfaces—not prose descriptions of database behavior and not raw database access.

Initial read-only capabilities should map to existing domain/query behavior:

- get current workspace identity and validated scope;
- get a selected trade with ordered executions;
- get bounded journal summaries, metrics, tags, and notes;
- get related notebook/playbook metadata;
- find permitted related records within the active scope.

Draft-generation capability is not persistence. It creates typed proposal objects only. The browser cannot grant the agent wider account or record access; server-side scope validation remains authoritative.

## Execution model

- Feature routes remain thin adapters: validate input, establish trusted context, invoke the AI feature interface, return typed conversation/draft results.
- A provider-neutral runtime resolves the selected model and encrypted BYO key, applies feature policy, normalizes errors, and records redacted operational events.
- Provider-specific options remain in the OpenAI/Anthropic adapter boundary.
- Agent execution is reserved for workflows requiring dynamic, bounded read-only capability use. Fixed-context recap, trade critique, and structured statement parsing stay direct model calls.
- Draft creation remains deterministic around the agent: structured output validation occurs before a card appears.

## Safety and privacy

- No direct write tool.
- No unbounded journal search or account scope chosen by the model.
- No provider key reaches the browser, prompt log, draft, or trace.
- No telemetry endpoint or external journal analytics service.
- Assistant-rendered money, execution values, fees, draft fields, and generated prose honor the existing journal privacy setting; privacy mode never creates a new disclosure path.
- Local operational events, if introduced, are redacted and retain feature ID, provider/model, prompt/agent version, duration, usage, retry count, finish reason, and tool/step count—not prompt or response content.
- Import remains its existing extraction → validation → human review → commit workflow; it is not converted into an autonomous agent.

## Failure UX

- Missing context: the assistant asks a precise follow-up.
- Invalid proposed value: the draft card highlights the field and explains the applicable domain rule.
- Provider/runtime failure: preserve user input and the current draft, show a safe error, and allow retry.
- Context switch: announce the scope transition and preserve the prior thread and drafts.

## Testing

The design must be testable without a live model.

- Capability tests prove scope and account isolation.
- Runtime tests prove provider/model selection, timeout/retry policy, error normalization, and redaction.
- Structured-draft tests prove validation, unknown/inferred-field handling, and no persistence on draft generation.
- Route tests prove the current API contract remains stable during migration.
- Browser tests prove the sheet exposes context, retains/reports context transitions, distinguishes unsaved drafts, deep-links into existing editors, and preserves a failed request's input.

## Non-goals

- A global unrestricted chat agent.
- Autonomous writes, background edits, or implicit save.
- A separate AI-only form/editor system.
- A multi-agent hierarchy, delegation framework, market-data/research agent, or broker-execution agent.
- Replacing all current direct model calls with agents.

## Incremental adoption

1. Add provider-neutral execution and typed feature interfaces without changing existing routes or prompt behavior.
2. Extract server-validated read-only context capabilities from current routes.
3. Build the B side-sheet shell and typed draft-card contract for one low-risk refinement flow.
4. Hand off drafts to the existing editor; verify no draft persists without normal submission.
5. Expand to trade creation/editing, journaling, notebooks, playbooks, and missed trades one workflow at a time.
6. Consolidate legacy prompt assembly only after equivalent contracts and regression coverage exist.
