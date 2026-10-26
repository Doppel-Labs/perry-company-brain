// issues — shared work items, their append-only event history, and ownership pivots.
//
// Issues are projected from meeting action items and then edited by people.
// Every human change appends issue_events rows (assigned, status_changed,
// updated, commented), so the history survives later edits.
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { type IssueEventRecord, type IssueRecord, type PageOptions, type PivotRecord, type Row } from "./types";
import { insertAudit, statement, withBrainTransaction, withDb } from "./database";
import { normalizePage } from "./values";
import { issueEventFromRow, issueFromRow, pivotFromRow } from "./rows";

/**
 * Creates or updates an issue, in one transaction. On an existing issue every
 * omitted (undefined) field keeps its stored value, and an empty string clears
 * a text field (project, description, owner, dueDate), matching the admin
 * API's clearable fields. A new issue defaults to open/normal. With
 * `preserveMutableFields`, an existing issue also keeps its status, priority,
 * and owner even when they are given, so re-running the projection never
 * clobbers someone's current work state. A new issue gets a `created` event;
 * no audit row is written.
 */
export function upsertIssue(input: {
  id: string;
  project?: string;
  title: string;
  description?: string;
  status?: IssueRecord["status"];
  priority?: IssueRecord["priority"];
  owner?: string;
  sourceMeetingId?: string;
  sourceActionId?: string;
  dueDate?: string;
  preserveMutableFields?: boolean;
}): IssueRecord {
  const now = new Date().toISOString();
  return withDb((db) =>
    withBrainTransaction(() => {
      const row = statement(db, "SELECT * FROM issues WHERE id = ?").get(input.id) as Row | undefined;
      const existing = row ? issueFromRow(row) : undefined;
      const preserve = Boolean(existing && input.preserveMutableFields);
      const status = (preserve ? undefined : input.status) ?? existing?.status ?? "open";
      const priority = (preserve ? undefined : input.priority) ?? existing?.priority ?? "normal";
      const owner = keepOrClear(preserve ? undefined : input.owner, existing?.owner);
      statement(
        db,
        `INSERT INTO issues (
          id, project, title, description, status, priority, owner, source_meeting_id,
          source_action_id, due_date, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project = excluded.project,
          title = excluded.title,
          description = excluded.description,
          status = excluded.status,
          priority = excluded.priority,
          owner = excluded.owner,
          source_meeting_id = excluded.source_meeting_id,
          source_action_id = excluded.source_action_id,
          due_date = excluded.due_date,
          updated_at = excluded.updated_at`
      ).run(
        input.id,
        keepOrClear(input.project, existing?.project) ?? null,
        input.title,
        keepOrClear(input.description, existing?.description) ?? null,
        status,
        priority,
        owner ?? null,
        input.sourceMeetingId ?? existing?.sourceMeetingId ?? null,
        input.sourceActionId ?? existing?.sourceActionId ?? null,
        keepOrClear(input.dueDate, existing?.dueDate) ?? null,
        now,
        now
      );
      if (!existing) {
        appendIssueEventInDb(db, {
          id: `${input.id}:event:created`,
          issueId: input.id,
          type: "created",
          detailJson: JSON.stringify({ sourceActionId: input.sourceActionId, title: input.title }),
          meetingId: input.sourceMeetingId,
          createdAt: now,
        });
      }
      return issueFromRow(statement(db, "SELECT * FROM issues WHERE id = ?").get(input.id) as Row);
    })
  );
}

// Upsert semantics for a clearable text field: undefined keeps `current`, "" clears it.
function keepOrClear(value: string | undefined, current: string | undefined): string | undefined {
  if (value === undefined) return current;
  return value === "" ? undefined : value;
}

/**
 * Applies a partial human edit (omitted fields keep their value), appends one
 * issue event per kind of change plus an optional comment, and writes an
 * `issue.updated` audit row with before/after, in one transaction. Returns
 * undefined if the issue does not exist.
 */
