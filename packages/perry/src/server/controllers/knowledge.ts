// controllers/knowledge — company-brain search, decisions, action items, insights, standups.
import { generateActivityStandup, getCompanyBrainInsights } from "@brain";
import { flushFtsQueue, listActionItems, listDecisions, searchBrain } from "@store";
import type { RouteDefinition } from "../router";
import { parseList, parseSearchType } from "../validation";

/**
 * Full-text search, paged decisions and actions, ownership insights, an on-demand
 * Inky GitHub-activity standup, and a manual FTS queue flush.
 */
export const knowledgeRoutes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/brain/search",
    handle: ({ query }) => ({
      results: searchBrain(query.string("q") ?? "", query.int("limit", 20, { max: 200 }), {
        types: query.parse("types", (value) => parseList(value, parseSearchType)),
      }),
    }),
  },
  {
    method: "GET",
    path: "/api/brain/decisions",
    handle: ({ query }) => {
      const { limit, offset } = query.page(50);
      return { records: listDecisions(limit, offset) };
    },
  },
  {
    method: "GET",
    path: "/api/brain/actions",
    handle: ({ query }) => {
      const { limit, offset } = query.page(50);
      return { records: listActionItems(limit, offset) };
    },
  },
  {
    method: "GET",
    path: "/api/brain/insights",
    handle: ({ query }) => getCompanyBrainInsights(query.int("limit", 10_000, { max: 100_000 })),
  },
  {
    method: "GET",
    path: "/api/brain/activity-standup",
    handle: ({ query }) =>
      generateActivityStandup({
        windowHours: query.optionalInt("windowHours", { min: 1, max: 24 * 31 }),
        mechanical: query.flag("mechanical"),
      }),
  },
  {
    method: "POST",
    path: "/api/brain/fts/flush",
    handle: ({ query }) => ({ flushed: flushFtsQueue(query.int("limit", 1000, { max: 100_000 })) }),
  },
];
