// ingestion-queue — the store side of the durable Granola ingestion queue (table `ingestion_jobs`).
//
// Rows are written here and run through the shared engine in job-queue.ts;
// the processing loop that drives them lives in src/ingestion/queue.ts.
//
// Each job records the id of the meeting it ingests (`meeting_id`). When a job
// is retired (out of attempts, by a failure or an expired lease) while its
// meeting is mid-publish, the meeting is marked `failed` in the same write.
import type { DatabaseSync } from "node:sqlite";
import { type IngestionJobRecord, type Row } from "./types";
import { insertAudit, statement, withBrainTransaction, withDb } from "./database";
import { ingestionJobFromRow } from "./rows";
import { createJobQueue } from "./job-queue";
import { markMeetingFailedInDb } from "./meetings";

/**
 * Enqueue a Granola ingestion job, keyed by idempotency: a replayed webhook
 * (same idempotency key) returns the existing job with `created: false`
 * instead of queuing a duplicate, whatever that job's status. A new job starts
 * `queued`, due immediately, with `maxAttempts` 5 by default. Runs in one
 * transaction with an `ingestion_job.queued` audit row.
 *
 * `meetingId` (from meetingIdForNote) links the job to its meeting so a
 * retired job can mark that meeting failed.
 *
 * The key is also written to `idempotency_keys`, but dedupe reads
 * `ingestion_jobs.idempotency_key` directly, and the ledger row cascades away
 * with its job, so the ledger adds no guarantee of its own today.
 */
export function enqueueIngestionJob(input: {
  id: string;
  idempotencyKey: string;
  payloadJson: string;
  meetingId?: string;
  type?: IngestionJobRecord["type"];
  maxAttempts?: number;
}): { job: IngestionJobRecord; created: boolean } {
  const now = new Date().toISOString();
  return withDb((db) =>
    withBrainTransaction(() => {
      const existing = statement(db, "SELECT * FROM ingestion_jobs WHERE idempotency_key = ?").get(
        input.idempotencyKey
      ) as Row | undefined;
      if (existing) return { job: ingestionJobFromRow(existing), created: false };

      statement(
        db,
        `INSERT INTO ingestion_jobs (
          id, type, idempotency_key, status, payload_json, attempts, max_attempts,
          not_before, created_at, updated_at, meeting_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.id,
        input.type ?? "granola.ingest",
        input.idempotencyKey,
        "queued",
        input.payloadJson,
        0,
        input.maxAttempts ?? 5,
        now,
        now,
        now,
        input.meetingId ?? null
      );
      statement(db, "INSERT INTO idempotency_keys (key, job_id, created_at) VALUES (?, ?, ?)").run(
        input.idempotencyKey,
        input.id,
        now
      );
      const row = statement(db, "SELECT * FROM ingestion_jobs WHERE id = ?").get(input.id) as Row;
      insertAudit(db, "ingestion_job.queued", "ingestion_job", input.id, { idempotencyKey: input.idempotencyKey });
      return { job: ingestionJobFromRow(row), created: true };
    })
  );
}

// claim(batch) / complete / fail / stats / list come from the shared engine.
// Claims are restricted to type 'granola.ingest'; retries back off up to 60 s.
const queue = createJobQueue<IngestionJobRecord>({
  table: "ingestion_jobs",
  mapRow: ingestionJobFromRow,
  events: { prefix: "ingestion_job", entity: "ingestion_job" },
  backoff: { capMs: 60_000, maxExp: 6 },
  claim: { where: "type = ?", params: ["granola.ingest"] },
  onFail: (db, id, message, status) => {
    if (status === "failed") markJobMeetingFailed(db, id, message);
  },
});

function markJobMeetingFailed(db: DatabaseSync, jobId: string, message: string): void {
  const row = statement(db, "SELECT meeting_id FROM ingestion_jobs WHERE id = ?").get(jobId) as Row | undefined;
  if (row?.meeting_id) markMeetingFailedInDb(db, String(row.meeting_id), message);
}

/** Claim the oldest due `granola.ingest` job (queued → processing, reclaiming expired leases first), or undefined if none is due. Used by the background worker. */
export function claimNextIngestionJob(): IngestionJobRecord | undefined {
  return queue.claim(1)[0];
}

export const claimIngestionJobs = queue.claim;
export const completeIngestionJob = queue.complete;
export const failIngestionJob = queue.fail;
export const getIngestionQueueStats = queue.stats;
export const listIngestionJobs = queue.list;
