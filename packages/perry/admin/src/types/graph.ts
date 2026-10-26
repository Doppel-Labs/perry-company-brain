// types/graph — wire shapes for the graph-sync and graph-memory read endpoints.
// Read-model rows are mostly optional because the bridge may return partial data.
export interface GraphSearchResult {
  fact?: string;
  name?: string;
  uuid?: string;
  score?: number;
  raw?: unknown;
}

export interface GraphSyncQueueSnapshot {
  stats: {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
  };
  recent: Array<{
    id: string;
    entityId: string;
    status: "queued" | "processing" | "completed" | "failed";
    attempts: number;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
    hasPayload: boolean;
    hasResult: boolean;
  }>;
}

export interface GraphChangeSetSummary {
  id: string;
  meetingId: string;
  graphSyncJobId: string;
  groupId: string;
  validationStatus: "valid" | "invalid";
  validationErrorCount: number;
  validationWarningCount: number;
  // `unverified`: a replay write was accepted but its readback diff did not pass; `lastError` names the gaps.
  applyStatus: "queued" | "applied" | "unverified" | "failed";
  appliedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEntityResult {
  stableKey: string;
  type?: string;
  name?: string;
  aliases?: string[];
  properties?: Record<string, unknown>;
  evidenceIds?: string[];
  updatedAt?: string;
}

export interface GraphEvidenceResult {
  evidenceId: string;
  title?: string;
  excerpt?: string;
  url?: string;
  source?: string;
  updatedAt?: string;
}

export interface GraphFactResult {
  factKey?: string;
  subjectKey?: string;
  relation?: string;
  objectKey?: string;
  evidenceId?: string;
  validFrom?: string;
  active?: boolean;
  confidence?: number;
  properties?: Record<string, unknown>;
}

export interface GraphFactRow {
  fact?: GraphFactResult;
  subject?: GraphEntityResult;
  object?: GraphEntityResult;
  evidence?: GraphEvidenceResult;
}

export interface GraphRetirementRow {
  retirement?: {
    subjectKey?: string;
    relation?: string;
    objectKey?: string;
    evidenceId?: string;
    validUntil?: string;
    reason?: string;
  };
  evidence?: GraphEvidenceResult;
}

export interface GraphEntityContextResponse {
  enabled: boolean;
  entity?: GraphEntityResult | null;
  facts: GraphFactRow[];
  retirements: GraphRetirementRow[];
  error?: string;
}

export interface GraphTimelineResponse {
  enabled: boolean;
  stableKey?: string;
  events: Array<{ type: "fact" | "retirement"; at?: string; item: GraphFactRow | GraphRetirementRow }>;
  error?: string;
}

/** Result of replaying a change set: what it should have written versus what readback could not find. */
export interface GraphReplayDiff {
  passed: boolean;
  checkedAt: string;
  expected: { entities: number; relations: number; retirements: number; evidence: number };
  missing: {
    entities: string[];
    relations: Array<{ subjectKey: string; relation: string; objectKey: string; evidenceId?: string }>;
    retirements: Array<{ subjectKey: string; relation: string; objectKey: string; evidenceId?: string }>;
    evidence: string[];
  };
  errors: string[];
}
