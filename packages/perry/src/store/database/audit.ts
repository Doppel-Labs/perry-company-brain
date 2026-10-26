// database/audit — append-only audit trail of store mutations.
//
// Disabled globally with PERRY_AUDIT_MODE=off, or for a scope (bulk backfills)
// with withAuditSuppressed.
import type { DatabaseSync } from "node:sqlite";
import { withDb } from "./connection";
import { statement } from "./statements";

let auditSuppressionDepth = 0;

export function appendAudit(eventType: string, entityType: string, entityId: string, detail: unknown): void {
  withDb((db) => insertAudit(db, eventType, entityType, entityId, detail));
}

/** Writes an audit row on `db`, so it joins the caller's open transaction. */
export function insertAudit(db: DatabaseSync, eventType: string, entityType: string, entityId: string, detail: unknown): void {
  if (auditSuppressionDepth > 0 || process.env.PERRY_AUDIT_MODE === "off") return;
  const now = new Date().toISOString();
  statement(
    db,
    "INSERT INTO audit_log (id, event_type, entity_type, entity_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(`${now}:${eventType}:${entityId}`, eventType, entityType, entityId, JSON.stringify(detail), now);
}

export function withAuditSuppressed<T>(callback: () => T): T {
  auditSuppressionDepth += 1;
  try {
    return callback();
  } finally {
    auditSuppressionDepth -= 1;
  }
}
