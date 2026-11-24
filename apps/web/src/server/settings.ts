import { eq } from "drizzle-orm";
import { db, settings } from "@/db";
import { withJournalTransaction, type JournalTx } from "@/db/transaction";
import { decryptJson, encryptJson } from "./crypto";
import { EMPTY_DEFAULTS, type JournalDefaults } from "@/lib/journal-defaults";
import { DEFAULT_CONVERSION, parseCurrencyConversion } from "@/lib/currencies";
import {
  AI_DEFAULT_MODELS,
  AI_KEY_VARIABLES,
  isAiProvider,
  type AiConnection,
  type AiProvider,
  type AiSettingsPayload,
} from "@/lib/ai-settings";

export const getJournalDefaults = (): JournalDefaults =>
  parseJournalDefaults(getSetting("journalDefaults"));

const parseJournalDefaults = (raw: string | null): JournalDefaults => {
  try {
    return { ...EMPTY_DEFAULTS, ...JSON.parse(raw ?? "{}") };
  } catch {
    return EMPTY_DEFAULTS;
  }
};

/** The journal defaults as the given transaction sees them. */
export const getJournalDefaultsInTx = (tx: JournalTx): JournalDefaults =>
  parseJournalDefaults(getSettingInTx(tx, "journalDefaults"));

/**
 * The journal connection, seen as a transaction handle.
 *
 * Drizzle's better-sqlite3 driver runs every statement on one connection, so
 * the non-transactional readers and writers below hand that connection to
 * their in-transaction twin: there is one implementation of the semantics, and
 * the difference is only whether a transaction is open.
 */
const journal = db as unknown as JournalTx;

export const getSetting = (key: string): string | null => getSettingInTx(journal, key);

/** The setting as the given transaction sees it. */
export const getSettingInTx = (tx: JournalTx, key: string): string | null =>
  tx.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;

/** Captures future projection events by default, including journals without a saved choice. */
export const getJournalEventCapture = (): boolean => getJournalEventCaptureInTx(journal);

/** Reads the capture choice through the caller's transaction so combined patches apply immediately. */
export const getJournalEventCaptureInTx = (tx: JournalTx): boolean =>
  getSettingInTx(tx, "journalEventCapture") !== "false";

export const setSetting = (key: string, value: string): void => {
  setSettingInTx(journal, key, value);
};

/**
 * Writes one setting inside the caller's transaction.
 *
 * One row per key, replaced on conflict.
 */
export const setSettingInTx = (tx: JournalTx, key: string, value: string): void => {
  tx.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
};

export const deleteSetting = (key: string): void => {
  deleteSettingInTx(journal, key);
};

/** Removes one setting inside the caller's transaction. */
export const deleteSettingInTx = (tx: JournalTx, key: string): void => {
  tx.delete(settings).where(eq(settings.key, key)).run();
};

/**
 * The import timezone as the given transaction sees it.
 *
 * The stored import zone, else the stored display zone, else UTC — the same
 * fallback chain as {@link getImportTimeZone}.
 */
export const getImportTimeZoneInTx = (tx: JournalTx): string =>
  getSettingInTx(tx, "importTimeZone") ?? getSettingInTx(tx, "timeZone") ?? "UTC";

export const getCurrencyConversion = () => {
  const saved = getSetting("currencyConversion");
  if (!saved) return DEFAULT_CONVERSION;
  // Invalid saved settings must not silently fall back to a different valuation.
  return parseCurrencyConversion(JSON.parse(saved));
};

/** Journal display timezone (IANA), default UTC. */
export const getTimeZone = (): string => getSetting("timeZone") ?? "UTC";

/** Journal display timezone (IANA), as the given transaction sees it. */
export const getTimeZoneInTx = (tx: JournalTx): string => getSettingInTx(tx, "timeZone") ?? "UTC";

/** Preserve the legacy parsing default until a separate import zone is saved. */
export const getImportTimeZone = (): string => getSetting("importTimeZone") ?? getTimeZone();

