# AI-Native Trading Journal — Architecture Modernization Design

**Status:** Source-validated proposal; awaiting design and implementation-plan approval  
**Date:** 2026-10-22  
**Scope:** Application architecture modernization  
**Implementation owner:** Codex, working against the verified repository  
**Reference:** `docs/architecture-discovery/`

**Validation baseline:** HEAD `e45707b158d21f2e63439c20f25c550f51079b17`, inspected 2026-10-22.
The [Architecture Contract Review](2026-10-22-ai-native-journal-architecture-contract-review.md)
is the normative technical amendment to this design: it resolves transaction ownership,
trade identity, evidence quality, migration ordering, worker deployment, and provider policy.
Where this baseline leaves alternatives open, use the review's selected contracts.
The [implementation plan](../plans/2026-10-22-ai-native-journal-modernization.md)
implements those contracts in dependency order. No production implementation is approved yet.

**Execution amendment (2026-10-23):** A separate agent implements one assigned phase at a time
using the [phase guide](../plans/2026-10-23-ai-native-journal-phases.md). It defines mandatory
stop/report points and schema ownership. Add a versioned, checksummed migration runner as
Phase 02 before introducing intelligence tables; current automatic bootstrap upgrades do
not provide a durable migration history. The guide supersedes earlier migration numbering.

**Worktree execution (2026-10-24):** The [prompt sheet](../plans/2026-10-24-ai-native-journal-handoff-prompts.md)
records the user's selected Superpowers subagent workflow with Orca-managed feature/phase/task
worktrees and tested local phase merges. It changes execution mechanics, not domain contracts.

### Validation corrections

- Database work uses synchronous better-sqlite3/Drizzle callbacks. Awaited network work
  must finish before entering a write transaction. Pass the transaction explicitly.
- Existing migrations now live in `db/bootstrap.ts`, under an immediate transaction;
  older reports describing independent `db/index.ts` ALTER statements are stale.
- `rebuildAccount` currently reads before its own transaction; trade deletion and
  account transfer need wider atomic boundaries. Preserve existing nested rollback
  behavior while introducing explicit transaction ownership.
- Preserve the derived trade key. Add a separate immutable intelligence identity with
  revisions and tombstones; ambiguous rekeys must not inherit identity or annotations.
- cTrader's Local MCP path is the accepted ADR 0002 exception to broker-sdk routing.
  Synthetic entries need explicit evidence quality; numerical duration alone proves nothing.
- Keep `ai-runtime.ts` and its three provider adapters. Existing hosted-only statement
  import fallback is a compatibility exception, not permission for background provider fallback.
- A worker requires an explicit packaged entry point and supervisor. Next route imports
  and hot reload must not start it. Desktop process ownership and port discovery are
  prerequisites, not assumed working infrastructure.
- Milestones 1–3 form one release gate: durable trade change to deterministic observation,
  with no provider configured. Do not enable general AI execution before that gate passes.

---

## 1. Vision and Objective

Transform the existing trade journal from a primarily request-driven application with isolated AI features into a modular, event-driven, AI-native application.

The journal must be able to:

- Observe relevant domain activity without user-initiated AI requests.
- Detect changes and derive reliable observations.
- Maintain persistent, evidence-backed knowledge.
- Execute deterministic and AI-assisted capabilities.
- Support a modular registry for specialized skills.
- Persist long-running workflows independently of model invocations.
- Proactively surface relevant interactions through adaptive engagement policies.
- Support conversational and structured UI experiences through a common interaction architecture.
- Continue performing core trading operations when AI providers are unavailable.

The AI must exist as part of the application's operating architecture, not only as a chatbot or a collection of API calls made from screens.

**The architecture must remain methodology-agnostic.**

Trading psychology book content, book-specific skills, and book-derived workflows are excluded from this modernization. They will be integrated only after the infrastructure is operational and validated.

---

## 2. Existing System — Preserve and Extend

The application currently consists of:

- Next.js App Router, React, TypeScript.
- SQLite with `better-sqlite3` and Drizzle ORM.
- A pure trading domain engine in `packages/core`.
- Broker statement parsers in `packages/importers`.
- Execution-based trade reconstruction.
- Broker synchronization through the existing broker SDK and cTrader MCP implementation.
- A provider-neutral Vercel AI SDK runtime.
- OpenAI, Anthropic, and OpenAI-compatible provider support.
- AI tools, context builders, execution policies, and scope validation.
- A Tauri desktop wrapper with a Node server sidecar.
- Existing automated tests and CI gates.

