// ingestion-queue — durable queue for Granola webhook ingestion jobs.
import { type IngestionJobRecord, type Row } from "./types";
import { insertAudit, statement, withBrainTransaction, withDb } from "./db";
import { ingestionJobFromRow } from "./rows";
import { createJobQueue } from "./job-queue";

/**
 * Enqueue a Granola ingestion job, keyed by idempotency: a replayed webhook
 * (same idempotency key) returns the existing job instead of queuing a
 * duplicate. The key is also written to a dedicated `idempotency_keys` ledger so
 * the guarantee survives even if the job row is later pruned.
 */
export function enqueueIngestionJob(input: {
  id: string;
  idempotencyKey: string;
  payloadJson: string;
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
          not_before, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        now
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

/** Claim a single due ingestion job — the worker's one-at-a-time fast path. */
export function claimNextIngestionJob(): IngestionJobRecord | undefined {
  return withDb((db) =>
    withBrainTransaction(() => {
      const now = new Date().toISOString();
      const row = statement(
        db,
        `SELECT * FROM ingestion_jobs
         WHERE type = ? AND status = ? AND not_before <= ?
         ORDER BY created_at ASC
         LIMIT 1`
      ).get("granola.ingest", "queued", now) as Row | undefined;
      if (!row) return undefined;
      const id = String(row.id);
      statement(db, "UPDATE ingestion_jobs SET status = ?, locked_at = ?, updated_at = ? WHERE id = ?").run(
        "processing",
        now,
        now,
        id
      );
      return ingestionJobFromRow(statement(db, "SELECT * FROM ingestion_jobs WHERE id = ?").get(id) as Row);
    })
  );
}

// claim(batch) / complete / fail / stats / list come from the shared engine.
const queue = createJobQueue<IngestionJobRecord>({
  table: "ingestion_jobs",
  mapRow: ingestionJobFromRow,
  events: { prefix: "ingestion_job", entity: "ingestion_job" },
  backoff: { capMs: 60_000, maxExp: 6 },
  claim: { where: "type = ?", params: ["granola.ingest"] },
});

export const claimIngestionJobs = queue.claim;
export const completeIngestionJob = queue.complete;
export const failIngestionJob = queue.fail;
export const getIngestionQueueStats = queue.stats;
export const listIngestionJobs = queue.list;
