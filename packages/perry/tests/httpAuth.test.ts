// Authentication policy, ported from the Doppel Labs security fix (4d5b1c5) onto
// the declarative router: route access comes from the real route table.
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import { apiRoutes } from "../src/server/controllers";
import { authorize, requireAdmin, requireWebhook } from "../src/server/auth";
import { Router } from "../src/server/router";

const router = new Router(apiRoutes);
const request = (headers: IncomingMessage["headers"] = {}, method = "GET") => ({ headers, method }) as IncomingMessage;
const status = (code: number) => (error: unknown) => (error as { status?: number }).status === code;

/** What the server does before any handler runs: non-API paths are open, API paths need their route's access. */
function authorizeApiRequest(req: IncomingMessage, pathname: string): void {
  if (!pathname.startsWith("/api/")) return;
  authorize(req, router.accessFor(req.method ?? "GET", pathname));
}

test("admin and webhook authentication fail closed without configured tokens", () => {
  const previous = { ...process.env };
  try {
    delete process.env.ADMIN_API_TOKEN;
    delete process.env.GRANOLA_WEBHOOK_TOKEN;
    assert.throws(() => requireAdmin(request()), status(503));
    assert.throws(() => requireWebhook(request()), status(503));
    process.env.ADMIN_API_TOKEN = "   ";
    assert.throws(() => requireAdmin(request({ authorization: "Bearer    " })), status(503), "a blank token is not configured");
    process.env.ADMIN_API_TOKEN = "test-admin-token";
    process.env.GRANOLA_WEBHOOK_TOKEN = "test-webhook-token";
    assert.throws(() => requireAdmin(request()), status(401));
    assert.throws(() => requireAdmin(request({ authorization: "Bearer wrong" })), status(401));
    assert.doesNotThrow(() => requireAdmin(request({ authorization: "Bearer test-admin-token" })));
    assert.doesNotThrow(() => requireAdmin(request({ "x-admin-token": "test-admin-token" })));
    assert.throws(() => requireWebhook(request({ authorization: "Bearer test-admin-token" })), status(401));
    assert.doesNotThrow(() => requireWebhook(request({ "x-perry-webhook-token": "test-webhook-token" })));
  } finally {
    process.env = previous;
  }
});

test("company reads and mutations require admin auth; only ping and the verified webhook are exempt", () => {
  const previous = { ...process.env };
  try {
    process.env.ADMIN_API_TOKEN = "test-admin-token";
    process.env.GRANOLA_WEBHOOK_TOKEN = "test-webhook-token";
    const paths = ["/api/config", "/api/health", "/api/meetings/history", "/api/brain/search", "/api/approvals", "/api/graph-sync/jobs", "/api/unknown", "/api/granola/zapier/extra"];
    for (const path of paths) {
      for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        assert.throws(() => authorizeApiRequest(request({}, method), path), status(401), `${method} ${path}`);
        assert.doesNotThrow(() => authorizeApiRequest(request({ authorization: "Bearer test-admin-token" }, method), path));
      }
    }
    assert.doesNotThrow(() => authorizeApiRequest(request(), "/api/ping"));
    assert.throws(() => authorizeApiRequest(request({}, "POST"), "/api/ping"), status(401));
    assert.throws(() => authorizeApiRequest(request({}, "POST"), "/api/granola/zapier"), status(401));
    assert.doesNotThrow(() => authorizeApiRequest(request({ "x-perry-webhook-token": "test-webhook-token" }, "POST"), "/api/granola/zapier"));
    assert.throws(() => authorizeApiRequest(request({ "x-perry-webhook-token": "test-webhook-token" }), "/api/granola/zapier"), status(401));
    assert.doesNotThrow(() => authorizeApiRequest(request(), "/"));
  } finally {
    process.env = previous;
  }
});