### Preservation requirements

1. Preserve existing execution ingestion, broker synchronization, and financial calculations.
2. Preserve Pepperstone cTrader synchronization and its existing MCP integration.
3. Preserve all three supported AI provider categories.
4. Preserve existing account credentials and encrypted settings.
5. Preserve the existing AI import restriction to supported hosted providers unless a separately approved enhancement changes it.
6. Preserve existing AI routes and observable user behavior throughout migration.
7. Keep the trading calculation engine independent of intelligence runtime dependencies.
8. Retain SQLite and the existing self-hosted deployment model.
9. Avoid introducing externally hosted services as mandatory dependencies.
10. Ensure existing trading data remains intact during migrations.

Architecture changes must be incremental and verified through tests.

---

## 3. Architectural Principles

### P1 — Domain-first

The trading domain remains authoritative for executions, trade projections, calculations, and annotations.

AI-generated claims must not overwrite trading facts.

### P2 — AI is an optional execution capability

Deterministic application behavior cannot require a configured or functioning LLM.

### P3 — Durable state belongs to the application

Jobs, workflows, observations, and interaction opportunities must remain valid across model invocations, browser sessions, application restarts, and provider changes.

### P4 — Events describe changes, not implementation instructions

A domain event describes a committed state change.

An instruction to run a particular skill or model is a command or scheduled job.

### P5 — Evidence precedes interpretation

Observable facts, derived observations, user statements, hypotheses, and conclusions must be distinguishable.

### P6 — Every execution has bounded authority

Capabilities and tools are executed within validated data scopes, permissions, and resource budgets.

### P7 — Interactive experiences are presentation-independent

The intelligence subsystem must not depend on chat, React components, or `json-render`.

### P8 — Prefer simple internal modules over distributed systems

Build a modular monolith with explicit boundaries. Introduce additional services only when operational requirements justify them.

### P9 — Delivery is at least once; effects are idempotent

Do not assume exactly-once processing from a queue or event bus.

### P10 — Existing behavior remains compatible

Each migration milestone must preserve current application functionality or explicitly document an approved breaking change.

---

## 4. High-Level Architecture

```
┌────────────────────────────────────────────────┐
│ Existing Trading Journal                       │
│ Executions / Trades / Accounts / Playbooks      │
│ Broker Sync / Imports / Analytics / Notes       │
└──────────────────────┬─────────────────────────┘
                       │
              Validated domain changes
                       │
┌──────────────────────▼─────────────────────────┐
│ INTELLIGENCE INFRASTRUCTURE                    │
│ Domain events / Outbox / Jobs / Scheduler       │
│ Worker supervision / Execution identity        │
└──────────────────────┬─────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────┐
│ INTELLIGENCE KNOWLEDGE                         │
│ Evidence / Observations / Patterns             │
│ Hypotheses / Provenance / Revisions            │
└──────────────────────┬─────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────┐
│ INTELLIGENCE RUNTIME                           │
│ Dispatcher / Capabilities / Skills             │
│ Tools / Agents / AI Provider Gateway           │
└──────────────────────┬─────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────┐
│ INTELLIGENCE EXPERIENCE                        │
│ Workflows / Opportunities / Engagement         │
│ Conversations / Interaction Commands           │
└──────────────────────┬─────────────────────────┘
                       │
              Interaction contracts
                       │
┌──────────────────────▼─────────────────────────┐
│ PRESENTATION                                   │
│ Chat / Insight Inbox / Contextual UI           │
│ Native Components / Future Generative UI       │
└────────────────────────────────────────────────┘
```

This diagram describes a conceptual processing flow, not permitted compile-time imports. Module dependency rules are defined separately below.

---

## 5. Module Ownership and Dependency Contracts

The architecture is divided into four major logical modules.

### 5.1 Intelligence Infrastructure

**Owns:**

