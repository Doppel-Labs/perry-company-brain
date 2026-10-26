// graph-sync — the store side of the durable Graphiti graph-sync queue (table `graph_sync_jobs`).
//
// Each job carries one meeting episode for the Graphiti bridge. Its validated
// change-set (graph_change_sets) is stored alongside, and its `apply_status`
// follows the job: queued on enqueue, applied on complete, queued/failed on fail.
// A job whose change-set failed validation is never posted: it is written
// straight to `failed` (or skipped at drain time if it was queued earlier).
import { type GraphChangeSetRecord, type GraphSyncJobRecord, type Row } from "./types";
import { insertAudit, statement, withBrainTransaction, withDb } from "./database";
import { graphSyncJobFromRow } from "./rows";
import { markGraphChangeSetApplied, markGraphChangeSetFailed, upsertGraphChangeSet } from "./change-sets";
import { createJobQueue } from "./job-queue";

/**
 * Enqueue (or re-enqueue) a graph-sync job for a meeting. Unlike ingestion this
 * is keyed by job id with an upsert, so re-syncing a meeting resets the job and
 * its attempts, whatever its current status. When a change-set is
 * supplied it is persisted (and, if valid, materialized into the ontology
 * tables) in the same transaction, so the job and its payload commit
 * atomically. An invalid change-set is stored for review but its job is
 * written as `failed` with the reason, so it is never claimed or posted, and
 * the change-set's apply status is `failed` too. Writes a `graph_sync.queued`
 * or `graph_sync.skipped_invalid` audit row.
 */
export function enqueueGraphSyncJob(input: {
  id: string;
  entityType?: GraphSyncJobRecord["entityType"];
  entityId: string;
  payloadJson: string;
  maxAttempts?: number;
  graphChangeSet?: {
    id: string;
    groupId: string;
    validationStatus: GraphChangeSetRecord["validationStatus"];
    validationErrors: unknown[];
    validationWarnings: unknown[];
    changeSet: unknown;
  };
}): GraphSyncJobRecord {
  const now = new Date().toISOString();
  const invalid = input.graphChangeSet?.validationStatus === "invalid";
  const status: GraphSyncJobRecord["status"] = invalid ? "failed" : "queued";
  const lastError = invalid ? invalidChangeSetReason(input.graphChangeSet?.validationErrors ?? []) : null;
  return withDb((db) =>
    withBrainTransaction(() => {
      statement(
        db,
        `INSERT INTO graph_sync_jobs (
          id, entity_type, entity_id, status, payload_json, attempts, max_attempts,
          not_before, last_error, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          payload_json = excluded.payload_json,
          result_json = NULL,
          attempts = 0,
          max_attempts = excluded.max_attempts,
          not_before = excluded.not_before,
          locked_at = NULL,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at`
      ).run(
        input.id,
        input.entityType ?? "meeting",
        input.entityId,
        status,
        input.payloadJson,
        0,
        input.maxAttempts ?? 5,
        now,
        lastError,
        now,
        now
      );
      insertAudit(db, invalid ? "graph_sync.skipped_invalid" : "graph_sync.queued", "graph_sync_job", input.id, {
        entityId: input.entityId,
      });
      if (input.graphChangeSet) {
        upsertGraphChangeSet(db, {
          id: input.graphChangeSet.id,
          meetingId: input.entityId,
          graphSyncJobId: input.id,
          groupId: input.graphChangeSet.groupId,
          validationStatus: input.graphChangeSet.validationStatus,
          validationErrorsJson: JSON.stringify(input.graphChangeSet.validationErrors),
          validationWarningsJson: JSON.stringify(input.graphChangeSet.validationWarnings),
          changeSetJson: JSON.stringify(input.graphChangeSet.changeSet),
          applyStatus: invalid ? "failed" : "queued",
          lastError: lastError ?? undefined,
        });
      }
      return graphSyncJobFromRow(statement(db, "SELECT * FROM graph_sync_jobs WHERE id = ?").get(input.id) as Row);
    })
  );
}

/**
 * Retires a claimed job without posting it, because its change-set failed
 * validation: the job becomes `failed` (terminal, never retried) and its
 * change-set `failed`, both with `reason`. Writes a `graph_sync.skipped_invalid`
 * audit row. Undefined if the job is gone.
 */
export function skipInvalidGraphSyncJob(id: string, reason: string, leaseToken?: string): GraphSyncJobRecord | undefined {
  return withDb((db) =>
    withBrainTransaction(() => {
      const now = new Date().toISOString();
      // Fenced like complete/fail: only the current lease holder may retire the job.
      const fence = leaseToken === undefined ? "" : " AND status = 'processing' AND lease_token = ?";
      const result = statement(
        db,
        `UPDATE graph_sync_jobs SET status = ?, locked_at = NULL, lease_token = NULL, last_error = ?, updated_at = ? WHERE id = ?${fence}`
      ).run("failed", reason, now, id, ...(leaseToken === undefined ? [] : [leaseToken]));
      if (Number(result.changes) === 0) return undefined;
      markGraphChangeSetFailed(db, id, reason, "failed");
      insertAudit(db, "graph_sync.skipped_invalid", "graph_sync_job", id, { reason });
      return graphSyncJobFromRow(statement(db, "SELECT * FROM graph_sync_jobs WHERE id = ?").get(id) as Row);
    })
  );
}

/** The last_error recorded on a job and change-set that were not posted because validation failed. */
export function invalidChangeSetReason(errors: unknown[]): string {
  const detail = errors.map(String).join("; ");
  return `Not posted: graph change set failed validation${detail ? `: ${detail}` : "."}`;
}

// claim / complete / fail / stats / list come from the shared engine. The
// change-set's apply-status mirrors the job via the onComplete/onFail hooks.
// Retries back off up to 5 minutes.
const queue = createJobQueue<GraphSyncJobRecord>({
  table: "graph_sync_jobs",
  mapRow: graphSyncJobFromRow,
  events: { prefix: "graph_sync", entity: "graph_sync_job" },
  backoff: { capMs: 300_000, maxExp: 8 },
  onComplete: (db, id, now) => markGraphChangeSetApplied(db, id, now),
  onFail: (db, id, message, status) => markGraphChangeSetFailed(db, id, message, status),
});

export const claimGraphSyncJobs = queue.claim;
export const completeGraphSyncJob = queue.complete;
export const failGraphSyncJob = queue.fail;
export const renewGraphSyncJobLease = queue.renew;
export const releaseGraphSyncJob = queue.release;
export const withGraphSyncJobLease = queue.withLease;
export const getGraphSyncQueueStats = queue.stats;
export const listGraphSyncJobs = queue.list;
