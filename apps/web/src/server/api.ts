import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, passwordConfigured, verifySession } from "./auth";
import { RequestError, requireValue } from "./request-error";
import { checkRequestOrigin } from "./request-origin";

export { RequestError, requireValue };

export const ok = (data: unknown, init?: ResponseInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(data, { ...init, headers });
};

export const bad = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

/**
 * The request of a handler call, when the call carries one.
 *
 * The wrapper does not require an `instanceof Request`: a route handler may
 * be called with a request-like plain object, and the origin policy only
 * needs its url and its headers.
 */
const requestOf = (args: readonly unknown[]): Request | null => {
  const first = args[0];
  if (typeof first !== "object" || first === null) return null;
  if (!("url" in first) || typeof first.url !== "string") return null;
  if (!("headers" in first)) return null;
  return first as Request;
};

/** Route-handler wrapper: uniform error JSON instead of HTML 500 pages. */
export const handler =
  <A extends unknown[]>(
    fn: (...args: A) => Promise<Response> | Response,
    options: { public?: boolean; origin?: boolean; sanitize?: boolean } = {},
  ) =>
  async (...args: A): Promise<Response> => {
    try {
      if (!options.public && passwordConfigured()) {
        const token = (await cookies()).get(AUTH_COOKIE)?.value;
        if (!verifySession(token)) return bad("Unauthorized", 401);
      }
      // The origin check runs after the gate: an unauthenticated request is
      // refused as unauthenticated, whatever it claims to come from.
      if (options.origin) {
        const request = requestOf(args);
        if (request && !checkRequestOrigin(request).allowed) return bad("origin_denied", 403);
      }
      return await fn(...args);
    } catch (error) {
      // A deliberate client error keeps its message; an unexpected one is
      // sanitized, so the client never learns what the server was doing.
      if (error instanceof RequestError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (options.sanitize) return NextResponse.json({ error: "Internal error" }, { status: 500 });
      const message = error instanceof Error ? error.message : "Internal error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
