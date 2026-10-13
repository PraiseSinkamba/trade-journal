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

export const classifyMcpError = (error: unknown): CTraderMcpSyncError => {
  if (error instanceof CTraderMcpSyncError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(message)) {
    return new CTraderMcpSyncError("unreachable", message, error);
  }
  if (/401|403|unauthor/i.test(message)) {
    return new CTraderMcpSyncError("auth", message, error);
  }
  if (/429|rate.?limit/i.test(message)) {
    return new CTraderMcpSyncError("rate_limited", message, error);
  }
  return new CTraderMcpSyncError("unknown", message, error);
};
