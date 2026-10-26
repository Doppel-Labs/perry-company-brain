// memory/writes — pushing meetings and change sets into the graph.
import type { GraphChangeSet } from "../change-set";
import { postJson } from "./bridge-client";
import { buildGraphitiMeetingEpisode } from "./episode";
import { getGraphMemoryStatus } from "./status";
import type { GraphitiEpisodePayload, GraphMemoryStatus, GraphMemorySyncInput } from "./types";

/** Best-effort sync of one meeting; failures are logged, never thrown. */
export async function syncMeetingToGraphMemory(input: GraphMemorySyncInput): Promise<void> {
  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl) return;

  const payload = buildGraphitiMeetingEpisode(input, status.groupId);
  try {
    await postGraphitiEpisode(payload, status);
  } catch (error) {
    console.warn(`Graphiti episode sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Posts an episode for Graphiti to extract from or, in direct change-set mode,
 * the episode's typed graphChangeSet instead. Throws on failure.
 */
export async function postGraphitiEpisode(
  payload: GraphitiEpisodePayload,
  status: GraphMemoryStatus = getGraphMemoryStatus()
): Promise<void> {
  if (!status.enabled || !status.bridgeUrl) return;
  if (status.directChangeSets) {
    const body = JSON.parse(payload.body) as { graphChangeSet?: GraphChangeSet };
    if (!body.graphChangeSet) throw new Error("Graphiti direct change-set sync failed: payload missing graphChangeSet");
    await postGraphChangeSet(body.graphChangeSet, payload.groupId, status);
    return;
  }

  const response = await postJson(status, "/episodes", payload);
  if (!response.ok) {
    throw new Error(`Graphiti episode sync failed: ${response.status} ${await response.text()}`);
  }
}

/** Applies a change set through the bridge. Throws on failure. */
export async function postGraphChangeSet(
  changeSet: GraphChangeSet,
  groupId: string,
  status: GraphMemoryStatus = getGraphMemoryStatus()
): Promise<unknown> {
  if (!status.enabled || !status.bridgeUrl) {
    throw new Error("Graphiti direct change-set sync failed: graph memory is disabled");
  }
  const response = await postJson(status, "/change-sets", { groupId, changeSet });
  if (!response.ok) {
    throw new Error(`Graphiti direct change-set sync failed: ${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  if (!text.trim()) return { ok: true };
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { ok: true, body: text };
  }
}
