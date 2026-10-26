import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertSafeBind, createAdminHttpServer, isLoopbackHost } from "@server";

const TOKEN_KEYS = ["ADMIN_API_TOKEN", "GRANOLA_WEBHOOK_TOKEN"] as const;
process.env.PERRY_DB_PATH = join(mkdtempSync(join(tmpdir(), "perry-admin-auth-")), "perry.sqlite");

test("admin API requires the admin token on reads and writes", async () => {
  await withEnv({ ADMIN_API_TOKEN: "admin-secret", GRANOLA_WEBHOOK_TOKEN: "hook-secret" }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/ping`)).status, 200);
    for (const path of ["/api/config", "/api/health", "/api/brain/search?q=x", "/api/meetings/history", "/api/users"]) {
      assert.equal((await fetch(`${baseUrl}${path}`)).status, 401, `${path} must be protected`);
      assert.equal((await fetch(`${baseUrl}${path}`, { headers: { authorization: "Bearer wrong" } })).status, 401);
    }
    const authorized = await fetch(`${baseUrl}/api/users`, { headers: { authorization: "Bearer admin-secret" } });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get("x-content-type-options"), "nosniff");
    assert.equal(authorized.headers.get("cache-control"), "no-store");

    const preview = await fetch(`${baseUrl}/api/granola/preview`, { method: "POST", body: "{}" });
    assert.equal(preview.status, 401);
  });
});

test("Granola webhook accepts only its own token", async () => {
  await withEnv({ ADMIN_API_TOKEN: "admin-secret", GRANOLA_WEBHOOK_TOKEN: "hook-secret" }, async (baseUrl) => {
    const post = (headers: Record<string, string>) =>
      fetch(`${baseUrl}/api/granola/zapier?dryRun=true`, { method: "POST", headers, body: "{}" });
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ "x-perry-webhook-token": "admin-secret" })).status, 401);
    assert.notEqual((await post({ "x-perry-webhook-token": "hook-secret" })).status, 401);
  });
});

test("without a configured token only genuine local requests are trusted", async () => {
  await withEnv({}, async (baseUrl, port) => {
    assert.equal((await fetch(`${baseUrl}/api/users`)).status, 200);
    // DNS-rebinding page: loopback peer but a foreign Host header.
    assert.equal(await rawStatus(port, "GET", "/api/users", { host: `evil.example:${port}` }), 401);
    // A local reverse proxy forwarding remote traffic.
    assert.equal((await fetch(`${baseUrl}/api/users`, { headers: { "x-forwarded-for": "203.0.113.9" } })).status, 401);
    assert.equal(await rawStatus(port, "POST", "/api/granola/zapier", { host: "evil.example" }), 401);
  });
});

test("rejects oversized and malformed JSON bodies", async () => {
  await withEnv({ ADMIN_API_TOKEN: "admin-secret" }, async (baseUrl) => {
    const headers = { authorization: "Bearer admin-secret", "content-type": "application/json" };
    const malformed = await fetch(`${baseUrl}/api/issues`, { method: "POST", headers, body: "{not json" });
    assert.equal(malformed.status, 400);
    const huge = await fetch(`${baseUrl}/api/issues`, { method: "POST", headers, body: `"${"x".repeat(3 * 1024 * 1024)}"` }).catch(
      () => undefined
    );
    if (huge) assert.equal(huge.status, 413);
  });
});

test("unknown API routes are auth-gated 404s and bad input is a 400, never a 500", async () => {
  await withEnv({ ADMIN_API_TOKEN: "admin-secret" }, async (baseUrl) => {
    const auth = { authorization: "Bearer admin-secret" };
    assert.equal((await fetch(`${baseUrl}/api/does-not-exist`)).status, 401);
    const missing = await fetch(`${baseUrl}/api/does-not-exist`, { headers: auth });
    assert.equal(missing.status, 404);
    assert.equal((await fetch(`${baseUrl}/api/issues/%E0%A4%A/events`, { headers: auth })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/brain/tools/evidence`, { headers: auth })).status, 400);
    const unknownApproval = await fetch(`${baseUrl}/api/approvals/does-not-exist/approve`, { method: "POST", headers: auth });
    assert.equal(unknownApproval.status, 404);
    assert.equal((await fetch(`${baseUrl}/api/approvals/does-not-exist/reject`, { method: "POST", headers: auth })).status, 404);
    const badIssue = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ title: 42 }),
    });
    assert.equal(badIssue.status, 400);
    assert.match(((await badIssue.json()) as { error: string }).error, /title/u);
  });
});

test("refuses a non-loopback bind without an admin token", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("[::1]"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  const previous = process.env.ADMIN_API_TOKEN;
  delete process.env.ADMIN_API_TOKEN;
  try {
    assert.throws(() => assertSafeBind("0.0.0.0"), /ADMIN_API_TOKEN/u);
    assert.doesNotThrow(() => assertSafeBind("127.0.0.1"));
  } finally {
    if (previous !== undefined) process.env.ADMIN_API_TOKEN = previous;
  }
});

async function withEnv(
  env: Partial<Record<(typeof TOKEN_KEYS)[number], string>>,
  run: (baseUrl: string, port: number) => Promise<void>
): Promise<void> {
  const previous = new Map(TOKEN_KEYS.map((key) => [key, process.env[key]]));
  for (const key of TOKEN_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  const server: Server = createAdminHttpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`, address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** fetch() ignores a forged Host header, so DNS-rebinding checks go through node:http. */
function rawStatus(port: number, method: string, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}
