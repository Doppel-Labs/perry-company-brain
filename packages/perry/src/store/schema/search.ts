// schema/search — Full-text search: the FTS5 index and its write-behind queue.
export const searchSchema = `
  CREATE TABLE IF NOT EXISTS fts_queue (
    entity_key TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    meeting_id TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT,
    created_at TEXT NOT NULL,
    queued_at TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS brain_fts USING fts5(
    type,
    entity_id UNINDEXED,
    meeting_id UNINDEXED,
    title,
    body,
    url UNINDEXED,
    created_at UNINDEXED
  );

  CREATE INDEX IF NOT EXISTS idx_fts_queue_queued_at ON fts_queue(queued_at);
`;
