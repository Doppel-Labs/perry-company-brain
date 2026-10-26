// change-set-replay — re-applies a stored change set to the graph and checks it landed.
//
// Replay is the operator's repair tool, separate from queue draining: it
// re-validates the stored JSON, posts it to the bridge's /change-sets endpoint
// under its original group, then reads back every entity, fact, retirement and
// evidence record to report what is missing. A successful write is not treated
// as proof; the readback diff is (see docs/graphiti-integration.md#replay). A
// write whose readback does not pass is recorded as `unverified`, not `applied`.
import { validateGraphChangeSet, type GraphChangeSet, type GraphChangeSetValidation } from "./change-set";
import {
  getGraphEntityContext,
  getGraphEvidence,
  getGraphMemoryStatus,
  listGraphFacts,
  postGraphChangeSet,
  type GraphEntityContextResponse,
  type GraphFactResult,
  type GraphRetirementResult,
} from "./memory";
import {
  getGraphChangeSet,
  markGraphChangeSetReplayApplied,
  markGraphChangeSetReplayFailed,
  type GraphChangeSetRecord,
} from "@store";

export interface GraphReplayDiffRelation {
  subjectKey: string;
  relation: string;
  objectKey: string;
  evidenceId?: string;
}

/** Readback result: `passed` only when nothing is missing and no read returned an error. */
export interface GraphReplayDiff {
  checkedAt: string;
  passed: boolean;
  expected: {
    entities: number;
    relations: number;
    retirements: number;
    evidence: number;
  };
  missing: {
    entities: string[];
    relations: GraphReplayDiffRelation[];
    retirements: GraphReplayDiffRelation[];
    evidence: string[];
  };
  errors: string[];
}

/**
 * `applied` when the bridge accepted the write and the readback diff passed;
 * `unverified` when the write was accepted but the readback found gaps or
 * errors (see `diff`). Matches the change set's new apply status.
 */
export type GraphChangeSetReplayStatus = "applied" | "unverified";

export interface GraphChangeSetReplayResult {
  changeSetId: string;
  meetingId: string;
  groupId: string;
  status: GraphChangeSetReplayStatus;
  appliedAt?: string;
  validation: GraphChangeSetValidation;
  bridgeResult: unknown;
  diff: GraphReplayDiff;
  record: GraphChangeSetRecord;
}

/** A replay failure carrying the HTTP status to return and, when known, the updated record and validation. */
export class GraphChangeSetReplayError extends Error {
  status: number;
  record?: GraphChangeSetRecord;
  validation?: GraphChangeSetValidation;

  constructor(status: number, message: string, options: { record?: GraphChangeSetRecord; validation?: GraphChangeSetValidation } = {}) {
    super(message);
    this.name = "GraphChangeSetReplayError";
    this.status = status;
    this.record = options.record;
    this.validation = options.validation;
  }
}

/**
 * Replays the stored change set `id`. Throws GraphChangeSetReplayError: 404 when
 * not found, 400 when the JSON is unparseable, the wrong shape, stored as
 * invalid, or invalid on re-validation, 503 when graph memory is off, 502 when
 * the bridge write or readback throws. Records the outcome on the change set
 * (apply status and audit entry), except for 404, 503 and a change set stored
 * as invalid. A completed write is recorded, and returned, as `applied` only
 * when the readback diff passed, otherwise as `unverified` with a summary of
 * the gaps as its last error.
 */
