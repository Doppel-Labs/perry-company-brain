// controllers/graph-memory — bounded reads of the temporal knowledge graph.
import {
  getGraphEntityContext,
  getGraphEvidence,
  getGraphTimeline,
  listGraphEntities,
  listGraphFacts,
  projectMultiplayerState,
  searchGraphMemory,
} from "@graph";
import type { RouteDefinition } from "../router";

/**
 * Read-only queries of the Graphiti bridge, plus POST /api/brain/project-multiplayer,
 * which upserts users, issues, and pivots derived from recent decisions and actions.
 */
export const graphMemoryRoutes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/brain/graph/search",
    handle: ({ query }) => searchGraphMemory(query.string("q") ?? "", query.int("limit", 10, { max: 200 })),
  },
  {
    method: "GET",
    path: "/api/brain/graph/entities",
    handle: ({ query }) =>
      listGraphEntities({
        query: query.string("q"),
        type: query.string("type"),
        limit: query.int("limit", 25, { max: 500 }),
      }),
  },
  {
    method: "GET",
    path: "/api/brain/graph/entities/:stableKey/context",
    handle: ({ params, query }) => getGraphEntityContext(params.stableKey, query.int("limit", 25, { max: 500 })),
  },
  {
    method: "GET",
    path: "/api/brain/graph/facts",
    handle: ({ query }) =>
      listGraphFacts({
        subject: query.string("subject"),
        object: query.string("object"),
        relation: query.string("relation"),
        active: query.optionalFlag("active"),
        limit: query.int("limit", 25, { max: 500 }),
      }),
  },
  {
    method: "GET",
    path: "/api/brain/graph/evidence",
    handle: ({ query }) => getGraphEvidence(query.string("evidenceId") ?? ""),
  },
  {
    method: "GET",
    path: "/api/brain/graph/timeline",
    handle: ({ query }) =>
      getGraphTimeline(query.string("stableKey") ?? query.string("entity") ?? "", query.int("limit", 50, { max: 500 })),
  },
  {
    method: "POST",
    path: "/api/brain/project-multiplayer",
    handle: ({ query }) => projectMultiplayerState(query.int("limit", 10_000, { max: 100_000 })),
  },
];
