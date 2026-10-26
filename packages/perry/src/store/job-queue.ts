// job-queue — the shared durable SQLite job-queue engine behind the ingestion and graph-sync queues.
//
// Both queues are the same machine; only the table, the row shape, the audit
// names, and a couple of side-effects differ. Encoding that machine once (here)
// means the subtle parts, the claim transaction, the lease, and the retry
// backoff, have a single source of truth. Enqueueing is NOT part of the engine:
// each queue module writes its own rows (ingestion dedupes on an idempotency
// key, graph-sync upserts by job id and resets the attempt count).
//
// Table contract — every queue table has these columns:
//   id, status ('queued'|'processing'|'completed'|'failed'), attempts,
//   max_attempts, not_before, locked_at, last_error, result_json,
//   created_at, updated_at
//
// Lifecycle:
//   (enqueue) ─► queued ──claim()──► processing ──complete()──► completed
//                  ▲                     │
//                  ├── fail(), attempts < max_attempts: not_before = now + backoff
//                  └── lease expired, attempts < max_attempts: not_before = now
//                                        ├── fail(), attempts >= max_attempts ──► failed
//                                        └── lease expired, attempts >= max_attempts ──► failed
//
// Claiming is the only step that must be atomic: inside one BEGIN IMMEDIATE
// transaction, expired leases are reclaimed (see below), then due rows
// (`queued` and `not_before <= now`, oldest `created_at` first) are selected and
// flipped to `processing` with `locked_at = now`, so two workers cannot claim
// the same job. complete()/fail() update one row by id and then run the
// per-queue hook and write the audit row as separate statements; they are
// atomic only when the caller has a transaction open.
//
// Backoff: fail() increments `attempts`. Below `max_attempts` the job is
// re-queued with `not_before = now + min(capMs, 1000 · 2^min(attempts, maxExp))`;
// at the limit it becomes `failed` (terminal; nothing re-queues it). Each queue
// picks its own cap: 60 s for ingestion, 5 min for graph-sync.
//
// Lease: each claim stamps its job with a fresh `lease_token` and sets
// `locked_at`, and holds the job for PERRY_JOB_LEASE_MS (default 10 minutes)
// from the last renewal. A job still `processing` after that is presumed
// abandoned by a crashed or stalled worker. The next claim counts the lost run
// as a failed attempt: below `max_attempts` the job is re-queued, due at once,
// and can be claimed by that same call; at the limit it is retired to `failed`
// (running the `onFail` hook).
//
// Healthy work never loses its lease. Drains claim slow (network) jobs one at
// a time, as they start, rather than holding a batch of them; a job claimed
// but not run is handed back with release(), which does not count an attempt.
// withLease() renews a job's lease as it starts (skipping it if another worker
// has taken it over) and keeps renewing it while the job runs, so a slow model
// or Notion call is not mistaken for a crash. complete() and fail() are fenced
// by the token: a worker whose lease was reclaimed cannot record an outcome
// over the new holder's.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type PageOptions, type Row } from "./types";
import { insertAudit, statement, withBrainTransaction, withDb } from "./database";
import { normalizePage } from "./values";

const DEFAULT_JOB_LEASE_MS = 10 * 60_000;

/** How long a claim holds its job: PERRY_JOB_LEASE_MS when that is a positive number, else 10 minutes. */
export function jobLeaseMs(): number {
  const raw = process.env.PERRY_JOB_LEASE_MS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_JOB_LEASE_MS;
}

/** Job counts per status; a status with no rows reports 0. */
export interface JobQueueStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}

/** What every job record exposes to the engine: its id and the lease token of its current claim. */
export interface LeasedJob {
  id: string;
  /** Set while the job is `processing`; identifies the claim that holds it. */
  leaseToken?: string;
}

/** Outcome of withLease(): `owned: false` means another worker holds the job and `work` never ran. */
export type LeaseRun<R> = { owned: true; value: R } | { owned: false };

/** Per-queue configuration; `table` and `claim.where` are interpolated into SQL, so they must be trusted constants. */
export interface JobQueueConfig<T> {
  /** Job table; must have the standard columns described above. */
  table: string;
  /** Maps a raw SQLite row to the typed job record. */
  mapRow: (row: Row) => T;
  /** Audit naming: event is `${prefix}.completed|failed|retry_queued|lease_expired`, tagged with `entity`. */
  events: { prefix: string; entity: string };
  /** Retry backoff: `delay = min(capMs, 1000 · 2^min(attempts, maxExp))`. */
  backoff: { capMs: number; maxExp: number };
  /** Extra leading `WHERE` clause for claims and lease reclaims (e.g. `"type = ?"`) and its bound params. */
  claim?: { where: string; params: string[] };
  /** Side-effect on success, threaded through the same connection (e.g. mark a change-set applied). */
  onComplete?: (db: DatabaseSync, id: string, now: string) => void;
  /** Side-effect on failure, retry, or expired lease, threaded through the same connection. */
  onFail?: (db: DatabaseSync, id: string, message: string, status: "failed" | "queued") => void;
}

