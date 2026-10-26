// api/graph — graph memory: the sync queue and change sets, plus the bounded graph
// read model (typed entities, active facts, entity context, timeline, semantic search).
import type {
  GraphChangeSetSummary,
  GraphEntityContextResponse,
  GraphEntityResult,
  GraphFactRow,
  GraphReplayDiff,
  GraphSearchResult,
  GraphSyncQueueSnapshot,
  GraphTimelineResponse,
} from "../types";
import { apiFetch, getJson, sendCommand } from "./client";

/** Queue counts plus the 5 most recent sync jobs. */
export function fetchGraphSyncJobs(label = "Graph sync load"): Promise<GraphSyncQueueSnapshot> {
  return getJson<GraphSyncQueueSnapshot>("/api/graph-sync/jobs?limit=5", label);
}

/** Up to 8 recent change sets (summaries, without payloads). */
export async function fetchGraphChangeSets(label = "Graph change sets load"): Promise<GraphChangeSetSummary[]> {
  return (await getJson<{ records: GraphChangeSetSummary[] }>("/api/graph-sync/change-sets?limit=8", label)).records;
}

/** Typed entity lookup. `enabled`/`error` report graph-memory state in a 200 body, not as an HTTP failure. */
export function searchGraphEntities(
  query: string,
  limit: number,
  label: string
): Promise<{ enabled: boolean; entities: GraphEntityResult[]; error?: string }> {
  return getJson(`/api/brain/graph/entities?q=${encodeURIComponent(query)}&limit=${limit}`, label);
}

/** Up to 8 facts that are still active (not retired). */
export async function fetchActiveGraphFacts(label = "Graph facts load"): Promise<GraphFactRow[]> {
  return (await getJson<{ facts: GraphFactRow[] }>("/api/brain/graph/facts?active=true&limit=8", label)).facts;
}

/** Semantic search over graph memory; like `searchGraphEntities`, errors can arrive in the body. */
export function searchGraph(query: string): Promise<{ enabled: boolean; results: GraphSearchResult[]; error?: string }> {
  return getJson(`/api/brain/graph/search?q=${encodeURIComponent(query)}&limit=10`, "Graph search");
}

/** Current facts and retirements around one entity, capped at 12. */
export function fetchGraphEntityContext(stableKey: string): Promise<GraphEntityContextResponse> {
  return getJson(`/api/brain/graph/entities/${encodeURIComponent(stableKey)}/context?limit=12`, "Graph entity context");
}

/** Fact and retirement events for one entity, capped at 12. */
export function fetchGraphTimeline(stableKey: string): Promise<GraphTimelineResponse> {
  return getJson(`/api/brain/graph/timeline?stableKey=${encodeURIComponent(stableKey)}&limit=12`, "Graph timeline");
}

/** Server write: queue graph sync jobs for up to 500 stored meetings (already-queued ones are skipped). Throws `ApiError`. */
export function enqueueGraphBackfill(): Promise<void> {
  return sendCommand("/api/graph-sync/backfill?limit=500", "POST", "Graph backfill");
}

/** Server write: process up to 25 queued sync jobs now. Throws `ApiError`. */
export function drainGraphSync(): Promise<void> {
  return sendCommand("/api/graph-sync/drain?limit=25", "POST", "Graph drain");
}

/** Replay failures surface the server's own `error` message when it sends one. */
export async function replayGraphChangeSet(id: string): Promise<GraphReplayDiff | null> {
  const response = await apiFetch(`/api/graph-sync/change-sets/${encodeURIComponent(id)}/replay`, { method: "POST" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Graph replay failed: ${response.status}`);
  }
  const payload = (await response.json()) as { replay?: { diff?: GraphReplayDiff } };
  return payload.replay?.diff ?? null;
}
