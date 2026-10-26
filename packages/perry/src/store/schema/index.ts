// schema — the brain store's SQLite schema, one module per domain.
//
// Every statement is idempotent (IF NOT EXISTS), so the whole schema is applied
// each time a database is opened; column and data changes for older databases
// live in `migrations.ts`.
import type { DatabaseSync } from "node:sqlite";
import { meetingsSchema } from "./meetings";
import { peopleSchema } from "./people";
import { publishingSchema } from "./publishing";
import { queuesSchema } from "./queues";
import { graphSchema } from "./graph";
import { searchSchema } from "./search";
import { migrateApprovalSummaryColumns, migrateDryRunMeetingStatus, migrateIngestionJobMeetingColumn } from "./migrations";

export { migrateApprovalSummaryColumns, migrateDryRunMeetingStatus, migrateIngestionJobMeetingColumn } from "./migrations";

/** Applies the full schema and the migrations to an open database. */
export function migrateOpenDb(db: DatabaseSync): void {
  db.exec(meetingsSchema);
  db.exec(peopleSchema);
  db.exec(publishingSchema);
  db.exec(queuesSchema);
  db.exec(graphSchema);
  db.exec(searchSchema);
  migrateApprovalSummaryColumns(db);
  migrateIngestionJobMeetingColumn(db);
  migrateDryRunMeetingStatus(db);
}