/** Per-symbol contract multipliers for futures/options P&L. */
export const getMultipliers = (): Record<string, number> =>
  parseMultipliers(getSetting("multipliers"));

/** The contract multipliers as the given transaction sees them. */
export const getMultipliersInTx = (tx: JournalTx): Record<string, number> =>
  parseMultipliers(getSettingInTx(tx, "multipliers"));

const parseMultipliers = (raw: string | null): Record<string, number> => {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
};

export const aiKeyEnvironment = (provider: AiProvider): string | null => {
  const variable = AI_KEY_VARIABLES[provider];
  return (variable && process.env[variable]?.trim()) || null;
};

/**
 * The provider key as the given transaction sees it.
 *
 * The environment variable still wins: a key that never touches the journal
 * is read from the process, not from the transaction.
 */
export const getAiKeyInTx = (tx: JournalTx, provider: AiProvider): string | null => {
  const environment = aiKeyEnvironment(provider);
  if (environment) return environment;
  const envelope = getSettingInTx(tx, `${provider}KeyEnc`);
  if (!envelope) return null;
  try {
    const key = decryptJson<unknown>(envelope);
    return typeof key === "string" ? key.trim() || null : null;
  } catch {
    return null;
  }
};

/** Provider keys are stored separately and encrypted like broker credentials. */
export const getAiKey = (provider: AiProvider): string | null => getAiKeyInTx(journal, provider);

export const setAiKey = (provider: AiProvider, key: string | null): void => {
  if (key === null) deleteSetting(`${provider}KeyEnc`);
  else setSetting(`${provider}KeyEnc`, encryptJson(key.trim()));
};

/**
 * Stores or clears one provider's key inside the caller's transaction.
 *
 * `null` removes the stored envelope; a key is stored encrypted, exactly as
 * {@link setAiKey} stores it.
 */
export const setAiKeyInTx = (tx: JournalTx, provider: AiProvider, key: string | null): void => {
  if (key === null) deleteSettingInTx(tx, `${provider}KeyEnc`);
  else setSettingInTx(tx, `${provider}KeyEnc`, encryptJson(key.trim()));
};

export const getAnthropicKey = (): string | null => getAiKey("anthropic");
export const setAnthropicKey = (key: string | null): void => setAiKey("anthropic", key);

