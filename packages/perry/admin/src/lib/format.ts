// lib/format — display formatting and small parsing helpers for the panels.
import type { IssueEventRecord } from "../types";

/** One-line summary of an issue event from its `detailJson`; malformed JSON is treated as empty. */
export function formatIssueEvent(event: IssueEventRecord): string {
  let detail: Record<string, unknown> = {};
  try {
    detail = JSON.parse(event.detailJson) as Record<string, unknown>;
  } catch {
    detail = {};
  }
  if (event.type === "assigned") return `${detail.previousOwner || "Unassigned"} -> ${detail.owner || "Unassigned"}`;
  if (event.type === "status_changed") return `${detail.previousStatus ?? "open"} -> ${detail.status ?? "open"}`;
  if (event.type === "commented") return String(detail.comment ?? "");
  if (event.type === "created") return String(detail.title ?? "Issue created");
  if (event.type === "updated") return "Metadata updated";
  return event.type;
}

/** Elide long ids to `first12...last8`. */
export function shortKey(value?: string): string {
  if (!value) return "unknown";
  return value.length > 28 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

/** One week ago, in the local-time `YYYY-MM-DDTHH:mm` form a datetime-local input expects. */
export function defaultSinceInput(): string {
  const date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Convert a datetime-local value to ISO for the API; unparseable input passes through trimmed. */
export function apiSince(value: string): string {
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.valueOf()) ? value.trim() : parsed.toISOString();
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Locale date-time, "unknown" when missing, or the raw string when it does not parse. */
export function formatMaybeDate(value?: string): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString();
}

/** Split a comma-separated field into trimmed, non-empty items. */
export function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
