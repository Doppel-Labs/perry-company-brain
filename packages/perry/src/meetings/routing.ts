// meetings/routing — picks where a meeting goes (project, Discord channel,
// Notion data source) and how it is published.
//
// Every active rule is scored against the note and the highest score wins; a
// tie keeps the earlier rule in settings order (Array.sort is stable). A rule's
// unset destinations fall back to the default meeting channel and data source.
import type { AppSettings, RoutingRuleConfig } from "@core";
import type { MeetingNote } from "./note";

/** The routing decision for one meeting; `reason` is a human-readable explanation for the admin UI and logs. */
export interface MeetingRoute {
  ruleId?: string;
  ruleName?: string;
  project?: string;
  discordChannelId?: string;
  notionDataSourceId?: string;
  publishMode: "approval" | "auto" | "draft";
  reason: string;
}

/** Returns the best-scoring active rule's route, or the default settings route when no rule scores above zero. Pure. */
export function resolveMeetingRoute(note: MeetingNote, settings: AppSettings): MeetingRoute {
  const matchingRule = settings.routingRules
    .filter((rule) => rule.isActive !== false)
    .map((rule) => ({ rule, score: scoreRule(rule, note) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.rule;

  if (!matchingRule) {
    return {
      publishMode: settings.granola.defaultPublishMode,
      discordChannelId: settings.discord.meetingChannelId,
      notionDataSourceId: settings.notion.meetingNotesDataSourceId,
      reason: "No routing rule matched; using default meeting settings",
    };
  }

  return {
    ruleId: matchingRule.id,
    ruleName: matchingRule.name,
    project: matchingRule.project,
    discordChannelId: matchingRule.discordChannelId ?? settings.discord.meetingChannelId,
    notionDataSourceId: matchingRule.notionDataSourceId ?? settings.notion.meetingNotesDataSourceId,
    publishMode: matchingRule.publishMode,
    reason: `Matched routing rule: ${matchingRule.name}`,
  };
}

// Folder match is worth 8, each title keyword hit 4, each attendee email hit 3,
// all case-insensitive. Keywords match as substrings of the title.
function scoreRule(rule: RoutingRuleConfig, note: MeetingNote): number {
  let score = 0;
  const title = note.title.toLowerCase();
  const folder = note.folderName?.toLowerCase();
  const attendees = new Set(note.attendees.map((attendee) => attendee.email?.toLowerCase()).filter(Boolean));

  if (rule.granolaFolderName && folder === rule.granolaFolderName.toLowerCase()) score += 8;
  for (const keyword of rule.titleKeywords) {
    if (keyword && title.includes(keyword.toLowerCase())) score += 4;
  }
  for (const email of rule.attendeeEmails) {
    if (attendees.has(email.toLowerCase())) score += 3;
  }

  return score;
}
