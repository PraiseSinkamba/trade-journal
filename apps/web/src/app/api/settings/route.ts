import { db, accounts } from "@/db";
import { handler, ok, requireValue } from "@/server/api";
import { updateSettings, type SettingsPatch } from "@/server/trading/commands";
import {
  getMultipliers,
  getCurrencyConversion,
  getTimeZone,
  getImportTimeZone,
  aiKeyEnvironment,
  getAiProvider,
  getAiSettings,
  getCurrentAccountId,
  normalizeAiBaseUrl,
} from "@/server/settings";
import { AI_PROVIDERS, AI_PROVIDER_NAMES, isAiProvider, type AiProvider } from "@/lib/ai-settings";
import { isTimeZone } from "@/lib/timezone";
import { parseCurrencyConversion, type CurrencyConversion } from "@/lib/currencies";

export const GET = handler(() =>
  ok({
    timeZone: getTimeZone(),
    importTimeZone: getImportTimeZone(),
    multipliers: getMultipliers(),
    currencyConversion: getCurrencyConversion(),
    ...getAiSettings(),
    currentAccountId: getCurrentAccountId(),
  }),
);

interface SettingsBody {
  timeZone?: string;
  importTimeZone?: string;
  multipliers?: Record<string, number>;
  /** Set to a key string to store (encrypted), or null to clear. Absent = unchanged. */
  anthropicKey?: string | null;
  openaiKey?: string | null;
  compatibleKey?: string | null;
  /** OpenAI-compatible API root. A different URL clears the saved key unless one is sent. */
  compatibleBaseUrl?: string;
  aiProvider?: AiProvider;
  aiModel?: string;
  currencyConversion?: CurrencyConversion;
  /** Persisted single-account default. Absent = unchanged. `null` clears it. */
  currentAccountId?: string | null;
}

export const PATCH = handler(async (request: Request) => {
  const body = (await request.json()) as SettingsBody;
  requireValue(body && typeof body === "object" && !Array.isArray(body), "Enter valid settings.");
  let conversion: CurrencyConversion | undefined;
  if (body.currencyConversion !== undefined) {
    try {
      conversion = parseCurrencyConversion(body.currencyConversion);
    } catch (error) {
      requireValue(false, error instanceof Error ? error.message : "Enter valid conversion rates.");
    }
    if (conversion.enabled) {
      const missing = [
        ...new Set(
          db
            .select({ currency: accounts.currency })
            .from(accounts)
            .all()
            .map((account) => account.currency),
        ),
      ].filter(
        (currency) => currency !== conversion!.reportingCurrency && !conversion!.rates[currency],
      );
      requireValue(
        missing.length === 0,
        `Enter conversion rates for ${missing.join(", ")} before enabling conversion.`,
      );
    }
  }
  if (body.aiProvider !== undefined)
    requireValue(
      isAiProvider(body.aiProvider),
      "Choose Anthropic, OpenAI or an OpenAI-compatible server.",
    );
  const provider = body.aiProvider ?? getAiProvider();
  const compatibleBaseUrl =
    body.compatibleBaseUrl === undefined
      ? undefined
      : typeof body.compatibleBaseUrl === "string"
        ? normalizeAiBaseUrl(body.compatibleBaseUrl)
        : null;
  requireValue(
    compatibleBaseUrl !== null,
    "Enter a valid server URL, such as http://localhost:11434/v1.",
  );
  if (body.aiModel !== undefined)
    requireValue(
      typeof body.aiModel === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(body.aiModel.trim()),
      "Enter a valid model ID.",
    );
  for (const id of AI_PROVIDERS) {
    const key = body[`${id}Key`];
    if (key === undefined) continue;
    requireValue(
      key === null ||
        (typeof key === "string" &&
          key.trim().length > 0 &&
          key.length <= 4096 &&
          !/\s/.test(key.trim())),
      `Enter a valid ${AI_PROVIDER_NAMES[id]} API key.`,
    );
    requireValue(
      !aiKeyEnvironment(id),
      `${AI_PROVIDER_NAMES[id]} uses an environment key. Update or remove it on the server.`,
    );
  }
  for (const key of ["timeZone", "importTimeZone"] as const)
    if (body[key] !== undefined)
      requireValue(
        isTimeZone(body[key]),
        `Enter a valid IANA ${key === "timeZone" ? "display" : "import"} timezone.`,
      );
  if (body.multipliers !== undefined)
    requireValue(
      body.multipliers &&
        typeof body.multipliers === "object" &&
        Object.values(body.multipliers).every(
          (n) => typeof n === "number" && Number.isFinite(n) && n > 0,
        ),
      "Contract multipliers must be positive numbers.",
    );
  const patch: SettingsPatch = {};
  if (conversion) patch.currencyConversion = conversion;
  if (body.timeZone !== undefined) patch.timeZone = body.timeZone;
  if (body.importTimeZone !== undefined) patch.importTimeZone = body.importTimeZone;
  if (body.multipliers !== undefined) patch.multipliers = body.multipliers;
  if (body.currentAccountId !== undefined) patch.currentAccountId = body.currentAccountId;
  if (body.aiProvider !== undefined) patch.aiProvider = body.aiProvider;
  if (body.aiModel !== undefined) {
    patch.aiModel = body.aiModel.trim();
    // The model belongs to the provider this request names, else to the one
    // the journal has selected.
    patch.aiModelProvider = provider;
  }
  const aiKeys: NonNullable<SettingsPatch["aiKeys"]> = {};
  for (const id of AI_PROVIDERS) {
    const key = body[`${id}Key`];
    if (key !== undefined) aiKeys[id] = key;
  }
  if (Object.keys(aiKeys).length > 0) patch.aiKeys = aiKeys;
  if (compatibleBaseUrl) patch.compatibleBaseUrl = compatibleBaseUrl;
  updateSettings(patch);
  return ok({ saved: true });
});
