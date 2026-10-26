// database/connection — where the brain store lives and how it is opened.
//
// One DatabaseSync handle is cached per path for the life of the process. The
// schema is applied on first open, so callers never see an unmigrated database.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateOpenDb } from "../schema";

type JournalMode = "DELETE" | "MEMORY" | "OFF" | "WAL";

const dbCache = new Map<string, DatabaseSync>();

/** `PERRY_DB_PATH`, else %LOCALAPPDATA%\Perry on Windows, else ./data. */
export function getMeetingStorePath(): string {
  if (process.env.PERRY_DB_PATH) return process.env.PERRY_DB_PATH;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "Perry", "perry.sqlite");
  }
  return join(process.cwd(), "data", "perry.sqlite");
}

/** Runs `callback` against the store at the current `PERRY_DB_PATH`. */
export function withDb<T>(callback: (db: DatabaseSync) => T): T {
  return callback(openDb(getMeetingStorePath()));
}

/** Ensures the default database exists and is fully migrated. */
export function migrateBrainStore(): void {
  withDb(() => undefined);
}

export function closeBrainStore(path = getMeetingStorePath()): void {
  const db = dbCache.get(path);
  if (!db) return;
  db.close();
  dbCache.delete(path);
}

function openDb(path: string): DatabaseSync {
  const cached = dbCache.get(path);
  if (cached) return cached;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = ${journalMode()};`);
  db.exec("PRAGMA foreign_keys = ON;");
  migrateOpenDb(db);
  dbCache.set(path, db);
  return db;
}

/** `PERRY_SQLITE_JOURNAL_MODE`, else MEMORY on Windows and DELETE elsewhere. */
function journalMode(): JournalMode {
  const configured = process.env.PERRY_SQLITE_JOURNAL_MODE?.toUpperCase();
  if (configured === "DELETE" || configured === "MEMORY" || configured === "OFF" || configured === "WAL") return configured;
  return process.platform === "win32" ? "MEMORY" : "DELETE";
}
