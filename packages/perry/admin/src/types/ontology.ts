// types/ontology — wire shapes for the /api/brain/ontology endpoints.
import type { GraphEvidenceResult, GraphFactResult } from "./graph";

export type OntologyType = "goal" | "metric" | "risk" | "blocker" | "open_question" | "capability" | "feature" | "artifact" | "benchmark_report";

export interface OntologyEntityRecord {
  stableKey: string;
  type: OntologyType;
  name: string;
  aliases?: string[];
  evidenceIds: string[];
  sourceMeetingIds: string[];
  updatedAt?: string;
}

export interface OntologySummaryResponse {
  summary: {
    changeSetCount: number;
    counts: Record<OntologyType, number>;
    topProjects: Array<{ project: string; linkedEntities: number }>;
  };
}

export interface OntologyQueryResponse {
  type: OntologyType;
  project?: string;
  count: number;
  entities: OntologyEntityRecord[];
}

export interface OntologyChangedSinceResponse {
  since: string;
  count: number;
  entities: OntologyEntityRecord[];
}

export interface OntologyEvidenceResponse {
  stableKey: string;
  entity?: OntologyEntityRecord;
  evidence: GraphEvidenceResult[];
  relations: GraphFactResult[];
}

export interface OntologyHealthResponse {
  ok: boolean;
  counts: {
    materializedEntities: number;
    materializedRelations: number;
    materializedEvidence: number;
    duplicateNameGroups: number;
    orphanedEvidence: number;
    relationsMissingEvidence: number;
    entitiesMissingEvidence: number;
    unprojectedEntities: number;
  };
  checks: Array<{ id: string; passed: boolean; severity: "pass" | "warning" | "critical"; detail: string }>;
}
