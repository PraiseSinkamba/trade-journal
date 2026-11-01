import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * The background AI policy, the daily reservation and the provider adapter
 * (Phase 13).
 *
 * The cases are the phase's exit evidence: a changed endpoint refuses the run
 * without any provider request, a cancelled run stops the request, the daily
 * allowance is taken atomically and survives a crash, and the provider keeps
 * its existing behaviour.
 */

// The journal opens its data directory when the module loads, so the scratch
// directory has to exist before the database module is imported.
const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-background-policy-"));
process.env.JOURNAL_DATA_DIR = scratch;

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { db, accounts, settings, intelligencePolicy, intelligenceRuns } = await import(
  "../src/db"
);
const { intelligenceBudgetReservations } = await import("../src/db/schema");
const { setSetting } = await import("../src/server/settings");
const { withJournalTransaction } = await import("../src/db/transaction");
const {
  authorizeBackgroundRun,
  enqueueBackgroundRun,
  executeBackgroundRun,
  getBackgroundPolicy,
  reserveBackgroundAttempt,
  saveBackgroundPolicy,
} = await import("../src/server/intelligence/composition");
const { BACKGROUND_DAILY_ATTEMPT_LIMIT } = await import(
  "../src/server/intelligence/contracts/policy"
);
const { runBackgroundAi } = await import("../src/server/ai-runtime");
// The route loads the journal, so it is imported after the scratch directory
// is in place.
const { GET, PATCH } = await import("../src/app/api/settings/route");

const NOW = Date.UTC(2026, 2, 14, 9, 0, 0);
const SERVER = "http://localhost:11434/v1";

const completion = (content: string) =>
  Response.json({
    id: "chatcmpl_background",
    object: "chat.completion",
    created: 1,
    model: "llama-fixture",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });

