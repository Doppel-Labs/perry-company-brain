// wiki-sync — mirrors decisions, action items, and projects into Notion wiki data sources.
//
// Sync is idempotent: each kind has a rich-text key property (see wiki-schema),
// and a sync first queries its data source for a page with that key, updating
// it when found and creating a page only when none exists. A sync is skipped
// (undefined) when its NOTION_*_DATA_SOURCE_ID is unset. PERRY_NOTION_DRY_RUN=true
// skips the API, lookup included, and returns a deterministic fake record with
// `dryRun: true`.
import { Client } from "@notionhq/client";
import { projectStableKey, normalizeStableKey } from "@core";
import type { ActionItemRecord, DecisionRecord, IssueRecord } from "@store";
import { actionItemSchema, decisionSchema, projectSchema } from "./wiki-schema";

export interface SyncedWikiRecord {
  id: string;
  url?: string;
  dryRun: boolean;
  kind: "decision" | "action_item" | "project";
  /** Whether a live sync made a new page or updated the one found by key; absent in dry runs. */
  operation?: "created" | "updated";
}

/** The slice of the Notion SDK client wiki sync uses; tests pass a fake. */
export interface NotionWikiClient {
  dataSources: { query(args: unknown): Promise<{ results: Array<{ id: string }> }> };
  pages: { create(args: unknown): Promise<unknown>; update(args: unknown): Promise<unknown> };
}

/** Optional overrides for the sync functions; by default a client is built from NOTION_TOKEN. */
export interface WikiSyncOptions {
  client?: NotionWikiClient;
}

/** Creates or updates the decision's page in NOTION_DECISIONS_DATA_SOURCE_ID, keyed by decision id; throws if NOTION_TOKEN is unset. */
export async function syncDecisionRecordToNotion(
  decision: DecisionRecord,
  options: WikiSyncOptions = {}
): Promise<SyncedWikiRecord | undefined> {
  if (isDryRun()) return dryRunRecord("decision", decision.id);
  const dataSourceId = process.env.NOTION_DECISIONS_DATA_SOURCE_ID;
  if (!dataSourceId) return undefined;
  return upsertWikiPage(options.client ?? notionClient(), "decision", dataSourceId, decisionSchema.sourceDecisionId, decision.id, {
    [decisionSchema.title]: { title: [{ text: { content: decision.text.slice(0, 1900) } }] },
    [decisionSchema.meeting]: { rich_text: [{ text: { content: decision.meetingId } }] },
    [decisionSchema.status]: { select: { name: decision.status } },
    [decisionSchema.evidence]: { rich_text: [{ text: { content: decision.id } }] },
    [decisionSchema.sourceDecisionId]: { rich_text: [{ text: { content: decision.id } }] },
  });
}

/** Creates or updates the action's page in NOTION_ACTION_ITEMS_DATA_SOURCE_ID, keyed by action id; throws if NOTION_TOKEN is unset. */
export async function syncActionItemRecordToNotion(
  action: ActionItemRecord,
  options: WikiSyncOptions = {}
): Promise<SyncedWikiRecord | undefined> {
  if (isDryRun()) return dryRunRecord("action_item", action.id);
  const dataSourceId = process.env.NOTION_ACTION_ITEMS_DATA_SOURCE_ID;
  if (!dataSourceId) return undefined;
  return upsertWikiPage(options.client ?? notionClient(), "action_item", dataSourceId, actionItemSchema.sourceActionId, action.id, {
    [actionItemSchema.title]: { title: [{ text: { content: action.text.slice(0, 1900) } }] },
    [actionItemSchema.meeting]: { rich_text: [{ text: { content: action.meetingId } }] },
    [actionItemSchema.owner]: action.owner ? { rich_text: [{ text: { content: action.owner } }] } : undefined,
    [actionItemSchema.dueDate]: action.dueDate ? { date: { start: action.dueDate } } : undefined,
    [actionItemSchema.status]: { select: { name: action.status } },
    [actionItemSchema.sourceActionId]: { rich_text: [{ text: { content: action.id } }] },
  });
}

/**
 * Creates or updates the project's page in NOTION_PROJECTS_DATA_SOURCE_ID,
 * keyed by its `project:<slug>` graph stable key (projectStableKey, the same
 * key the graph stores). Skipped when the record has no project name; throws if
 * NOTION_TOKEN is unset.
 */
export async function syncProjectRecordToNotion(
  project: Pick<IssueRecord, "project" | "owner" | "status">,
  options: WikiSyncOptions = {}
): Promise<SyncedWikiRecord | undefined> {
  if (!project.project) return undefined;
  if (isDryRun()) return dryRunRecord("project", project.project);
  const dataSourceId = process.env.NOTION_PROJECTS_DATA_SOURCE_ID;
  if (!dataSourceId) return undefined;
  const graphEntity = projectStableKey(project.project);
  return upsertWikiPage(options.client ?? notionClient(), "project", dataSourceId, projectSchema.graphEntity, graphEntity, {
    [projectSchema.title]: { title: [{ text: { content: project.project } }] },
    [projectSchema.owner]: project.owner ? { rich_text: [{ text: { content: project.owner } }] } : undefined,
    [projectSchema.status]: { select: { name: project.status } },
    [projectSchema.graphEntity]: { rich_text: [{ text: { content: graphEntity } }] },
  });
}

// Finds the page whose rich-text `keyProperty` equals `key` and updates it, or
// creates one. If earlier non-idempotent syncs left duplicates, the first match is updated.
async function upsertWikiPage(
  client: NotionWikiClient,
  kind: SyncedWikiRecord["kind"],
  dataSourceId: string,
  keyProperty: string,
  key: string,
  properties: Record<string, unknown>
): Promise<SyncedWikiRecord> {
  const existing = await client.dataSources.query({
    data_source_id: dataSourceId,
    filter: { property: keyProperty, rich_text: { equals: key } },
    page_size: 1,
  });
  const match = existing.results[0];
  if (match) {
    const page = await client.pages.update({ page_id: match.id, properties });
    return notionRecord(kind, page ?? match, "updated");
  }
  const page = await client.pages.create({ parent: { data_source_id: dataSourceId }, properties });
  return notionRecord(kind, page, "created");
}

function notionClient(): NotionWikiClient {
  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) throw new Error("NOTION_TOKEN is required for Notion wiki sync");
  return new Client({ auth: notionToken, notionVersion: "2025-09-03" } as any) as unknown as NotionWikiClient;
}

function isDryRun(): boolean {
  return process.env.PERRY_NOTION_DRY_RUN === "true";
}

function dryRunRecord(kind: SyncedWikiRecord["kind"], id: string): SyncedWikiRecord {
  return {
    id: `dry-run-${kind}-${normalizeStableKey(id)}`,
    url: `https://notion.example/perry-dry-run/${kind}/${encodeURIComponent(id)}`,
    dryRun: true,
    kind,
  };
}

function notionRecord(kind: SyncedWikiRecord["kind"], page: any, operation: SyncedWikiRecord["operation"]): SyncedWikiRecord {
  return { id: page.id, url: "url" in page ? page.url : undefined, dryRun: false, kind, operation };
}
