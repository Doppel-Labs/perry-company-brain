import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  claimIngestionJobs,
  claimNextIngestionJob,
  closeBrainStore,
  enqueueIngestionJob,
  enqueueGraphSyncJob,
  claimGraphSyncJobs,
  jobLeaseMs,
  listGraphSyncJobs,
  listIngestionJobs,
  withDb,
} from "@store";

async function withTempBrain(run: () => void): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-job-queue-"));
  const previous = { db: process.env.PERRY_DB_PATH, lease: process.env.PERRY_JOB_LEASE_MS };
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_JOB_LEASE_MS = "60000";
  try {
    run();
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    restoreEnv("PERRY_DB_PATH", previous.db);
    restoreEnv("PERRY_JOB_LEASE_MS", previous.lease);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// Simulates a worker that claimed the job and then crashed `ageMs` ago.
function ageLock(table: string, id: string, ageMs: number): void {
  const lockedAt = new Date(Date.now() - ageMs).toISOString();
  withDb((db) => db.prepare(`UPDATE ${table} SET locked_at = ? WHERE id = ?`).run(lockedAt, id));
}

function enqueueTestJob(id: string, maxAttempts?: number) {
  return enqueueIngestionJob({ id, idempotencyKey: `key:${id}`, payloadJson: "{}", maxAttempts }).job;
}

test("PERRY_JOB_LEASE_MS falls back to 10 minutes when blank, invalid, or not positive", () => {
  const previous = process.env.PERRY_JOB_LEASE_MS;
  try {
    for (const value of [undefined, "", "  ", "soon", "0", "-5"]) {
      if (value === undefined) delete process.env.PERRY_JOB_LEASE_MS;
      else process.env.PERRY_JOB_LEASE_MS = value;
      assert.equal(jobLeaseMs(), 600_000, `value ${JSON.stringify(value)}`);
    }
    process.env.PERRY_JOB_LEASE_MS = "1500";
    assert.equal(jobLeaseMs(), 1500);
  } finally {
    restoreEnv("PERRY_JOB_LEASE_MS", previous);
  }
});

test("a job left processing past its lease is reclaimed and counted as an attempt", async () => {
  await withTempBrain(() => {
    const job = enqueueTestJob("job:stuck");
    assert.equal(claimNextIngestionJob()?.id, job.id);

    // Within the lease the job stays with its worker.
    ageLock("ingestion_jobs", job.id, 30_000);
    assert.deepEqual(claimIngestionJobs(5), []);

    ageLock("ingestion_jobs", job.id, 61_000);
    const [reclaimed] = claimIngestionJobs(5);
    assert.equal(reclaimed?.id, job.id);
    assert.equal(reclaimed?.status, "processing");
    assert.equal(reclaimed?.attempts, 1);
    assert.match(reclaimed?.lastError ?? "", /Lease expired/u);
  });
});

test("an expired lease on the last attempt retires the job as failed", async () => {
  await withTempBrain(() => {
    const job = enqueueTestJob("job:last-chance", 1);
    claimNextIngestionJob();
    ageLock("ingestion_jobs", job.id, 61_000);

    assert.equal(claimNextIngestionJob(), undefined);
    const [retired] = listIngestionJobs();
    assert.equal(retired.status, "failed");
    assert.equal(retired.attempts, 1);
    assert.equal(retired.lockedAt, undefined);
    assert.match(retired.lastError ?? "", /Lease expired/u);
  });
});

test("the graph-sync queue shares the lease", async () => {
  await withTempBrain(() => {
    enqueueGraphSyncJob({ id: "graph-sync:stuck", entityType: "meeting", entityId: "granola:stuck", payloadJson: "{}" });
    assert.equal(claimGraphSyncJobs(1).length, 1);
    ageLock("graph_sync_jobs", "graph-sync:stuck", 61_000);

    const [reclaimed] = claimGraphSyncJobs(1);
    assert.equal(reclaimed?.id, "graph-sync:stuck");
    assert.equal(reclaimed?.attempts, 1);
    assert.equal(listGraphSyncJobs()[0].status, "processing");
  });
});
