"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { acquireJson } from "./api-request";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/** Deduplicate concurrent reads and cancel requests when their last consumer leaves. */
export const useApi = <T>(url: string | null): ApiState<T> => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const [tick, setTick] = useState(0);
  const [dataUrl, setDataUrl] = useState(url);

  useEffect(() => {
    if (!url) {
      setData(null);
      setError(null);
      setLoading(false);
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const request = acquireJson<T>(url);
    request.promise
      .then((body) => {
        if (cancelled) return;
        // Render fresh data as a transition so React yields to the browser mid-render
        // instead of blocking the main thread for the whole page.
        startTransition(() => {
          setData(body);
          setDataUrl(url);
          setError(null);
          setLoading(false);
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Network error");
          setData(null);
          setDataUrl(url);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      request.release();
    };
  }, [url, tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const current = dataUrl === url;
  return {
    data: current ? data : null,
    error: current ? error : null,
    loading: Boolean(url) && (!current || loading),
    refresh,
  };
};

/**
 * A failed request.
 *
 * The status is carried so a caller can tell a stale action (409) from a
 * refused one (403) from a broken one (500) without reading the message.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const postJson = async <T = unknown>(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST",
): Promise<T> => {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // A body that is not JSON cannot be read. A success that cannot be read is
  // a failure, not an empty answer, so the status carries it.
  const data = (await response.json().catch(() => undefined)) as
    (T & { error?: string }) | undefined;
  if (!response.ok)
    throw new ApiError(data?.error ?? `Request failed (${response.status})`, response.status);
  if (data === undefined)
    throw new ApiError(`Request failed (${response.status})`, response.status);
  return data;
};
