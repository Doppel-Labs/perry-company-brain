// change-sets — validated graph change-sets, one per meeting graph-sync job (table `graph_change_sets`).
//
// A change-set is the structured entities/relations/evidence Perry derived
// from a meeting. It is stored next to its graph-sync job and, when it passed
// validation, materialized into the ontology tables at write time. An invalid
// change-set is kept for review only: never materialized and never posted.
// `apply_status` tracks the graph side: queued, applied (accepted and, after a
// replay, verified by readback), unverified (a replay write the readback could
// not confirm), or failed.
import { DatabaseSync } from "node:sqlite";
import { type GraphChangeSetRecord, type PageOptions, type Row } from "./types";
import { insertAudit, statement, withDb } from "./database";
import { normalizePage } from "./values";
import { graphChangeSetFromRow } from "./rows";
import { materializeOntologyFromChangeSet } from "./ontology";

/** Newest first, optionally filtered by apply status (default 50, max 200). */
export function listGraphChangeSets(options: PageOptions & { status?: GraphChangeSetRecord["applyStatus"] } = {}): GraphChangeSetRecord[] {
  const { limit, offset } = normalizePage(options, 50, 200);
  return withDb((db) => {
    const status = options.status;
    const rows = status
      ? (statement(
          db,
          "SELECT * FROM graph_change_sets WHERE apply_status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        ).all(status, limit, offset) as Row[])
      : (statement(db, "SELECT * FROM graph_change_sets ORDER BY created_at DESC LIMIT ? OFFSET ?").all(
          limit,
          offset
        ) as Row[]);
    return rows.map(graphChangeSetFromRow);
  });
}

export function getGraphChangeSet(id: string): GraphChangeSetRecord | undefined {
  return withDb((db) => {
    const row = statement(db, "SELECT * FROM graph_change_sets WHERE id = ?").get(id) as Row | undefined;
    return row ? graphChangeSetFromRow(row) : undefined;
  });
}

export function getGraphChangeSetByJobId(graphSyncJobId: string): GraphChangeSetRecord | undefined {
  return withDb((db) => {
    const row = statement(db, "SELECT * FROM graph_change_sets WHERE graph_sync_job_id = ?").get(graphSyncJobId) as
      | Row
      | undefined;
    return row ? graphChangeSetFromRow(row) : undefined;
  });
}

/**
 * Records a manual replay whose write the bridge accepted. `verified` is the
 * readback verdict: true marks the change-set `applied`; false marks it
 * `unverified` with `unverifiedReason` as its last error, since only a clean
 * readback proves the graph holds it. Either way `applied_at` is the write
 * time. Writes a `graph_change_set.replayed` or `graph_change_set.replay_unverified`
 * audit row with `result`.
 */
export function markGraphChangeSetReplayApplied(
  id: string,
  result: unknown,
  verification: { verified: boolean; unverifiedReason?: string } = { verified: true }
): GraphChangeSetRecord | undefined {
  return withDb((db) => {
    const now = new Date().toISOString();
    const status: GraphChangeSetRecord["applyStatus"] = verification.verified ? "applied" : "unverified";
    const lastError = verification.verified ? null : verification.unverifiedReason ?? "Replay readback did not pass.";
    statement(
      db,
      "UPDATE graph_change_sets SET apply_status = ?, applied_at = ?, last_error = ?, updated_at = ? WHERE id = ?"
    ).run(status, now, lastError, now, id);
    insertAudit(
      db,
      verification.verified ? "graph_change_set.replayed" : "graph_change_set.replay_unverified",
      "graph_change_set",
      id,
      { result }
    );
    const row = statement(db, "SELECT * FROM graph_change_sets WHERE id = ?").get(id) as Row | undefined;
    return row ? graphChangeSetFromRow(row) : undefined;
  });
}

/** Marks a change-set failed after a manual replay; writes a `graph_change_set.replay_failed` audit row. */
export function markGraphChangeSetReplayFailed(id: string, error: unknown): GraphChangeSetRecord | undefined {
  return withDb((db) => {
    const now = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    statement(db, "UPDATE graph_change_sets SET apply_status = ?, last_error = ?, updated_at = ? WHERE id = ?").run(
      "failed",
      message,
      now,
      id
    );
    insertAudit(db, "graph_change_set.replay_failed", "graph_change_set", id, { error: message });
    const row = statement(db, "SELECT * FROM graph_change_sets WHERE id = ?").get(id) as Row | undefined;
    return row ? graphChangeSetFromRow(row) : undefined;
  });
}

/**
 * Inserts or replaces a change-set on `db` (joins the caller's transaction),
 * then materializes it into the ontology tables if its validation status is
 * `valid`; an invalid one is stored for review only. Writes a
 * `graph_change_set.queued` audit row.
 */
export function upsertGraphChangeSet(
  db: DatabaseSync,
  input: Omit<GraphChangeSetRecord, "createdAt" | "updatedAt">
): void {
  const now = new Date().toISOString();
  statement(
    db,
    `INSERT INTO graph_change_sets (
      id, meeting_id, graph_sync_job_id, group_id, validation_status,
      validation_errors_json, validation_warnings_json, change_set_json,
      apply_status, applied_at, last_error, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      meeting_id = excluded.meeting_id,
      graph_sync_job_id = excluded.graph_sync_job_id,
      group_id = excluded.group_id,
      validation_status = excluded.validation_status,
      validation_errors_json = excluded.validation_errors_json,
      validation_warnings_json = excluded.validation_warnings_json,
      change_set_json = excluded.change_set_json,
      apply_status = excluded.apply_status,
      applied_at = excluded.applied_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at`
  ).run(
    input.id,
    input.meetingId,
    input.graphSyncJobId,
    input.groupId,
    input.validationStatus,
    input.validationErrorsJson,
    input.validationWarningsJson,
    input.changeSetJson,
    input.applyStatus,
    input.appliedAt ?? null,
    input.lastError ?? null,
    now,
    now
  );
  if (input.validationStatus === "valid") materializeOntologyFromChangeSet(db, input.changeSetJson, input.meetingId, now);
  insertAudit(db, "graph_change_set.queued", "graph_change_set", input.id, {
    meetingId: input.meetingId,
    graphSyncJobId: input.graphSyncJobId,
    validationStatus: input.validationStatus,
  });
}

/** Graph-sync onComplete hook: marks the job's change-set applied (no-op if the job has none). */
export function markGraphChangeSetApplied(db: DatabaseSync, graphSyncJobId: string, appliedAt: string): void {
  statement(
    db,
    "UPDATE graph_change_sets SET apply_status = ?, applied_at = ?, last_error = NULL, updated_at = ? WHERE graph_sync_job_id = ?"
  ).run("applied", appliedAt, appliedAt, graphSyncJobId);
  const row = statement(db, "SELECT id FROM graph_change_sets WHERE graph_sync_job_id = ?").get(graphSyncJobId) as
    | Row
    | undefined;
  if (row) insertAudit(db, "graph_change_set.applied", "graph_change_set", String(row.id), { graphSyncJobId });
}

/** Graph-sync onFail hook: mirrors the job's new status (`queued` on retry, `failed` when retired) and records the error. */
export function markGraphChangeSetFailed(
  db: DatabaseSync,
  graphSyncJobId: string,
  message: string,
  applyStatus: GraphChangeSetRecord["applyStatus"]
): void {
  const now = new Date().toISOString();
  statement(
    db,
    "UPDATE graph_change_sets SET apply_status = ?, last_error = ?, updated_at = ? WHERE graph_sync_job_id = ?"
  ).run(applyStatus, message, now, graphSyncJobId);
  const row = statement(db, "SELECT id FROM graph_change_sets WHERE graph_sync_job_id = ?").get(graphSyncJobId) as
    | Row
    | undefined;
  if (row) insertAudit(db, "graph_change_set.apply_failed", "graph_change_set", String(row.id), { graphSyncJobId, message });
}
