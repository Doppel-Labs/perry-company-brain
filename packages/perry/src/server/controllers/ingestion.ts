// controllers/ingestion — Granola webhook intake, previews, and the ingestion queue.
import {
  drainGranolaIngestionJobs,
  enqueueGranolaIngestionJob,
  getFullIngestionQueueSnapshot,
  getIngestionQueueSnapshot,
  previewGranolaZapierPayload,
  processGranolaZapierPayload,
} from "@ingestion";
import { sampleGranolaZapierPayload } from "@meetings";
import { listMeetingRecords } from "@store";
import { badRequest } from "../http/errors";
import { readJson } from "../http/request";
import { reply } from "../http/response";
import type { RouteDefinition } from "../router";

/**
 * The Granola webhook (webhook token, not admin) processes a payload inline,
 * or enqueues it with ?enqueue=true or PERRY_WEBHOOK_MODE=queue (202 when
 * newly queued, 200 for an existing job). Admin routes preview payloads, list
 * meetings, and inspect or drain the ingestion queue.
 */
export const ingestionRoutes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/granola/zapier",
    access: "webhook",
    handle: async ({ req, query }) => {
      const force = query.flag("force");
      const dryRun = query.flag("dryRun");
      if (query.flag("enqueue") || process.env.PERRY_WEBHOOK_MODE === "queue") {
        if (dryRun) throw badRequest("Queued webhook ingestion does not support dryRun; use /api/granola/preview instead.");
        const job = enqueueGranolaIngestionJob(await readJson(req), { force });
        return reply(job.created ? 202 : 200, job);
      }
      return reply(202, await processGranolaZapierPayload(await readJson(req), { dryRun, force }));
    },
  },
  {
    method: "POST",
    path: "/api/granola/preview",
    handle: async ({ req }) => previewGranolaZapierPayload(await readJson(req)),
  },
  {
    method: "GET",
    path: "/api/granola/sample",
    handle: () => sampleGranolaZapierPayload,
  },
  {
    method: "GET",
    path: "/api/meetings/history",
    handle: ({ query }) => ({ records: listMeetingRecords(query.page()) }),
  },
  {
    method: "GET",
    path: "/api/ingestion/jobs",
    handle: ({ query }) =>
      query.flag("detail") ? getFullIngestionQueueSnapshot(query.page()) : getIngestionQueueSnapshot(query.page()),
  },
  {
    method: "POST",
    path: "/api/ingestion/drain",
    handle: ({ query }) => drainGranolaIngestionJobs(query.int("limit", 10, { max: 1000 })),
  },
];
