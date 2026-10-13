export type CTraderMcpSyncErrorKind =
  | "unreachable"
  | "auth"
  | "account_gone"
  | "rate_limited"
  | "parse"
  | "unknown";

export class CTraderMcpSyncError extends Error {
  constructor(
    public readonly kind: CTraderMcpSyncErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CTraderMcpSyncError";
  }
}

export class CTraderMcpConnectError extends CTraderMcpSyncError {
  constructor(message: string, cause?: unknown) {
    super("unreachable", message, cause);
  }
}

const ERROR_MESSAGES: Record<
  CTraderMcpSyncErrorKind,
  (ctx?: { endpoint?: string }) => string
> = {
  unreachable: ({ endpoint } = {}) =>
    endpoint
      ? `Can't reach cTrader MCP at ${endpoint}. Check the URL and that the desktop is running.`
      : "Can't reach cTrader MCP. Check the URL and that the desktop is running.",
  auth: () =>
    "cTrader MCP authentication failed. For remote: refresh the token in cTrader Web → Settings → Remote MCP.",
  account_gone: () =>
    "cTrader account is no longer accessible from this token. Re-connect the account.",
  rate_limited: () => "cTrader MCP rate-limited. Retry in a minute.",
  parse: () => "cTrader MCP returned unexpected data.",
  unknown: () => "cTrader MCP sync failed. Check server logs.",
};

export const classifyMcpError = (
  error: unknown,
  ctx?: { endpoint?: string },
): CTraderMcpSyncError => {
  if (error instanceof CTraderMcpSyncError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(message)) {
    return new CTraderMcpSyncError(
      "unreachable",
      ERROR_MESSAGES.unreachable(ctx),
      error,
    );
  }
  if (/401|403|unauthor/i.test(message)) {
    return new CTraderMcpSyncError("auth", ERROR_MESSAGES.auth(), error);
  }
  if (/429|rate.?limit/i.test(message)) {
    return new CTraderMcpSyncError("rate_limited", ERROR_MESSAGES.rate_limited(), error);
  }
  return new CTraderMcpSyncError("unknown", ERROR_MESSAGES.unknown(), error);
};
