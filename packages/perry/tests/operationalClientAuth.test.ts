import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import test from "node:test";

async function runScript(script: string, env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [resolve("scripts", script), ...(script.includes("gauntlet") ? ["--strict"] : [])],
      { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("close", code => resolveRun({ code, output }));
  });
}

test("benchmark and strict gauntlet authenticate only the intended services", async () => {
  const seen: Array<{ path: string; authorization?: string; webhook?: string }> = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url!, authorization: req.headers.authorization, webhook: req.headers["x-perry-webhook-token"] as string | undefined });
    req.resume();
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const env = { ADMIN_API_TOKEN: "client-test-admin", GRANOLA_WEBHOOK_TOKEN: "client-test-webhook",
    PERRY_PERF_URL: origin, PERRY_HTTP_REQUESTS: "1", PERRY_HTTP_WARMUP: "0", PERRY_HTTP_CONCURRENCY: "1",
    PERRY_ADMIN_URL: origin, PERRY_GRAPHITI_BRIDGE_URL: origin + "/graphiti", LMSTUDIO_BASE_URL: origin + "/lm/v1", LMSTUDIO_API_KEY: "client-test-model",
    PERRY_GAUNTLET_REPLAY_CHANGE_SET_ID: "" };
  try {
    const benchmark = await runScript("perf-http.cjs", env);
    assert.equal(benchmark.code, 0, benchmark.output);
    assert.equal(seen.length, 10);
    for (const call of seen) {
      if (call.path.startsWith("/api/granola/zapier")) {
        assert.equal(call.webhook, "client-test-webhook");
        assert.equal(call.authorization, undefined);
      } else if (call.path === "/api/ping") {
        assert.equal(call.authorization, undefined);
      } else {
        assert.equal(call.authorization, "Bearer client-test-admin", call.path);
        assert.equal(call.webhook, undefined);
      }
    }
    seen.length = 0;
    const gauntlet = await runScript("local-brain-gauntlet.cjs", env);
    assert.equal(gauntlet.code, 0, gauntlet.output);
    assert.equal(seen.length, 9);
    for (const call of seen) {
      if (call.path.startsWith("/graphiti/") || call.path === "/api/ping") assert.equal(call.authorization, undefined);
      else if (call.path.startsWith("/lm/")) assert.equal(call.authorization, "Bearer client-test-model");
      else assert.equal(call.authorization, "Bearer client-test-admin", call.path);
      assert.equal(call.webhook, undefined);
    }
    seen.length = 0;
    const unconfigured = await runScript("perf-http.cjs", { ...env, ADMIN_API_TOKEN: "" });
    assert.equal(unconfigured.code, 1);
    assert.equal(seen.length, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  }
});

test("benchmark refuses admin and webhook redirects without leaking credentials", async () => {
  for (const redirectPath of ["/api/health", "/api/granola/zapier?dryRun=true"]) {
    let leaked = 0;
    let redirectedHeaders: Record<string, unknown> | undefined;
    const target = createServer((req, res) => { leaked++; req.resume(); res.end("{}"); });
    target.listen(0, "127.0.0.1"); await once(target, "listening");
    const targetUrl = "http://127.0.0.1:" + (target.address() as { port: number }).port;
    const redirect = createServer((req, res) => {
      req.resume();
      if (req.url === redirectPath) {
        redirectedHeaders = req.headers;
        res.writeHead(302, { location: targetUrl + "/capture" });
      } else res.setHeader("content-type", "application/json");
      res.end("{}");
    });
    redirect.listen(0, "127.0.0.1"); await once(redirect, "listening");
    try {
      const result = await runScript("perf-http.cjs", { ADMIN_API_TOKEN: "redirect-test-admin", GRANOLA_WEBHOOK_TOKEN: "redirect-test-webhook",
        PERRY_PERF_URL: "http://127.0.0.1:" + (redirect.address() as { port: number }).port, PERRY_HTTP_REQUESTS: "1", PERRY_HTTP_WARMUP: "0" });
      assert.equal(result.code, 1);
      assert.ok(redirectedHeaders, "must reach the credential-bearing endpoint");
      if (redirectPath === "/api/health") assert.equal(redirectedHeaders.authorization, "Bearer redirect-test-admin");
      else assert.equal(redirectedHeaders["x-perry-webhook-token"], "redirect-test-webhook");
      assert.equal(leaked, 0);
    } finally {
      target.closeAllConnections(); redirect.closeAllConnections();
      await Promise.all([new Promise<void>(r => target.close(() => r())), new Promise<void>(r => redirect.close(() => r()))]);
    }
  }
});
