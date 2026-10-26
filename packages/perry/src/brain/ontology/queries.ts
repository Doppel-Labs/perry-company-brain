// ontology/queries — typed reads over the ontology index.
import type { GraphEvidenceLink, GraphRelationAssertion } from "@core";
import { listOntologyEntities, listOntologyEvidence, listOntologyRelations } from "@store";
import { buildOntologyIndexFromRows, getOntologyIndex } from "./index-builder";
import { filterByProject } from "./project-filter";
import { compareOntologyEntities, matches, unique } from "./text";
import {
  type CompanyOntologyEntityType,
  type OntologyChangedSinceResult,
  type OntologyEntityRecord,
  type OntologyIndex,
  type OntologyQueryOptions,
  type OntologyQueryResult,
  ontologyTypes,
} from "./types";

// The per-type queries below share queryOntologyType: filter by type, then
// project and text, sort by compareOntologyEntities; default 25 rows, max 100.

export function queryGoals(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("goal", options, index);
}

export function queryMetrics(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("metric", options, index);
}

export function queryRisks(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("risk", options, index);
}

export function queryBlockers(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("blocker", options, index);
}

export function queryOpenQuestions(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("open_question", options, index);
}

export function queryCapabilities(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("capability", options, index);
}

export function queryFeatures(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("feature", options, index);
}

export function queryArtifacts(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("artifact", options, index);
}

export function queryBenchmarkReports(options: OntologyQueryOptions = {}, index = getOntologyIndex()): OntologyQueryResult {
  return queryOntologyType("benchmark_report", options, index);
}

/**
 * Entities whose rows changed since `since`, read straight from the ontology
 * tables (filtered by changedSince) instead of a full index. Default 100 rows, max 500.
 */
export function queryOntologyChangedSince(since: string, options: OntologyQueryOptions = {}): OntologyChangedSinceResult {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500);
  const changed = buildOntologyIndexFromRows({
    entityRows: listOntologyEntities({ includeProjects: true, changedSince: since, limit: Math.max(limit, 500) }),
    relationRows: listOntologyRelations({ changedSince: since, limit: 5_000 }),
    evidenceRows: listOntologyEvidence({ changedSince: since, limit: 5_000 }),
  });
  let entities = changed.entities;
  const project = options.project?.trim();
  if (project) {
    entities = entities.filter((entity) => filterByProject([entity], entity.type as CompanyOntologyEntityType, project, changed).length > 0);
  }
  if (options.q?.trim()) entities = entities.filter((entity) => matches(`${entity.name} ${(entity.aliases ?? []).join(" ")}`, options.q ?? ""));
  entities = entities.sort(compareOntologyEntities);
  return { since, count: entities.length, entities: entities.slice(0, limit) };
}

/** An entity (if indexed), every relation touching it, and the evidence behind both. */
export function queryEvidenceFor(stableKey: string, index = getOntologyIndex()): {
  stableKey: string;
  entity?: OntologyEntityRecord;
  evidence: GraphEvidenceLink[];
  relations: GraphRelationAssertion[];
} {
  const entity = index.entities.find((item) => item.stableKey === stableKey);
  const relations = index.relations.filter((relation) => relation.subjectKey === stableKey || relation.objectKey === stableKey);
  const evidenceIds = unique([...(entity?.evidenceIds ?? []), ...relations.map((relation) => relation.evidenceId)]);
  return {
    stableKey,
    entity,
    evidence: evidenceIds.map((id) => index.evidence.find((item) => item.evidenceId === id)).filter((item): item is GraphEvidenceLink => Boolean(item)),
    relations,
  };
}

/** Entity counts per type and the 20 projects with the most outgoing relations. */
export function summarizeOntology(index = getOntologyIndex()): {
  changeSetCount: number;
  counts: Record<CompanyOntologyEntityType, number>;
  topProjects: Array<{ project: string; linkedEntities: number }>;
} {
  const counts = Object.fromEntries([...ontologyTypes].map((type) => [type, 0])) as Record<CompanyOntologyEntityType, number>;
  for (const entity of index.entities) counts[entity.type as CompanyOntologyEntityType] += 1;
  const projects = new Map<string, number>();
  for (const relation of index.relations) {
    if (!relation.subjectKey.startsWith("project:")) continue;
    projects.set(relation.subjectKey, (projects.get(relation.subjectKey) ?? 0) + 1);
  }
  return {
    changeSetCount: index.changeSetCount,
    counts,
    topProjects: [...projects.entries()]
      .map(([project, linkedEntities]) => ({ project, linkedEntities }))
      .sort((a, b) => b.linkedEntities - a.linkedEntities || a.project.localeCompare(b.project))
      .slice(0, 20),
  };
}

function queryOntologyType(type: CompanyOntologyEntityType, options: OntologyQueryOptions, index: OntologyIndex): OntologyQueryResult {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 100);
  let entities = index.entities.filter((entity) => entity.type === type);
  if (options.project?.trim()) entities = filterByProject(entities, type, options.project, index);
  if (options.q?.trim()) entities = entities.filter((entity) => matches(`${entity.name} ${(entity.aliases ?? []).join(" ")}`, options.q ?? ""));
  entities = entities.sort(compareOntologyEntities);
  return { type, project: options.project?.trim() || undefined, count: entities.length, entities: entities.slice(0, limit) };
}