export async function replayGraphChangeSet(id: string): Promise<GraphChangeSetReplayResult> {
  const record = getGraphChangeSet(id);
  if (!record) throw new GraphChangeSetReplayError(404, "Graph change set not found.");

  const changeSet = parseStoredChangeSet(record);
  // The stored verdict includes the privacy leak check, which needs the source
  // note and so cannot be re-run here; a change set stored as invalid stays refused.
  if (record.validationStatus === "invalid") {
    throw new GraphChangeSetReplayError(400, "Graph change set was stored as invalid and cannot be replayed.", {
      record,
      validation: {
        valid: false,
        errors: parseStringArray(record.validationErrorsJson),
        warnings: parseStringArray(record.validationWarningsJson),
      },
    });
  }
  const validation = validateGraphChangeSet(changeSet);
  if (!validation.valid) {
    const updated = markGraphChangeSetReplayFailed(record.id, `Validation failed: ${validation.errors.join("; ")}`) ?? record;
    throw new GraphChangeSetReplayError(400, "Graph change set is invalid and cannot be replayed.", {
      record: updated,
      validation,
    });
  }

  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl) {
    throw new GraphChangeSetReplayError(503, "Graph memory is disabled or missing PERRY_GRAPHITI_BRIDGE_URL.", {
      record,
      validation,
    });
  }

  try {
    const bridgeResult = await postGraphChangeSet(changeSet, record.groupId, status);
    const diff = await diffGraphChangeSetReadback(changeSet);
    const updated =
      markGraphChangeSetReplayApplied(
        record.id,
        { bridgeResult, diff },
        { verified: diff.passed, unverifiedReason: describeDiffGaps(diff) }
      ) ?? record;
    return {
      changeSetId: record.id,
      meetingId: record.meetingId,
      groupId: record.groupId,
      status: diff.passed ? "applied" : "unverified",
      appliedAt: updated.appliedAt,
      validation,
      bridgeResult,
      diff,
      record: updated,
    };
  } catch (error) {
    const updated = markGraphChangeSetReplayFailed(record.id, error) ?? record;
    throw new GraphChangeSetReplayError(502, error instanceof Error ? error.message : String(error), {
      record: updated,
      validation,
    });
  }
}

// The bridge's per-request row cap. A read that returns this many rows may have
// been cut short, so a row absent from it is not proof the row is missing.
const READBACK_LIMIT = 100;

/**
 * Reads the change set back from the bridge and lists what is missing. Facts
 * and retirements are first looked up in their subject's entity context
 * (fetched once per key). The bridge caps each read at READBACK_LIMIT rows, so
 * when that page is full and lacks the row, the readback narrows the query: a
 * fact is looked up by its exact subject, relation and object; a retirement in
 * its object's context. Only a row absent from a complete read is reported
 * missing; one absent from a read that is still full is reported in `errors`
 * as unverifiable. Evidence ids match when either side omits one. Never throws
 * on bridge errors: they are collected in `errors` and fail the diff.
 */
export async function diffGraphChangeSetReadback(changeSet: GraphChangeSet): Promise<GraphReplayDiff> {
  const contexts = new Map<string, GraphEntityContextResponse>();
  const errors: string[] = [];
  const missingEntities: string[] = [];
  const missingRelations: GraphReplayDiffRelation[] = [];
  const missingRetirements: GraphReplayDiffRelation[] = [];
  const missingEvidence: string[] = [];

  const contextFor = async (stableKey: string): Promise<GraphEntityContextResponse | undefined> => {
    const cached = contexts.get(stableKey);
    if (cached) return cached;
    const context = await getGraphEntityContext(stableKey, READBACK_LIMIT);
    contexts.set(stableKey, context);
    if (context.error) errors.push(`${stableKey}: ${context.error}`);
    return context;
  };

  for (const entity of changeSet.entities) {
    const context = await contextFor(entity.stableKey);
    if (!context?.entity?.stableKey) missingEntities.push(entity.stableKey);
  }

  for (const relation of changeSet.relations) {
    const facts = (await contextFor(relation.subjectKey))?.facts.map((row) => row.fact) ?? [];
    let found = facts.some((fact) => sameRow(fact, relation));
    let truncated = facts.length >= READBACK_LIMIT;
    if (!found && truncated) {
      const exact = await listGraphFacts({
        subject: relation.subjectKey,
        relation: relation.relation,
        object: relation.objectKey,
        limit: READBACK_LIMIT,
      });
      if (exact.error) errors.push(`${relation.subjectKey} ${relation.relation} ${relation.objectKey}: ${exact.error}`);
      found = exact.facts.some((row) => sameRow(row.fact, relation));
      truncated = exact.facts.length >= READBACK_LIMIT;
    }
    if (!found && truncated) {
      errors.push(`Could not verify ${relation.subjectKey} ${relation.relation} ${relation.objectKey}: readback truncated`);
    } else if (!found) {
      missingRelations.push({
        subjectKey: relation.subjectKey,
        relation: relation.relation,
        objectKey: relation.objectKey,
        evidenceId: relation.evidenceId,
      });
    }
  }

  for (const retirement of changeSet.retirements) {
    let found = false;
    let truncated = false;
    // The subject's context first, then the object's (usually far smaller).
    for (const key of [retirement.subjectKey, retirement.objectKey]) {
      const rows = (await contextFor(key))?.retirements.map((row) => row.retirement) ?? [];
      found = rows.some((item) => sameRow(item, retirement));
      truncated = rows.length >= READBACK_LIMIT;
      if (found || !truncated) break;
    }
    if (!found && truncated) {
      errors.push(`Could not verify retirement ${retirement.subjectKey} ${retirement.relation} ${retirement.objectKey}: readback truncated`);
    } else if (!found) {
      missingRetirements.push({
        subjectKey: retirement.subjectKey,
        relation: retirement.relation,
        objectKey: retirement.objectKey,
        evidenceId: retirement.evidenceId,
      });
    }
  }

  for (const evidence of changeSet.evidence) {
    const result = await getGraphEvidence(evidence.evidenceId);
    if (result.error) errors.push(`${evidence.evidenceId}: ${result.error}`);
    if (!result.evidence?.evidenceId) missingEvidence.push(evidence.evidenceId);
  }

  const passed =
    missingEntities.length === 0 &&
    missingRelations.length === 0 &&
    missingRetirements.length === 0 &&
    missingEvidence.length === 0 &&
    errors.length === 0;

  return {
    checkedAt: new Date().toISOString(),
    passed,
    expected: {
      entities: changeSet.entities.length,
      relations: changeSet.relations.length,
      retirements: changeSet.retirements.length,
      evidence: changeSet.evidence.length,
    },
    missing: {
      entities: missingEntities,
      relations: missingRelations,
      retirements: missingRetirements,
      evidence: missingEvidence,
    },
    errors,
  };
}

