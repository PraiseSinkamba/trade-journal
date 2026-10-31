import {
  FILTER_KEYS,
  computeMetrics,
  type AnalysisFilters,
  type AnnotatedTrade,
} from "@luxalgo/journal-core";
import { db, accounts, playbooks } from "@/db";
import { describeFilters } from "@/lib/filter-description";
import { AI_FEATURE_POLICIES, AI_FEATURE_TOOL_IDS, type AiFeature } from "./ai-contracts";
import { JOURNAL_CAPABILITY_IDS } from "./intelligence/contracts/capabilities";
import {
  DATA_SOURCES,
  type DataSource,
  type ExecutionContext,
} from "./intelligence/contracts/execution";
import { createExecutionContext } from "./intelligence/runtime/execution";
import { requireValue } from "./request-error";
import { getTimeZone } from "./settings";

/** Recursively freeze a value in place. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Narrow data-source selector for typed read-only capabilities. */
export type { DataSource } from "./intelligence/contracts/execution";

/** Deep-frozen snapshot of the validated AI request scope. */
export type FrozenApprovedScope = Readonly<{
  filters: Readonly<Record<string, string>>;
  timeZone: string;
  accounts: ReadonlyArray<{ id: string; name: string; currency: string }>;
  question: string;
  date: string | undefined;
  scope: Readonly<{ label: string; timeZone: string }>;
  context: string;
  dataSource: DataSource;
  tradeCritiqueKey: string | undefined;
}>;

export function isDay(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

/** Require an explicit filter snapshot; malformed scopes must never fall back to all trades. */
export function readAiRequest(value: unknown, field: "question" | "date") {
  requireValue(value && typeof value === "object" && !Array.isArray(value), "Invalid AI request");
  const body = value as Record<string, unknown>;
  const allowedFields = [field, "filters", "timeZone", "dataSource", "tradeCritiqueKey"] as const;
  requireValue(
    Object.keys(body).every((key) => allowedFields.includes(key as (typeof allowedFields)[number])),
    "Unknown AI request field",
  );

  // Validate and normalise dataSource
  const rawDataSource = body.dataSource as string | undefined;
  requireValue(
    rawDataSource === undefined ||
      (typeof rawDataSource === "string" &&
        (DATA_SOURCES as readonly string[]).includes(rawDataSource)),
    `dataSource must be one of: ${DATA_SOURCES.join(", ")}`,
  );
  const dataSource = (rawDataSource ?? "trades") as DataSource;

  // tradeCritiqueKey is only valid alongside trades+playbooks
  const rawCritiqueKey = body.tradeCritiqueKey as string | undefined;
  requireValue(
    rawCritiqueKey === undefined ||
      (dataSource === "trades+playbooks" && typeof rawCritiqueKey === "string"),
    "tradeCritiqueKey requires dataSource trades+playbooks",
  );
  const tradeCritiqueKey =
    dataSource === "trades+playbooks" && typeof rawCritiqueKey === "string"
      ? rawCritiqueKey
      : undefined;
  requireValue(
    body.filters && typeof body.filters === "object" && !Array.isArray(body.filters),
    "filters is required (use {} for all trades)",
  );
  const filters: AnalysisFilters = {};
  for (const [key, raw] of Object.entries(body.filters)) {
    requireValue(
      FILTER_KEYS.includes(key as (typeof FILTER_KEYS)[number]),
      "Unknown journal filter",
    );
    requireValue(
      typeof raw === "string" && raw.trim().length > 0 && raw.length <= 4096,
      `Invalid ${key} filter`,
    );
    const v = raw.trim();
    if (["accounts", "symbol", "excludeSymbol", "tag", "mistake", "weekdays"].includes(key)) {
      requireValue(
        v.split(",").every((part) => part.trim().length > 0),
        `Invalid ${key} filter`,
      );
    }
    if (key === "from" || key === "to") requireValue(isDay(v), `Invalid ${key} date`);
    if (/^(entry|exit)(After|Before)$/.test(key))
      requireValue(/^([01]\d|2[0-3]):[0-5]\d$/.test(v), `Invalid ${key} time`);
    if (/(Min|Max)$/.test(key))
      requireValue(
        /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v) && Number.isFinite(Number(v)),
        `Invalid ${key} number`,
      );
    const choices: Record<string, string[]> = {
      direction: ["long", "short"],
      status: ["closed", "open", "win", "loss", "breakeven"],
      reviewed: ["yes", "no"],
      assetClass: ["equity", "futures", "forex", "option", "crypto", "cfd", "other"],
    };
    if (choices[key]) requireValue(choices[key].includes(v), `Invalid ${key} filter`);
    if (key === "weekdays")
      requireValue(
        v.split(",").every((d) => /^[0-6]$/.test(d.trim())),
        "Invalid weekdays filter",
      );
    filters[key as keyof AnalysisFilters] = v;
  }
  requireValue(
    !filters.from || !filters.to || filters.from <= filters.to,
    "From date must not be after To date",
  );
  for (const key of FILTER_KEYS.filter((k) => k.endsWith("Min"))) {
    const max = filters[key.replace(/Min$/, "Max") as keyof AnalysisFilters];
    requireValue(
      !filters[key] || !max || Number(filters[key]) <= Number(max),
      `Invalid ${key} range`,
    );
  }
  const timeZone = getTimeZone();
  requireValue(
    body.timeZone === undefined || body.timeZone === timeZone,
    "Journal timezone changed. Refresh and try again.",
  );
  const allAccounts = db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .all();
  const ids = filters.accounts?.split(",").map((id) => id.trim());
  requireValue(
    !ids || ids.every((id) => allAccounts.some((a) => a.id === id)),
    "A selected account no longer exists. Update your filters.",
  );
  if (ids) filters.accounts = [...new Set(ids)].join(",");
  const selectedAccounts = ids ? allAccounts.filter((a) => ids.includes(a.id)) : allAccounts;
  const strategies = db.select({ id: playbooks.id, name: playbooks.name }).from(playbooks).all();
  const date = field === "date" ? body.date : undefined;
  if (field === "date") requireValue(isDay(date), "date (YYYY-MM-DD) is required");
  if (field === "question")
    requireValue(
      typeof body.question === "string" &&
        body.question.trim().length > 0 &&
        body.question.length <= 10000,
      "question is required (maximum 10000 characters)",
    );
  const label = (privateMode: boolean) =>
    [
      date,
      !ids ? "All accounts" : "",
      describeFilters(filters, selectedAccounts, strategies, privateMode),
      timeZone,
    ]
      .filter(Boolean)
      .join(" · ");
  return deepFreeze({
    filters,
    timeZone,
    accounts: selectedAccounts,
    question: typeof body.question === "string" ? body.question.trim() : "",
    date: date as string | undefined,
    scope: { label: label(true), timeZone },
    context: `Journal scope: ${label(false)}. Only the filtered data below is available. Do not infer results for excluded accounts or dates.`,
    dataSource,
    tradeCritiqueKey,
  });
}

