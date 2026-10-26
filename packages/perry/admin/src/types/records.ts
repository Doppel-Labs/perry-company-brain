// types/records — wire shapes for stored records: meetings, decisions, action items,
// users, issues and their events, pivots, approvals, and ingestion previews.
export type IssueStatus = "open" | "in_progress" | "blocked" | "done" | "canceled";
export type IssuePriority = "low" | "normal" | "high" | "urgent";

export interface MeetingRecord {
  id: string;
  source: string;
  sourceId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  notionUrl?: string;
  discordMessageUrl?: string;
  status: "pending_approval" | "publishing" | "processed" | "failed" | "dry-run";
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
  team?: string;
  isActive: boolean;
  updatedAt: string;
}

export interface IssueRecord {
  id: string;
  project?: string;
  title: string;
  description?: string;
  status: IssueStatus;
  priority: IssuePriority;
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
  /** JSON-encoded, type-specific detail; see `formatIssueEvent`. */
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

export interface ApprovalRecord {
  id: string;
  meetingId: string;
  title: string;
  announcement: string;
  routeProject?: string;
  routeReason?: string;
  publishMode?: string;
  decisionCount: number;
  actionItemCount: number;
  status: "pending" | "approved" | "rejected" | "posted";
  createdAt: string;
  updatedAt: string;
}

/** How the server produced a knowledge result (mirrors ExtractionProvenance in src/extraction/types.ts). */
export interface ExtractionProvenance {
  method: "rules" | "llm" | "hybrid";
  requestedMode: "rules" | "llm" | "hybrid";
  backend?: string;
  model?: string;
  confidence?: number;
  durationMs?: number;
  droppedUngrounded?: number;
  fallbackReason?: string;
}

/** Decisions, action items, and entities extracted from a note. */
export interface PreviewKnowledge {
  decisions: Array<{ text: string }>;
  actionItems: Array<{ text: string; owner?: string; dueDate?: string }>;
  entities?: Array<{ type: string; name: string }>;
  extraction?: ExtractionProvenance;
}

export interface PreviewResult {
  duplicate: boolean;
  dryRun: boolean;
  announcement: string;
  record: MeetingRecord;
  knowledge?: PreviewKnowledge;
  notionUrl?: string;
  discordMessageUrl?: string;
}
