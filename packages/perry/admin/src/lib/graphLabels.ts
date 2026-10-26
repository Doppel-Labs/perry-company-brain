// lib/graphLabels — human-readable labels for graph rows. Every field in these rows
// is optional, so each label falls back to a placeholder instead of rendering blank.
import type { GraphEntityResult, GraphFactRow, GraphRetirementRow, GraphTimelineResponse } from "../types";

export function graphEndpointLabel(entity?: GraphEntityResult | null): string {
  if (!entity) return "Unknown entity";
  return entity.name || entity.stableKey || "Unknown entity";
}

/** `subject RELATION object`, preferring entity names over stable keys. */
export function graphFactLabel(row: GraphFactRow): string {
  const subject = row.subject?.name || row.fact?.subjectKey || "subject";
  const relation = row.fact?.relation || "RELATES_TO";
  const object = row.object?.name || row.fact?.objectKey || "object";
  return `${subject} ${relation} ${object}`;
}

export function graphRetirementLabel(row: GraphRetirementRow): string {
  const retirement = row.retirement;
  const subject = retirement?.subjectKey || "subject";
  const relation = retirement?.relation || "RETIRED";
  const object = retirement?.objectKey || "object";
  return `${subject} ${relation} ${object}`;
}

/** Dispatches on `event.type` to the fact or retirement label. */
export function graphTimelineLabel(event: GraphTimelineResponse["events"][number]): string {
  if (event.type === "fact") return graphFactLabel(event.item as GraphFactRow);
  return graphRetirementLabel(event.item as GraphRetirementRow);
}

/** A missing relation or retirement from a replay diff, with its evidence id when known. */
export function graphDiffRelationLabel(item: { subjectKey: string; relation: string; objectKey: string; evidenceId?: string }): string {
  return `${item.subjectKey} ${item.relation} ${item.objectKey}${item.evidenceId ? ` (${item.evidenceId})` : ""}`;
}
