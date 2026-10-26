// meetings/note — the canonical meeting note, the Granola/Zapier payload adapter,
// and the Discord announcement text.
//
// Zapier field names vary between Zap configurations, so the payload schema
// accepts several aliases for the id, link, and folder and passes unknown keys
// through; normalization picks the first alias present.
import { z } from "zod";
import { loadAppSettings } from "@core";

/**
 * A meeting note in Perry's source-neutral shape. `privateNotes` holds the
 * author's own Granola notes (`my_notes`) and is kept separate from the
 * shareable `summaryMarkdown`.
 */
export interface MeetingNote {
  source: "granola";
  sourceId?: string;
  title: string;
  creatorName?: string;
  creatorEmail?: string;
  attendees: Array<{ name?: string; email?: string }>;
  calendarTitle?: string;
  startedAt?: string;
  summaryMarkdown: string;
  transcript?: string;
  privateNotes?: string;
  sourceUrl?: string;
  folderName?: string;
}

const GranolaZapierPayloadSchema = z
  .object({
    id: z.string().optional(),
    note_id: z.string().optional(),
    sourceId: z.string().optional(),
    title: z.string().optional(),
    creator: z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
      })
      .optional(),
    attendees: z
      .array(
        z.object({
          name: z.string().optional(),
          email: z.string().optional(),
        })
      )
      .optional(),
    calendar_event: z
      .object({
        title: z.string().optional(),
        start_time: z.string().optional(),
        start: z.string().optional(),
      })
      .optional(),
    my_notes: z.string().optional(),
    summary: z.string().optional(),
    transcript: z.string().optional(),
    link: z.string().optional(),
    url: z.string().optional(),
    folder: z.string().optional(),
    folder_name: z.string().optional(),
    folderName: z.string().optional(),
  })
  .passthrough();

/**
 * Converts a Granola-via-Zapier webhook body into a MeetingNote. Falls back to
 * the calendar title, then "Untitled Granola note"; a blank summary becomes a
 * placeholder sentence. Throws a ZodError when a known field has the wrong type.
 */
export function normalizeGranolaZapierPayload(input: unknown): MeetingNote {
  const payload = GranolaZapierPayloadSchema.parse(input);
  const title = payload.title ?? payload.calendar_event?.title ?? "Untitled Granola note";
  const summaryMarkdown = payload.summary?.trim() || "No enhanced summary was included.";

  return {
    source: "granola",
    sourceId: payload.note_id ?? payload.id ?? payload.sourceId,
    title,
    creatorName: payload.creator?.name,
    creatorEmail: payload.creator?.email,
    attendees: payload.attendees ?? [],
    calendarTitle: payload.calendar_event?.title,
    startedAt: payload.calendar_event?.start_time ?? payload.calendar_event?.start,
    summaryMarkdown,
    transcript: payload.transcript,
    privateNotes: payload.my_notes,
    sourceUrl: payload.link ?? payload.url,
    folderName: payload.folder_name ?? payload.folderName ?? payload.folder,
  };
}

/**
 * Renders the Discord announcement: title, date, creator, attendees, Notion and
 * Granola links, then the summary truncated to about 1400 characters. Private
 * notes and the transcript are never included. Dates are rendered in en-US in
 * `timeZone`, which defaults to the configured standup timezone (settings, else
 * TIMEZONE), not the server's.
 */
export function formatMeetingAnnouncement(
  note: MeetingNote,
  notionUrl?: string,
  timeZone: string = loadAppSettings().standup.timezone
): string {
  const lines = [`**Meeting notes: ${note.title}**`];
  if (note.startedAt) lines.push(`Date: ${formatDateTime(note.startedAt, timeZone)}`);
  if (note.creatorName) lines.push(`Captured by: ${note.creatorName}`);
  const attendeeNames = note.attendees.map((attendee) => attendee.name ?? attendee.email).filter(Boolean);
  if (attendeeNames.length > 0) {
    lines.push(`Attendees: ${attendeeNames.join(", ")}`);
  }
  if (notionUrl) lines.push(`Notion: ${notionUrl}`);
  if (note.sourceUrl) lines.push(`Granola: ${note.sourceUrl}`);
  lines.push("");
  lines.push(truncateForDiscord(note.summaryMarkdown, 1400));
  return lines.join("\n");
}

function truncateForDiscord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

/**
 * A medium date and short time with the zone name ("Jan 15, 2026, 11:30 AM EST").
 * Unparseable input, or an invalid timezone name, returns the raw value.
 */
function formatDateTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    const formatted = date.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    });
    const zone = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value;
    return zone ? `${formatted} ${zone}` : formatted;
  } catch {
    return value;
  }
}
