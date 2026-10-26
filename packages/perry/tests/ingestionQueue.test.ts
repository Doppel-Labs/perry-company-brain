import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { drainGranolaIngestionJobs, enqueueGranolaIngestionJob, getIngestionQueueSnapshot } from "@ingestion";
import {
  closeBrainStore,
  countApprovals,
  getMeetingRecord,
  listActionItems,
  listApprovals,
  listDecisions,
  listIngestionJobs,
  withDb,
} from "@store";

test("deduplicates queued Granola ingestion jobs and drains them", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-ingestion-queue-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    const payload = {
      note_id: "queue-note-1",
      title: "Queued Review",
      summary: "Decision: queue first.\n\nAction items:\n- Ada: Review the queue",
    };

    const first = enqueueGranolaIngestionJob(payload);
    const second = enqueueGranolaIngestionJob(payload);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.job.id, second.job.id);
    assert.equal(getIngestionQueueSnapshot().stats.queued, 1);
    const summary = getIngestionQueueSnapshot({ limit: 1 }).recent[0];
    assert.equal(summary.hasPayload, true);
    assert.equal("payloadJson" in summary, false);

    const drained = await drainGranolaIngestionJobs(5);
    assert.equal(drained.processed, 1);
    assert.equal(drained.failed, 0);
    assert.equal(getIngestionQueueSnapshot().stats.completed, 1);
    assert.equal(listApprovals("pending").length, 1);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("drains more jobs than one claim page", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-ingestion-queue-page-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    const count = 1005;
    for (let index = 0; index < count; index += 1) {
      enqueueGranolaIngestionJob({
        note_id: `queue-page-note-${index}`,
        title: `Queued Page Review ${index}`,
        summary: "Decision: drain every page.\n\nAction items:\n- Perry: Finish the batch",
      });
    }

    const drained = await drainGranolaIngestionJobs(count);
    assert.equal(drained.processed, count);
    assert.equal(drained.failed, 0);
    assert.equal(getIngestionQueueSnapshot({ limit: 0 }).stats.completed, count);
    assert.equal(countApprovals("pending"), count);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("a bypassApproval enqueue gets its own job instead of the earlier held one", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-ingestion-queue-bypass-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    const payload = { note_id: "bypass-note", title: "Bypass Review", summary: "Decision: ship it." };
    const held = enqueueGranolaIngestionJob(payload);
    const bypass = enqueueGranolaIngestionJob(payload, { bypassApproval: true });
    const bypassAgain = enqueueGranolaIngestionJob(payload, { bypassApproval: true });

    assert.equal(bypass.created, true);
    assert.notEqual(bypass.job.id, held.job.id);
    assert.equal(JSON.parse(bypass.job.payloadJson).options.bypassApproval, true);
    assert.equal(bypassAgain.created, false);
    assert.equal(bypassAgain.job.id, bypass.job.id);
    // Keys of non-bypass jobs keep their original format.
    assert.equal(held.job.idempotencyKey, "granola.ingest:granola:bypass-note:normal");
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("a job that fails mid-batch leaves no partial writes, and its failure is recorded", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-ingestion-queue-atomic-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    enqueueGranolaIngestionJob({
      note_id: "atomic-good",
      title: "Good Review",
      summary: "Decision: keep going.\n\nAction items:\n- Ada: Ship",
    });
    enqueueGranolaIngestionJob({
      note_id: "atomic-bad",
      title: "Explode",
      summary: "Decision: this one fails.\n\nAction items:\n- Bo: Never stored",
    });
    // The approval is the last write of a held job, so by the time it fails
    // the meeting and its knowledge have already been written.
    withDb((db) =>
      db.exec(`CREATE TRIGGER explode_approval BEFORE INSERT ON approvals WHEN NEW.title = 'Explode'
        BEGIN SELECT RAISE(ABORT, 'approval insert failed'); END;`)
    );

    const drained = await drainGranolaIngestionJobs(5);

    assert.deepEqual(drained, { processed: 1, failed: 1, leaseLost: 0 });
    assert.equal(getMeetingRecord("granola:atomic-bad"), undefined);
    assert.equal(listDecisions(10).some((decision) => decision.meetingId === "granola:atomic-bad"), false);
    assert.equal(listActionItems(10).some((action) => action.meetingId === "granola:atomic-bad"), false);
    assert.equal(getMeetingRecord("granola:atomic-good")?.status, "pending_approval");
    assert.equal(countApprovals("pending"), 1);

    const failedJob = listIngestionJobs().find((job) => job.idempotencyKey.includes("atomic-bad"));
    assert.equal(failedJob?.status, "queued");
    assert.equal(failedJob?.attempts, 1);
    assert.match(failedJob?.lastError ?? "", /approval insert failed/u);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
