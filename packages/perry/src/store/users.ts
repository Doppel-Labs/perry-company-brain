// users — the people roster, linking one person across email, Discord, Notion, and GitHub.
import { type PageOptions, type Row, type UserRecord } from "./types";
import { statement, withDb } from "./database";
import { normalizePage, slugKey } from "./values";
import { userFromRow } from "./rows";

/**
 * Inserts or fully replaces a user. The id defaults to `user:<slug of email,
 * else display name>`; every column is overwritten, so omitted optional
 * fields are cleared and `isActive` defaults to true. No audit row.
 */
export function upsertUser(input: {
  id?: string;
  displayName: string;
  email?: string;
  discordUserId?: string;
  notionUserId?: string;
  githubUsername?: string;
  team?: string;
  timezone?: string;
  isActive?: boolean;
}): UserRecord {
  const now = new Date().toISOString();
  const id = input.id ?? `user:${slugKey(input.email ?? input.displayName)}`;
  return withDb((db) => {
    statement(
      db,
      `INSERT INTO users (
        id, display_name, email, discord_user_id, notion_user_id, github_username,
        team, timezone, is_active, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        email = excluded.email,
        discord_user_id = excluded.discord_user_id,
        notion_user_id = excluded.notion_user_id,
        github_username = excluded.github_username,
        team = excluded.team,
        timezone = excluded.timezone,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at`
    ).run(
      id,
      input.displayName,
      input.email ?? null,
      input.discordUserId ?? null,
      input.notionUserId ?? null,
      input.githubUsername ?? null,
      input.team ?? null,
      input.timezone ?? null,
      input.isActive === false ? 0 : 1,
      now,
      now
    );
    const row = statement(db, "SELECT * FROM users WHERE id = ?").get(id) as Row;
    return userFromRow(row);
  });
}

/** Alphabetical by display name (default 100, max 100,000). */
export function listUsers(options: PageOptions = {}): UserRecord[] {
  const { limit, offset } = normalizePage(options, 100, 100_000);
  return withDb((db) =>
    statement(db, "SELECT * FROM users ORDER BY display_name ASC LIMIT ? OFFSET ?")
      .all(limit, offset)
      .map((row) => userFromRow(row as Row))
  );
}
