// ingestion/worker — the optional in-process background worker for the ingestion queue.
//
// Enabled with PERRY_INGESTION_WORKER=true and started by the admin server.
// Every PERRY_INGESTION_INTERVAL_MS (default 1000) it processes at most one
// job; a tick is skipped while the previous one is still running, so jobs never
// run concurrently within a process. Failures are logged, and the queue's
// retry/backoff decides when the job runs again.
import { processNextGranolaIngestionJob } from "./queue";

export interface IngestionWorkerHandle {
  stop(): void;
}

/**
 * Starts polling (first tick immediately) and returns a handle to stop it.
 * A no-op handle when the worker is disabled. The timer is unref'd, so it
 * does not keep the process alive on its own.
 */
export function startIngestionWorker(): IngestionWorkerHandle {
  const enabled = process.env.PERRY_INGESTION_WORKER === "true";
  if (!enabled) return { stop() {} };

  const intervalMs = Number(process.env.PERRY_INGESTION_INTERVAL_MS) || 1000;
  let running = false;

  const tick = () => {
    if (running) return;
    running = true;
    void processNextGranolaIngestionJob()
      .catch((error) => {
        console.error("Ingestion worker failed:", error);
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
