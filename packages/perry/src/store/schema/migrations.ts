// schema/migrations — column and data changes for databases created by older versions.
import type { DatabaseSync } from "node:sqlite";
import type { Row } from "../types";

/** Adds the denormalized approval summary columns to `approvals` tables created before they existed. Idempotent. */
export function migrateApprovalSummaryColumns(db: DatabaseSync): void {
  addColumnIfMissing(db, "approvals", "route_project", "TEXT");
  addColumnIfMissing(db, "approvals", "route_reason", "TEXT");
  addColumnIfMissing(db, "approvals", "publish_mode", "TEXT");
  addColumnIfMissing(db, "approvals", "decision_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "approvals", "action_item_count", "INTEGER NOT NULL DEFAULT 0");
}

/** Adds `ingestion_jobs.meeting_id` to tables created before it existed; older jobs keep NULL. Idempotent. */
export function migrateIngestionJobMeetingColumn(db: DatabaseSync): void {
  addColumnIfMissing(db, "ingestion_jobs", "meeting_id", "TEXT");
}

/**
 * Older versions stored meetings held for approval with status `dry-run`.
 * Previews were never stored, so every stored `dry-run` row is a held meeting:
 * rename it to `pending_approval`. Idempotent, and cheap once done (indexed).
 */
export function migrateDryRunMeetingStatus(db: DatabaseSync): void {
  db.prepare("UPDATE meetings SET status = 'pending_approval' WHERE status = 'dry-run'").run();
}

function addColumnIfMissing(db: DatabaseSync, tableName: string, columnName: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Row[];
  if (rows.some((row) => row.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
}
