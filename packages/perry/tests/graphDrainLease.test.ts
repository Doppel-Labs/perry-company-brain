// Drains under a short lease: slow posts must not let a second worker take over
// healthy work, and each episode must be posted exactly once (Codex review on
// Doppel-Labs #4).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { drainGraphSyncJobs, enqueueMeetingGraphSync } from "@graph";
import { closeBrainStore, listGraphSyncJobs } from "@store";

const managedEnv = [
  "PERRY_DB_PATH",
  "PERRY_JOB_LEASE_MS",
  "PERRY_GRAPHITI_ENABLED",
  "PERRY_GRAPHITI_BRIDGE_URL",
  "PERRY_GRAPHITI_GROUP_ID",
  "PERRY_GRAPHITI_DIRECT_CHANGESETS",
  "PERRY_GRAPHITI_TIMEOUT_MS",
];

function enqueueMeeting(index: number): void {
  const sourceId = `lease-note-${index}`;
  enqueueMeetingGraphSync({
    note: { source: "granola", sourceId, title: `Lease Review ${index}`, attendees: [], summaryMarkdown: "Decision: keep leases." },
    record: {
      id: `granola:${sourceId}`,
      source: "granola",
      sourceId,
      title: `Lease Review ${index}`,
      createdAt: "2026-05-23T15:00:00.000Z",
      updatedAt: "2026-05-23T15:01:00.000Z",
      status: "processed",
    },
    knowledge: { decisions: [{ text: "keep leases" }], actionItems: [] },
  });
}

test("concurrent drains with posts slower than the lease post each episode once", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-graph-lease-"));
  const previous = new Map(managedEnv.map((name) => [name, process.env[name]]));
  const posted = new Map<string, number>();
  // Each post takes 3x the lease. The timings leave the heartbeat (every lease/3)
  // ample slack, so a slow or cold-starting machine cannot fake a stall.
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const name = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { name: string }).name;
      posted.set(name, (posted.get(name) ?? 0) + 1);
      setTimeout(() => res.writeHead(202, { "content-type": "application/json" }).end('{"ok":true}'), 1200);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");

  for (const name of managedEnv) delete process.env[name];
  Object.assign(process.env, {
    PERRY_DB_PATH: join(tempDir, "perry.sqlite"),
    PERRY_JOB_LEASE_MS: "400",
    PERRY_GRAPHITI_ENABLED: "true",
    PERRY_GRAPHITI_BRIDGE_URL: `http://127.0.0.1:${address.port}`,
    PERRY_GRAPHITI_GROUP_ID: "lease-test",
    PERRY_GRAPHITI_TIMEOUT_MS: "5000",
  });
  try {
    for (let index = 0; index < 3; index += 1) enqueueMeeting(index);

    // The second worker starts once the first claim's lease would have expired,
    // which is when a batch-claiming drain used to lose its waiting jobs.
    const later = new Promise<void>((resolve) => setTimeout(resolve, 600)).then(() => drainGraphSyncJobs(10));
    const [first, second] = await Promise.all([drainGraphSyncJobs(10), later]);

    assert.equal(first.processed + second.processed, 3);
    assert.equal(first.failed + second.failed, 0);
    assert.deepEqual([...posted.values()], [1, 1, 1], "every episode posted exactly once");
    for (const job of listGraphSyncJobs({ limit: 10 })) {
      assert.equal(job.status, "completed");
      assert.equal(job.attempts, 0, `${job.id} never lost its lease`);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeBrainStore(process.env.PERRY_DB_PATH);
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
