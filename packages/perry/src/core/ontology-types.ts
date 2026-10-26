// core/ontology-types — the shared vocabulary of the company-brain graph.
//
// Every graph write is expressed as a GraphChangeSet built from these types
// (see graph/change-set.ts), so adding an entity or relation type starts here.
// The meaning of each type is documented in docs/company-brain-ontology.md.

/** Every node type the graph can hold: meeting work, company state, and integration/provenance surfaces. */
export type GraphEntityType =
  | "meeting"
  | "person"
  | "project"
  | "decision"
  | "action_item"
  | "repository"
  | "customer"
  | "policy"
  | "goal"
  | "metric"
  | "risk"
  | "blocker"
  | "open_question"
  | "capability"
  | "feature"
  | "artifact"
  | "benchmark_report"
  | "channel"
  | "data_source"
  | "notion_page"
  | "discord_message"
  | "source_note";

/** Every edge type the graph can hold; subjects and objects are referenced by entity stableKey. */
export type GraphRelationType =
  | "CAPTURED_BY"
  | "ATTENDED_BY"
  | "ROUTED_TO_PROJECT"
  | "HAS_DECISION"
  | "HAS_ACTION_ITEM"
  | "ASSIGNED_TO"
  | "ASSIGNED_OWNER"
  | "HAS_FALLBACK_REVIEWER"
  | "MENTIONS_REPOSITORY"
  | "MENTIONS_CUSTOMER"
  | "REFERENCES_POLICY"
  | "MENTIONS_GOAL"
  | "MENTIONS_METRIC"
  | "MENTIONS_RISK"
  | "MENTIONS_BLOCKER"
  | "MENTIONS_OPEN_QUESTION"
  | "MENTIONS_CAPABILITY"
  | "MENTIONS_FEATURE"
  | "REFERENCES_ARTIFACT"
  | "REFERENCES_BENCHMARK_REPORT"
  | "VALIDATED_BY"
  | "SUPPORTS_GOAL"
  | "HAS_RISK"
  | "BLOCKED_BY"
  | "HAS_OPEN_QUESTION"
  | "IMPLEMENTS_CAPABILITY"
  | "ROUTED_TO_CHANNEL"
  | "WRITES_TO_DATA_SOURCE"
  | "DOCUMENTED_IN"
  | "POSTED_TO"
  | "DERIVED_FROM";

/** Create-or-update for one entity, identified by `stableKey`, citing the evidence that supports it. */
export interface GraphEntityUpsert {
  type: GraphEntityType;
  stableKey: string;
  name: string;
  aliases?: string[];
  properties?: Record<string, string | number | boolean | null>;
  evidenceIds: string[];
}

/** Asserts an edge as true from `validFrom`, with a 0..1 confidence and one supporting evidence id. */
export interface GraphRelationAssertion {
  subjectKey: string;
  relation: GraphRelationType;
  objectKey: string;
  evidenceId: string;
  validFrom?: string;
  confidence: number;
  properties?: Record<string, string | number | boolean | null>;
}

/** Ends a previously asserted edge at `validUntil` (e.g. an owner handover) without deleting its history. */
export interface GraphRelationRetirement {
  subjectKey: string;
  relation: GraphRelationType;
  objectKey: string;
  evidenceId: string;
  validUntil: string;
  reason: string;
}

/** A short, bounded citation back to the source record that justifies entities and relations. */
export interface GraphEvidenceLink {
  evidenceId: string;
  kind: "meeting" | "decision" | "action_item" | "source_link";
  source: "granola" | "perry" | "notion" | "discord";
  sourceId: string;
  meetingId: string;
  title?: string;
  excerpt?: string;
  url?: string;
}

/** All graph changes derived from one meeting, applied as a unit; `warnings` are non-blocking gaps. */
export interface GraphChangeSet {
  schemaVersion: 1;
  sourceMeetingId: string;
  generatedAt: string;
  entities: GraphEntityUpsert[];
  relations: GraphRelationAssertion[];
  retirements: GraphRelationRetirement[];
  evidence: GraphEvidenceLink[];
  warnings: string[];
}

export interface GraphChangeSetValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** The company-state subset (goals, risks, features, ...) that turns the graph from a meeting archive into a company brain. */
export type CompanyOntologyEntityType = Extract<
  GraphEntityType,
  "goal" | "metric" | "risk" | "blocker" | "open_question" | "capability" | "feature" | "artifact" | "benchmark_report"
>;

/** Runtime list of CompanyOntologyEntityType, for validation and iteration. */
export const companyOntologyEntityTypes: readonly CompanyOntologyEntityType[] = [
  "goal",
  "metric",
  "risk",
  "blocker",
  "open_question",
  "capability",
  "feature",
  "artifact",
  "benchmark_report",
];
