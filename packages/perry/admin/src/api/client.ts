// api/client — the only module that calls fetch. Holds the admin bearer token
// and the error-handling combinators the hooks compose: throw, `optional`,
// `orReportError`.
//
// The token lives in memory only. It is never written to localStorage or
// sessionStorage, so it disappears with the page and cannot be read back from
// browser storage later; reloading the page asks for it again.
//
// Module state, not React state: `apiFetch` reads it on every call, so a token
// typed into the UI applies to the very next request without re-rendering.
let currentAdminToken = "";

/** The token in use for this page, or "" before one is entered. */
export function currentToken(): string {
  return currentAdminToken;
}

/** Use `value` for subsequent requests; "" clears it. */
export function setAdminTokenForRequests(value: string): void {
  currentAdminToken = value;
}

/** Every admin API call carries the admin token — reads are protected too. */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (currentAdminToken && !headers.has("authorization")) headers.set("authorization", `Bearer ${currentAdminToken}`);
  return fetch(input, { ...init, headers });
}

/** A non-OK HTTP response. The message format (`<label> failed: <status>`) is what the login screen matches on. */
export class ApiError extends Error {
  constructor(
    label: string,
    readonly status: number
  ) {
    super(`${label} failed: ${status}`);
  }
}

/**
 * Fetch and parse a JSON body. A non-OK status throws `ApiError` labelled with `label`;
 * network failures and unparseable bodies reject with their own errors.
 */
export async function requestJson<T>(path: string, label: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw new ApiError(label, response.status);
  return (await response.json()) as T;
}

/** GET a JSON body; see `requestJson` for error behaviour. */
export function getJson<T>(path: string, label: string): Promise<T> {
  return requestJson<T>(path, label);
}

/** Send `body` as JSON with `method` and parse the JSON reply; see `requestJson` for error behaviour. */
export function sendJson<T>(path: string, method: string, label: string, body: unknown): Promise<T> {
  return requestJson<T>(path, label, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Fire a bodiless command; the response body is not read. */
export async function sendCommand(path: string, method: string, label: string): Promise<void> {
  const response = await apiFetch(path, { method });
  if (!response.ok) throw new ApiError(label, response.status);
}

/**
 * Resolves to undefined on a non-OK response; network and parse errors still reject.
 * Used by best-effort reloads (`refreshOperations`, ontology, graph context): one
 * failing endpoint must not blank its panel or abort the other requests.
 */
export async function optional<T>(request: Promise<T>): Promise<T | undefined> {
  try {
    return await request;
  } catch (err) {
    if (err instanceof ApiError) return undefined;
    throw err;
  }
}

/** Reports a non-OK response through `report` and resolves to undefined; network and parse errors still reject. */
export async function orReportError<T>(request: Promise<T>, report: (message: string) => void): Promise<T | undefined> {
  try {
    return await request;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    report(err.message);
    return undefined;
  }
}

/**
 * Like Promise.all, but waits for every request and rethrows the first failure in argument order.
 * Used by the initial load: no request is still in flight when the error is shown, and the
 * reported error is deterministic. With a missing token every call 401s, and the user sees
 * the first one ("Config load failed: 401"), which ConnectScreen recognises.
 */
export async function allInOrder<T extends readonly unknown[] | []>(
  requests: T
): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  const settled = await Promise.allSettled(requests);
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
  }
  return settled.map((result) => (result as PromiseFulfilledResult<unknown>).value) as {
    -readonly [P in keyof T]: Awaited<T[P]>;
  };
}