- Event envelopes and durable event publication.
- Transactional outbox persistence.
- Event delivery tracking.
- Durable job scheduling and execution.
- Worker claiming, leases, retries, cancellation, and recovery.
- Task correlation and execution metadata.
- Application scheduling primitives.

**Does not own:**

- Trading calculations.
- Interpretation of behavioral patterns.
- AI prompts or model decisions.
- Conversation content.
- Presentation components.

### 5.2 Intelligence Knowledge

**Owns:**

- Observations.
- Evidence references and provenance.
- Hypotheses and their lifecycle.
- Pattern definitions and evaluations.
- Revision and invalidation handling.
- Current knowledge projections.
- Knowledge retention and correction rules.

**Does not own:**

- AI provider initialization.
- Event transport implementation.
- UI rendering.
- Direct modifications to source trading records.

### 5.3 Intelligence Runtime

**Owns:**

- Capability registration and discovery.
- Capability selection and eligibility.
- Skill registration and activation.
- Agent execution profiles.
- Prompt and instruction composition.
- Tool registration and controlled execution.
- Model capability resolution.
- Provider-neutral AI execution.
- Execution budgets and typed outcomes.

**Does not own:**

- Long-running workflow persistence.
- Authoritative trading writes.
- User-facing presentation.
- Event delivery infrastructure.

### 5.4 Intelligence Experience

**Owns:**

- Durable workflow definitions and instances.
- Workflow transitions.
- Conversations and messages.
- Intelligence opportunities.
- Adaptive engagement decisions.
- Interaction state and action dispatch.
- Presentation-independent interaction intents.

**Does not own:**

- Trading calculations.
- Provider-specific model requests.
- Database migration infrastructure.
- Arbitrary React component generation.

### 5.5 Dependency rules

All modules may depend on a small, stable set of shared contracts.

Concrete dependencies should be introduced through composition rather than circular imports.

**Required direction:**

```
Shared Contracts
    ↑
    ├── Infrastructure implementations
    ├── Knowledge domain
    ├── Runtime domain
    └── Experience domain

Application Composition Root
    ├── wires infrastructure
    ├── wires knowledge
    ├── wires runtime
    └── wires experience
```

Cross-module communication uses:

- Typed commands for explicit operations.
- Domain events for committed changes.
- Read-only interfaces for querying shared information.
- Typed outcomes for capability results.
- Application service interfaces for authorized mutations.

No module should import another module's private repository, provider adapter, or UI implementation.

For implementation simplicity, modules may initially reside within `apps/web/src/server/intelligence/`.

Do not introduce new publishable workspace packages without reviewing the existing monorepo publication workflow.

---

## 6. Domain Event Contract

### 6.1 Event envelope

Proposed TypeScript interface:

```
interface DomainEvent<TPayload> {
  id: string;
  type: string;
  schemaVersion: number;

  aggregate: {
    type: string;
    id: string;
    revision?: string;
  };

  correlationId: string;
  causationId?: string;

  origin:
    | "user"
    | "broker_sync"
    | "import"
    | "system"
    | "workflow";

  occurredAt?: string;
  recordedAt: string;

  payload: TPayload;
}
```

All concrete event types must use validated schemas and a discriminated union.

Payloads must be bounded, serializable, and free of credentials or unnecessary sensitive data.

Event consumers must not interpret arbitrary event payload properties as execution permissions.

### 6.2 Event publication invariants

- Domain events must represent meaningful changes.
- Events must not be published for unchanged trade projections.
- Event persistence must be committed atomically with the relevant authoritative mutation.
- A failed transaction must not produce a deliverable event.
- A committed event must remain processable after a crash.
- Handlers must tolerate duplicate delivery.
- Event schemas must be versioned.
- External network calls must never occur inside SQLite write transactions.

### 6.3 Transactional outbox

Introduce durable outbox storage for committed domain changes.

Required operational capabilities:

- Pending event discovery.
- Safe concurrent claiming or dispatch coordination.
- Handler-specific delivery tracking.
- Retries and terminal failure handling.
- Idempotent scheduling of consumer jobs.
- Correlation and causation propagation.
- Controlled retention and diagnostics.

The implementation may use an outbox table plus a separate delivery table, or an equivalent normalized design.

The exact schema must be justified in the implementation plan.

### 6.4 Event processing guarantees

