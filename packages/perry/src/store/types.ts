// types — record shapes returned by the store, plus the raw `Row` type the mappers in rows.ts consume.
import { type MeetingNote } from "@meetings";
import { type GraphEntityType } from "@core";

/**
 * A meeting as tracked by the workflow. Stored statuses:
 * - `pending_approval`: held for an admin to approve (rows written as
 *   `dry-run` by older versions are migrated to this);
 * - `publishing`: a publish started and has not finished. The Notion and
 *   Discord fields hold the steps already done, so a retry resumes there;
 * - `processed`: published to Notion and Discord;
 * - `failed`: its ingestion job ran out of attempts while publishing; `error`
 *   holds the last error, and a retry (re-send or approve) still resumes.
 *
 * `dry-run` marks the unsaved record returned by a preview; it is never stored.
 */
export interface MeetingRecord {
  id: string;
  source: MeetingNote["source"];
  sourceId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  notionPageId?: string;
  notionUrl?: string;
  discordMessageUrl?: string;
  status: "pending_approval" | "publishing" | "processed" | "failed" | "dry-run";
  error?: string;
}

export interface DecisionRecord {
  id: string;
  meetingId: string;
  text: string;
  status: "proposed" | "accepted" | "rejected";
  createdAt: string;
}

export interface ActionItemRecord {
  id: string;
  meetingId: string;
  text: string;
  owner?: string;
  dueDate?: string;
  status: "open" | "done" | "wont-do";
  createdAt: string;
}

export interface UserRecord {
  id: string;
  displayName: string;
  email?: string;
  discordUserId?: string;
  notionUserId?: string;
  githubUsername?: string;
  team?: string;
  timezone?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IssueRecord {
  id: string;
  project?: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "blocked" | "done" | "canceled";
  priority: "low" | "normal" | "high" | "urgent";
  owner?: string;
  sourceMeetingId?: string;
  sourceActionId?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueEventRecord {
  id: string;
  issueId: string;
  type: "created" | "assigned" | "status_changed" | "commented" | "pivoted" | "updated";
  actor?: string;
  detailJson: string;
  meetingId?: string;
  createdAt: string;
}

export interface PivotRecord {
  id: string;
  project?: string;
  subject: string;
  previousOwner?: string;
  newOwner?: string;
  fallbackReviewer?: string;
  reason: string;
  sourceDecisionId: string;
  sourceMeetingId: string;
  affectedIssueIds: string[];
  createdAt: string;
}

export interface BrainSearchResult {
  type: "meeting" | "decision" | "action";
  id: string;
  meetingId?: string;
  title: string;
  snippet: string;
  url?: string;
  createdAt: string;
}

/** Paging input; each list function clamps it with its own default and maximum. */
export interface PageOptions {
  limit?: number;
  offset?: number;
}

export interface BrainSearchOptions extends PageOptions {
  types?: Array<BrainSearchResult["type"]>;
}

/** A meeting held for review; see approvals.ts for the status lifecycle (`rejected` and `posted` are terminal). */
export interface ApprovalRecord {
  id: string;
  meetingId: string;
  title: string;
  payloadJson: string;
  announcement: string;
  knowledgeJson: string;
  routeJson: string;
  status: "pending" | "approved" | "rejected" | "posted";
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalSummaryRecord {
  id: string;
  meetingId: string;
  title: string;
  announcement: string;
  routeProject?: string;
  routeReason?: string;
  publishMode?: string;
  decisionCount: number;
  actionItemCount: number;
  status: ApprovalRecord["status"];
  createdAt: string;
  updatedAt: string;
}

/** Approval input; the summary fields are derived from the JSON blobs when omitted. */
export type ApprovalWriteInput = Omit<ApprovalRecord, "createdAt" | "updatedAt"> &
  Partial<Pick<ApprovalSummaryRecord, "routeProject" | "routeReason" | "publishMode" | "decisionCount" | "actionItemCount">>;

export interface BackfillMeetingInput {
  record: MeetingRecord;
  knowledge: { decisions: Array<{ text: string }>; actionItems: Array<{ text: string; owner?: string; dueDate?: string }> };
}

export interface MeetingGraphBackfillRecord {
  record: MeetingRecord;
  knowledge: {
    decisions: Array<{ text: string }>;
    actionItems: Array<{ text: string; owner?: string; dueDate?: string }>;
  };
}

/** A row of `ingestion_jobs`; `payloadJson` holds the Granola payload and its workflow options. */
export interface IngestionJobRecord {
  id: string;
  type: "granola.ingest";
  idempotencyKey: string;
  status: "queued" | "processing" | "completed" | "failed";
  payloadJson: string;
  resultJson?: string;
  attempts: number;
  maxAttempts: number;
  notBefore: string;
  lockedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IngestionQueueStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface GraphSyncJobRecord {
  id: string;
  entityType: "meeting";
  entityId: string;
  status: "queued" | "processing" | "completed" | "failed";
  payloadJson: string;
  resultJson?: string;
  attempts: number;
  maxAttempts: number;
  notBefore: string;
  lockedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphSyncQueueStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}

/**
 * A row of `graph_change_sets`; `applyStatus` mirrors the owning graph-sync job.
 * `unverified` means the bridge accepted a replay write but the readback diff did not pass.
 */
export interface GraphChangeSetRecord {
  id: string;
  meetingId: string;
  graphSyncJobId: string;
  groupId: string;
  validationStatus: "valid" | "invalid";
  validationErrorsJson: string;
  validationWarningsJson: string;
  changeSetJson: string;
  applyStatus: "queued" | "applied" | "unverified" | "failed";
  appliedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

/** Materialized ontology read model rows; the `*Json` fields are raw JSON columns. */
export interface OntologyEntityRow {
  stableKey: string;
  type: GraphEntityType;
  name: string;
  aliasesJson: string;
  propertiesJson: string;
  evidenceIdsJson: string;
  sourceMeetingIdsJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyRelationRow {
  id: string;
  subjectKey: string;
  relation: string;
  objectKey: string;
  evidenceId: string;
  validFrom?: string;
  confidence: number;
  propertiesJson: string;
  sourceMeetingId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyEvidenceRow {
  evidenceId: string;
  kind: string;
  source: string;
  sourceId: string;
  meetingId: string;
  title?: string;
  excerpt?: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyBackfillResult {
  changeSets: number;
  entities: number;
  relations: number;
  evidence: number;
  dryRun?: boolean;
  reset?: boolean;
  changedSince?: string;
}

/** A raw node:sqlite result row, keyed by column name. */
export interface Row {
  [key: string]: unknown;
}