export function updateIssue(input: {
  id: string;
  project?: string;
  title?: string;
  description?: string;
  status?: IssueRecord["status"];
  priority?: IssueRecord["priority"];
  owner?: string;
  dueDate?: string;
  actor?: string;
  comment?: string;
}): IssueRecord | undefined {
  const now = new Date().toISOString();
  return withDb((db) =>
    withBrainTransaction(() => {
      const existing = statement(db, "SELECT * FROM issues WHERE id = ?").get(input.id) as Row | undefined;
      if (!existing) return undefined;
      const before = issueFromRow(existing);
      const next: IssueRecord = {
        ...before,
        project: input.project ?? before.project,
        title: input.title ?? before.title,
        description: input.description ?? before.description,
        status: input.status ?? before.status,
        priority: input.priority ?? before.priority,
        owner: input.owner ?? before.owner,
        dueDate: input.dueDate ?? before.dueDate,
        updatedAt: now,
      };
      statement(
        db,
        `UPDATE issues
         SET project = ?, title = ?, description = ?, status = ?, priority = ?,
           owner = ?, due_date = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        next.project ?? null,
        next.title,
        next.description ?? null,
        next.status,
        next.priority,
        next.owner ?? null,
        next.dueDate ?? null,
        now,
        input.id
      );
      appendIssueMutationEvents(db, before, next, input, now);
      insertAudit(db, "issue.updated", "issue", input.id, {
        actor: input.actor,
        before,
        after: next,
        comment: input.comment,
      });
      const row = statement(db, "SELECT * FROM issues WHERE id = ?").get(input.id) as Row;
      return issueFromRow(row);
    })
  );
}

/** Most recently updated first, optionally filtered by owner, status, and project (default 100, max 100,000). */
export function listIssues(options: PageOptions & { owner?: string; status?: IssueRecord["status"]; project?: string } = {}): IssueRecord[] {
  const { limit, offset } = normalizePage(options, 100, 100_000);
  const clauses: string[] = [];
  const params: string[] = [];
  if (options.owner) {
    clauses.push("owner = ?");
    params.push(options.owner);
  }
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  if (options.project) {
    clauses.push("project = ?");
    params.push(options.project);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return withDb((db) =>
    statement(db, `SELECT * FROM issues ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset)
      .map((row) => issueFromRow(row as Row))
  );
}

/** An issue's history, oldest first (default 100, max 1000). */
export function listIssueEvents(issueId: string, options: PageOptions = {}): IssueEventRecord[] {
  const { limit, offset } = normalizePage(options, 100, 1000);
  return withDb((db) =>
    statement(db, "SELECT * FROM issue_events WHERE issue_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?")
      .all(issueId, limit, offset)
      .map((row) => issueEventFromRow(row as Row))
  );
}

/** Inserts or updates an ownership pivot; on conflict the source ids and `createdAt` are kept. No audit row. */
export function upsertPivot(input: Omit<PivotRecord, "createdAt"> & { createdAt?: string }): PivotRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return withDb((db) => {
    statement(
      db,
      `INSERT INTO pivots (
        id, project, subject, previous_owner, new_owner, fallback_reviewer, reason,
        source_decision_id, source_meeting_id, affected_issue_ids_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project = excluded.project,
        subject = excluded.subject,
        previous_owner = excluded.previous_owner,
        new_owner = excluded.new_owner,
        fallback_reviewer = excluded.fallback_reviewer,
        reason = excluded.reason,
        affected_issue_ids_json = excluded.affected_issue_ids_json`
    ).run(
      input.id,
      input.project ?? null,
      input.subject,
      input.previousOwner ?? null,
      input.newOwner ?? null,
      input.fallbackReviewer ?? null,
      input.reason,
      input.sourceDecisionId,
      input.sourceMeetingId,
      JSON.stringify(input.affectedIssueIds),
      createdAt
    );
    const row = statement(db, "SELECT * FROM pivots WHERE id = ?").get(input.id) as Row;
    return pivotFromRow(row);
  });
}

export function listPivots(options: PageOptions = {}): PivotRecord[] {
  const { limit, offset } = normalizePage(options, 100, 100_000);
  return withDb((db) =>
    statement(db, "SELECT * FROM pivots ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset)
      .map((row) => pivotFromRow(row as Row))
  );
}

function appendIssueMutationEvents(
  db: DatabaseSync,
  before: IssueRecord,
  after: IssueRecord,
  input: {
    actor?: string;
    comment?: string;
    project?: string;
    title?: string;
    description?: string;
    status?: IssueRecord["status"];
    priority?: IssueRecord["priority"];
    owner?: string;
    dueDate?: string;
  },
  createdAt: string
): void {
  const base = {
    issueId: after.id,
    actor: input.actor,
    meetingId: after.sourceMeetingId,
    createdAt,
  };
  if (before.owner !== after.owner) {
    appendIssueEventInDb(db, {
      ...base,
      id: `issue-event:${randomUUID()}`,
      type: "assigned",
      detailJson: JSON.stringify({ previousOwner: before.owner, owner: after.owner }),
    });
  }
  if (before.status !== after.status) {
    appendIssueEventInDb(db, {
      ...base,
      id: `issue-event:${randomUUID()}`,
      type: "status_changed",
      detailJson: JSON.stringify({ previousStatus: before.status, status: after.status }),
    });
  }
  const metadataChanged =
    before.project !== after.project ||
    before.title !== after.title ||
    before.description !== after.description ||
    before.priority !== after.priority ||
    before.dueDate !== after.dueDate;
  if (metadataChanged) {
    appendIssueEventInDb(db, {
      ...base,
      id: `issue-event:${randomUUID()}`,
      type: "updated",
      detailJson: JSON.stringify({
        project: after.project,
        title: after.title,
        description: after.description,
        priority: after.priority,
        dueDate: after.dueDate,
      }),
    });
  }
  if (input.comment?.trim()) {
    appendIssueEventInDb(db, {
      ...base,
      id: `issue-event:${randomUUID()}`,
      type: "commented",
      detailJson: JSON.stringify({ comment: input.comment.trim() }),
    });
  }
}

// INSERT OR IGNORE: events are immutable, and the deterministic `created` id
// makes that event idempotent.
function appendIssueEventInDb(
  db: DatabaseSync,
  event: {
    id: string;
    issueId: string;
    type: IssueEventRecord["type"];
    actor?: string;
    detailJson: string;
    meetingId?: string;
    createdAt: string;
  }
): void {
  statement(
    db,
    `INSERT OR IGNORE INTO issue_events (
      id, issue_id, type, actor, detail_json, meeting_id, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.issueId,
    event.type,
    event.actor ?? null,
    event.detailJson,
    event.meetingId ?? null,
    event.createdAt
  );
}
