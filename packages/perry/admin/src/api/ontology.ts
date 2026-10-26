// api/ontology — the materialised company ontology (goals, risks, metrics, ...):
// per-type counts, filtered queries, health checks, and per-entity evidence.
import { apiSince } from "../lib/format";
import type {
  OntologyChangedSinceResponse,
  OntologyEvidenceResponse,
  OntologyHealthResponse,
  OntologyQueryResponse,
  OntologySummaryResponse,
  OntologyType,
} from "../types";
import { getJson } from "./client";

/** "state" lists current entities of one type; "changed" lists entities of any type changed since a time. */
export type OntologyMode = "state" | "changed";

export interface OntologyFilter {
  mode: OntologyMode;
  type: OntologyType;
  project: string;
  query: string;
  /** datetime-local input value; only used in "changed" mode. */
  since: string;
}

/** Entity counts per type and the number of indexed change sets. */
export async function fetchOntologySummary(): Promise<OntologySummaryResponse["summary"]> {
  return (await getJson<OntologySummaryResponse>("/api/brain/ontology", "Ontology summary")).summary;
}

/**
 * Up to 8 entities matching `filter`. "changed" mode hits a different endpoint and
 * ignores `type`; "state" mode ignores `since`. Blank project/query are omitted.
 */
export function queryOntology(filter: OntologyFilter): Promise<OntologyQueryResponse | OntologyChangedSinceResponse> {
  const params = new URLSearchParams({ limit: "8" });
  if (filter.project.trim()) params.set("project", filter.project.trim());
  if (filter.query.trim()) params.set("q", filter.query.trim());
  if (filter.mode === "changed") {
    params.set("since", apiSince(filter.since));
    return getJson(`/api/brain/ontology/changed-since?${params.toString()}`, "Ontology query");
  }
  params.set("type", filter.type);
  return getJson(`/api/brain/ontology?${params.toString()}`, "Ontology query");
}

/** Integrity checks over the materialised ontology (orphaned evidence, duplicates, ...). */
export function fetchOntologyHealth(): Promise<OntologyHealthResponse> {
  return getJson("/api/brain/ontology/health?changeSetLimit=100", "Ontology health");
}

/** The evidence rows and relations backing one entity. */
export function fetchOntologyEvidence(stableKey: string): Promise<OntologyEvidenceResponse> {
  return getJson(`/api/brain/ontology/evidence?stableKey=${encodeURIComponent(stableKey)}`, "Ontology evidence");
}
