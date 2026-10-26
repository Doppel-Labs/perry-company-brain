// api/operations — operational records: meeting history, extracted decisions and
// action items, the approval queue, users, and ownership pivots.
import type { ActionItemRecord, ApprovalRecord, DecisionRecord, MeetingRecord, PivotRecord, UserRecord } from "../types";
import { getJson, sendCommand } from "./client";

// Most list endpoints wrap their rows as `{ records: [...] }`.
async function getRecords<T>(path: string, label: string): Promise<T[]> {
  return (await getJson<{ records: T[] }>(path, label)).records;
}

export function fetchMeetingHistory(label = "History load"): Promise<MeetingRecord[]> {
  return getRecords("/api/meetings/history", label);
}

export function fetchDecisions(label = "Decisions load"): Promise<DecisionRecord[]> {
  return getRecords("/api/brain/decisions?limit=12", label);
}

export function fetchActionItems(label = "Action items load"): Promise<ActionItemRecord[]> {
  return getRecords("/api/brain/actions?limit=12", label);
}

export function fetchPendingApprovals(label = "Approvals load"): Promise<ApprovalRecord[]> {
  return getRecords("/api/approvals?status=pending", label);
}

/** Server write: approve or reject a pending meeting announcement. Throws `ApiError`. */
export function actOnApproval(id: string, action: "approve" | "reject"): Promise<void> {
  return sendCommand(`/api/approvals/${encodeURIComponent(id)}/${action}`, "POST", action);
}

/** Known users (up to 24); they populate the issue owner pickers. */
export function fetchUsers(label = "Users load"): Promise<UserRecord[]> {
  return getRecords("/api/users?limit=24", label);
}

/** Recent ownership changes inferred from decisions (up to 8). */
export function fetchPivots(label = "Pivots load"): Promise<PivotRecord[]> {
  return getRecords("/api/pivots?limit=8", label);
}
