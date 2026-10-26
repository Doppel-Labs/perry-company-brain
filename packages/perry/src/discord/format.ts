// format — Markdown for the standup posts: daily summaries and missing-standup reminders.
import type { StandupEntry } from "@notion";
import type { Person } from "@core";

/**
 * Formats a Date as a short heading date using the host's default locale and
 * timezone, e.g. "Apr 15, 2026" in en-US.
 */
export function formatHeadingDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Renders a standup summary into a Markdown string suitable for Discord.
 * Each entry appears under the submitter's name in bold with their yesterday,
 * today, blockers and status fields; empty fields are omitted. The summary
 * begins with a bold heading containing the date.
 */
export function formatSummary(entries: StandupEntry[], date: Date): string {
  const heading = `**Standup – ${formatHeadingDate(date)}**`;
  if (entries.length === 0) {
    return `${heading}\n\nNo standup entries were found for this date.`;
  }
  const body = entries
    .map((entry) => {
      const parts: string[] = [];
      parts.push(`**${entry.personName ?? "Unknown"}**`);
      if (entry.yesterday) parts.push(`Yesterday: ${entry.yesterday}`);
      if (entry.today) parts.push(`Today: ${entry.today}`);
      if (entry.blockers) parts.push(`Blockers: ${entry.blockers}`);
      if (entry.status) parts.push(`Status: ${entry.status}`);
      return parts.join("\n");
    })
    .join("\n\n");
  return `${heading}\n\n${body}`;
}

/**
 * Renders a missing-standup reminder. If no one is missing, returns an
 * encouraging message; otherwise lists each person as a Discord mention, or by
 * name when they have no Discord user id.
 */
export function formatMissing(
  missing: Person[],
  date: Date
): string {
  const heading = `**Standup reminder – ${formatHeadingDate(date)}**`;
  if (missing.length === 0) {
    return `${heading}\n\nAll standup updates have been submitted. 🎉`;
  }
  const mentions = missing
    .map((p) => {
      return p.discordUserId ? `<@${p.discordUserId}>` : p.name;
    })
    .join(" ");
  return `${heading}\n\nThe following people still need to submit their standup:\n${mentions}`;
}