The system guarantees at-least-once delivery, not exactly-once delivery.

Consumer effects must be idempotent at the data layer.

Re-delivering an event cannot produce duplicate observations, duplicate workflows, or repeated engagement opportunities.

---

## 7. Trade Reconciliation Contract

The existing execution-based reconstruction engine remains authoritative.

Introduce a transaction-aware trade reconciliation boundary.

### 7.1 Responsibilities

The reconciliation service must:

1. Accept validated execution changes from supported sources.
2. Reuse the existing round-trip reconstruction engine.
3. Compare prior persisted projections with reconstructed projections.
4. Identify meaningful changes.
5. Persist updated projections.
6. Persist relevant domain events in the same transaction.
7. Return an operation summary to the caller.

### 7.2 Change categories

```
type TradeChangeKind =
  | "discovered"
  | "opened"
  | "closed"
  | "revised"
  | "removed";
```

Additional classifications may be introduced when supported by clear semantics.

`discovered` means the journal encountered an existing trade for the first time.

`closed` means the journal has evidence of a previously observed open trade becoming closed.

Historical discovery must not be automatically treated as a real-time closure.

### 7.3 Stable intelligence references

The system requires stable references for observations, workflows, and evidence.

Investigate introducing an internal immutable trade identity that maps to the existing derived trade key.

The existing trade key must not be replaced casually.

Identity mapping must consider:

- Execution membership.
- Prior projection identity.
- Trade key changes.
- Historical reconstruction.
- Source corrections.
- Ambiguous matches.

Do not silently infer a one-to-one identity mapping where the evidence is insufficient.

An unresolved mapping must remain explicit.

### 7.4 Data-quality requirements

Each intelligence evaluator must distinguish direct observations, reconstructed values, estimates, and unknown information.

In particular, synthetic cTrader entries or unavailable opening timestamps must not be interpreted as reliable evidence of holding duration.

Existing broker synchronization should remain independent of the new intelligence runtime.

---

## 8. Durable Job and Scheduler Contracts

### 8.1 Job responsibilities

A durable job executes a bounded unit of work.

Required attributes include:

- Stable job identifier.
- Job type and payload schema version.
- Idempotency key.
- Originating event or workflow reference.
- Execution status.
- Scheduling eligibility time.
- Attempt count.
- Claim ownership and lease expiry.
- Cancellation state.
- Sanitized failure metadata.
- Creation and update timestamps.

### 8.2 Required job states

```
type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "retry_wait"
  | "failed"
  | "cancelled";
```

Waiting-for-user is a workflow state, not a running worker job.

### 8.3 Worker invariants

- Job claims must be atomic.
- Expired claims must be recoverable.
- Job processing must tolerate restarts.
- A job must not remain permanently locked after a crash.
- The worker must not hold database transactions open during AI calls.
- Completed effects must be committed before the job is acknowledged.
- Long-running jobs must support bounded cancellation or lease renewal.
- Duplicate execution must not duplicate business effects.
- Unrecoverable failures must remain inspectable.
- Jobs must honor execution and resource policies.

### 8.4 Scheduler

Support three scheduling sources:

1. Event-triggered execution.
2. Time-triggered execution.
3. Condition-triggered execution.

The scheduler translates eligible work into durable jobs.

It does not need to invoke an AI model merely to evaluate whether a scheduled operation is due.

### 8.5 Deployment

Initially support a single supervised worker instance.

Worker lifecycle must operate in:

- Standalone Node deployments.
- Docker deployments.
- Tauri desktop deployments.

Do not start workers implicitly when importing a route or server module.

Worker startup and shutdown must be explicit, observable, and safe during hot reload, process restart, or desktop shutdown.

---

## 9. Observation and Knowledge Contracts

### 9.1 Entity distinctions

**Fact:** A source-backed state or event.

**Observation:** A finding derived from reliable evidence.

**Self-report:** A user's statement about their experience or decisions.

**Hypothesis:** A tentative interpretation requiring investigation.

**Pattern:** An evaluated relationship supported by multiple observations or other evidence.

These categories must not be collapsed into a single unstructured memory field.

### 9.2 Observation contract

