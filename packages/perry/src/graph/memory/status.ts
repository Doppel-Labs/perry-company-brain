// memory/status — graph memory configuration, read from the environment on every
// call so tests and the admin UI see changes without a restart.
import type { GraphMemoryStatus } from "./types";

/** Enabled only when PERRY_GRAPHITI_ENABLED=true and a bridge URL is set. */
export function getGraphMemoryStatus(): GraphMemoryStatus {
  return {
    enabled: process.env.PERRY_GRAPHITI_ENABLED === "true" && Boolean(process.env.PERRY_GRAPHITI_BRIDGE_URL),
    bridgeUrl: process.env.PERRY_GRAPHITI_BRIDGE_URL,
    groupId: process.env.PERRY_GRAPHITI_GROUP_ID ?? "doppel-labs",
    timeoutMs: Math.max(Number(process.env.PERRY_GRAPHITI_TIMEOUT_MS) || 3000, 250),
    includePrivateNotes: process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES === "true",
    includeTranscript: process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT === "true",
    directChangeSets: process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS === "true",
  };
}
