// fts — write-behind full-text indexing.
//
// Writers queue rows into fts_queue inside their own transaction (cheap); the
// FTS worker later moves them into the brain_fts index in batches (flushFtsQueue).
// fts_queue is keyed by `${type}:${entityId}`, so re-queuing an entity before
// the flush replaces its pending content rather than indexing it twice. Removing
// stale rows already in brain_fts is the writer's job (see meetings.ts).
import type { DatabaseSync } from "node:sqlite";
import { statement, withBrainTransaction, withDb } from "./database";
import type { BrainSearchResult, Row } from "./types";

interface FtsRecord {
  type: BrainSearchResult["type"];
  entityId: string;
  meetingId?: string;
  title: string;
  body: string;
  url?: string;
  createdAt: string;
  queuedAt?: string;
}


/**
 * Moves up to `limit` (clamped to 1..100,000) of the oldest queued rows into
 * brain_fts and deletes them from the queue, in one transaction. Returns how
 * many rows were moved; 0 when the queue is empty.
 */
export function flushFtsQueue(limit = 1000): number {
  return withDb((db) => {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100_000);
    const countRow = statement(
      db,
      "SELECT COUNT(*) AS count FROM (SELECT 1 FROM fts_queue ORDER BY queued_at LIMIT ?)"
    ).get(normalizedLimit) as Row;
    const count = Number(countRow.count);
    if (count === 0) return 0;
    withBrainTransaction(() => {
      statement(
        db,
        `INSERT INTO brain_fts (type, entity_id, meeting_id, title, body, url, created_at)
         SELECT type, entity_id, meeting_id, title, body, url, created_at
         FROM fts_queue
         ORDER BY queued_at
         LIMIT ?`
      ).run(normalizedLimit);
      statement(
        db,
        `DELETE FROM fts_queue
         WHERE entity_key IN (
           SELECT entity_key FROM fts_queue ORDER BY queued_at LIMIT ?
         )`
      ).run(normalizedLimit);
    });
    return count;
  });
}

/** Rows waiting in fts_queue, i.e. not yet searchable. */
export function pendingFtsCount(): number {
  return withDb((db) => {
    const row = statement(db, "SELECT COUNT(*) AS count FROM fts_queue").get() as Row;
    return Number(row.count);
  });
}

/** Queues (or re-queues, replacing pending content) an entity for indexing. */
export function queueFts(
  db: DatabaseSync,
  record: FtsRecord
): void {
  statement(
    db,
    `INSERT INTO fts_queue (
      entity_key, type, entity_id, meeting_id, title, body, url, created_at, queued_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_key) DO UPDATE SET
      title = excluded.title,
      body = excluded.body,
      url = excluded.url,
      created_at = excluded.created_at,
      queued_at = excluded.queued_at`
  ).run(
    `${record.type}:${record.entityId}`,
    record.type,
    record.entityId,
    record.meetingId ?? null,
    record.title,
    record.body,
    record.url ?? null,
    record.createdAt,
    record.queuedAt ?? new Date().toISOString()
  );
}

/** Queues a brand-new entity; faster, but fails if the entity is already queued. */
export function queueFtsAppendOnly(
  db: DatabaseSync,
  record: FtsRecord
): void {
  statement(
    db,
    `INSERT INTO fts_queue (
      entity_key, type, entity_id, meeting_id, title, body, url, created_at, queued_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${record.type}:${record.entityId}`,
    record.type,
    record.entityId,
    record.meetingId ?? null,
    record.title,
    record.body,
    record.url ?? null,
    record.createdAt,
    record.queuedAt ?? new Date().toISOString()
  );
}