```
interface Observation<TData> {
  id: string;
  type: string;
  schemaVersion: number;

  subject: {
    type: string;
    id: string;
  };

  origin:
    | "measured"
    | "derived"
    | "self_reported";

  data: TData;

  evidenceIds: string[];

  evaluator?: {
    id: string;
    version: string;
  };

  status:
    | "active"
    | "superseded"
    | "invalidated";

  observedAt: string;
  recordedAt: string;
}
```

The final implementation must use registered, validated payload schemas rather than unrestricted `unknown` data throughout the application.

### 9.3 Knowledge invariants

- Observations must be traceable to sources.
- Derived observations must record evaluator identity and version.
- An observation cannot have stronger certainty than its evidence supports.
- Tentative AI interpretations must not become confirmed facts automatically.
- Invalidated source evidence must trigger appropriate re-evaluation.
- User corrections must update active interpretations.
- Superseded observations must not be returned as current truth.
- Retention and deletion must be supported.
- Pattern evaluation must support insufficient-evidence outcomes.

### 9.4 Memory

Persistent trader memory should be represented by structured knowledge records and derived current-state projections.

Do not use raw chat history as the authoritative behavioral memory store.

Conversations may supply evidence, but evidence-backed knowledge must have its own lifecycle.

---

## 10. Capability and Skill Runtime Contracts

### 10.1 Capability definition

```
interface CapabilityDefinition<TInput, TResult> {
  id: string;
  version: string;

  triggers: string[];

  mode:
    | "deterministic"
    | "ai-assisted";

  evaluate(
    context: CapabilityEvaluationContext
  ): Promise<EligibilityResult>;

  execute(
    input: TInput,
    context: CapabilityExecutionContext
  ): Promise<TResult>;
}
```

Capabilities must be registered explicitly.

The dispatcher selects eligible capabilities using deterministic rules by default.

Do not run an LLM merely to select a handler for every event.

### 10.2 Skill contract

A skill is a specialized capability with additional procedural and knowledge dependencies.

The architecture must support:

- Registration.
- Stable identifiers.
- Versioning.
- Eligibility conditions.
- Declarative dependencies.
- Selective instruction loading.
- Scoped tools.
- Typed inputs and outputs.
- Independent testing.
- Execution-policy enforcement.

Arbitrary runtime execution of untrusted third-party skill code is out of scope.

### 10.3 Execution context

Each operation must carry:

- Execution identifier.
- Correlation identifier.
- Trusted principal.
- Trigger source.
- Authorized data scope.
- Permitted capabilities and tools.
- Resource budgets.
- Cancellation signal.

Interactive and background invocations may derive authorization differently, but both must pass through the same execution policy enforcement.

---

## 11. Tool Gateway Contract

Separate tool registration from model-specific exposure.

### Required responsibilities

**Tool Registry:** Discovers available operations and their contracts.

**Tool Gateway:** Validates inputs, scope, permissions, budgets, and outputs.

**Tool Adapter:** Presents approved operations to the AI SDK.

**Domain Service:** Performs the authorized business operation.

### Tool access categories

```
type ToolAccess =
  | "read"
  | "propose"
  | "write";
```

Automatic AI-driven writes must be limited to explicitly authorized derived or operational data.

Authoritative trading mutations must use validated application commands and appropriate user approval.

The system must not give models unrestricted SQL, arbitrary HTTP access, or direct broker credentials.

Existing cTrader MCP synchronization must remain a broker integration, not become automatically exposed as an AI tool.

---

## 12. Model Execution Contract

Preserve the existing provider-neutral AI runtime.

Support:

- OpenAI.
- Anthropic.
- OpenAI-compatible endpoints.

The runtime must accommodate differences in:

- Tool calling.
- Structured output.
- Streaming.
- Document and image inputs.
- Context limits.
- Model availability.

Required capabilities must be validated or explicitly configured.

Do not assume that all OpenAI-compatible servers support identical features.

Do not silently switch private data from a local model to a hosted provider.

Maintain the existing hosted-provider policy for statement imports unless a separately approved feature changes it.

### AI execution limits

Continue supporting:

- Step and tool-call budgets.
- Timeouts and cancellation.
- Output token limits.
- Retry policies.
- Sanitized errors.
- Execution metadata.

Extend this with controlled background-execution budgets and persisted minimal diagnostics.

