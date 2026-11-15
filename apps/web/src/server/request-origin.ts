/**
 * The origin policy of the mutating routes (Phase 18).
 *
 * A browser tells the server where a request came from. A request that
 * carries a foreign origin did not come from this journal's own pages, so it
 * is refused. A request that carries no origin at all is not a browser
 * request: it is a trusted nonbrowser client (a script on the operator's own
 * machine), and it is allowed — but only when it also declares no fetch site,
 * because a browser request that omits the origin while declaring a fetch
 * site is a cross-site request in disguise.
 *
 * This module imports nothing from Next and reads no cookie: it takes the
 * request and decides.
 */

/** The verdict of the origin policy. */
export type OriginVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "origin_mismatch" | "cross_site" | "untrusted_client";
    };

/** A request whose headers can be read. */
interface HeaderReader {
  readonly headers: { get(name: string): string | null };
}

/**
 * Reads the headers of a request-like value.
 *
 * The value is checked at runtime: the handler boundary may hand this module
 * a plain object that only looks like a request.
 */
const headerReader = (value: unknown): HeaderReader | null => {
  if (typeof value !== "object" || value === null) return null;
  if (!("headers" in value)) return null;
  const headers = value.headers;
  if (typeof headers !== "object" || headers === null) return null;
  if (!("get" in headers) || typeof headers.get !== "function") return null;
  // The shape was checked above, one property at a time.
  return { headers: headers as { get(name: string): string | null } };
};

/** Reads one header of a request. */
const header = (request: Request, name: string): string | null => {
  const reader = headerReader(request);
  if (!reader) return null;
  return reader.headers.get(name);
};

/**
 * The origins a request may come from.
 *
 * The origin of the request itself is always allowed — a request the journal
 * served is a request of this journal. `JOURNAL_ALLOWED_ORIGINS` names the
 * extra origins a deployment trusts, comma separated.
 */
export const allowedOrigins = (request: Request): string[] => {
  const origins = new Set<string>();
  try {
    origins.add(new URL(request.url).origin);
  } catch {
    // A request without a usable URL has no origin of its own.
  }
  const configured = process.env.JOURNAL_ALLOWED_ORIGINS;
  if (configured) {
    for (const entry of configured.split(",")) {
      const trimmed = entry.trim();
      if (trimmed) origins.add(trimmed);
    }
  }
  return [...origins];
};

/**
 * Decides whether a mutating request may act.
 *
 * The order is fixed: a cross-site fetch is refused whatever else it
 * carries, a request with an origin is allowed only when that origin is
 * allowed, and a request without an origin is the trusted-nonbrowser case.
 */
export const checkRequestOrigin = (request: Request): OriginVerdict => {
  const site = header(request, "sec-fetch-site")?.trim().toLowerCase() ?? null;

  if (site === "cross-site") return { allowed: false, reason: "cross_site" };

  const origin = header(request, "origin")?.trim() ?? null;
  if (origin) {
    return allowedOrigins(request).includes(origin)
      ? { allowed: true }
      : { allowed: false, reason: "origin_mismatch" };
  }

  if (site === null || site === "none") return { allowed: true };
  return { allowed: false, reason: "untrusted_client" };
};
