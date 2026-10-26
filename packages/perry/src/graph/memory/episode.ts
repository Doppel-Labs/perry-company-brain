// memory/episode — turns a processed meeting into a Graphiti episode payload.
//
// Private notes and transcripts are excluded unless explicitly enabled
// (PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES / PERRY_GRAPHITI_INCLUDE_TRANSCRIPT).
import { buildGraphChangeSet, validateGraphChangeSet } from "../change-set";
import { graphPrivacySourcesFor } from "../change-set-validation";
import { validIsoOrUndefined } from "@store";
import { getGraphMemoryStatus } from "./status";
import type { GraphitiEpisodePayload, GraphMemorySyncInput } from "./types";

/**
 * The episode for one meeting: a JSON body with the note, route, links,
 * decisions, action items, and the meeting's change set and its validation
 * (including the private-content leak check against this note), named `perry-meeting-<recordId>`. Pure apart from reading the env config.
 */
export function buildGraphitiMeetingEpisode(input: GraphMemorySyncInput, groupId = "doppel-labs"): GraphitiEpisodePayload {
  const referenceTime = validIsoOrUndefined(input.note.startedAt) ?? input.record.updatedAt ?? new Date().toISOString();
  const status = getGraphMemoryStatus();
  const graphChangeSet = buildGraphChangeSet(input);
  const graphValidation = validateGraphChangeSet(graphChangeSet, graphPrivacySourcesFor(input));
  const body = {
    kind: "meeting_note",
    source: input.note.source,
    sourceId: input.note.sourceId,
    title: input.note.title,
    creator: {
      name: input.note.creatorName,
      email: input.note.creatorEmail,
    },
    attendees: input.note.attendees,
    calendarTitle: input.note.calendarTitle,
    folderName: input.note.folderName,
    startedAt: input.note.startedAt,
    summaryMarkdown: input.note.summaryMarkdown,
    privateNotes: status.includePrivateNotes ? input.note.privateNotes : undefined,
    transcript: status.includeTranscript ? input.note.transcript : undefined,
    granolaUrl: input.note.sourceUrl,
    notionUrl: input.notionUrl ?? input.record.notionUrl,
    discordMessageUrl: input.discordMessageUrl ?? input.record.discordMessageUrl,
    route: input.route,
    decisions: input.knowledge.decisions,
    actionItems: input.knowledge.actionItems,
    graphChangeSet,
    graphValidation,
  };

  return {
    name: `perry-meeting-${input.record.id}`,
    body: JSON.stringify(body),
    source: "json",
    sourceDescription: "Perry Granola meeting note",
    referenceTime,
    groupId,
  };
}

