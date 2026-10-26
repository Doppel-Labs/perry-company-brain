// hooks/useGraphSync — graph sync queue and change sets, plus backfill, drain, and
// replay (server writes, each followed by a refresh).
import { useState } from "react";
import * as graphApi from "../api/graph";
import { errorMessage } from "../lib/errors";
import type { GraphChangeSetSummary, GraphReplayDiff, GraphSyncQueueSnapshot } from "../types";
import type { HookDeps } from "./types";

/** The graph-sync job queue, validated change sets, and the operator actions that drive them. */
export function useGraphSync({ setError, refresh }: HookDeps) {
  const [graphSyncQueue, setGraphSyncQueue] = useState<GraphSyncQueueSnapshot | null>(null);
  const [graphChangeSets, setGraphChangeSets] = useState<GraphChangeSetSummary[]>([]);
  const [graphActionStatus, setGraphActionStatus] = useState<"idle" | "backfilling" | "draining">("idle");
  const [replayingGraphChangeSetId, setReplayingGraphChangeSetId] = useState("");
  const [lastGraphReplayDiff, setLastGraphReplayDiff] = useState<GraphReplayDiff | null>(null);

  async function enqueueGraphBackfill() {
    setGraphActionStatus("backfilling");
    setError("");
    try {
      await graphApi.enqueueGraphBackfill();
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Graph backfill failed"));
    } finally {
      setGraphActionStatus("idle");
    }
  }

  async function drainGraphSync() {
    setGraphActionStatus("draining");
    setError("");
    try {
      await graphApi.drainGraphSync();
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Graph drain failed"));
    } finally {
      setGraphActionStatus("idle");
    }
  }

  async function replayGraphChangeSet(id: string) {
    setReplayingGraphChangeSetId(id);
    setError("");
    try {
      setLastGraphReplayDiff(await graphApi.replayGraphChangeSet(id));
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Graph replay failed"));
    } finally {
      setReplayingGraphChangeSetId("");
    }
  }

  return {
    graphSyncQueue,
    setGraphSyncQueue,
    graphChangeSets,
    setGraphChangeSets,
    graphActionStatus,
    replayingGraphChangeSetId,
    lastGraphReplayDiff,
    enqueueGraphBackfill,
    drainGraphSync,
    replayGraphChangeSet,
  };
}

export type GraphSyncState = ReturnType<typeof useGraphSync>;
