// memory/bridge-client — the HTTP transport to the Graphiti bridge sidecar.
//
// Every call is bounded by the configured timeout. Reads degrade to an empty
// result carrying `error` instead of throwing, so a down bridge never breaks
// the admin UI or Discord; writes throw so queues can retry.
import type { GraphMemoryStatus } from "./types";

/** Joins the configured bridge URL (trailing slashes removed) and `path`. */
export function bridgeUrl(status: GraphMemoryStatus, path: string): string {
  return `${(status.bridgeUrl ?? "").replace(/\/+$/u, "")}${path}`;
}

/** fetch that aborts after `timeoutMs`; the abort surfaces as a thrown error. */
export async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** POSTs `body` as JSON to a bridge path. Resolves with the raw response; does not check its status. */
export async function postJson(status: GraphMemoryStatus, path: string, body: unknown): Promise<Response> {
  return fetchWithTimeout(bridgeUrl(status, path), status.timeoutMs, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** GETs a bridge path and maps the body; any failure returns `fallback` with an error. */
export async function graphGet<T, R extends { enabled: boolean; error?: string }>(
  status: GraphMemoryStatus,
  path: string,
  fallback: R,
  mapBody: (body: T) => R
): Promise<R> {
  if (!status.enabled || !status.bridgeUrl) return { ...fallback, enabled: status.enabled };
  try {
    const response = await fetchWithTimeout(bridgeUrl(status, path), status.timeoutMs, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { ...fallback, enabled: true, error: `Graph read failed: ${response.status}` };
    return mapBody((await response.json()) as T);
  } catch (error) {
    return { ...fallback, enabled: true, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Truncates `value` to an integer in [1, max]. */
export function clampLimit(value: number, max: number): number {
  return Math.max(1, Math.min(Math.trunc(value), max));
}
