// Lease ownership: fencing, renewal, release, and the heartbeat that keeps a
// slow job from being mistaken for a crashed one (Codex review on Doppel-Labs #4).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  claimIngestionJobs,
  claimNextIngestionJob,
  closeBrainStore,
  completeIngestionJob,
  enqueueIngestionJob,
  failIngestionJob,
  listIngestionJobs,
  releaseIngestionJob,
  renewIngestionJobLease,
  withDb,
  withIngestionJobLease,
} from "@store";

async function withTempBrain(leaseMs: string, run: () => Promise<void> | void): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-job-lease-"));
  const previous = { db: process.env.PERRY_DB_PATH, lease: process.env.PERRY_JOB_LEASE_MS };
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_JOB_LEASE_MS = leaseMs;
  try {
    await run();
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    for (const [name, value] of [["PERRY_DB_PATH", previous.db], ["PERRY_JOB_LEASE_MS", previous.lease]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const enqueue = (id: string) => enqueueIngestionJob({ id, idempotencyKey: `key:${id}`, payloadJson: "{}" }).job;
const job = (id: string) => listIngestionJobs({ limit: 50 }).find((item) => item.id === id)!;
const ageLock = (id: string, ageMs: number) =>
  withDb((db) => db.prepare("UPDATE ingestion_jobs SET locked_at = ? WHERE id = ?").run(new Date(Date.now() - ageMs).toISOString(), id));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("every claim gets its own lease token", async () => {
  await withTempBrain("60000", () => {
    enqueue("a");
    enqueue("b");
    const claimed = claimIngestionJobs(2);
    assert.equal(claimed.length, 2);
    assert.ok(claimed[0].leaseToken && claimed[1].leaseToken);
    assert.notEqual(claimed[0].leaseToken, claimed[1].leaseToken);
  });
});

test("a worker whose lease was reclaimed cannot complete or fail the job", async () => {
  await withTempBrain("60000", () => {
    enqueue("fenced");
    const stale = claimNextIngestionJob()!;
    ageLock("fenced", 61_000);
    const current = claimNextIngestionJob()!;
    assert.equal(current.id, "fenced");
    assert.notEqual(current.leaseToken, stale.leaseToken);

    assert.equal(completeIngestionJob("fenced", { from: "stale" }, stale.leaseToken), undefined);
    assert.equal(failIngestionJob("fenced", new Error("stale"), stale.leaseToken), undefined);
    assert.equal(job("fenced").status, "processing", "the stale worker changed nothing");
    assert.equal(job("fenced").leaseToken, current.leaseToken);

    assert.equal(completeIngestionJob("fenced", { from: "current" }, current.leaseToken)?.status, "completed");
  });
});

test("renew extends only a lease that is still held", async () => {
  await withTempBrain("60000", () => {
    enqueue("renewed");
    const claimed = claimNextIngestionJob()!;
    ageLock("renewed", 50_000);
    assert.equal(renewIngestionJobLease("renewed", claimed.leaseToken!), true);
    // Renewed just now, so 50 s later it is still inside the 60 s lease.
    ageLock("renewed", 0);
    assert.deepEqual(claimIngestionJobs(5), []);
    assert.equal(renewIngestionJobLease("renewed", "some-other-token"), false);
  });
});

test("release hands a claimed job back without counting an attempt", async () => {
  await withTempBrain("60000", () => {
    enqueue("released");
    const claimed = claimNextIngestionJob()!;
    assert.equal(releaseIngestionJob("released", claimed.leaseToken!), true);
    assert.equal(job("released").status, "queued");
    assert.equal(job("released").attempts, 0);
    assert.equal(job("released").leaseToken, undefined);
    assert.equal(releaseIngestionJob("released", claimed.leaseToken!), false, "no longer held");
    assert.equal(claimNextIngestionJob()?.id, "released", "due again at once");
  });
});

test("the heartbeat keeps a slow job's lease alive across several lease periods", async () => {
  await withTempBrain("150", async () => {
    enqueue("slow");
    const claimed = claimNextIngestionJob()!;
    let reclaimedByOtherWorker = 0;
    const run = await withIngestionJobLease(claimed, async () => {
      for (let tick = 0; tick < 6; tick += 1) {
        await sleep(100);
        reclaimedByOtherWorker += claimIngestionJobs(5).length;
      }
      return "done";
    });
    assert.deepEqual(run, { owned: true, value: "done" });
    assert.equal(reclaimedByOtherWorker, 0, "600 ms of work under a 150 ms lease was never reclaimed");
    assert.equal(job("slow").attempts, 0);
  });
});

test("a job whose lease was lost before it started is not run", async () => {
  await withTempBrain("60000", async () => {
    enqueue("lost");
    const waiting = claimNextIngestionJob()!;
    ageLock("lost", 61_000);
    claimNextIngestionJob(); // another worker reclaims it
    let ran = false;
    const run = await withIngestionJobLease(waiting, async () => {
      ran = true;
    });
    assert.deepEqual(run, { owned: false });
    assert.equal(ran, false);
  });
});
