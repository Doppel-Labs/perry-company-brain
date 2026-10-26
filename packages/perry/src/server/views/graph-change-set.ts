// views/graph-change-set — the list projection of a change set: counts, not payloads.
import type { listGraphChangeSets } from "@store";

type GraphChangeSetRecord = ReturnType<typeof listGraphChangeSets>[number];

export function toChangeSetSummary(record: GraphChangeSetRecord) {
  return {
    id: record.id,
    meetingId: record.meetingId,
    graphSyncJobId: record.graphSyncJobId,
    groupId: record.groupId,
    validationStatus: record.validationStatus,
    validationErrorCount: jsonArrayLength(record.validationErrorsJson),
    validationWarningCount: jsonArrayLength(record.validationWarningsJson),
    applyStatus: record.applyStatus,
    appliedAt: record.appliedAt,
    lastError: record.lastError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function jsonArrayLength(value: string): number {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
