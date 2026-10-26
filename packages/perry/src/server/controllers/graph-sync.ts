// controllers/graph-sync — graph sync queue and change-set review/replay.
import {
  drainGraphSyncJobs,
  enqueueGraphBackfillPage,
  getFullGraphSyncQueueSnapshot,
  getGraphSyncQueueSnapshot,
  replayGraphChangeSet,
} from "@graph";
import { getGraphChangeSet, listGraphChangeSets } from "@store";
import { notFound } from "../http/errors";
import type { RouteDefinition } from "../router";
import { parseGraphChangeSetStatus } from "../validation";
import { toChangeSetSummary } from "../views/graph-change-set";

/** Inspect the graph sync queue and change sets; replay a change set, drain jobs, or enqueue a backfill page. */
export const graphSyncRoutes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/graph-sync/jobs",
    handle: ({ query }) =>
      query.flag("detail") ? getFullGraphSyncQueueSnapshot(query.page()) : getGraphSyncQueueSnapshot(query.page()),
  },
  {
    method: "GET",
    path: "/api/graph-sync/change-sets",
    handle: ({ query }) => {
      const records = listGraphChangeSets({ ...query.page(), status: query.parse("status", parseGraphChangeSetStatus) });
      return { records: query.flag("detail") ? records : records.map(toChangeSetSummary) };
    },
  },
  {
    method: "GET",
    path: "/api/graph-sync/change-sets/:id",
    handle: ({ params }) => {
      const record = getGraphChangeSet(params.id);
      if (!record) throw notFound("Graph change set not found.");
      return { record };
    },
  },
  {
    method: "POST",
    path: "/api/graph-sync/change-sets/:id/replay",
    handle: async ({ params }) => ({ replay: await replayGraphChangeSet(params.id) }),
  },
  {
    method: "POST",
    path: "/api/graph-sync/drain",
    handle: ({ query }) => drainGraphSyncJobs(query.int("limit", 10, { max: 1000 })),
  },
  {
    method: "POST",
    path: "/api/graph-sync/backfill",
    handle: ({ query }) =>
      enqueueGraphBackfillPage({ limit: query.int("limit", 100), offset: query.int("offset", 0, { max: Number.MAX_SAFE_INTEGER }) }),
  },
];
