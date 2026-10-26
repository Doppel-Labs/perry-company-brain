// ingestion/queue — the Granola ingestion queue: enqueue a webhook payload, then process it later.
//
// The webhook can enqueue instead of processing inline (`?enqueue=true` or
// PERRY_WEBHOOK_MODE=queue). Jobs are idempotent per note and per options: the
// key is `granola.ingest:<source>:<sourceId>:<force|normal>`, plus `:bypass`
// when the job skips approval, falling back to a hash of the whole payload when
// the note has no sourceId; the job id is a hash of the key. A replayed webhook
// therefore returns the existing job, while the same note enqueued with
// different options (force, or bypassApproval) gets its own job.
//
// Two ways to run jobs:
//   - processNextGranolaIngestionJob: one job at a time, used by the worker.
//   - drainGranolaIngestionJobs: a bounded batch, used by POST /api/ingestion/drain.
//     Jobs whose meeting needs approval are handled synchronously in a single
//     transaction (no network calls), each inside its own savepoint so a
//     failing job leaves no partial writes; auto-publish jobs then run one by
//     one through the async workflow (Notion, Discord).
// A failing job is recorded with failIngestionJob, which retries it with
// backoff and, once it is out of attempts, marks a mid-publish meeting
// `failed`; see src/store/job-queue.ts for the state machine.
import { createHash } from "node:crypto";
import {
  claimIngestionJobs,
  claimNextIngestionJob,
  completeIngestionJob,
  enqueueIngestionJob,
  failIngestionJob,
  getIngestionQueueStats,
  releaseIngestionJob,
  withIngestionJobLease,
  listIngestionJobs,
  meetingIdForNote,
  type IngestionJobRecord,
  type IngestionQueueStats,
  type PageOptions,
  withBrainTransaction,
  withDb,
} from "@store";
import { loadAppSettings } from "@core";
import { normalizeGranolaZapierPayload } from "@meetings";
import {
  processGranolaZapierPayload,
  tryProcessGranolaApprovalPayloadSync,
  type MeetingWorkflowResult,
} from "./workflow";

export interface EnqueuedIngestionJob {
  job: IngestionJobRecord;
  created: boolean;
}

/** Queue counts plus recent jobs with their payload/result bodies stripped. */
export interface IngestionQueueSnapshot {
  stats: IngestionQueueStats;
  recent: IngestionJobSummary[];
}

export type IngestionJobSummary = Omit<IngestionJobRecord, "payloadJson" | "resultJson"> & {
  hasPayload: boolean;
  hasResult: boolean;
};

// What a job's payload_json holds: the raw webhook body plus the workflow options.
interface QueuedGranolaPayload {
  payload: unknown;
  options: {
    force?: boolean;
    bypassApproval?: boolean;
  };
}

/**
 * Normalizes the payload (throws if it is not a valid Granola note) and
 * enqueues it. `created` is false when a job with the same idempotency key
 * (same note, same `force` and `bypassApproval`) already exists, so a
 * bypassing enqueue is never answered with an earlier held job.
 */
export function enqueueGranolaIngestionJob(
  payload: unknown,
  options: { force?: boolean; bypassApproval?: boolean } = {}
): EnqueuedIngestionJob {
  const note = normalizeGranolaZapierPayload(payload);
  const sourceKey = note.sourceId ? `${note.source}:${note.sourceId}` : stableHash(payload);
  // The `:bypass` suffix is appended rather than a new segment, so keys of
  // existing non-bypass jobs are unchanged.
  const optionKey = `${options.force ? "force" : "normal"}${options.bypassApproval ? ":bypass" : ""}`;
  const idempotencyKey = `granola.ingest:${sourceKey}:${optionKey}`;
  const id = `job:${stableHash(idempotencyKey)}`;
  return enqueueIngestionJob({
    id,
    idempotencyKey,
    meetingId: meetingIdForNote(note),
    payloadJson: JSON.stringify({ payload, options } satisfies QueuedGranolaPayload),
  });
}

/**
 * Claims and runs the oldest due job. Returns `processed: false` when nothing
 * is due. On failure the job is recorded as failed (or re-queued) and the
 * error is rethrown.
 */
export async function processNextGranolaIngestionJob(): Promise<{
  processed: boolean;
  job?: IngestionJobRecord;
  result?: MeetingWorkflowResult;
}> {
  const job = claimNextIngestionJob();
  if (!job) return { processed: false };
  const run = await processClaimedGranolaIngestionJob(job);
  return run.owned ? { processed: true, job, result: run.result } : { processed: false, job };
}

/**
 * Runs one claimed job while holding its lease (renewed at the start and
 * throughout, see withLease), and records the outcome under that lease. If
 * another worker reclaimed the job first, nothing runs and `owned` is false.
 * Rethrows the workflow's error after recording it.
 */
