// ontology/project-filter — scoping ontology entities to a project.
import { projectStableKey, type GraphRelationType } from "@core";
import type { CompanyOntologyEntityType, OntologyEntityRecord, OntologyIndex } from "./types";

const projectRelationsByType: Record<CompanyOntologyEntityType, GraphRelationType[]> = {
  goal: ["SUPPORTS_GOAL"],
  metric: [],
  risk: ["HAS_RISK"],
  blocker: ["BLOCKED_BY"],
  open_question: ["HAS_OPEN_QUESTION"],
  capability: ["IMPLEMENTS_CAPABILITY"],
  feature: [],
  artifact: [],
  benchmark_report: [],
};

/**
 * Entities belonging to a project: those the project links to directly by its
 * typed relation, else those that came from meetings routed to the project.
 */
export function filterByProject(
  entities: OntologyEntityRecord[],
  type: CompanyOntologyEntityType,
  project: string,
  index: OntologyIndex
): OntologyEntityRecord[] {
  const projectKey = projectStableKey(project);
  const directRelations = projectRelationsByType[type] ?? [];
  const directlyLinked = new Set(
    index.relations
      .filter((relation) => relation.subjectKey === projectKey && directRelations.includes(relation.relation))
      .map((relation) => relation.objectKey)
  );
  if (directlyLinked.size > 0) return entities.filter((entity) => directlyLinked.has(entity.stableKey));

  const projectMeetingIds = new Set(
    index.relations
      .filter((relation) => relation.relation === "ROUTED_TO_PROJECT" && relation.objectKey === projectKey)
      .map((relation) => relation.subjectKey)
  );
  return entities.filter((entity) =>
    entity.incoming.some((relation) => projectMeetingIds.has(relation.subjectKey)) ||
    entity.sourceMeetingIds.some((meetingId) => projectMeetingIds.has(`meeting:${meetingId}`))
  );
}
