// meetings — meeting records and their extracted knowledge (decisions, action items).
//
// Every write also queues the affected rows for full-text indexing (fts.ts).
// Knowledge rows have positional ids, `${meetingId}:decision:${n}` and
// `${meetingId}:action:${n}`, and are replaced wholesale on re-extraction.
// The backfill functions are faster plain INSERTs for bulk imports into
// fresh rows and throw on an existing id.
//
// A meeting's id is derived from its note (meetingIdForNote), so the same note
// always maps to the same row; see MeetingRecord for the status lifecycle.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { type MeetingNote } from "@meetings";
import { type ActionItemRecord, type BackfillMeetingInput, type DecisionRecord, type MeetingGraphBackfillRecord, type MeetingRecord, type PageOptions, type Row } from "./types";
import { insertAudit, statement, withBrainTransaction, withDb } from "./database";
import { queueFts, queueFtsAppendOnly } from "./fts";
import { normalizePage, optionalString, validIsoOrUndefined } from "./values";
import { actionFromRow, decisionFromRow, meetingFromRow } from "./rows";

/** Newest first by meeting time (default 100, max 1000). */
export function listMeetingRecords(options: PageOptions = {}): MeetingRecord[] {
  const { limit, offset } = normalizePage(options, 100, 1000);
  return withDb((db) =>
    statement(
      db,
      `SELECT id, source, source_id, title, created_at, updated_at, notion_page_id,
        notion_url, discord_message_url, status, error
       FROM meetings ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .all(limit, offset)
      .map((row) => row as Row)
      .map(meetingFromRow)
  );
}

export function listMeetingRecordsByStatus(status: MeetingRecord["status"], options: PageOptions = {}): MeetingRecord[] {
  const { limit, offset } = normalizePage(options, 100, 1000);
  return withDb((db) =>
    statement(
      db,
      `SELECT id, source, source_id, title, created_at, updated_at, notion_page_id,
        notion_url, discord_message_url, status, error
       FROM meetings WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .all(status, limit, offset)
      .map((row) => row as Row)
      .map(meetingFromRow)
  );
}

export function countMeetingRecords(status?: MeetingRecord["status"]): number {
  return withDb((db) => {
    const row = status
      ? (statement(db, "SELECT COUNT(*) AS count FROM meetings WHERE status = ?").get(status) as Row)
      : (statement(db, "SELECT COUNT(*) AS count FROM meetings").get() as Row);
    return Number(row.count);
  });
}

/**
 * The dedupe lookup: matches on (source, sourceId), or, for a note with no
 * sourceId, on the content-derived id from meetingIdForNote.
 */
export function findMeetingRecord(note: MeetingNote): MeetingRecord | undefined {
  const sourceId = note.sourceId;
  if (!sourceId) return getMeetingRecord(meetingIdForNote(note));
  return withDb((db) => {
    const row = statement(db, "SELECT * FROM meetings WHERE source = ? AND source_id = ?").get(note.source, sourceId);
    return row ? meetingFromRow(row as Row) : undefined;
  });
}

export function getMeetingRecord(id: string): MeetingRecord | undefined {
  return withDb((db) => {
    const row = statement(db, "SELECT * FROM meetings WHERE id = ?").get(id);
    return row ? meetingFromRow(row as Row) : undefined;
  });
}

/**
 * Marks a meeting `failed` with `error`, but only while it is `publishing` (or
 * already `failed`): a held or published meeting is left alone. Keeps the
 * Notion/Discord fields, so a later publish still resumes. Joins the caller's
 * transaction on `db`; writes a `meeting.failed` audit row when it changes one.
 */
export function markMeetingFailedInDb(db: DatabaseSync, meetingId: string, error: string): void {
  const result = statement(
    db,
    "UPDATE meetings SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status IN ('publishing', 'failed')"
  ).run("failed", error, new Date().toISOString(), meetingId);
  if (Number(result.changes) > 0) insertAudit(db, "meeting.failed", "meeting", meetingId, { error });
}

/**
 * Inserts or updates a meeting (source, sourceId, and createdAt are fixed at
 * first insert), drops its stale brain_fts row, and re-queues it for indexing.
 * Writes a `meeting.upserted` audit row. Returns `record` as given.
 */
export function upsertMeetingRecord(record: MeetingRecord): MeetingRecord {
  return withDb((db) => {
    const existing = statement(db, "SELECT 1 FROM meetings WHERE id = ?").get(record.id);
    statement(
      db,
      `INSERT INTO meetings (
        id, source, source_id, title, created_at, updated_at, notion_page_id,
        notion_url, discord_message_url, status, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        updated_at = excluded.updated_at,
        notion_page_id = excluded.notion_page_id,
        notion_url = excluded.notion_url,
        discord_message_url = excluded.discord_message_url,
        status = excluded.status,
        error = excluded.error`
    ).run(
      record.id,
      record.source,
      record.sourceId ?? null,
      record.title,
      record.createdAt,
      record.updatedAt,
      record.notionPageId ?? null,
      record.notionUrl ?? null,
      record.discordMessageUrl ?? null,
      record.status,
      record.error ?? null
    );
    if (existing) {
      statement(db, "DELETE FROM brain_fts WHERE type = ? AND entity_id = ?").run("meeting", record.id);
    }
    queueFts(db, {
      type: "meeting",
      entityId: record.id,
      title: record.title,
      body: record.title,
      url: record.notionUrl,
      createdAt: record.createdAt,
      queuedAt: record.updatedAt,
    });
    insertAudit(db, "meeting.upserted", "meeting", record.id, record);
    return record;
  });
}

/** Bulk-import path: inserts the meeting and its knowledge; throws if the meeting id already exists. */
export function insertBackfillMeeting(
  record: MeetingRecord,
  knowledge: { decisions: Array<{ text: string }>; actionItems: Array<{ text: string; owner?: string; dueDate?: string }> }
): MeetingRecord {
  return withDb((db) => {
    insertBackfillMeetingInDb(db, record, knowledge);
    return record;
  });
}

/** Backfill inserts in one transaction (all or nothing); returns the number inserted. */
export function insertBackfillMeetingBatch(items: BackfillMeetingInput[]): number {
  if (items.length === 0) return 0;
  return withDb((db) =>
    withBrainTransaction(() => {
      for (const item of items) {
        insertBackfillMeetingInDb(db, item.record, item.knowledge);
      }
      return items.length;
    })
  );
}

function insertBackfillMeetingInDb(
  db: DatabaseSync,
  record: MeetingRecord,
  knowledge: BackfillMeetingInput["knowledge"]
): void {
  statement(
    db,
    `INSERT INTO meetings (
      id, source, source_id, title, created_at, updated_at, notion_page_id,
      notion_url, discord_message_url, status, error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.source,
    record.sourceId ?? null,
    record.title,
    record.createdAt,
    record.updatedAt,
    record.notionPageId ?? null,
    record.notionUrl ?? null,
    record.discordMessageUrl ?? null,
    record.status,
    record.error ?? null
  );
  queueFtsAppendOnly(db, {
    type: "meeting",
    entityId: record.id,
    title: record.title,
    body: record.title,
    url: record.notionUrl,
    createdAt: record.createdAt,
    queuedAt: record.updatedAt,
  });
  insertMeetingKnowledgeFast(db, record.id, record.title, record.notionUrl, knowledge, record.updatedAt, true);
  insertAudit(db, "meeting.backfilled", "meeting", record.id, record);
}

/**
 * Deletes a meeting's decisions and action items (and their search rows) and
 * writes `knowledge` in their place, atomically (it joins the caller's
 * transaction if one is open). New rows take the meeting's `created_at` as
 * their timestamp. Writes a `knowledge.replaced` audit row.
 */
export function replaceMeetingKnowledge(
  meetingId: string,
  knowledge: { decisions: Array<{ text: string }>; actionItems: Array<{ text: string; owner?: string; dueDate?: string }> }
): void {
  withDb((db) => {
    withBrainTransaction(() => replaceMeetingKnowledgeInDb(db, meetingId, knowledge));
  });
}

function replaceMeetingKnowledgeInDb(
  db: DatabaseSync,
  meetingId: string,
  knowledge: { decisions: Array<{ text: string }>; actionItems: Array<{ text: string; owner?: string; dueDate?: string }> }
): void {
    const hasExistingKnowledge =
      statement(db, "SELECT 1 FROM decisions WHERE meeting_id = ? LIMIT 1").get(meetingId) ??
      statement(db, "SELECT 1 FROM action_items WHERE meeting_id = ? LIMIT 1").get(meetingId);
    statement(db, "DELETE FROM decisions WHERE meeting_id = ?").run(meetingId);
    statement(db, "DELETE FROM action_items WHERE meeting_id = ?").run(meetingId);
    if (hasExistingKnowledge) {
      statement(db, "DELETE FROM brain_fts WHERE meeting_id = ? AND type IN ('decision', 'action')").run(meetingId);
      statement(db, "DELETE FROM fts_queue WHERE meeting_id = ? AND type IN ('decision', 'action')").run(meetingId);
    }
    const meetingRow = statement(db, "SELECT title, notion_url, created_at FROM meetings WHERE id = ?").get(meetingId) as
      | Row
      | undefined;
    const meetingTitle = meetingRow ? String(meetingRow.title) : meetingId;
    const meetingUrl = meetingRow ? optionalString(meetingRow.notion_url) : undefined;
    // Knowledge is dated by its meeting, not by when it was extracted.
    const createdAt = meetingRow ? String(meetingRow.created_at) : new Date().toISOString();
    knowledge.decisions.forEach((decision, index) => {
      const id = `${meetingId}:decision:${index + 1}`;
      statement(db, "INSERT INTO decisions (id, meeting_id, text, status, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id,
        meetingId,
        decision.text,
        "accepted",
        createdAt
      );
      queueFts(db, {
        type: "decision",
        entityId: id,
        meetingId,
        title: meetingTitle,
        body: decision.text,
        url: meetingUrl,
        createdAt,
        queuedAt: createdAt,
      });
    });
    knowledge.actionItems.forEach((action, index) => {
      const id = `${meetingId}:action:${index + 1}`;
      statement(
        db,
        "INSERT INTO action_items (id, meeting_id, text, owner, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(
        id,
        meetingId,
        action.text,
        action.owner ?? null,
        action.dueDate ?? null,
        "open",
        createdAt
      );
      queueFts(db, {
        type: "action",
        entityId: id,
        meetingId,
        title: meetingTitle,
        body: action.text,
        url: meetingUrl,
        createdAt,
        queuedAt: createdAt,
      });
    });
    insertAudit(db, "knowledge.replaced", "meeting", meetingId, {
      decisions: knowledge.decisions.length,
      actionItems: knowledge.actionItems.length,
    });
}

function insertMeetingKnowledgeFast(
  db: DatabaseSync,
  meetingId: string,
  meetingTitle: string,
  meetingUrl: string | undefined,
  knowledge: { decisions: Array<{ text: string }>; actionItems: Array<{ text: string; owner?: string; dueDate?: string }> },
  queuedAt = new Date().toISOString(),
  appendOnly = false
): void {
  const now = queuedAt;
  const queue = appendOnly ? queueFtsAppendOnly : queueFts;
  knowledge.decisions.forEach((decision, index) => {
    const id = `${meetingId}:decision:${index + 1}`;
    statement(db, "INSERT INTO decisions (id, meeting_id, text, status, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      meetingId,
      decision.text,
      "accepted",
      now
    );
    queue(db, {
      type: "decision",
      entityId: id,
      meetingId,
      title: meetingTitle,
      body: decision.text,
      url: meetingUrl,
      createdAt: now,
      queuedAt,
    });
  });
  knowledge.actionItems.forEach((action, index) => {
    const id = `${meetingId}:action:${index + 1}`;
    statement(
      db,
      "INSERT INTO action_items (id, meeting_id, text, owner, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      meetingId,
      action.text,
      action.owner ?? null,
      action.dueDate ?? null,
      "open",
      now
    );
    queue(db, {
      type: "action",
      entityId: id,
      meetingId,
      title: meetingTitle,
      body: action.text,
      url: meetingUrl,
      createdAt: now,
      queuedAt,
    });
  });
}

/** Newest first; `limit`/`offset` are passed to SQL unclamped. */
export function listDecisions(limit = 50, offset = 0): DecisionRecord[] {
  const page = normalizePage({ limit, offset }, 50, 10_000);
  return withDb((db) =>
    statement(db, "SELECT id, meeting_id, text, status, created_at FROM decisions ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(page.limit, page.offset)
      .map((row) => row as Row)
      .map(decisionFromRow)
  );
}

/** Newest first; `limit`/`offset` are passed to SQL unclamped. */
export function listActionItems(limit = 50, offset = 0): ActionItemRecord[] {
  const page = normalizePage({ limit, offset }, 50, 10_000);
  return withDb((db) =>
    statement(
      db,
      `SELECT id, meeting_id, text, owner, due_date, status, created_at
       FROM action_items ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .all(page.limit, page.offset)
      .map((row) => row as Row)
      .map(actionFromRow)
  );
}

/** Open action items whose owner equals one of `owners` (case-insensitive, trimmed), newest first (default 50, max 1000). */
export function listOpenActionItemsByOwners(owners: string[], options: PageOptions = {}): ActionItemRecord[] {
  const keys = [...new Set(owners.map((owner) => owner.trim().toLowerCase()).filter(Boolean))];
  if (keys.length === 0) return [];
  const { limit, offset } = normalizePage(options, 50, 1000);
  const placeholders = keys.map(() => "?").join(", ");
  return withDb((db) =>
    statement(
      db,
      `SELECT id, meeting_id, text, owner, due_date, status, created_at
       FROM action_items WHERE status = 'open' AND lower(trim(owner)) IN (${placeholders})
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .all(...keys, limit, offset)
      .map((row) => actionFromRow(row as Row))
  );
}

/** A meeting's stored knowledge in the shape extraction produces, for re-syncing the graph. */
export function getMeetingKnowledge(meetingId: string): MeetingGraphBackfillRecord["knowledge"] {
  return withDb((db) => {
    const decisions = statement(db, "SELECT id, meeting_id, text, status, created_at FROM decisions WHERE meeting_id = ? ORDER BY created_at")
      .all(meetingId)
      .map((row) => decisionFromRow(row as Row))
      .map((decision) => ({ text: decision.text }));
    const actionItems = statement(
      db,
      `SELECT id, meeting_id, text, owner, due_date, status, created_at
       FROM action_items WHERE meeting_id = ? ORDER BY created_at`
    )
      .all(meetingId)
      .map((row) => actionFromRow(row as Row))
      .map((action) => ({ text: action.text, owner: action.owner, dueDate: action.dueDate }));
    return { decisions, actionItems };
  });
}

/** Published (`processed`) meetings with their knowledge, for graph backfills. */
export function listMeetingGraphBackfillRecords(options: PageOptions = {}): MeetingGraphBackfillRecord[] {
  return listMeetingRecordsByStatus("processed", options).map((record) => ({
    record,
    knowledge: getMeetingKnowledge(record.id),
  }));
}

/**
 * The stable meeting id for a note: `${source}:${sourceId}`, or, when the note
 * has no sourceId, `${source}:content:<hash>`, a SHA-256 prefix of its title,
 * start time, and creator (email, else name). A re-sent note therefore lands on
 * the same row and dedupes. Without a start time the summary is hashed too, so
 * two undated meetings that only share a title (say, two "Standup"s) stay
 * separate; editing an undated note's summary does make it a new meeting.
 */
export function meetingIdForNote(note: MeetingNote): string {
  if (note.sourceId) return `${note.source}:${note.sourceId}`;
  const startedAt = note.startedAt?.trim() ?? "";
  const fingerprint = JSON.stringify([
    note.title.trim(),
    startedAt,
    (note.creatorEmail ?? note.creatorName ?? "").trim().toLowerCase(),
    startedAt ? "" : note.summaryMarkdown.trim(),
  ]);
  return `${note.source}:content:${createHash("sha256").update(fingerprint).digest("hex").slice(0, 24)}`;
}

/**
 * Builds (does not save) a record for a normalized note, with the id from
 * meetingIdForNote. `createdAt` is the meeting's start time when it parses,
 * else now.
 */
export function meetingRecordFromNote(note: MeetingNote, status: MeetingRecord["status"]): MeetingRecord {
  const now = new Date().toISOString();
  const createdAt = validIsoOrUndefined(note.startedAt) ?? now;
  return {
    id: meetingIdForNote(note),
    source: note.source,
    sourceId: note.sourceId,
    title: note.title,
    createdAt,
    updatedAt: now,
    status,
  };
}
