import { asc, eq } from "drizzle-orm";
import { accounts, db } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { encryptJson } from "@/server/crypto";
import { newId, nowIso } from "@/server/ids";
import { syncAccount } from "@/server/sync";
import { CTraderMcpClient } from "@/server/ctrader-mcp/client";
import { getAccountBalance } from "@/server/ctrader-mcp/account";
import { classifyMcpError, CTraderMcpSyncError } from "@/server/ctrader-mcp/errors";

export const GET = handler((request: Request) => {
  if (new URL(request.url).searchParams.get("summary") === "1") {
    return ok({
      accounts: db
        .select({
          id: accounts.id,
          name: accounts.name,
          broker: accounts.broker,
          archivedAt: accounts.archivedAt,
        })
        .from(accounts)
        .orderBy(asc(accounts.createdAt))
        .all(),
    });
  }
  const rows = db.select().from(accounts).orderBy(asc(accounts.createdAt)).all();
  return ok({
    accounts: rows.map(({ credentialsEnc, ...safe }) => ({
      ...safe,
      connected: credentialsEnc !== null,
      snapshot: safe.snapshotJson ? JSON.parse(safe.snapshotJson) : null,
    })),
  });
});

interface CreateBody {
  name?: string;
  kind?: "sync" | "import" | "manual";
  broker?: string;
  currency?: string;
  initialBalance?: number;
  profitCalcMethod?: "fifo" | "lifo" | "wavg";
  credentials?: Record<string, unknown>;
  autoSync?: boolean;
}

interface FetchedBalance {
  balance: number;
  currency: string;
}

const fetchCTraderBalanceForCredentials = async (
  credentials: Record<string, unknown>,
): Promise<FetchedBalance> => {
  const endpoint = typeof credentials.endpoint === "string" ? credentials.endpoint : "";
  const authHeader =
    typeof credentials.authHeader === "string" && credentials.authHeader
      ? credentials.authHeader
      : undefined;
  const client = new CTraderMcpClient({ mode: "local", endpoint, ...(authHeader ? { authHeader } : {}) });
  try {
    await client.initialize();
    const balance = await getAccountBalance(client);
    return { balance: balance.balance, currency: balance.depositAsset };
  } finally {
    await client.close().catch(() => undefined);
  }
};

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as CreateBody;
  if (!body.name || !body.kind) return bad("name and kind are required");
  if (body.kind === "sync" && (!body.broker || !body.credentials)) {
    return bad("sync accounts need a broker and credentials");
  }
  if (
    body.kind === "sync" &&
    body.broker === "ctrader-mcp" &&
    body.credentials &&
    typeof body.credentials.endpoint === "string" &&
    !/^https?:\/\//i.test(body.credentials.endpoint)
  ) {
    return bad("cTrader MCP endpoint must be an http(s) URL");
  }

  // cTrader MCP: pull the live balance once so the account isn't born with
  // initialBalance=0. A user-supplied value (>0) wins; the fetched value is
  // only used as a fallback. Failure to reach cTrader aborts the create —
  // bad credentials shouldn't strand a half-created account.
  let initialBalance = body.initialBalance ?? 0;
  let currency = body.currency ?? "USD";
  if (
    body.kind === "sync" &&
    body.broker === "ctrader-mcp" &&
    body.credentials
  ) {
    try {
      const fetched = await fetchCTraderBalanceForCredentials(body.credentials);
      if (!(initialBalance > 0)) initialBalance = fetched.balance;
      if (!body.currency) currency = fetched.currency;
    } catch (error) {
      const err =
        error instanceof CTraderMcpSyncError
          ? error
          : classifyMcpError(error);
      return bad(err.message, 502);
    }
  }

  const id = newId();
  db.insert(accounts)
    .values({
      id,
      name: body.name,
      broker: body.broker ?? "",
      kind: body.kind,
      currency,
      initialBalance,
      profitCalcMethod: body.profitCalcMethod ?? "fifo",
      credentialsEnc: body.kind === "sync" ? encryptJson(body.credentials) : null,
      autoSync: body.autoSync ?? body.kind === "sync",
      createdAt: nowIso(),
    })
    .run();

  // First sync happens right away so the account isn't born empty.
  let sync = null;
  if (body.kind === "sync") {
    try {
      sync = await syncAccount(id);
    } catch (error) {
      // Bad credentials shouldn't strand a half-created account.
      db.delete(accounts).where(eq(accounts.id, id)).run();
      return bad(error instanceof Error ? error.message : "Broker connection failed", 502);
    }
  }
  return ok({ id, sync });
});