/** The operations a queue module re-exports under its own names (e.g. `claimIngestionJobs`). */
export interface JobQueue<T extends LeasedJob> {
  /**
   * Atomically reclaim expired leases, then claim up to `limit` (default 10,
   * max 1000) due jobs, oldest first (queued → processing). `limit <= 0`
   * does nothing.
   */
  claim(limit?: number): T[];
  /**
   * Mark a job completed, storing `result` as JSON; returns the updated record.
   * With `leaseToken`, only the current lease holder can complete: a stale
   * worker gets undefined and changes nothing. Without it, the id alone decides.
   */
  complete(id: string, result: unknown, leaseToken?: string): T | undefined;
  /**
   * Record a failure (stores the error message): retire after `max_attempts`,
   * else re-queue with backoff. Fenced by `leaseToken` like complete().
   * Undefined if the job is gone or the lease is no longer held.
   */
  fail(id: string, error: unknown, leaseToken?: string): T | undefined;
  /** Extend the lease of a job still held under `leaseToken`; false if the job was reclaimed or finished. */
  renew(id: string, leaseToken: string): boolean;
  /** Hand a claimed job back to the queue, due now, without counting an attempt; false if the lease is no longer held. */
  release(id: string, leaseToken: string): boolean;
  /**
   * Runs `work` for a claimed job while holding its lease: renews it first (so
   * a job that waited in a batch starts with a full lease), then every third of
   * the lease while `work` runs. If the lease was already lost, `work` does not
   * run and the result is `{ owned: false }`.
   */
  withLease<R>(job: T, work: () => Promise<R>): Promise<LeaseRun<R>>;
  /** Count of jobs by status. */
  stats(): JobQueueStats;
  /** Most-recent jobs first, paginated (default 50, max 200). */
  list(options?: PageOptions): T[];
}

