// ontology/index-builder — assembles an OntologyIndex from storage.
import type { GraphChangeSet, GraphEvidenceLink, GraphRelationAssertion, GraphRelationType } from "@core";
import {
  listGraphChangeSets,
  listOntologyEntities,
  listOntologyEvidence,
  listOntologyRelations,
  parseJsonObject,
  type OntologyEntityRow,
  type OntologyEvidenceRow,
  type OntologyRelationRow,
} from "@store";
import { type CompanyOntologyEntityType, type OntologyEntityRecord, type OntologyIndex, ontologyTypes } from "./types";
import { unique } from "./text";

/**
 * Loads the ontology index from the materialized ontology tables, falling back to
 * replaying stored graph change sets when nothing has been materialized yet.
 * Change sets that failed validation are never part of the index.
 */
export function getOntologyIndex(limit = 1000): OntologyIndex {
  const rowIndex = getMaterializedOntologyIndex(limit);
  if (rowIndex.entities.length > 0 || rowIndex.relations.length > 0 || rowIndex.evidence.length > 0) return rowIndex;
  return getChangeSetOntologyIndex(limit);
}

/** Folds change sets into one index; later change sets merge into earlier entities. */
export function buildOntologyIndex(changeSets: GraphChangeSet[]): OntologyIndex {
  const entities = new Map<string, OntologyEntityRecord>();
  const relations: GraphRelationAssertion[] = [];
  const evidence = new Map<string, GraphEvidenceLink>();
  const warnings: string[] = [];

  for (const changeSet of changeSets) {
    warnings.push(...changeSet.warnings);
    for (const item of changeSet.evidence) {
      evidence.set(item.evidenceId, { ...evidence.get(item.evidenceId), ...item });
    }
    for (const entity of changeSet.entities) {
      if (!ontologyTypes.has(entity.type as CompanyOntologyEntityType) && entity.type !== "project") continue;
      const existing = entities.get(entity.stableKey);
      if (!existing) {
        entities.set(entity.stableKey, {
          ...entity,
          aliases: unique(entity.aliases ?? []),
          evidenceIds: unique(entity.evidenceIds),
          sourceMeetingIds: [changeSet.sourceMeetingId],
          incoming: [],
          outgoing: [],
          evidence: [],
        });
        continue;
      }
      entities.set(entity.stableKey, {
        ...existing,
        aliases: unique([...(existing.aliases ?? []), ...(entity.aliases ?? [])]),
        properties: { ...(existing.properties ?? {}), ...(entity.properties ?? {}) },
        evidenceIds: unique([...existing.evidenceIds, ...entity.evidenceIds]),
        sourceMeetingIds: unique([...existing.sourceMeetingIds, changeSet.sourceMeetingId]),
      });
    }
    relations.push(...changeSet.relations);
  }

  hydrateOntologyRecords(entities, relations, evidence);

  return {
    generatedAt: new Date().toISOString(),
    changeSetCount: changeSets.length,
    entities: [...entities.values()].filter((entity) => ontologyTypes.has(entity.type as CompanyOntologyEntityType)),
    relations,
    evidence: [...evidence.values()],
    warnings: unique(warnings),
  };
}

function getMaterializedOntologyIndex(limit: number): OntologyIndex {
  return buildOntologyIndexFromRows({
    entityRows: listOntologyEntities({ includeProjects: true, limit: Math.max(limit, 1_000) }),
    relationRows: listOntologyRelations({ limit: Math.max(limit * 20, 10_000) }),
    evidenceRows: listOntologyEvidence({ limit: Math.max(limit * 10, 10_000) }),
  });
}

function getChangeSetOntologyIndex(limit: number): OntologyIndex {
  const changeSets: GraphChangeSet[] = [];
  let offset = 0;
  while (changeSets.length < limit) {
    const records = listGraphChangeSets({ limit: Math.min(200, limit - changeSets.length), offset });
    if (records.length === 0) break;
    for (const record of records) {
      if (record.validationStatus === "invalid") continue;
      const parsed = parseGraphChangeSet(record.changeSetJson);
      if (parsed) changeSets.push(parsed);
    }
    offset += records.length;
    if (records.length < 200) break;
  }
  return buildOntologyIndex(changeSets);
}

/**
 * Builds an index from materialized rows. `changeSetCount` here is the number
 * of distinct source meetings referenced by the entities.
 */
export function buildOntologyIndexFromRows(input: {
  entityRows: OntologyEntityRow[];
  relationRows: OntologyRelationRow[];
  evidenceRows: OntologyEvidenceRow[];
}): OntologyIndex {
  const entities = new Map<string, OntologyEntityRecord>();
  const evidence = new Map<string, GraphEvidenceLink>();
  const sourceMeetingIds = new Set<string>();

  for (const row of input.evidenceRows) {
    evidence.set(row.evidenceId, {
      evidenceId: row.evidenceId,
      kind: row.kind as GraphEvidenceLink["kind"],
      source: row.source as GraphEvidenceLink["source"],
      sourceId: row.sourceId,
      meetingId: row.meetingId,
      title: row.title,
      excerpt: row.excerpt,
      url: row.url,
    });
  }

  for (const row of input.entityRows) {
    const sourceMeetings = parseStringArray(row.sourceMeetingIdsJson);
    for (const id of sourceMeetings) sourceMeetingIds.add(id);
    entities.set(row.stableKey, {
      type: row.type,
      stableKey: row.stableKey,
      name: row.name,
      aliases: parseStringArray(row.aliasesJson),
      properties: parseJsonObject(row.propertiesJson),
      evidenceIds: parseStringArray(row.evidenceIdsJson),
      sourceMeetingIds: sourceMeetings,
      incoming: [],
      outgoing: [],
      evidence: [],
      updatedAt: row.updatedAt,
    });
  }

  const relations = input.relationRows.map((row) => ({
    subjectKey: row.subjectKey,
    relation: row.relation as GraphRelationType,
    objectKey: row.objectKey,
    evidenceId: row.evidenceId,
    validFrom: row.validFrom,
    confidence: row.confidence,
    properties: parseJsonObject(row.propertiesJson),
  }));
  hydrateOntologyRecords(entities, relations, evidence);

  return {
    generatedAt: new Date().toISOString(),
    changeSetCount: sourceMeetingIds.size,
    entities: [...entities.values()].filter((entity) => ontologyTypes.has(entity.type as CompanyOntologyEntityType)),
    relations,
    evidence: [...evidence.values()],
    warnings: [],
  };
}

function hydrateOntologyRecords(
  entities: Map<string, OntologyEntityRecord>,
  relations: GraphRelationAssertion[],
  evidence: Map<string, GraphEvidenceLink>
): void {
  for (const relation of relations) {
    const subject = entities.get(relation.subjectKey);
    const object = entities.get(relation.objectKey);
    if (subject) subject.outgoing.push(relation);
    if (object) object.incoming.push(relation);
  }

  for (const entity of entities.values()) {
    const evidenceIds = unique([
      ...entity.evidenceIds,
      ...entity.incoming.map((relation) => relation.evidenceId),
      ...entity.outgoing.map((relation) => relation.evidenceId),
    ]);
    entity.evidence = evidenceIds.map((id) => evidence.get(id)).filter((item): item is GraphEvidenceLink => Boolean(item));
  }
}

function parseGraphChangeSet(value: string): GraphChangeSet | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isGraphChangeSet(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isGraphChangeSet(value: unknown): value is GraphChangeSet {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && Array.isArray(record.entities) && Array.isArray(record.relations) && Array.isArray(record.evidence);
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
