"use client";

import { useEffect, useMemo, useState } from "react";
import { postJson, useApi } from "@/lib/use-api";

interface SettingsResponse {
  currentAccountId: string | null;
}
interface AccountSummary {
  id: string;
  archivedAt: string | null;
}

/**
 * Resolve `settings.currentAccountId` against the live account list so a stale
 * or archived id falls back to `null`. `setDefault` PATCHes `/api/settings`;
 * the next mount re-reads.
 */
export interface AccountDefaultState {
  defaultId: string | null;
  loading: boolean;
  setDefault: (id: string | null) => void;
}

export const useAccountDefault = (): AccountDefaultState => {
  const { data: settings, loading: loadingSettings } = useApi<SettingsResponse>("/api/settings");
  const { data: accounts, loading: loadingAccounts } = useApi<{ accounts: AccountSummary[] }>(
    "/api/accounts?summary=1",
  );
  const [patching, setPatching] = useState(false);

  const defaultId = useMemo<string | null>(() => {
    const candidate = settings?.currentAccountId ?? null;
    if (!candidate) return null;
    const match = accounts?.accounts.find(
      (account) => account.id === candidate && !account.archivedAt,
    );
    return match ? candidate : null;
  }, [settings?.currentAccountId, accounts?.accounts]);

  const setDefault = (id: string | null) => {
    setPatching(true);
    void postJson("/api/settings", { currentAccountId: id }, "PATCH")
      .catch(() => {})
      .finally(() => setPatching(false));
  };

  // Logging under SSR: settings and accounts hydrate after mount.
  useEffect(() => undefined, []);

  return {
    defaultId,
    loading: loadingSettings || loadingAccounts || patching,
    setDefault,
  };
};