/** Builds the queue operations for one job table. Pure setup: nothing touches the database until an operation runs. */
export function createJobQueue<T extends LeasedJob>(config: JobQueueConfig<T>): JobQueue<T> {
  const { table, mapRow, events, backoff } = config;
  const claimWhere = config.claim ? `${config.claim.where} AND ` : "";
  const claimParams = config.claim?.params ?? [];
  const byId = `SELECT * FROM ${table} WHERE id = ?`;

  function claim(limit = 10): T[] {
    if (limit <= 0) return [];
    const n = normalizePage({ limit }, 10, 1000).limit;
    return withDb((db) =>
      withBrainTransaction(() => {
        const now = new Date().toISOString();
        reclaimExpiredLeases(db, now);
        const rows = statement(
          db,
          `SELECT * FROM ${table} WHERE ${claimWhere}status = ? AND not_before <= ? ORDER BY created_at ASC LIMIT ?`
        ).all(...claimParams, "queued", now, n) as Row[];
        if (rows.length === 0) return [];
        for (const row of rows) {
          statement(db, `UPDATE ${table} SET status = ?, locked_at = ?, lease_token = ?, updated_at = ? WHERE id = ?`).run(
            "processing",
            now,
            randomUUID(),
            now,
            String(row.id)
          );
        }
        const placeholders = rows.map(() => "?").join(", ");
        return statement(db, `SELECT * FROM ${table} WHERE id IN (${placeholders}) ORDER BY created_at ASC`)
          .all(...rows.map((row) => String(row.id)))
          .map((row) => mapRow(row as Row));
      })
    );
  }

  // Runs inside claim()'s transaction. A `processing` row with no locked_at has
  // no lease holder either, so it counts as expired.
  function reclaimExpiredLeases(db: DatabaseSync, now: string): void {
    const leaseMs = jobLeaseMs();
    const cutoff = new Date(Date.parse(now) - leaseMs).toISOString();
    const rows = statement(
      db,
      `SELECT id, attempts, max_attempts FROM ${table}
       WHERE ${claimWhere}status = ? AND (locked_at IS NULL OR locked_at <= ?)`
    ).all(...claimParams, "processing", cutoff) as Row[];
    for (const row of rows) {
      const message = `Lease expired: job was still processing after ${leaseMs} ms (worker crashed or stalled)`;
      recordFailure(db, row, message, now, now, "lease_expired");
    }
  }

  // Shared by fail() and lease expiry: counts one attempt, then retires the job
  // at max_attempts or re-queues it, due at `retryAt`.
  function recordFailure(
    db: DatabaseSync,
    row: Row,
    message: string,
    now: string,
    retryAt: string,
    retryEvent: "retry_queued" | "lease_expired"
  ): void {
    const id = String(row.id);
    const attempts = Number(row.attempts) + 1;
    const finalFailure = attempts >= Number(row.max_attempts);
    const status: "failed" | "queued" = finalFailure ? "failed" : "queued";
    // A retired job keeps not_before = now; `retryAt` only matters for a re-queue.
    statement(
      db,
      `UPDATE ${table} SET status = ?, attempts = ?, locked_at = NULL, lease_token = NULL, last_error = ?, not_before = ?, updated_at = ? WHERE id = ?`
    ).run(status, attempts, message, finalFailure ? now : retryAt, now, id);
    config.onFail?.(db, id, message, status);
    insertAudit(db, finalFailure ? `${events.prefix}.failed` : `${events.prefix}.${retryEvent}`, events.entity, id, {
      attempts,
      error: message,
    });
  }

  // The WHERE clause that fences a write to the current lease holder (or, with
  // no token, to the id alone, for callers that do not hold a lease).
  function owner(leaseToken: string | undefined): { sql: string; params: string[] } {
    return leaseToken === undefined
      ? { sql: "id = ?", params: [] }
      : { sql: "id = ? AND status = 'processing' AND lease_token = ?", params: [leaseToken] };
  }

  function complete(id: string, result: unknown, leaseToken?: string): T | undefined {
    return withDb((db) => {
      const now = new Date().toISOString();
      const fence = owner(leaseToken);
      const updated = statement(
        db,
        `UPDATE ${table} SET status = ?, result_json = ?, locked_at = NULL, lease_token = NULL, last_error = NULL, updated_at = ? WHERE ${fence.sql}`
      ).run("completed", JSON.stringify(result), now, id, ...fence.params);
      if (Number(updated.changes) === 0) {
        if (leaseToken !== undefined) insertAudit(db, `${events.prefix}.stale_result`, events.entity, id, { outcome: "completed" });
        return undefined;
      }
      config.onComplete?.(db, id, now);
      insertAudit(db, `${events.prefix}.completed`, events.entity, id, {});
      const row = statement(db, byId).get(id) as Row | undefined;
      return row ? mapRow(row) : undefined;
    });
  }

  function fail(id: string, error: unknown, leaseToken?: string): T | undefined {
    return withDb((db) => {
      const now = new Date().toISOString();
      const fence = owner(leaseToken);
      const row = statement(db, `SELECT id, attempts, max_attempts FROM ${table} WHERE ${fence.sql}`).get(id, ...fence.params) as
        | Row
        | undefined;
      if (!row) {
        if (leaseToken !== undefined) insertAudit(db, `${events.prefix}.stale_result`, events.entity, id, { outcome: "failed" });
        return undefined;
      }
      const attempts = Number(row.attempts) + 1;
      const retryAt = new Date(
        Date.now() + Math.min(backoff.capMs, 1000 * 2 ** Math.min(attempts, backoff.maxExp))
      ).toISOString();
      const message = error instanceof Error ? error.message : String(error);
      recordFailure(db, row, message, now, retryAt, "retry_queued");
      return mapRow(statement(db, byId).get(id) as Row);
    });
  }

  function renew(id: string, leaseToken: string): boolean {
    return withDb((db) => {
      const now = new Date().toISOString();
      const renewed = statement(
        db,
        `UPDATE ${table} SET locked_at = ?, updated_at = ? WHERE id = ? AND status = 'processing' AND lease_token = ?`
      ).run(now, now, id, leaseToken);
      return Number(renewed.changes) > 0;
    });
  }

  function release(id: string, leaseToken: string): boolean {
    return withDb((db) => {
      const now = new Date().toISOString();
      const released = statement(
        db,
        `UPDATE ${table} SET status = 'queued', locked_at = NULL, lease_token = NULL, not_before = ?, updated_at = ?
         WHERE id = ? AND status = 'processing' AND lease_token = ?`
      ).run(now, now, id, leaseToken);
      return Number(released.changes) > 0;
    });
  }

  async function withLease<R>(job: T, work: () => Promise<R>): Promise<LeaseRun<R>> {
    const token = job.leaseToken;
    if (token === undefined || !renew(job.id, token)) return { owned: false };
    // Renew well inside the lease so one slow call cannot outlive it; unref so
    // the timer never keeps the process alive on its own.
    const heartbeat = setInterval(() => {
      if (!renew(job.id, token)) clearInterval(heartbeat);
    }, Math.max(Math.floor(jobLeaseMs() / 3), 10));
    heartbeat.unref();
    try {
      return { owned: true, value: await work() };
    } finally {
      clearInterval(heartbeat);
    }
  }

  function stats(): JobQueueStats {
    return withDb((db) => {
      const rows = statement(db, `SELECT status, COUNT(*) AS count FROM ${table} GROUP BY status`).all() as Row[];
      const out: JobQueueStats = { queued: 0, processing: 0, completed: 0, failed: 0 };
      for (const row of rows) {
        const status = String(row.status) as keyof JobQueueStats;
        if (status in out) out[status] = Number(row.count);
      }
      return out;
    });
  }

  function list(options: PageOptions = {}): T[] {
    const { limit, offset } = normalizePage(options, 50, 200);
    return withDb((db) =>
      statement(db, `SELECT * FROM ${table} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
        .all(limit, offset)
        .map((row) => mapRow(row as Row))
    );
  }

  return { claim, complete, fail, renew, release, withLease, stats, list };
}
