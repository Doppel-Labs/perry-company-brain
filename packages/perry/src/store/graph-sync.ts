// graph-sync — durable queue for Graphiti graph-sync jobs (and their change-sets).
import { type GraphChangeSetRecord, type GraphSyncJobRecord, type Row } from "./types";
import { insertAudit, statement, withBrainTransaction, withDb } from "./db";
import { graphSyncJobFromRow } from "./rows";
import { markGraphChangeSetApplied, markGraphChangeSetFailed, upsertGraphChangeSet } from "./change-sets";
import { createJobQueue } from "./job-queue";

/**
 * Enqueue (or re-enqueue) a graph-sync job for a meeting. Unlike ingestion this
 * is keyed by job id with an upsert, so re-syncing a meeting resets the job and
 * its attempts. When a validated change-set is supplied it's persisted in the
 * same transaction, so the job and its payload commit atomically.
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
  return withDb((db) =>
    withBrainTransaction(() => {
      statement(
        db,
        `INSERT INTO graph_sync_jobs (
          id, entity_type, entity_id, status, payload_json, attempts, max_attempts,
          not_before, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = ?,
          payload_json = excluded.payload_json,
          result_json = NULL,
          attempts = 0,
          max_attempts = excluded.max_attempts,
          not_before = excluded.not_before,
          locked_at = NULL,
          last_error = NULL,
          updated_at = excluded.updated_at`
      ).run(
        input.id,
        input.entityType ?? "meeting",
        input.entityId,
        "queued",
        input.payloadJson,
        0,
        input.maxAttempts ?? 5,
        now,
        now,
        now,
        "queued"
      );
      insertAudit(db, "graph_sync.queued", "graph_sync_job", input.id, { entityId: input.entityId });
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
          applyStatus: "queued",
        });
      }
      return graphSyncJobFromRow(statement(db, "SELECT * FROM graph_sync_jobs WHERE id = ?").get(input.id) as Row);
    })
  );
}

// claim / complete / fail / stats / list come from the shared engine. The
// change-set's apply-status mirrors the job via the onComplete/onFail hooks.
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
export const getGraphSyncQueueStats = queue.stats;
export const listGraphSyncJobs = queue.list;
