// memory/reads — bounded, read-only graph queries. They never throw: errors come back in `error`.
import { clampLimit, graphGet, postJson } from "./bridge-client";
import { getGraphMemoryStatus } from "./status";
import type {
  GraphEntityContextResponse,
  GraphEntityResult,
  GraphEvidenceResult,
  GraphFactRow,
  GraphMemorySearchResponse,
  GraphMemorySearchResult,
  GraphRetirementRow,
  GraphTimelineResponse,
} from "./types";

/** Searches the group's graph via the bridge's /search (limit clamped to 1–50). Empty query returns no results. */
export async function searchGraphMemory(query: string, limit = 10): Promise<GraphMemorySearchResponse> {
  const status = getGraphMemoryStatus();
  const normalizedQuery = query.trim();
  if (!status.enabled || !status.bridgeUrl || !normalizedQuery) {
    return { enabled: status.enabled, results: [] };
  }

  try {
    const response = await postJson(status, "/search", {
      query: normalizedQuery,
      groupId: status.groupId,
      limit: clampLimit(limit, 50),
    });
    if (!response.ok) {
      return { enabled: true, results: [], error: `Graphiti search failed: ${response.status}` };
    }
    const body = (await response.json()) as { results?: GraphMemorySearchResult[] };
    return { enabled: true, results: body.results ?? [] };
  } catch (error) {
    return { enabled: true, results: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Lists entities, optionally filtered by text query and type (limit default 25, max 100). */
export async function listGraphEntities(options: {
  query?: string;
  type?: string;
  limit?: number;
} = {}): Promise<{ enabled: boolean; entities: GraphEntityResult[]; error?: string }> {
  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl) return { enabled: status.enabled, entities: [] };
  const params = new URLSearchParams({
    groupId: status.groupId,
    limit: String(clampLimit(options.limit ?? 25, 100)),
  });
  if (options.query) params.set("q", options.query);
  if (options.type) params.set("type", options.type);
  return graphGet<{ entities?: GraphEntityResult[] }, { enabled: boolean; entities: GraphEntityResult[]; error?: string }>(
    status,
    `/entities?${params.toString()}`,
    { enabled: status.enabled, entities: [] },
    (body) => ({
      enabled: true,
      entities: body.entities ?? [],
    })
  );
}

/** Lists facts filtered by subject, object, relation and active flag (limit default 25, max 100). */
export async function listGraphFacts(options: {
  subject?: string;
  object?: string;
  relation?: string;
  active?: boolean;
  limit?: number;
} = {}): Promise<{ enabled: boolean; facts: GraphFactRow[]; error?: string }> {
  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl) return { enabled: status.enabled, facts: [] };
  const params = new URLSearchParams({
    groupId: status.groupId,
    limit: String(clampLimit(options.limit ?? 25, 100)),
  });
  if (options.subject) params.set("subject", options.subject);
  if (options.object) params.set("object", options.object);
  if (options.relation) params.set("relation", options.relation);
  if (typeof options.active === "boolean") params.set("active", String(options.active));
  return graphGet<{ facts?: GraphFactRow[] }, { enabled: boolean; facts: GraphFactRow[]; error?: string }>(
    status,
    `/facts?${params.toString()}`,
    { enabled: status.enabled, facts: [] },
    (body) => ({
      enabled: true,
      facts: body.facts ?? [],
    })
  );
}

/** One evidence record by id; `evidence` is null when absent or when graph memory is off. */
export async function getGraphEvidence(evidenceId: string): Promise<{
  enabled: boolean;
  evidence?: GraphEvidenceResult | null;
  error?: string;
}> {
  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl || !evidenceId.trim()) {
    return { enabled: status.enabled, evidence: null };
  }
  const params = new URLSearchParams({ groupId: status.groupId, evidenceId: evidenceId.trim() });
  return graphGet<
    { evidence?: GraphEvidenceResult | null },
    { enabled: boolean; evidence?: GraphEvidenceResult | null; error?: string }
  >(status, `/evidence?${params.toString()}`, { enabled: status.enabled, evidence: null }, (body) => ({
    enabled: true,
    evidence: body.evidence ?? null,
  }));
}

/** An entity with the facts and retirements it participates in (limit default 25, max 100). */
export async function getGraphEntityContext(stableKey: string, limit = 25): Promise<GraphEntityContextResponse> {
  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl || !stableKey.trim()) {
    return { enabled: status.enabled, entity: null, facts: [], retirements: [] };
  }
  const params = new URLSearchParams({
    groupId: status.groupId,
    stableKey: stableKey.trim(),
    limit: String(clampLimit(limit, 100)),
  });
  return graphGet<
    { entity?: GraphEntityResult | null; facts?: GraphFactRow[]; retirements?: GraphRetirementRow[] },
    GraphEntityContextResponse
  >(
    status,
    `/entity-context?${params.toString()}`,
    { enabled: status.enabled, entity: null, facts: [], retirements: [] },
    (body) => ({
      enabled: true,
      entity: body.entity ?? null,
      facts: body.facts ?? [],
      retirements: body.retirements ?? [],
    })
  );
}

/** An entity's fact and retirement events as the bridge orders them (limit default 50, max 100). */
export async function getGraphTimeline(stableKey: string, limit = 50): Promise<GraphTimelineResponse> {
  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl || !stableKey.trim()) {
    return { enabled: status.enabled, stableKey: stableKey.trim(), events: [] };
  }
  const params = new URLSearchParams({
    groupId: status.groupId,
    stableKey: stableKey.trim(),
    limit: String(clampLimit(limit, 100)),
  });
  return graphGet<{ stableKey?: string; events?: GraphTimelineResponse["events"] }, GraphTimelineResponse>(
    status,
    `/timeline?${params.toString()}`,
    { enabled: status.enabled, stableKey: stableKey.trim(), events: [] },
    (body) => ({
      enabled: true,
      stableKey: body.stableKey ?? stableKey.trim(),
      events: body.events ?? [],
    })
  );
}
