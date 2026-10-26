// api/issues — the multiplayer issue tracker: list, create, update, events, and
// projecting meetings into issues.
import type { IssueEventRecord, IssuePriority, IssueRecord } from "../types";
import { getJson, sendCommand, sendJson } from "./client";

export interface IssueDraft {
  title: string;
  project: string;
  owner: string;
  priority: IssuePriority;
  dueDate: string;
}

/** Fields to change on an issue; `comment` appends a comment event instead of changing a field. */
export type IssuePatch = Partial<IssueRecord> & { comment?: string };

/** Up to 24 issues with status "open". */
export async function fetchOpenIssues(label = "Issues load"): Promise<IssueRecord[]> {
  return (await getJson<{ records: IssueRecord[] }>("/api/issues?limit=24&status=open", label)).records;
}

/** Server write: create an issue from the draft form. Throws `ApiError`. */
export async function createIssue(draft: IssueDraft): Promise<IssueRecord> {
  const payload = await sendJson<{ issue: IssueRecord }>("/api/issues", "POST", "Issue create", {
    title: draft.title,
    project: draft.project,
    owner: draft.owner,
    priority: draft.priority,
    dueDate: draft.dueDate,
  });
  return payload.issue;
}

/** Server write, attributed to "Perry Admin"; returns the updated issue and its full event list. Throws `ApiError`. */
export function patchIssue(id: string, patch: IssuePatch): Promise<{ issue: IssueRecord; events: IssueEventRecord[] }> {
  return sendJson(`/api/issues/${encodeURIComponent(id)}`, "PATCH", "Issue update", { ...patch, actor: "Perry Admin" });
}

/** The last 50 events for one issue. */
export async function fetchIssueEvents(issueId: string): Promise<IssueEventRecord[]> {
  const path = `/api/issues/${encodeURIComponent(issueId)}/events?limit=50`;
  return (await getJson<{ records: IssueEventRecord[] }>(path, "Issue events")).records;
}

/** Server write: project stored decisions and action items (up to 25,000 each) into users, issues, and ownership pivots. Throws `ApiError`. */
export function projectMultiplayer(): Promise<void> {
  return sendCommand("/api/brain/project-multiplayer?limit=25000", "POST", "Projection");
}