// A read-back fact or retirement matches when subject, relation and object
// agree and the evidence ids agree or either is absent.
function sameRow(
  row: GraphFactResult | GraphRetirementResult | undefined,
  expected: { subjectKey: string; relation: string; objectKey: string; evidenceId?: string }
): boolean {
  return (
    row?.subjectKey === expected.subjectKey &&
    row.relation === expected.relation &&
    row.objectKey === expected.objectKey &&
    (!expected.evidenceId || !row.evidenceId || row.evidenceId === expected.evidenceId)
  );
}

// The last_error for an unverified replay, e.g. "Replay readback did not pass: 2 relations missing; 1 read errors".
function describeDiffGaps(diff: GraphReplayDiff): string {
  const gaps: Array<[number, string]> = [
    [diff.missing.entities.length, "entities missing"],
    [diff.missing.relations.length, "relations missing"],
    [diff.missing.retirements.length, "retirements missing"],
    [diff.missing.evidence.length, "evidence missing"],
    [diff.errors.length, "read errors"],
  ];
  const parts = gaps.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`);
  return `Replay readback did not pass: ${parts.join("; ")}`;
}

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// Parses the stored JSON; on failure marks the change set failed and throws 400.
function parseStoredChangeSet(record: GraphChangeSetRecord): GraphChangeSet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.changeSetJson) as unknown;
  } catch (error) {
    markGraphChangeSetReplayFailed(record.id, error);
    throw new GraphChangeSetReplayError(400, "Stored graph change set JSON could not be parsed.", { record });
  }
  if (!isGraphChangeSetLike(parsed)) {
    markGraphChangeSetReplayFailed(record.id, "Stored graph change set JSON has the wrong shape.");
    throw new GraphChangeSetReplayError(400, "Stored graph change set JSON has the wrong shape.", { record });
  }
  return parsed;
}

// Shallow shape check: schemaVersion 1 and the expected top-level fields. Item contents are left to validation.
function isGraphChangeSetLike(value: unknown): value is GraphChangeSet {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    typeof record.sourceMeetingId === "string" &&
    typeof record.generatedAt === "string" &&
    Array.isArray(record.entities) &&
    Array.isArray(record.relations) &&
    Array.isArray(record.retirements) &&
    Array.isArray(record.evidence) &&
    Array.isArray(record.warnings)
  );
}
