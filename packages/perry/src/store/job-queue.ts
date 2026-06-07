import type { DatabaseSync } from "node:sqlite";
import { type PageOptions, type Row } from "./types";
import { insertAudit, normalizePage, statement, withBrainTransaction, withDb } from "./db";

/**
 * A durable, at-least-once SQLite job queue — the shared engine behind both the
 * Granola **ingestion** queue and the Graphiti **graph-sync** queue.
 *
 * Both queues are the same machine; only the table, the row shape, the audit
 * names, and a couple of side-effects differ. Encoding that machine once (here)
 * instead of twice means the subtle parts — the claim transaction and the retry
 * backoff — have a single, documented source of truth and can't drift apart.
 *
 * ## The contract every queue table satisfies
 * `id, status('queued'|'processing'|'completed'|'failed'), attempts, max_attempts,
 *  not_before, locked_at, last_error, result_json, created_at, updated_at`.
 *
 * ## Claiming (the only part that must be atomic)
 * A worker `claim()`s a batch by selecting `queued` rows whose `not_before` has
 * passed and flipping them to `processing` — all inside one transaction so two
 * workers can never grab the same job. `complete()`/`fail()` don't need the
 * transaction: they target a single row by id.
 *
 * ## Failure & backoff
 * On `fail()` we bump `attempts`; if it reaches `max_attempts` the job is dead
 * (`failed`), otherwise it's re-`queued` with an exponential `not_before`:
 * `delay = min(capMs, 1000 · 2^min(attempts, maxExp))`. The cap bounds the wait
 * for a permanently-flaky job; `maxExp` bounds the exponent so the math never
 * overflows. (Ingestion is impatient — 60 s cap; graph-sync tolerates longer
 * outages — 5 min — hence the per-queue `backoff`.)
 */
export interface JobQueueStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface JobQueueConfig<T> {
  /** Job table; must have the standard columns described above. */
  table: string;
  /** Maps a raw SQLite row to the typed job record. */
  mapRow: (row: Row) => T;
  /** Audit naming: event is `${prefix}.completed|failed|retry_queued`, tagged with `entity`. */
  events: { prefix: string; entity: string };
  /** Retry backoff: `delay = min(capMs, 1000 · 2^min(attempts, maxExp))`. */
  backoff: { capMs: number; maxExp: number };
  /** Extra leading `WHERE` clause for claims (e.g. `"type = ?"`) and its bound params. */
  claim?: { where: string; params: string[] };
  /** Side-effect on success, threaded through the same connection (e.g. mark a change-set applied). */
  onComplete?: (db: DatabaseSync, id: string, now: string) => void;
  /** Side-effect on failure/retry, threaded through the same connection. */
  onFail?: (db: DatabaseSync, id: string, message: string, status: "failed" | "queued") => void;
}

export interface JobQueue<T> {
  /** Atomically claim up to `limit` due jobs (queued → processing). */
  claim(limit?: number): T[];
  /** Mark a job completed; returns the updated record (or undefined if gone). */
  complete(id: string, result: unknown): T | undefined;
  /** Record a failure: retire after `max_attempts`, else re-queue with backoff. */
  fail(id: string, error: unknown): T | undefined;
  /** Count of jobs by status. */
  stats(): JobQueueStats;
  /** Most-recent jobs first, paginated. */
  list(options?: PageOptions): T[];
}

export function createJobQueue<T>(config: JobQueueConfig<T>): JobQueue<T> {
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
        const rows = statement(
          db,
          `SELECT * FROM ${table} WHERE ${claimWhere}status = ? AND not_before <= ? ORDER BY created_at ASC LIMIT ?`
        ).all(...claimParams, "queued", now, n) as Row[];
        if (rows.length === 0) return [];
        for (const row of rows) {
          statement(db, `UPDATE ${table} SET status = ?, locked_at = ?, updated_at = ? WHERE id = ?`).run(
            "processing",
            now,
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

  function complete(id: string, result: unknown): T | undefined {
    return withDb((db) => {
      const now = new Date().toISOString();
      statement(
        db,
        `UPDATE ${table} SET status = ?, result_json = ?, locked_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?`
      ).run("completed", JSON.stringify(result), now, id);
      config.onComplete?.(db, id, now);
      insertAudit(db, `${events.prefix}.completed`, events.entity, id, {});
      const row = statement(db, byId).get(id) as Row | undefined;
      return row ? mapRow(row) : undefined;
    });
  }

  function fail(id: string, error: unknown): T | undefined {
    return withDb((db) => {
      const now = new Date().toISOString();
      const row = statement(db, `SELECT attempts, max_attempts FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
      if (!row) return undefined;
      const attempts = Number(row.attempts) + 1;
      const finalFailure = attempts >= Number(row.max_attempts);
      const status: "failed" | "queued" = finalFailure ? "failed" : "queued";
      const notBefore = new Date(
        Date.now() + Math.min(backoff.capMs, 1000 * 2 ** Math.min(attempts, backoff.maxExp))
      ).toISOString();
      const message = error instanceof Error ? error.message : String(error);
      statement(
        db,
        `UPDATE ${table} SET status = ?, attempts = ?, locked_at = NULL, last_error = ?, not_before = ?, updated_at = ? WHERE id = ?`
      ).run(status, attempts, message, finalFailure ? now : notBefore, now, id);
      config.onFail?.(db, id, message, status);
      insertAudit(db, finalFailure ? `${events.prefix}.failed` : `${events.prefix}.retry_queued`, events.entity, id, {
        attempts,
        error: message,
      });
      return mapRow(statement(db, byId).get(id) as Row);
    });
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

  return { claim, complete, fail, stats, list };
}