export function accountContext(trades: AnnotatedTrade[], scope: FrozenApprovedScope) {
  return (
    "By account (amounts in each account's currency; no currency conversion):\n" +
    scope.accounts
      .map((account) => {
        const m = computeMetrics(
          trades.filter((t) => t.accountId === account.id),
          { timeZone: scope.timeZone },
        );
        return `${JSON.stringify(account.name)} (${account.currency}): ${m.closedTrades} closed trades, net ${m.netPnl.toFixed(2)}, fees ${m.fees.toFixed(2)}`;
      })
      .join("\n") +
    (new Set(scope.accounts.map((a) => a.currency)).size > 1
      ? "\nAccounts use different currencies. Combined amounts below are unconverted sums, not a common-currency portfolio return. Do not compare monetary performance across currencies."
      : "")
  );
}

/** The capabilities one approved data source may use. */
const DATA_SOURCE_CAPABILITY_IDS: Readonly<Record<DataSource, readonly string[]>> = {
  trades: [
    JOURNAL_CAPABILITY_IDS.askContext,
    JOURNAL_CAPABILITY_IDS.dailyRecap,
    JOURNAL_CAPABILITY_IDS.tradeCritique,
  ],
  "trades+playbooks": [
    JOURNAL_CAPABILITY_IDS.askContext,
    JOURNAL_CAPABILITY_IDS.dailyRecap,
    JOURNAL_CAPABILITY_IDS.tradeCritique,
    JOURNAL_CAPABILITY_IDS.playbookRules,
  ],
  "trades+missed": [
    JOURNAL_CAPABILITY_IDS.askContext,
    JOURNAL_CAPABILITY_IDS.dailyRecap,
    JOURNAL_CAPABILITY_IDS.tradeCritique,
    JOURNAL_CAPABILITY_IDS.missedObservations,
  ],
  "trades+notes": [
    JOURNAL_CAPABILITY_IDS.askContext,
    JOURNAL_CAPABILITY_IDS.dailyRecap,
    JOURNAL_CAPABILITY_IDS.tradeCritique,
    JOURNAL_CAPABILITY_IDS.notebookEntries,
  ],
  "trades+progress": [
    JOURNAL_CAPABILITY_IDS.askContext,
    JOURNAL_CAPABILITY_IDS.dailyRecap,
    JOURNAL_CAPABILITY_IDS.tradeCritique,
    JOURNAL_CAPABILITY_IDS.progressHistory,
  ],
};

/** The options that bind an execution context to one AI request. */
export type InteractiveContextOptions = Readonly<{
  feature?: Extract<AiFeature, "askJournalAgent" | "reportsAgent">;
  /** Reserves one tool call from the runtime-owned budget. */
  consumeToolCall?: () => boolean;
  executionId?: string;
  correlationId?: string;
}>;

/**
 * Build the execution context of an interactive AI request.
 *
 * The approved scope decides what the execution may read — accounts, filters,
 * timezone and the data-source allowlist. The feature decides which tools the
 * request may use. Nothing here widens the scope that was already approved.
 */
export function createInteractiveContext(
  scope: FrozenApprovedScope,
  signal: AbortSignal,
  options: InteractiveContextOptions = {},
): ExecutionContext {
  const feature = options.feature ?? "askJournalAgent";
  const policy = AI_FEATURE_POLICIES[feature];
  return createExecutionContext({
    executionId: options.executionId ?? crypto.randomUUID(),
    correlationId: options.correlationId ?? crypto.randomUUID(),
    principal: "interactive",
    mode: "interactive",
    triggerSource: "user.request",
    scope: {
      accountIds: scope.accounts.map((account) => account.id),
      filters: scope.filters,
      timeZone: scope.timeZone,
      dataSources: [scope.dataSource],
    },
    allowedCapabilityIds: [...DATA_SOURCE_CAPABILITY_IDS[scope.dataSource]],
    allowedToolIds: [...AI_FEATURE_TOOL_IDS[feature]],
    budgets: {
      maxSteps: policy.maxSteps ?? 1,
      maxToolCalls: policy.maxToolCalls ?? 0,
      maxOutputTokens: policy.maxOutputTokens,
      ...(policy.timeoutMs === undefined ? {} : { timeoutMs: policy.timeoutMs }),
      consumeToolCall: options.consumeToolCall ?? (() => true),
    },
    signal,
  });
}
