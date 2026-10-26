// Bounded JSON bodies, ported from the Doppel Labs security fix (8f977f7) onto
// the http/request module.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { maxJsonBodyBytes as MAX_JSON_BODY_BYTES, readJson } from "../src/server/http/request";
import { createAdminHttpServer } from "../src/server/http";

function body(parts: Array<Buffer | string>, headers: IncomingMessage["headers"] = {}): IncomingMessage {
  return Object.assign(Readable.from(parts), { headers }) as IncomingMessage;
}
const isStatus = (status: number) => (error: unknown) => (error as { status?: number }).status === status;

test("JSON reader accepts split UTF-8, empty input and an exact-limit body", async () => {
  const encoded = Buffer.from(JSON.stringify({ text: "é🙂" }));
  assert.deepEqual(await readJson(body([encoded.subarray(0, 11), encoded.subarray(11)])), { text: "é🙂" });
  assert.deepEqual(await readJson(body([])), {});
  assert.equal(await readJson(body([JSON.stringify("a".repeat(MAX_JSON_BODY_BYTES - 2))])), "a".repeat(MAX_JSON_BODY_BYTES - 2));
});

test("JSON reader rejects announced oversized input before consuming it", async () => {
  const req = body([], { "content-length": String(MAX_JSON_BODY_BYTES + 1) });
  let consumed = false;
  req.iterator = (() => { consumed = true; throw new Error("must not consume"); }) as typeof req.iterator;
  await assert.rejects(readJson(req), isStatus(413));
  assert.equal(consumed, false);
});

test("JSON reader bounds actual streamed bytes even with absent or understated length", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    await assert.rejects(readJson(body([Buffer.alloc(MAX_JSON_BODY_BYTES), Buffer.from("x")], headers)), isStatus(413));
  }
});

test("JSON reader reports malformed JSON and invalid lengths as client errors", async () => {
  await assert.rejects(readJson(body(["{"])), isStatus(400));
  await assert.rejects(readJson(body([], { "content-length": "invalid" })), isStatus(400));
});

test("production server returns 413 for authorized chunked and announced oversized bodies", async () => {
  const previous = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = "body-test-admin";
  const server = createAdminHttpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const send = (headers: Record<string, string>, chunks: Buffer[]) => new Promise<number>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/api/granola/preview", method: "POST",
      headers: { authorization: "Bearer body-test-admin", "content-type": "application/json", ...headers } }, res => {
      assert.equal(res.headers.connection, "close");
      res.resume();
      res.once("end", () => resolve(res.statusCode!));
    });
    req.on("error", reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
  try {
    assert.equal(await send({ "content-length": String(MAX_JSON_BODY_BYTES + 1) }, []), 413);
    assert.equal(await send({}, [Buffer.alloc(MAX_JSON_BODY_BYTES), Buffer.alloc(1)]), 413);
    assert.equal((await fetch("http://127.0.0.1:" + port + "/api/ping")).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.ADMIN_API_TOKEN; else process.env.ADMIN_API_TOKEN = previous;
  }
});
