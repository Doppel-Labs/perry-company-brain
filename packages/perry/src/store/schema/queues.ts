// schema/queues — Durable job queues (ingestion, graph sync) and their idempotency keys.
export const queuesSchema = `
  CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    result_json TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    not_before TEXT NOT NULL,
    locked_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    meeting_id TEXT -- the meeting the job ingests; marked failed when the job is retired mid-publish
  );

  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS graph_sync_jobs (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    result_json TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    not_before TEXT NOT NULL,
    locked_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status_not_before ON ingestion_jobs(status, not_before, created_at);

  CREATE INDEX IF NOT EXISTS idx_graph_sync_jobs_status_not_before ON graph_sync_jobs(status, not_before, created_at);

  CREATE INDEX IF NOT EXISTS idx_graph_sync_jobs_entity ON graph_sync_jobs(entity_type, entity_id);
`;
