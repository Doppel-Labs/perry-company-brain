// database/statements — prepared-statement cache, keyed by database and SQL text.
import type { DatabaseSync, StatementSync } from "node:sqlite";

const statementCache = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

/** Prepares `sql` once per database and reuses it; always bind values, never interpolate. */
export function statement(db: DatabaseSync, sql: string): StatementSync {
  let cache = statementCache.get(db);
  if (!cache) {
    cache = new Map<string, StatementSync>();
    statementCache.set(db, cache);
  }
  let prepared = cache.get(sql);
  if (!prepared) {
    prepared = db.prepare(sql);
    cache.set(sql, prepared);
  }
  return prepared;
}