Do not persist API keys, broker credentials, or raw sensitive prompts in operational logs.

---

## 13. Workflow Contract

A workflow is a persistent, versioned state machine.

It owns long-lived business process state, not an AI model or a worker.

### Proposed state

```
type WorkflowStatus =
  | "running"
  | "waiting_for_user"
  | "scheduled"
  | "completed"
  | "cancelled"
  | "failed";
```

### Required behavior

- Persist current state.
- Persist definition version.
- Validate transitions.
- Record transition history.
- Support optimistic concurrency.
- Reject duplicate commands.
- Schedule effects durably.
- Support pause and resume.
- Recover after restart.
- Never require an AI process to remain active while waiting for user input.

Workflow transitions should be deterministic.

External effects execute separately through the durable job infrastructure.

---

## 14. Adaptive Engagement Contract

The application uses adaptive engagement.

Engagement must be governed by a central policy engine.

### Outcomes

```
type EngagementAction =
  | "observe"
  | "inbox"
  | "contextual"
  | "proactive"
  | "defer"
  | "suppress";
```

### Policy inputs

- Evidence quality.
- User preferences.
- Relevance.
- Novelty.
- Actionability.
- Active workflows.
- Prior dismissals.
- Timing.
- Current trading activity, when reliably known.
- Interruption limits.
- AI execution budgets.

Engagement cannot depend solely on an LLM deciding when to speak.

### Intelligence Opportunity

An opportunity represents a potential interaction.

It exists independently of a workflow or conversation.

Required properties include:

- Identity and source reference.
- Opportunity type.
- Deduplication key.
- Priority.
- Eligibility time.
- Expiration policy.
- Delivery state.
- Interaction history.

Multiple capabilities must not independently flood the user with overlapping opportunities.

The engagement coordinator owns consolidation, cooldowns, and presentation priority.

---

## 15. Conversation and Interaction Contracts

A conversation is independent of a workflow.

A workflow may be linked to one or more conversations.

An interaction opportunity may exist before any conversation begins.

### Interaction intents

The intelligence backend should create structured interaction intents describing:

- Interaction type.
- Relevant content.
- Current workflow or opportunity reference.
- Available authorized actions.
- Presentation constraints.
- Required user inputs.

The frontend decides how to render these intents.

Initially, this may be implemented through native React components.

Future generative UI integration may use `json-render`, but it must remain an optional presentation adapter.

Generated components cannot bypass server-side command validation.

---

## 16. Security and Privacy Constraints

- Preserve the current single-user model.
- Do not introduce multi-tenancy without separate requirements.
- Authenticate interactive requests using the application's existing security boundary.
- Use trusted system principals for background work.
- Reauthorize scope and permissions when jobs execute.
- Protect credentials and provider settings.
- Avoid sensitive event payloads and unnecessary data replication.
- Keep provider routing explicit.
- Maintain the application's local-first/self-hosted expectations.
- Introduce user controls for background AI execution.
- Support inspection, correction, and deletion of persistent intelligence.
- Review CSRF/origin handling and user-controlled external endpoints before enabling new write-capable automation.

Background execution is not permission to bypass application authorization.

---

## 17. Migration Strategy

Implementation must be incremental.

### Milestone 0 — Preparation

- Verify repository state and architecture discovery against current HEAD.
- Resolve discrepancies between earlier reports and upstream additions.
- Establish architecture tests and compatibility baselines.
- Confirm existing CI and build behavior.
- Select a safe, versioned database migration approach.

### Milestone 1 — Infrastructure

- Introduce shared contracts.
- Implement the durable event/outbox infrastructure.
- Implement the job queue and worker lifecycle.
- Add tests for recovery, idempotency, and transaction atomicity.

### Milestone 2 — Trading Integration

- Introduce transaction-aware reconciliation.
- Integrate meaningful domain event generation.
- Preserve all existing import and broker sync pathways.
- Handle backfills and unchanged re-syncs correctly.

### Milestone 3 — Knowledge

- Introduce evidence and observation storage.
- Add a minimal deterministic observation capability.
- Support revision and invalidation.
- Validate the first end-to-end vertical slice.

### Milestone 4 — Intelligence Runtime

