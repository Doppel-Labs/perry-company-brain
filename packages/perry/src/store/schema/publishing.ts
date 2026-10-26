// schema/publishing — Publishing workflow and the append-only audit trail.
export const publishingSchema = `
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    title TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    announcement TEXT NOT NULL,
    knowledge_json TEXT NOT NULL,
    route_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    route_project TEXT,
    route_reason TEXT,
    publish_mode TEXT,
    decision_count INTEGER NOT NULL DEFAULT 0,
    action_item_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

  CREATE INDEX IF NOT EXISTS idx_approvals_status_created_at ON approvals(status, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_approvals_created_at ON approvals(created_at);

  CREATE INDEX IF NOT EXISTS idx_approvals_status_project_created_at ON approvals(status, route_project, created_at DESC);
`;
