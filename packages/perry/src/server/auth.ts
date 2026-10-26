// auth — the single access policy for the admin HTTP server.
//
// Fail closed: routes declare an Access level (see router.ts) and default to
// "admin". Only the liveness ping is public; the Granola webhook has its own
// token. When a token is not configured, the request is only trusted if it is
// a genuine local request —
// loopback peer AND loopback Host header (the Host check defeats DNS-rebinding
// pages in a local browser). A non-loopback bind refuses to start without
// ADMIN_API_TOKEN, so an unconfigured server can never be reached remotely.
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { httpError } from "./http/errors";

/** Who may call a route: anyone, admin-token holders, or the Granola webhook. */
export type Access = "public" | "admin" | "webhook";

/** ADMIN_HOST, defaulting to loopback. */
export function adminHost(): string {
  return process.env.ADMIN_HOST?.trim() || "127.0.0.1";
}

/** localhost, ::1 (bracketed or not), ::ffff:127.0.0.1, or any 127.x.x.x address. */
export function isLoopbackHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/gu, "").toLowerCase();
  return bare === "localhost" || bare === "::1" || bare === "::ffff:127.0.0.1" || /^127(?:\.\d{1,3}){3}$/u.test(bare);
}

/** Refuse to expose an unauthenticated admin API beyond this machine. */
export function assertSafeBind(host: string): void {
  if (isLoopbackHost(host)) return;
  if (!process.env.ADMIN_API_TOKEN) {
    throw new Error(
      `Refusing to bind the admin server to ${host} without ADMIN_API_TOKEN. ` +
        "Set ADMIN_API_TOKEN (and serve it over HTTPS) or keep ADMIN_HOST=127.0.0.1."
    );
  }
  if (!process.env.GRANOLA_WEBHOOK_TOKEN) {
    console.warn("GRANOLA_WEBHOOK_TOKEN is not set: /api/granola/zapier will reject all remote webhook calls.");
  }
}

/** Throws 401 unless the request satisfies `access`. */
export function authorize(req: IncomingMessage, access: Access): void {
  if (access === "admin") requireAdmin(req);
  else if (access === "webhook") requireWebhook(req);
}

export function requireAdmin(req: IncomingMessage): void {
  if (!hasValidToken(process.env.ADMIN_API_TOKEN, bearerToken(req), req)) {
    throw httpError(401, "Unauthorized");
  }
}

export function requireWebhook(req: IncomingMessage): void {
  if (!hasValidToken(process.env.GRANOLA_WEBHOOK_TOKEN, header(req, "x-perry-webhook-token"), req)) {
    throw httpError(401, "Unauthorized webhook");
  }
}

/** A configured secret must match; an unconfigured one only admits trusted local requests. */
function hasValidToken(expected: string | undefined, provided: string | undefined, req: IncomingMessage): boolean {
  if (expected) return provided !== undefined && safeEqual(provided, expected);
  return isTrustedLocalRequest(req);
}

/** Loopback peer, loopback Host header, and no X-Forwarded-For header (a proxied request). */
export function isTrustedLocalRequest(req: IncomingMessage): boolean {
  const peer = req.socket.remoteAddress ?? "";
  const host = (req.headers.host ?? "").replace(/:\d+$/u, "");
  return isLoopbackHost(peer) && isLoopbackHost(host) && !req.headers["x-forwarded-for"];
}

function bearerToken(req: IncomingMessage): string | undefined {
  const authorization = header(req, "authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/iu);
  return match?.[1].trim() ?? header(req, "x-admin-token");
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
