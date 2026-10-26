// http/response — the JSON "view" layer: every response goes out through here.
import type { ServerResponse } from "node:http";

/** Baseline hardening headers sent with every response. */
export const securityHeaders: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
};

const jsonHeaders = {
  ...securityHeaders,
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

/** A controller result with an explicit status; plain return values are sent as 200. */
export class Reply {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {}
}

export const reply = (status: number, body: unknown): Reply => new Reply(status, body);

/** Sends `payload` as JSON with the hardening headers; a Buffer is sent as-is, already serialized. */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { ...jsonHeaders, "content-length": body.length });
  res.end(body);
}

export function sendResult(res: ServerResponse, result: unknown): void {
  if (result instanceof Reply) sendJson(res, result.status, result.body);
  else sendJson(res, 200, result);
}