- Introduce the capability registry and dispatcher.
- Generalize existing AI tools behind a gateway.
- Implement reusable execution contexts.
- Preserve existing AI routes and response contracts.
- Add model capability policies and execution diagnostics.

### Milestone 5 — Experience Infrastructure

- Introduce durable workflows.
- Introduce intelligence opportunities and engagement policy.
- Introduce interaction contracts and persistent user interaction state.
- Validate the second end-to-end vertical slice.

### Milestone 6 — Integration and Hardening

- Complete crash recovery and migration tests.
- Validate Tauri and Docker worker behavior.
- Benchmark database and worker contention.
- Review security, privacy, and provider routing.
- Add operational documentation and rollback guidance.

Do not integrate book-derived methodology in any of these milestones.

---

## 18. Acceptance Scenarios

### Vertical Slice A — Reliable Domain Intelligence

```
Trade changed
  → Reconciliation
  → Durable domain event
  → Worker processing
  → Deterministic observation
  → Persistent evidence
```

This must work with no AI provider configured.

Required test cases:

- Repeated identical broker synchronization.
- Historical import.
- Newly closed trade.
- Corrected execution.
- Unavailable opening-time evidence.
- Database transaction failure.
- Crash after event persistence.
- Duplicate event delivery.
- Interrupted worker execution.
- Reconciliation and identity ambiguity.

### Vertical Slice B — Intelligent Interaction

```
Persisted observation
  → Capability selection
  → Optional AI reasoning
  → Intelligence opportunity
  → Engagement decision
  → User interaction
  → Persisted workflow/knowledge update
```

Required test cases:

- No configured AI provider.
- Unsupported model capability.
- Provider timeout.
- Duplicate generated outcome.
- Dismissed insight.
- Deferred engagement.
- User correction.
- Interrupted workflow.
- Stale or duplicate UI action.
- Application restart before workflow continuation.

### Compatibility acceptance

Existing journal features must continue to pass their tests, including:

- Trading calculations.
- Manual entry.
- Broker imports.
- cTrader MCP account synchronization.
- Financial analytics.
- Playbook operations.
- Existing AI Ask, Reports, Recap, Critique, and Import workflows.
- Provider and credential settings.
- Tauri packaging.
- Docker build.

---

## 19. Explicitly Out of Scope

Do not implement:

- Book-specific trading psychology methodology.
- Book-derived diagnostic rules.
- Specialized coaching workflows.
- Arbitrary third-party executable plugins.
- Multi-tenant account infrastructure.
- Distributed microservices.
- Mandatory Redis or cloud queues.
- A vector database.
- Full event sourcing.
- Live trading automation.
- AI-generated trade execution.
- Unrestricted agent autonomy.
- Full `json-render` feature integration before the presentation contract is stable.

The architecture must permit future extensions without implementing them prematurely.

---

## 20. Design Questions for Codex to Validate

The following require repository-backed technical decisions during planning:

1. Exact transaction boundaries for rebuilding and persisting trade projections.
2. Performance of large account rebuilds under SQLite transactions.
3. Stable trade identity mapping and handling ambiguous reconciliation.
4. Exact event delivery and durable job schema.
5. Database migration tooling and compatibility with existing data.
6. Worker process supervision for Docker and Tauri.
7. Backward compatibility for existing AI request/response contracts.
8. Tool and capability registration design.
9. Model feature detection and explicit capability configuration.
10. Data retention, backup, and recovery behavior for intelligence records.

Codex must document each decision and its trade-offs.

Do not invent certainty where the repository or tests do not provide evidence.

---

## 21. Definition of Architectural Completion

The modernization is complete when:

1. The journal can react to meaningful domain changes without originating from an AI screen.
2. Events, jobs, and workflow state survive process restarts.
3. Duplicate activity does not create duplicate intelligence.
4. Observations have explicit sources, provenance, and revision behavior.
5. Capabilities can run independently of chat components.
6. AI tools share application authorization and domain operations.
7. A configured LLM is optional for the deterministic intelligence pipeline.
8. Persistent workflows can pause and resume.
9. The journal can create and present relevant intelligence opportunities using controlled adaptive engagement.
10. Existing application functionality, tests, and deployment targets remain operational.

**The deliverable is an extensible AI-native journal architecture—not an implementation of any particular coaching methodology.**
