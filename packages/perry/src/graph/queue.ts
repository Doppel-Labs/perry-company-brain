// queue — the graph sync queue: meeting episodes waiting to be posted to the bridge.
//
// Durability, claiming and retry backoff live in the store's shared job-queue
// engine (graph_sync_jobs); this file decides what goes into a job and how a
// claimed job is delivered. One job per meeting: re-enqueueing resets it.
// A change set that fails validation is stored for review but never posted,
// in either write mode: its job is written as failed, and drain skips any
// invalid job that was queued before that rule existed.
import {
  claimGraphSyncJobs,
  completeGraphSyncJob,
  enqueueGraphSyncJob,
  failGraphSyncJob,
  getGraphSyncQueueStats,
  invalidChangeSetReason,
  listGraphSyncJobs,
  skipInvalidGraphSyncJob,
  withGraphSyncJobLease,
  type GraphSyncJobRecord,
  type GraphSyncQueueStats,
  type PageOptions,
} from "@store";
import {
  buildGraphitiMeetingEpisode,
  getGraphMemoryStatus,
  postGraphitiEpisode,
  type GraphMemorySyncInput,
  type GraphitiEpisodePayload,
} from "./memory";

export interface GraphSyncQueueSnapshot {
  stats: GraphSyncQueueStats;
  recent: GraphSyncJobSummary[];
}

/** A job row without its payload and result JSON, for listings. */
export type GraphSyncJobSummary = Omit<GraphSyncJobRecord, "payloadJson" | "resultJson"> & {
  hasPayload: boolean;
  hasResult: boolean;
};

/**
 * Builds the meeting's episode (with its change set and validation) and queues
 * it as job `graph-sync:meeting:<id>`, storing the change set in the same
 * transaction. An invalid change set is stored as `invalid` and its job is
 * written as `failed` rather than queued, so it is never posted or
 * materialized. Returns undefined, writing nothing, when graph memory is disabled.
 */
export function enqueueMeetingGraphSync(input: GraphMemorySyncInput): GraphSyncJobRecord | undefined {
  const status = getGraphMemoryStatus();
  if (!status.enabled) return undefined;
  const episode = buildGraphitiMeetingEpisode(input, status.groupId);
  const body = JSON.parse(episode.body) as {
    graphChangeSet?: unknown;
    graphValidation?: { valid?: boolean; errors?: unknown[]; warnings?: unknown[] };
  };
  return enqueueGraphSyncJob({
    id: `graph-sync:meeting:${input.record.id}`,
    entityType: "meeting",
    entityId: input.record.id,
    payloadJson: JSON.stringify(episode),
    graphChangeSet: body.graphChangeSet
      ? {
          id: `graph-change-set:meeting:${input.record.id}`,
          groupId: episode.groupId,
          validationStatus: body.graphValidation?.valid === false ? "invalid" : "valid",
          validationErrors: body.graphValidation?.errors ?? [],
          validationWarnings: body.graphValidation?.warnings ?? [],
          changeSet: body.graphChangeSet,
        }
      : undefined,
  });
}

/**
 * Claims and posts up to `limit` due jobs, re-claiming until the limit is met or
 * none are due. A failed post is recorded on the job (retried with backoff
 * until max attempts) rather than thrown. `skipped` counts claimed jobs whose
 * change set failed validation: they are retired as failed without being
 * posted. A no-op when graph memory is disabled.
 * `leaseLost` counts claimed jobs another worker took over before this drain
 * reached them; those are left to that worker.
 */
export async function drainGraphSyncJobs(
  limit = 10
): Promise<{ processed: number; failed: number; skipped: number; leaseLost: number }> {
  const status = getGraphMemoryStatus();
  if (!status.enabled) return { processed: 0, failed: 0, skipped: 0, leaseLost: 0 };

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let leaseLost = 0;
  const target = Math.max(Math.trunc(limit), 0);

  while (processed + failed + skipped + leaseLost < target) {
    // Claim one job at a time, as it starts: each post is a network call, so a
    // claimed batch would sit waiting while its leases ran down.
    const jobs = claimGraphSyncJobs(1);
    if (jobs.length === 0) break;

    for (const job of jobs) {
      try {
        const run = await withGraphSyncJobLease(job, async () => {
          const payload = JSON.parse(job.payloadJson) as GraphitiEpisodePayload;
          const validationErrors = invalidPayloadErrors(payload);
          if (validationErrors) {
            skipInvalidGraphSyncJob(job.id, invalidChangeSetReason(validationErrors), job.leaseToken);
            return "skipped" as const;
          }
          await postGraphitiEpisode(payload, status);
          completeGraphSyncJob(job.id, { posted: true, name: payload.name, groupId: payload.groupId }, job.leaseToken);
          return "processed" as const;
        });
        if (!run.owned) leaseLost += 1;
        else if (run.value === "skipped") skipped += 1;
        else processed += 1;
      } catch (error) {
        failGraphSyncJob(job.id, error, job.leaseToken);
        failed += 1;
      }
    }
  }

  return { processed, failed, skipped, leaseLost };
}

/** Queue counts plus a page of recent jobs, without payloads. */
export function getGraphSyncQueueSnapshot(options: PageOptions = {}): GraphSyncQueueSnapshot {
  return {
    stats: getGraphSyncQueueStats(),
    recent: listGraphSyncJobs(options).map(summarizeJob),
  };
}

/** Like getGraphSyncQueueSnapshot, but the jobs include their payload and result JSON. */
export function getFullGraphSyncQueueSnapshot(options: PageOptions = {}): {
  stats: GraphSyncQueueStats;
  recent: GraphSyncJobRecord[];
} {
  return {
    stats: getGraphSyncQueueStats(),
    recent: listGraphSyncJobs(options),
  };
}

// The episode's recorded validation errors when its change set is invalid, else undefined.
function invalidPayloadErrors(payload: GraphitiEpisodePayload): unknown[] | undefined {
  const body = JSON.parse(payload.body) as { graphValidation?: { valid?: boolean; errors?: unknown[] } };
  return body.graphValidation?.valid === false ? body.graphValidation.errors ?? [] : undefined;
}

function summarizeJob(job: GraphSyncJobRecord): GraphSyncJobSummary {
  const { payloadJson, resultJson, ...summary } = job;
  return {
    ...summary,
    hasPayload: Boolean(payloadJson),
    hasResult: Boolean(resultJson),
  };
}