const hostedResponse = (text: string) =>
  Response.json({
    id: "resp_background",
    object: "response",
    created_at: 1,
    model: "gpt-6-luna",
    status: "completed",
    output: [
      {
        type: "message",
        id: "msg_background",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
  });

const scope = {
  accountIds: ["acct-1"],
  filters: {},
  timeZone: "UTC",
  dataSources: ["trades" as const],
  requiredFeatures: [] as ("tools" | "structuredOutput")[],
  inputCharacters: 2000,
};

const seedAccounts = () => {
  for (const id of ["acct-1", "acct-2"])
    db
      .insert(accounts)
      .values({ id, name: `Account ${id}`, kind: "import", createdAt: "2026-01-01" })
      .run();
};

const enableBackground = (overrides: Partial<Parameters<typeof saveBackgroundPolicy>[0]> = {}) =>
  saveBackgroundPolicy({
    enabled: true,
    accounts: ["acct-1"],
    capabilities: { tools: false, structuredOutput: false },
    maxInputCharacters: 8000,
    ...overrides,
  });

beforeEach(() => {
  db.delete(settings).run();
  db.delete(accounts).run();
  db.delete(intelligenceBudgetReservations).run();
  db.delete(intelligenceRuns).run();
  db.delete(intelligencePolicy).run();
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected provider request");
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("the background policy", () => {
  it("starts off and records every change as a new revision", () => {
    expect(getBackgroundPolicy()).toMatchObject({
      enabled: false,
      accounts: [],
      capabilities: { tools: false, structuredOutput: false },
      revision: 0,
    });
    seedAccounts();
    expect(enableBackground()).toMatchObject({
      enabled: true,
      accounts: ["acct-1"],
      revision: 1,
    });
    expect(enableBackground({ maxInputCharacters: 4000 })).toMatchObject({ revision: 2 });
    expect(db.select().from(intelligencePolicy).all()).toHaveLength(2);
  });

  it("drops an account that no longer exists instead of refusing the save", () => {
    seedAccounts();
    enableBackground();
    expect(saveBackgroundPolicy({ accounts: ["acct-1", "acct-gone"] }).accounts).toEqual([
      "acct-1",
    ]);
  });

  it("keeps the revision when the policy did not change", () => {
    seedAccounts();
    expect(enableBackground().revision).toBe(1);
    expect(enableBackground().revision).toBe(1);
    expect(db.select().from(intelligencePolicy).all()).toHaveLength(1);
  });
});

describe("authorising a background run", () => {
  it("authorises an opted-in account with the background budgets", () => {
    seedAccounts();
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-1", scope });
    const decision = authorizeBackgroundRun(runId, NOW, new AbortController().signal);
    expect(decision.status).toBe("completed");
    if (decision.status !== "completed") return;
    expect(decision.value).toMatchObject({
      principal: "system",
      mode: "background",
      scope: { accountIds: ["acct-1"], timeZone: "UTC" },
      budgets: { maxSteps: 4, maxToolCalls: 4, maxOutputTokens: 1200, timeoutMs: 30_000 },
    });
  });

  it("refuses a run while background AI is off", () => {
    seedAccounts();
    const runId = enqueueBackgroundRun({ effectKey: "effect-off", scope });
    expect(authorizeBackgroundRun(runId, NOW, new AbortController().signal)).toMatchObject({
      status: "unavailable",
      reason: "policy_missing",
    });
  });

  it("refuses an account that did not opt in", () => {
    seedAccounts();
    enableBackground({ accounts: ["acct-2"] });
    const runId = enqueueBackgroundRun({ effectKey: "effect-other", scope });
    expect(authorizeBackgroundRun(runId, NOW, new AbortController().signal)).toMatchObject({
      status: "unavailable",
      reason: "account_not_opted_in",
    });
  });

  it("refuses a run whose policy was revised after it was queued", () => {
    seedAccounts();
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-revised", scope });
    enableBackground({ maxInputCharacters: 4000 });
    expect(authorizeBackgroundRun(runId, NOW, new AbortController().signal)).toMatchObject({
      status: "unavailable",
      reason: "policy_changed",
    });
  });

  it("refuses a run whose account was deleted", () => {
    seedAccounts();
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-deleted", scope });
    db.delete(accounts).run();
    expect(authorizeBackgroundRun(runId, NOW, new AbortController().signal)).toMatchObject({
      status: "cancelled",
      reason: "account_missing",
    });
  });

  it("refuses a cancelled run", () => {
    seedAccounts();
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-cancelled", scope });
    const controller = new AbortController();
    controller.abort();
    expect(authorizeBackgroundRun(runId, NOW, controller.signal)).toMatchObject({
      status: "cancelled",
      reason: "cancelled",
    });
  });

  it("refuses a run that needs tools the operator did not allow", () => {
    seedAccounts();
    enableBackground();
    const runId = enqueueBackgroundRun({
      effectKey: "effect-tools",
      scope: { ...scope, requiredFeatures: ["tools"] },
    });
    expect(authorizeBackgroundRun(runId, NOW, new AbortController().signal)).toMatchObject({
      status: "unavailable",
      reason: "tools_unsupported",
    });
  });

  it("refuses a run that reads more context than the operator allowed", () => {
    seedAccounts();
    enableBackground({ maxInputCharacters: 1000 });
    const runId = enqueueBackgroundRun({ effectKey: "effect-capacity", scope });
    expect(authorizeBackgroundRun(runId, NOW, new AbortController().signal)).toMatchObject({
      status: "unavailable",
      reason: "context_too_large",
    });
  });

  it("refuses a run whose endpoint changed, without contacting the provider", () => {
    seedAccounts();
    setSetting("aiProvider", "compatible");
    setSetting("compatibleModel", "llama-fixture");
    setSetting("compatibleBaseUrl", SERVER);
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-endpoint", scope });
    // The operator moves the server to another URL.
    setSetting("compatibleBaseUrl", "http://localhost:11435/v1");
    expect(authorizeBackgroundRun(runId, NOW, new AbortController().signal)).toMatchObject({
      status: "unavailable",
      reason: "configuration_changed",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a run whose model changed, without contacting the provider", () => {
    seedAccounts();
    setSetting("aiProvider", "compatible");
    setSetting("compatibleModel", "llama-fixture");
    setSetting("compatibleBaseUrl", SERVER);
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-model", scope });
    setSetting("compatibleModel", "llama-other");
    expect(authorizeBackgroundRun(runId, NOW, new AbortController().signal)).toMatchObject({
      status: "unavailable",
      reason: "configuration_changed",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a run when the day's allowance is already spent", () => {
    seedAccounts();
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-budget", scope });
    for (let index = 0; index < BACKGROUND_DAILY_ATTEMPT_LIMIT; index += 1)
      withJournalTransaction((tx) => {
        expect(reserveBackgroundAttempt(tx, runId, NOW)).toBe(true);
      });
    expect(authorizeBackgroundRun(runId, NOW, new AbortController().signal)).toMatchObject({
      status: "unavailable",
      reason: "daily_budget_exhausted",
    });
  });
});

describe("the daily attempt reservation", () => {
  it("counts every attempt of the day, not every run", () => {
    seedAccounts();
    enableBackground();
    const first = enqueueBackgroundRun({ effectKey: "effect-a", scope });
    const second = enqueueBackgroundRun({ effectKey: "effect-b", scope });
    for (let index = 0; index < BACKGROUND_DAILY_ATTEMPT_LIMIT; index += 1)
      withJournalTransaction((tx) => {
        expect(reserveBackgroundAttempt(tx, index % 2 === 0 ? first : second, NOW)).toBe(true);
      });
    withJournalTransaction((tx) => {
      expect(reserveBackgroundAttempt(tx, first, NOW)).toBe(false);
    });
  });

  it("keeps the reservation of a crashed attempt", () => {
    seedAccounts();
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-crash", scope });
    withJournalTransaction((tx) => {
      expect(reserveBackgroundAttempt(tx, runId, NOW)).toBe(true);
    });
    // The attempt dies after the reservation committed: the allowance stays
    // spent, and a fresh retry takes another one.
    expect(db.select().from(intelligenceBudgetReservations).all()).toHaveLength(1);
    withJournalTransaction((tx) => {
      expect(reserveBackgroundAttempt(tx, runId, NOW)).toBe(true);
    });
    expect(db.select().from(intelligenceBudgetReservations).all()).toHaveLength(2);
  });

  it("starts a new day's allowance on the next day", () => {
    seedAccounts();
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-day", scope });
    for (let index = 0; index < BACKGROUND_DAILY_ATTEMPT_LIMIT; index += 1)
      withJournalTransaction((tx) => {
        expect(reserveBackgroundAttempt(tx, runId, NOW)).toBe(true);
      });
    withJournalTransaction((tx) => {
      expect(reserveBackgroundAttempt(tx, runId, NOW + 86_400_000)).toBe(true);
    });
  });
});

describe("the composed execution path", () => {
  it("calls the pinned endpoint once, after the reservation is committed", async () => {
    seedAccounts();
    setSetting("aiProvider", "compatible");
    setSetting("compatibleModel", "llama-fixture");
    setSetting("compatibleBaseUrl", SERVER);
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-execute", scope });
    const fetcher = vi.fn(async () => completion("Background answer"));
    vi.stubGlobal("fetch", fetcher);
    const result = await executeBackgroundRun({
      runId,
      system: "System",
      prompt: "Prompt",
      signal: new AbortController().signal,
      now: NOW,
    });
    expect(result.status).toBe("completed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    // The reservation is committed before the request: the row exists by the
    // time the provider is called.
    expect(db.select().from(intelligenceBudgetReservations).all()).toHaveLength(1);
    expect(db.select().from(intelligenceRuns).all()[0]?.status).toBe("completed");
  });

  it("issues no request when the run is refused", async () => {
    seedAccounts();
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-refused", scope });
    // The operator moves the server: the run is refused before any request.
    setSetting("aiProvider", "compatible");
    setSetting("compatibleModel", "llama-fixture");
    setSetting("compatibleBaseUrl", SERVER);
    const result = await executeBackgroundRun({
      runId,
      system: "System",
      prompt: "Prompt",
      signal: new AbortController().signal,
      now: NOW,
    });
    expect(result).toMatchObject({ status: "unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("records the refusal, so the run stays unavailable until it is rescheduled", async () => {
    seedAccounts();
    setSetting("aiProvider", "compatible");
    setSetting("compatibleModel", "llama-fixture");
    setSetting("compatibleBaseUrl", SERVER);
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-stale", scope });
    setSetting("compatibleBaseUrl", "http://localhost:11435/v1");
    expect(authorizeBackgroundRun(runId, NOW, new AbortController().signal)).toMatchObject({
      status: "unavailable",
      reason: "configuration_changed",
    });
    expect(db.select().from(intelligenceRuns).all()[0]?.status).toBe("unavailable");
    // The configuration comes back: the run still refuses, because it was
    // refused before and only an explicit reschedule revives it.
    setSetting("compatibleBaseUrl", SERVER);
    expect(authorizeBackgroundRun(runId, NOW, new AbortController().signal)).toMatchObject({
      status: "failed",
      reason: "run_finished",
    });
    const rescheduled = enqueueBackgroundRun({ effectKey: "effect-stale", scope });
    expect(rescheduled).toBe(runId);
    expect(
      authorizeBackgroundRun(rescheduled, NOW, new AbortController().signal).status,
    ).toBe("completed");
  });

  it("issues no request when the provider has no key", async () => {
    seedAccounts();
    setSetting("aiProvider", "openai");
    setSetting("openaiModel", "gpt-6-luna");
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-nokey", scope });
    const result = await executeBackgroundRun({
      runId,
      system: "System",
      prompt: "Prompt",
      signal: new AbortController().signal,
      now: NOW,
    });
    expect(result).toMatchObject({ status: "unavailable", reason: "provider_not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("records a cancelled run as cancelled, not as a timeout", async () => {
    seedAccounts();
    setSetting("aiProvider", "compatible");
    setSetting("compatibleModel", "llama-fixture");
    setSetting("compatibleBaseUrl", SERVER);
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-cancelled-run", scope });
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }),
    );
    const result = await executeBackgroundRun({
      runId,
      system: "System",
      prompt: "Prompt",
      signal: controller.signal,
      now: NOW,
    });
    expect(result).toMatchObject({ status: "cancelled", reason: "cancelled" });
    const stored = db.select().from(intelligenceRuns).all()[0];
    expect(stored?.status).toBe("cancelled");
    expect(JSON.stringify(stored?.metaJson)).toContain("cancelled");
  });

  it("refuses a run that already ended", async () => {
    seedAccounts();
    enableBackground();
    const runId = enqueueBackgroundRun({ effectKey: "effect-ended", scope });
    withJournalTransaction((tx) => {
      db.update(intelligenceRuns)
        .set({ status: "cancelled" })
        .where(eq(intelligenceRuns.id, runId))
        .run();
    });
    expect(authorizeBackgroundRun(runId, NOW, new AbortController().signal)).toMatchObject({
      status: "cancelled",
      reason: "cancelled",
    });
  });
});

describe("the provider adapter", () => {
  it("keeps a keyless compatible server keyless and calls only the pinned endpoint", async () => {
    const fetcher = vi.fn(async () => completion("Background answer"));
    vi.stubGlobal("fetch", fetcher);
    const result = await runBackgroundAi({
      configuration: {
        provider: "compatible",
        modelId: "llama-fixture",
        apiKey: null,
        baseUrl: SERVER,
      },
      promptVersion: "background-v1",
      system: "System",
      prompt: "Prompt",
    });
    expect(result.output).toBe("Background answer");
    expect(result.meta).toMatchObject({ feature: "background", provider: "compatible" });
    const [url, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(url).toBe(`${SERVER}/chat/completions`);
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("sends a hosted provider its own key and keeps store off", async () => {
    const fetcher = vi.fn(async () => hostedResponse("Hosted answer"));
    vi.stubGlobal("fetch", fetcher);
    const result = await runBackgroundAi({
      configuration: { provider: "openai", modelId: "gpt-6-luna", apiKey: "fixture-openai-key" },
      promptVersion: "background-v1",
      system: "System",
      prompt: "Prompt",
    });
    expect(result.output).toBe("Hosted answer");
    const [, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer fixture-openai-key");
    expect(JSON.parse(init.body as string).store).toBe(false);
  });

  it("fails a hosted provider without a key before any request", async () => {
    await expect(
      runBackgroundAi({
        configuration: { provider: "openai", modelId: "gpt-6-luna", apiKey: null },
        promptVersion: "background-v1",
        system: "System",
        prompt: "Prompt",
      }),
    ).rejects.toMatchObject({ kind: "missing_key" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never falls back to another provider when the pinned one fails", async () => {
    const fetcher = vi.fn(async () => new Response("provider failure", { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      runBackgroundAi({
        configuration: {
          provider: "compatible",
          modelId: "llama-fixture",
          apiKey: null,
          baseUrl: SERVER,
        },
        promptVersion: "background-v1",
        system: "System",
        prompt: "Prompt",
      }),
    ).rejects.toMatchObject({ kind: "provider" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]![0]).toBe(
      `${SERVER}/chat/completions`,
    );
  });

  it("never puts a prompt or a key into a failure message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("secret provider body", { status: 500 })),
    );
    const failure = await runBackgroundAi({
      configuration: { provider: "openai", modelId: "gpt-6-luna", apiKey: "fixture-secret-key" },
      promptVersion: "background-v1",
      system: "System",
      prompt: "A private question",
    }).catch((error: unknown) => error as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain("fixture-secret-key");
    expect((failure as Error).message).not.toContain("A private question");
  });

  it("stops the request when the caller cancels", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }),
    );
    await expect(
      runBackgroundAi({
        configuration: { provider: "openai", modelId: "gpt-6-luna", apiKey: "fixture-openai-key" },
        promptVersion: "background-v1",
        system: "System",
        prompt: "Prompt",
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("the settings surface", () => {
  it("exposes the background policy and stores a change as a new revision", async () => {
    seedAccounts();
    const state = await (await GET()).json();
    expect(state.backgroundAi).toMatchObject({ enabled: false, revision: 0 });
    const response = await PATCH(
      new Request("http://localhost/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backgroundAi: {
            enabled: true,
            accounts: ["acct-1"],
            capabilities: { tools: true, structuredOutput: false },
            maxInputCharacters: 4000,
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await (await GET()).json()).backgroundAi).toMatchObject({
      enabled: true,
      accounts: ["acct-1"],
      capabilities: { tools: true },
      maxInputCharacters: 4000,
      revision: 1,
    });
  });
});
