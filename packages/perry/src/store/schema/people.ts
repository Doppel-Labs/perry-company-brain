// schema/people — People and work tracking: the roster, issues, their event history, and ownership pivots.
export const peopleSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT,
    discord_user_id TEXT,
    notion_user_id TEXT,
    github_username TEXT,
    team TEXT,
    timezone TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    project TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    owner TEXT,
    source_meeting_id TEXT,
    source_action_id TEXT,
    due_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS issue_events (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    actor TEXT,
    detail_json TEXT NOT NULL,
    meeting_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pivots (
    id TEXT PRIMARY KEY,
    project TEXT,
    subject TEXT NOT NULL,
    previous_owner TEXT,
    new_owner TEXT,
    fallback_reviewer TEXT,
    reason TEXT NOT NULL,
    source_decision_id TEXT NOT NULL,
    source_meeting_id TEXT NOT NULL,
    affected_issue_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

  CREATE INDEX IF NOT EXISTS idx_issues_owner_status ON issues(owner, status);

  CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project, status);

  CREATE INDEX IF NOT EXISTS idx_issues_source_action ON issues(source_action_id);

  CREATE INDEX IF NOT EXISTS idx_issue_events_issue_id ON issue_events(issue_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_pivots_subject_created_at ON pivots(subject, created_at);
`;
