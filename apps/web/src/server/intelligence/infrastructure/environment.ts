import { eq } from "drizzle-orm";
import { accounts } from "@/db/schema";
import type { JournalTx } from "@/db/transaction";
import { aiProviderConfiguredInTx, getCurrentProviderConfigurationInTx } from "@/server/settings";
import type { BackgroundEnvironment, BackgroundEnvironmentReader } from "../contracts/policy";

/**
 * The background environment reader (Phase 23).
 *
 * It answers the two questions a background run is authorised against: which
 * accounts the journal still holds, and how the provider is configured right
 * now. Both are read inside the caller's transaction, so a run that is
 * authorised and the run that is written see the same accounts and the same
 * provider.
 */

/** The accounts the journal still holds, and the provider it is configured for. */
const readEnvironmentInTx = (tx: JournalTx): BackgroundEnvironment => {
  const existingAccountIds = tx
    .select({ id: accounts.id })
    .from(accounts)
    .all()
    .map((row) => row.id);
  const configuration = getCurrentProviderConfigurationInTx(tx);
  return {
    existingAccountIds,
    providerConfiguration: {
      provider: configuration.provider,
      model: configuration.modelId,
      baseUrl: configuration.baseUrl,
    },
    providerConfigured: aiProviderConfiguredInTx(tx, configuration.provider),
  };
};

/**
 * Creates the environment reader.
 *
 * The factory is the only public surface of this module: a sibling domain
 * injects the port from `../contracts/policy` and never reaches the adapter
 * directly, so the boundary rule holds.
 */
export const createBackgroundEnvironmentReader = (): BackgroundEnvironmentReader => ({
  readEnvironmentInTx,
});
