// sync-worker — the in-process timer that drains the graph sync queue.
import { drainGraphSyncJobs } from "./queue";

/**
 * Starts draining when PERRY_GRAPH_SYNC_WORKER=true: every
 * PERRY_GRAPH_SYNC_INTERVAL_MS (default 3000) it drains up to
 * PERRY_GRAPH_SYNC_BATCH_SIZE jobs (default 10). Ticks are not serialized, but
 * claims are atomic so overlapping drains never take the same job. Errors are
 * logged; the timer is unref'd so it never keeps the process alive.
 */
export function startGraphSyncWorker(): void {
  const enabled = process.env.PERRY_GRAPH_SYNC_WORKER === "true";
  if (!enabled) return;

  const intervalMs = Number(process.env.PERRY_GRAPH_SYNC_INTERVAL_MS) || 3000;
  const batchSize = Number(process.env.PERRY_GRAPH_SYNC_BATCH_SIZE) || 10;
  setInterval(() => {
    drainGraphSyncJobs(batchSize).catch((error) => {
      console.error("Graph sync worker failed", error);
    });
  }, intervalMs).unref();
}
