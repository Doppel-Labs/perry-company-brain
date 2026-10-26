// memory/types — request and response shapes for the Graphiti bridge.
import type { ExtractedKnowledge } from "@extraction";
import type { MeetingNote, MeetingRoute } from "@meetings";
import type { MeetingRecord } from "@store";

/** Graph memory configuration from the environment; see getGraphMemoryStatus. */
export interface GraphMemoryStatus {
  enabled: boolean;
  bridgeUrl?: string;
  groupId: string;
  timeoutMs: number;
  includePrivateNotes: boolean;
  includeTranscript: boolean;
  /** Post typed change sets to /change-sets instead of episodes to /episodes. */
  directChangeSets: boolean;
}

/** Everything known about a processed meeting, used to build its change set and episode. */
export interface GraphMemorySyncInput {
  note: MeetingNote;
  record: MeetingRecord;
  knowledge: ExtractedKnowledge;
  route?: MeetingRoute;
  notionUrl?: string;
  discordMessageUrl?: string;
}

export interface GraphMemorySearchResult {
  fact?: string;
  name?: string;
  uuid?: string;
  sourceNode?: string;
  targetNode?: string;
  score?: number;
  raw?: unknown;
}

export interface GraphMemorySearchResponse {
  enabled: boolean;
  results: GraphMemorySearchResult[];
  error?: string;
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
  kind?: string;
  source?: string;
  sourceId?: string;
  meetingId?: string;
  title?: string;
  excerpt?: string;
  url?: string;
  updatedAt?: string;
}

export interface GraphFactResult {
  factKey?: string;
  subjectKey?: string;
  relation?: string;
  objectKey?: string;
  evidenceId?: string;
  validFrom?: string;
  confidence?: number;
  active?: boolean;
  properties?: Record<string, unknown>;
  updatedAt?: string;
}

/** A fact with its subject, object and evidence joined in by the bridge. */
export interface GraphFactRow {
  fact?: GraphFactResult;
  subject?: GraphEntityResult;
  object?: GraphEntityResult;
  evidence?: GraphEvidenceResult;
}

export interface GraphRetirementResult {
  retirementKey?: string;
  subjectKey?: string;
  relation?: string;
  objectKey?: string;
  evidenceId?: string;
  validUntil?: string;
  reason?: string;
  updatedAt?: string;
}

export interface GraphRetirementRow {
  retirement?: GraphRetirementResult;
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

/** Body of a bridge /episodes write; `body` is the JSON-encoded meeting episode. */
export interface GraphitiEpisodePayload {
  name: string;
  body: string;
  source: "json";
  sourceDescription: string;
  referenceTime: string;
  groupId: string;
}
