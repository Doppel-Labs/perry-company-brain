// schema/meetings — Meetings and the knowledge extracted from them: decisions, action items, sources.
export const meetingsSchema = `
  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    notion_page_id TEXT,
    notion_url TEXT,
    discord_message_url TEXT,
    status TEXT NOT NULL,
    error TEXT,
    UNIQUE(source, source_id)
  );

  CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS action_items (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    owner TEXT,
    due_date TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    url TEXT,
    title TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings(created_at);

  CREATE INDEX IF NOT EXISTS idx_meetings_source_id ON meetings(source, source_id);

  CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);

  CREATE INDEX IF NOT EXISTS idx_decisions_meeting_id ON decisions(meeting_id);

  CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at);

  CREATE INDEX IF NOT EXISTS idx_actions_meeting_id ON action_items(meeting_id);

  CREATE INDEX IF NOT EXISTS idx_actions_created_at ON action_items(created_at);

  CREATE INDEX IF NOT EXISTS idx_actions_owner_status_created ON action_items(owner, status, created_at);

  CREATE INDEX IF NOT EXISTS idx_actions_status_due_created ON action_items(status, due_date, created_at);
`;
