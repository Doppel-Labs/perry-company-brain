// auth — the single access policy for the admin HTTP server.
//
// Fail closed: routes declare an Access level (see router.ts) and default to
// "admin". Only the liveness ping is public; the Granola webhook has its own
// token, and the two tokens are never interchangeable. An unset token disables
// what it protects: every admin route (or the webhook) answers 503 rather than
// running without authentication, so a forgotten secret can never mean an open
// API. `pnpm bootstrap` generates both tokens for local development.
//
// The server also binds to loopback by default, and a non-loopback bind
// refuses to start without ADMIN_API_TOKEN, so a misconfigured deployment fails
// at startup instead of serving 503s to the network.
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

/** Refuse to expose the admin API beyond this machine without a token. */
export function assertSafeBind(host: string): void {
  if (isLoopbackHost(host)) return;
  if (!process.env.ADMIN_API_TOKEN?.trim()) {
    throw new Error(
      `Refusing to bind the admin server to ${host} without ADMIN_API_TOKEN. ` +
        "Set ADMIN_API_TOKEN (and serve it over HTTPS) or keep ADMIN_HOST=127.0.0.1."
    );
  }
  if (!process.env.GRANOLA_WEBHOOK_TOKEN?.trim()) {
    console.warn("GRANOLA_WEBHOOK_TOKEN is not set: /api/granola/zapier answers 503 until it is.");
  }
}

/** Throws 503 when the required token is not configured, 401 when the request does not carry it. */
export function authorize(req: IncomingMessage, access: Access): void {
  if (access === "admin") requireAdmin(req);
  else if (access === "webhook") requireWebhook(req);
}

export function requireAdmin(req: IncomingMessage): void {
  requireToken(process.env.ADMIN_API_TOKEN, bearerToken(req), "Admin authentication is not configured", "Unauthorized");
}

export function requireWebhook(req: IncomingMessage): void {
  requireToken(
    process.env.GRANOLA_WEBHOOK_TOKEN,
    header(req, "x-perry-webhook-token"),
    "Webhook authentication is not configured",
    "Unauthorized webhook"
  );
}

function requireToken(expected: string | undefined, provided: string | undefined, unconfigured: string, unauthorized: string): void {
  const secret = expected?.trim();
  if (!secret) throw httpError(503, unconfigured);
  if (provided === undefined || !safeEqual(provided, secret)) throw httpError(401, unauthorized);
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

/** Constant-time comparison; a length mismatch fails without comparing bytes. */
function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
