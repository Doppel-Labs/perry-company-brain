// hooks/useGraphExplorer — read-side graph state: entity search and selection, active
// facts, the selected entity's context and timeline, and semantic search.
import { useState } from "react";
import { optional, orReportError } from "../api/client";
import * as graphApi from "../api/graph";
import { reportErrors } from "../lib/errors";
import type { GraphEntityContextResponse, GraphEntityResult, GraphFactRow, GraphSearchResult, GraphTimelineResponse } from "../types";
import type { HookDeps } from "./types";

/**
 * Typed entity lookup, bounded entity context/timeline, active facts, and semantic graph
 * search. The actions never reject: network errors are reported via `setError`.
 */
export function useGraphExplorer({ setError }: Pick<HookDeps, "setError">) {
  const [graphQuery, setGraphQuery] = useState("");
  const [graphResults, setGraphResults] = useState<GraphSearchResult[]>([]);
  const [graphEntityQuery, setGraphEntityQuery] = useState("wallace");
  const [graphEntities, setGraphEntities] = useState<GraphEntityResult[]>([]);
  const [graphFacts, setGraphFacts] = useState<GraphFactRow[]>([]);
  const [selectedGraphEntityKey, setSelectedGraphEntityKey] = useState("");
  const [graphEntityContext, setGraphEntityContext] = useState<GraphEntityContextResponse | null>(null);
  const [graphTimeline, setGraphTimeline] = useState<GraphTimelineResponse | null>(null);

  function searchGraph() {
    return reportErrors(
      async () => {
        if (!graphQuery.trim()) {
          setGraphResults([]);
          return;
        }
        const payload = await orReportError(graphApi.searchGraph(graphQuery), setError);
        if (!payload) return;
        if (payload.error) setError(payload.error);
        setGraphResults(payload.results);
      },
      setError,
      "Graph search failed"
    );
  }

  function searchGraphEntities() {
    return reportErrors(
      async () => {
        const payload = await orReportError(graphApi.searchGraphEntities(graphEntityQuery, 12, "Graph entity search"), setError);
        if (!payload) return;
        if (payload.error) setError(payload.error);
        setGraphEntities(payload.entities);
        if (payload.entities[0]) {
          setSelectedGraphEntityKey(payload.entities[0].stableKey);
          await refreshGraphEntityContext(payload.entities[0].stableKey);
        } else {
          setSelectedGraphEntityKey("");
          setGraphEntityContext(null);
          setGraphTimeline(null);
        }
      },
      setError,
      "Graph entity search failed"
    );
  }

  // Context and timeline are best-effort; an `error` inside a 200 body is still reported.
  function refreshGraphEntityContext(stableKey: string) {
    return reportErrors(
      async () => {
        const [context, timeline] = await Promise.all([
          optional(graphApi.fetchGraphEntityContext(stableKey)),
          optional(graphApi.fetchGraphTimeline(stableKey)),
        ]);
        if (context) {
          if (context.error) setError(context.error);
          setGraphEntityContext(context);
        }
        if (timeline) {
          if (timeline.error) setError(timeline.error);
          setGraphTimeline(timeline);
        }
      },
      setError,
      "Graph entity context load failed"
    );
  }

  function selectGraphEntity(stableKey: string) {
    setSelectedGraphEntityKey(stableKey);
    void refreshGraphEntityContext(stableKey);
  }

  return {
    graphQuery,
    setGraphQuery,
    graphResults,
    graphEntityQuery,
    setGraphEntityQuery,
    graphEntities,
    setGraphEntities,
    graphFacts,
    setGraphFacts,
    selectedGraphEntityKey,
    setSelectedGraphEntityKey,
    graphEntityContext,
    graphTimeline,
    searchGraph,
    searchGraphEntities,
    refreshGraphEntityContext,
    selectGraphEntity,
  };
}

export type GraphExplorerState = ReturnType<typeof useGraphExplorer>;