/** An http(s) API root without credentials, query or fragment, minus trailing slashes. */
export const normalizeAiBaseUrl = (value: string): string | null => {
  if (value.length > 2048 || /[?#]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
};

export const getCompatibleBaseUrl = (): string | null => getSetting("compatibleBaseUrl");

/** A saved key belongs to the server it was entered for, so a new URL drops it. */
export const setCompatibleBaseUrl = (url: string, keepKey: boolean): void => {
  if (!keepKey && url !== getCompatibleBaseUrl()) setAiKey("compatible", null);
  setSetting("compatibleBaseUrl", url);
};

/**
 * Stores the compatible server URL inside the caller's transaction.
 *
 * A saved key belongs to the server it was entered for: a changed URL drops
 * the key unless a new one was sent.
 */
export const setCompatibleBaseUrlInTx = (tx: JournalTx, url: string, keepKey: boolean): void => {
  const saved = getSettingInTx(tx, "compatibleBaseUrl");
  if (!keepKey && url !== saved) setAiKeyInTx(tx, "compatible", null);
  setSettingInTx(tx, "compatibleBaseUrl", url);
};

export const getAiProvider = (): AiProvider => {
  const selected = getSetting("aiProvider");
  if (isAiProvider(selected)) return selected;
  // Preserve existing Anthropic setups; an OpenAI-only setup works without a UI visit.
  return !getAiKey("anthropic") && getAiKey("openai") ? "openai" : "anthropic";
};

/** Anthropic keeps the legacy "aiModel" key; other providers use "<provider>Model". */
export const aiModelSetting = (provider: AiProvider): string =>
  provider === "anthropic" ? "aiModel" : `${provider}Model`;

export const getAiModel = (provider: AiProvider): string =>
  getSetting(aiModelSetting(provider))?.trim() || AI_DEFAULT_MODELS[provider];

/** Hosted providers need a key. A compatible server needs a URL and model; its key is optional. */
export const aiProviderConfigured = (provider: AiProvider): boolean =>
  aiProviderConfiguredInTx(journal, provider);

/**
 * Whether the provider can be reached, as the given transaction sees it.
 *
 * A hosted provider needs its key, a compatible server its URL and model: the
 * same rule the settings surface uses, read inside the caller's transaction.
 */
export const aiProviderConfiguredInTx = (tx: JournalTx, provider: AiProvider): boolean =>
  provider === "compatible"
    ? Boolean(getCompatibleBaseUrlInTx(tx) && getAiModelInTx(tx, provider))
    : getAiKeyInTx(tx, provider) !== null;

export const getAiSettings = (): AiSettingsPayload => {
  const aiProvider = getAiProvider();
  const connection = (provider: AiProvider): AiConnection => ({
    configured: aiProviderConfigured(provider),
    source: aiKeyEnvironment(provider)
      ? ("environment" as const)
      : getAiKey(provider)
        ? ("saved" as const)
        : null,
    model: getAiModel(provider),
    baseUrl: provider === "compatible" ? getCompatibleBaseUrl() : null,
  });
  const aiConnections = {
    anthropic: connection("anthropic"),
    openai: connection("openai"),
    compatible: connection("compatible"),
  };
  return {
    aiProvider,
    aiConfigured: aiConnections[aiProvider].configured,
    aiModel: aiConnections[aiProvider].model,
    aiConnections,
  };
};

/** Server-only resolver for the runtime: returns the active provider, model, key, and URL. */
export const resolveAiConfiguration = (): {
  provider: AiProvider;
  modelId: string;
  apiKey: string | null;
  baseUrl: string | null;
} => {
  const provider = getAiProvider();
  return {
    provider,
    modelId: getAiModel(provider),
    apiKey: getAiKey(provider),
    baseUrl: provider === "compatible" ? getCompatibleBaseUrl() : null,
  };
};

/**
 * The provider configuration a background run is pinned to, without the key.
 *
 * A background run is approved against the provider, the model and the
 * endpoint that are configured right now; the fingerprint of exactly these
 * three values is what the run pins, so a later change is visible.
 */
export const getCurrentProviderConfiguration = (): {
  provider: AiProvider;
  modelId: string;
  baseUrl: string | null;
} => {
  const provider = getAiProvider();
  return {
    provider,
    modelId: getAiModel(provider),
    baseUrl: provider === "compatible" ? getCompatibleBaseUrl() : null,
  };
};

/**
 * The provider configuration as the given transaction sees it.
 *
 * The background runtime reads the configuration inside the transaction that
 * pins it, so the run that is written and the configuration it is compared
 * against come from the same snapshot.
 */
export const getCurrentProviderConfigurationInTx = (
  tx: JournalTx,
): {
  provider: AiProvider;
  modelId: string;
  baseUrl: string | null;
} => {
  const provider = getAiProviderInTx(tx);
  return {
    provider,
    modelId: getAiModelInTx(tx, provider),
    baseUrl: provider === "compatible" ? getCompatibleBaseUrlInTx(tx) : null,
  };
};

/** The selected provider, as the given transaction sees it. */
export const getAiProviderInTx = (tx: JournalTx): AiProvider => {
  const selected = getSettingInTx(tx, "aiProvider");
  if (isAiProvider(selected)) return selected;
  return !getAiKeyInTx(tx, "anthropic") && getAiKeyInTx(tx, "openai") ? "openai" : "anthropic";
};

/** The model of one provider, as the given transaction sees it. */
export const getAiModelInTx = (tx: JournalTx, provider: AiProvider): string =>
  getSettingInTx(tx, aiModelSetting(provider))?.trim() || AI_DEFAULT_MODELS[provider];

/** The compatible server URL, as the given transaction sees it. */
export const getCompatibleBaseUrlInTx = (tx: JournalTx): string | null =>
  getSettingInTx(tx, "compatibleBaseUrl");

/**
 * Statement parsing stays on the hosted providers: they accept PDFs and strict
 * structured output. A compatible server is never used for imports; when it is
 * the selected provider, a hosted provider with a key is used instead.
 */
export const resolveAiImportConfiguration = (): {
  provider: "openai" | "anthropic";
  modelId: string;
  apiKey: string | null;
} | null => {
  const provider = getAiProvider();
  if (provider !== "compatible") {
    return { provider, modelId: getAiModel(provider), apiKey: getAiKey(provider) };
  }
  for (const hosted of ["openai", "anthropic"] as const) {
    const apiKey = getAiKey(hosted);
    if (apiKey) return { provider: hosted, modelId: getAiModel(hosted), apiKey };
  }
  return null;
};

/** Persisted single-account default; survives reloads and devices. */
export const getCurrentAccountId = (): string | null => getSetting("currentAccountId");

/** Write the persisted default. `null` clears it. */
export const setCurrentAccountId = (id: string | null): void => {
  if (id === null) deleteSetting("currentAccountId");
  else setSetting("currentAccountId", id);
};

/** Writes the persisted default inside the caller's transaction. `null` clears it. */
export const setCurrentAccountIdInTx = (tx: JournalTx, id: string | null): void => {
  if (id === null) deleteSettingInTx(tx, "currentAccountId");
  else setSettingInTx(tx, "currentAccountId", id);
};

/**
 * The journal's intelligence controls (Phase 19).
 *
 * The two switches the operator owns: the journal may raise the insights it
 * noticed on its own, and it may be paused altogether. They live in the
 * existing settings table, so there is no schema change and no migration.
 */
export interface IntelligenceControls {
  /** Whether the journal may raise insights on its own. */
  readonly proactiveOptIn: boolean;
  /** Whether the journal raises nothing at all. */
  readonly paused: boolean;
}

/** The setting key of the proactive opt-in. */
const INTELLIGENCE_PROACTIVE_OPT_IN_KEY = "intelligenceProactiveOptIn";
/** The setting key of the pause. */
const INTELLIGENCE_PAUSED_KEY = "intelligencePaused";

/** The controls as the default journal sees them. */
export const getIntelligenceControls = (): IntelligenceControls => ({
  proactiveOptIn: getSetting(INTELLIGENCE_PROACTIVE_OPT_IN_KEY) !== "false",
  paused: getSetting(INTELLIGENCE_PAUSED_KEY) === "true",
});

/** The controls as the given transaction sees them. */
export const getIntelligenceControlsInTx = (tx: JournalTx): IntelligenceControls => ({
  proactiveOptIn: getSettingInTx(tx, INTELLIGENCE_PROACTIVE_OPT_IN_KEY) !== "false",
  paused: getSettingInTx(tx, INTELLIGENCE_PAUSED_KEY) === "true",
});

/**
 * Writes the switches the patch names and answers the merged state.
 *
 * A switch the patch does not name keeps its stored value: a surface that
 * writes one switch never clears the other.
 *
 * Both switches are written in one transaction: a crash between two writes
 * would leave the journal paused but still opted in, and the operator's
 * decision is one decision.
 */
export const setIntelligenceControls = (patch: {
  proactiveOptIn?: boolean;
  paused?: boolean;
}): IntelligenceControls => {
  withJournalTransaction((tx) => {
    if (patch.proactiveOptIn !== undefined)
      setSettingInTx(tx, INTELLIGENCE_PROACTIVE_OPT_IN_KEY, String(patch.proactiveOptIn));
    if (patch.paused !== undefined)
      setSettingInTx(tx, INTELLIGENCE_PAUSED_KEY, String(patch.paused));
  });
  return getIntelligenceControls();
};
