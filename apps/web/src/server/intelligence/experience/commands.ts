import { z } from "zod";
import {
  interactionCommandRequestSchema,
  parseInteractionActionId,
} from "@/lib/intelligence-interactions";
import type { ExecutionContext } from "../contracts/execution";
import {
  workflowCommandSchema,
  type ExperienceStore,
  type RunInTransaction,
  type WorkflowResult,
} from "../contracts/experience";
import type { WorkflowEngine } from "./workflows";

/**
 * The command service (Phase 18).
 *
 * One command, resolved in a fixed order: the request is parsed, the action
 * id is resolved, the scope is resolved, the workflow is loaded, the revision
 * is checked, the scope is checked against the workflow, and only then does
 * the engine run. Every decision happens before the engine opens its
 * transaction, so a refused command writes nothing at all.
 *
 * The action id is a handle, not a permission: it names the workflow and the
 * action, and the service resolves it against the stored state before it
 * acts.
 */

/** What the service answers. */
export type CommandOutcome =
  | { readonly status: 200; readonly result: WorkflowResult }
  | { readonly status: 400; readonly error: "invalid_request" }
  | { readonly status: 403; readonly error: "scope_denied" }
  | { readonly status: 409; readonly error: "stale_revision"; readonly currentRevision: number };

/** The command service's dependencies. */
export interface CommandServiceDeps {
  /** The workflow engine the command is applied through. */
  readonly engine: WorkflowEngine;
  /** The experience store the workflow and the command ledger are read from. */
  readonly store: ExperienceStore;
  /** The transaction seam: the service opens no connection of its own. */
  readonly runInTransaction: RunInTransaction;
  /** The account ids that still exist in the journal. */
  readonly accountIds: () => readonly string[];
  /** The interactive execution context one command runs under. */
  readonly context: (accountIds: readonly string[]) => ExecutionContext;
}

/**
 * Creates the command service.
 */
export const createCommandService = (deps: CommandServiceDeps) => ({
  /**
   * Applies one command.
   */
  apply(body: unknown): CommandOutcome {
    // 1. Parse the request.
    const parsed = interactionCommandRequestSchema.safeParse(body);
    if (!parsed.success) return { status: 400, error: "invalid_request" };
    const request = parsed.data;

    // 2. Resolve the action id. It must name a workflow action, and it must
    //    name the action the request asks for.
    const actionId = parseInteractionActionId(request.actionId);
    if (!actionId || actionId.kind !== "workflow" || actionId.action !== request.action) {
      return { status: 400, error: "invalid_request" };
    }

    // The action id carries the revision it was issued at. A request whose
    // action id and expected revision disagree asks for one action and
    // expects another: the request is inconsistent, not stale.
    if (actionId.revision !== request.expectedRevision) {
      return { status: 400, error: "invalid_request" };
    }

    // The engine's own command schema decides what a legal command is: a
    // correction without a correction, or a deferral without an instant, is
    // a client error.
    const command = workflowCommandSchema.safeParse({
      commandId: request.commandId,
      workflowId: actionId.workflowId,
      expectedRevision: request.expectedRevision,
      action: request.action,
      ...(request.correction === undefined ? {} : { correction: request.correction }),
      ...(request.deferUntil === undefined ? {} : { deferUntil: request.deferUntil }),
    });
    if (!command.success) return { status: 400, error: "invalid_request" };

    // 3. Resolve the scope. A named account that does not exist is a revoked
    //    scope; a request that names no account is about every account.
    const known = deps.accountIds();
    const named = request.scope;
    const scopeAccountIds = named === undefined ? [...known] : [...named];
    if (named !== undefined && named.some((id) => !known.includes(id))) {
      return { status: 403, error: "scope_denied" };
    }

    // 4. Load the workflow and the command ledger.
    const loaded = deps.runInTransaction((tx) => ({
      workflow: deps.store.loadWorkflow(tx, actionId.workflowId),
      recorded: deps.store.loadCommand(tx, request.commandId),
    }));
    const workflow = loaded.workflow;
    // A workflow that is gone — purged with its account — is a stale action.
    if (!workflow) return { status: 409, error: "stale_revision", currentRevision: 0 };

    // 5. Check the revision. A command that is already in the ledger is
    //    answered from the ledger, not from the revision: the retry of an
    //    applied command is a duplicate, not a stale action.
    if (!loaded.recorded && workflow.revision !== request.expectedRevision) {
      return { status: 409, error: "stale_revision", currentRevision: workflow.revision };
    }

    // 6. Check the scope against the workflow. A workflow with no account is
    //    journal-wide and always in scope.
    if (workflow.accountId !== null && !scopeAccountIds.includes(workflow.accountId)) {
      return { status: 403, error: "scope_denied" };
    }

    // 7. Apply.
    try {
      const result = deps.engine.transitionWorkflow(command.data, deps.context(scopeAccountIds));
      if (result.kind === "conflict") {
        return { status: 409, error: "stale_revision", currentRevision: result.currentRevision };
      }
      return { status: 200, result };
    } catch (error) {
      // The engine refuses an illegal command payload with a schema error:
      // that is a client error, never an internal failure.
      if (error instanceof z.ZodError) return { status: 400, error: "invalid_request" };
      throw error;
    }
  },
});