async function processClaimedGranolaIngestionJob(
  job: IngestionJobRecord
): Promise<{ owned: true; result: MeetingWorkflowResult } | { owned: false }> {
  try {
    const run = await withIngestionJobLease(job, () => {
      const queued = JSON.parse(job.payloadJson) as QueuedGranolaPayload;
      return processGranolaZapierPayload(queued.payload, {
        force: queued.options.force,
        bypassApproval: queued.options.bypassApproval,
      });
    });
    if (!run.owned) return { owned: false };
    completeIngestionJob(job.id, workflowResultSummary(run.value), job.leaseToken);
    return { owned: true, result: run.value };
  } catch (error) {
    failIngestionJob(job.id, error, job.leaseToken);
    throw error;
  }
}

/**
 * Runs up to `limit` due jobs and returns how many succeeded and failed;
 * errors are counted, not thrown. Claims in rounds until the target is
 * reached or nothing is due, so it can drain more than one claim page.
 * `leaseLost` counts claimed jobs another worker took over before this drain
 * reached them (its batch ran past the lease); those are left to that worker.
 */
export async function drainGranolaIngestionJobs(limit = 10): Promise<{ processed: number; failed: number; leaseLost: number }> {
  let processed = 0;
  let failed = 0;
  let leaseLost = 0;
  const target = Math.max(Math.trunc(limit), 0);

  while (processed + failed + leaseLost < target) {
    const jobs = claimIngestionJobs(target - processed - failed - leaseLost);
    if (jobs.length === 0) break;

    const fallbackJobs: IngestionJobRecord[] = [];
    const settings = loadAppSettings();
    // Approval-mode jobs only touch SQLite, so the whole batch commits in one
    // transaction. Each job runs in its own savepoint: a job that throws has
    // its writes rolled back, and only then is it failed, so the failure
    // record commits with the batch. Auto-publish jobs are deferred.
    withBrainTransaction(() => {
      for (const job of jobs) {
        try {
          const result = withJobSavepoint(() => {
            const queued = JSON.parse(job.payloadJson) as QueuedGranolaPayload;
            const held = tryProcessGranolaApprovalPayloadSync(queued.payload, {
              force: queued.options.force,
              bypassApproval: queued.options.bypassApproval,
              settings,
            });
            if (held) completeIngestionJob(job.id, workflowResultSummary(held), job.leaseToken);
            return held;
          });
          if (!result) {
            fallbackJobs.push(job);
            continue;
          }
          processed += 1;
        } catch (error) {
          failIngestionJob(job.id, error, job.leaseToken);
          failed += 1;
        }
      }
    });

    // Network jobs (model, Notion, Discord) can take long, so they are not
    // held while earlier ones run: hand them back without counting an
    // attempt, then claim and run them one at a time, each under its own lease.
    for (const job of fallbackJobs) {
      if (job.leaseToken === undefined || !releaseIngestionJob(job.id, job.leaseToken)) leaseLost += 1;
    }
    for (let started = 0; started < fallbackJobs.length && processed + failed + leaseLost < target; started += 1) {
      const job = claimNextIngestionJob();
      if (!job) break;
      try {
        const run = await processClaimedGranolaIngestionJob(job);
        if (run.owned) processed += 1;
        else leaseLost += 1;
      } catch {
        failed += 1;
      }
    }
  }

  return { processed, failed, leaseLost };
}

export function getIngestionQueueSnapshot(options: PageOptions = {}): IngestionQueueSnapshot {
  return {
    stats: getIngestionQueueStats(),
    recent: listIngestionJobs(options).map(summarizeJob),
  };
}

/** Like getIngestionQueueSnapshot, but with full job records including payloads. */
export function getFullIngestionQueueSnapshot(options: PageOptions = {}): {
  stats: IngestionQueueStats;
  recent: IngestionJobRecord[];
} {
  return {
    stats: getIngestionQueueStats(),
    recent: listIngestionJobs(options),
  };
}

// Runs `callback` inside a SQLite savepoint of the open transaction: released
// on success, rolled back (only its own writes) when it throws.
function withJobSavepoint<T>(callback: () => T): T {
  return withDb((db) => {
    db.exec("SAVEPOINT ingestion_job;");
    try {
      const result = callback();
      db.exec("RELEASE ingestion_job;");
      return result;
    } catch (error) {
      db.exec("ROLLBACK TO ingestion_job;");
      db.exec("RELEASE ingestion_job;");
      throw error;
    }
  });
}

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function summarizeJob(job: IngestionJobRecord): IngestionJobSummary {
  const { payloadJson, resultJson, ...summary } = job;
  return {
    ...summary,
    hasPayload: Boolean(payloadJson),
    hasResult: Boolean(resultJson),
  };
}

function workflowResultSummary(result: MeetingWorkflowResult): {
  duplicate: boolean;
  dryRun: boolean;
  recordId: string;
  approvalId?: string;
  notionPageId?: string;
  discordMessageUrl?: string;
} {
  return {
    duplicate: result.duplicate,
    dryRun: result.dryRun,
    recordId: result.record.id,
    approvalId: result.approval?.id,
    notionPageId: result.notionPageId,
    discordMessageUrl: result.discordMessageUrl,
  };
}
