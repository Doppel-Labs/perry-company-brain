import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function matches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const actualBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function requireAdmin(req: IncomingMessage): void {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) fail(503, "Admin authentication is not configured");
  const provided = req.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? req.headers["x-admin-token"];
  if (!matches(provided, token)) fail(401, "Unauthorized");
}

export function requireWebhook(req: IncomingMessage): void {
  const token = process.env.GRANOLA_WEBHOOK_TOKEN;
  if (!token) fail(503, "Webhook authentication is not configured");
  if (!matches(req.headers["x-perry-webhook-token"], token)) fail(401, "Unauthorized webhook");
}

/** Authenticate every API route before any handler can read company data. */
export function authorizeApiRequest(req: IncomingMessage, pathname: string): void {
  if (!pathname.startsWith("/api/")) return;
  if (req.method === "GET" && pathname === "/api/ping") return;
  if (req.method === "POST" && pathname === "/api/granola/zapier") {
    requireWebhook(req);
    return;
  }
  requireAdmin(req);
}
