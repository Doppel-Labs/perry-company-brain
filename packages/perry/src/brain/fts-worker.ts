// fts-worker — background timer that moves queued rows into the full-text search index.
//
// Writes enqueue FTS work rather than indexing inline; this worker drains that
// queue in batches. Ticks are synchronous and guarded against overlap, and a
// failing tick is logged and retried on the next interval.
import { flushFtsQueue, pendingFtsCount } from "@store";

export interface FtsWorkerHandle {
  stop(): void;
}

/**
 * Starts draining the FTS queue now and every PERRY_FTS_INTERVAL_MS (default
 * 1000 ms), up to PERRY_FTS_BATCH_SIZE (default 1000) rows per tick. Disabled,
 * returning a no-op handle, when PERRY_FTS_WORKER=false. The timer is unref'd,
 * so it does not keep the process alive.
 */
export function startFtsWorker(): FtsWorkerHandle {
  const enabled = process.env.PERRY_FTS_WORKER !== "false";
  if (!enabled) {
    return { stop() {} };
  }

  const intervalMs = Number(process.env.PERRY_FTS_INTERVAL_MS) || 1000;
  const batchSize = Number(process.env.PERRY_FTS_BATCH_SIZE) || 1000;
  let running = false;

  const tick = () => {
    if (running) return;
    running = true;
    try {
      if (pendingFtsCount() > 0) {
        flushFtsQueue(batchSize);
      }
    } catch (error) {
      console.error("FTS worker failed:", error);
    } finally {
      running = false;
    }
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
