// extraction/semantic — the backend-neutral contract for LLM extraction: the
// output schema, the shared system prompt, prompt building, and response parsing.
import { z } from "zod";
import type { MeetingNote } from "@meetings";

/**
 * The structured "company-brain objects" an LLM extracts from a meeting note.
 * Shared by every extraction backend (LM Studio, Together.ai) so the contract
 * — and the prompt that produces it — lives in exactly one place.
 */
export const LocalSemanticExtractionSchema = z.object({
  decisions: z.array(z.object({ text: z.string().min(1) })).default([]),
  actionItems: z
    .array(
      z.object({
        text: z.string().min(1),
        owner: z.string().optional(),
        dueDate: z.string().optional(),
      })
    )
    .default([]),
  entities: z
    .array(
      z.object({
        type: z.enum(["person", "project", "repository", "customer", "policy", "channel", "data_source"]),
        name: z.string().min(1),
        stableKey: z.string().optional(),
      })
    )
    .default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type LocalSemanticExtraction = z.infer<typeof LocalSemanticExtractionSchema>;

/** System instruction shared by all semantic-extraction backends. */
export const SEMANTIC_EXTRACTION_SYSTEM_PROMPT =
  "Extract company-brain objects from a meeting. Return only valid JSON with decisions, actionItems, entities, and confidence. Preserve each Decisions bullet as a separate decision and each Action items bullet as a separate action item. Extract explicit repository names like owner/repo, explicit customer names, project names, policies, channels, and data sources. Do not include private notes unless provided in the user message.";

/**
 * Builds the user-message body (title, calendar, folder, start, attendees,
 * summary), hard-truncated to maxContextChars. Private notes and the transcript
 * are deliberately left out.
 */
export function buildExtractionPrompt(note: MeetingNote, maxContextChars: number): string {
  const body = [
    `Title: ${note.title}`,
    note.calendarTitle ? `Calendar: ${note.calendarTitle}` : undefined,
    note.folderName ? `Folder: ${note.folderName}` : undefined,
    note.startedAt ? `Started: ${note.startedAt}` : undefined,
    note.attendees.length
      ? `Attendees: ${note.attendees.map((attendee) => attendee.name ?? attendee.email).filter(Boolean).join(", ")}`
      : undefined,
    "Summary:",
    note.summaryMarkdown,
  ]
    .filter(Boolean)
    .join("\n");
  return body.slice(0, maxContextChars);
}

/** Parses + validates a raw LLM JSON response (tolerates surrounding prose). Throws on missing/invalid JSON or a schema violation; omitted arrays default to empty and confidence to 0.5. */
export function parseLocalSemanticExtraction(content: string): LocalSemanticExtraction {
  const parsed = JSON.parse(extractJsonObject(content)) as unknown;
  return LocalSemanticExtractionSchema.parse(parsed);
}

/**
 * Pulls the first parseable JSON object out of a possibly chatty response. Each
 * "{" is tried in order as a candidate start; a balanced-brace scan that skips
 * braces inside strings (honouring backslash escapes) finds its end, and the
 * first candidate that parses wins. So prose like "use {curly} braces" before
 * or after the object does not break extraction. Throws if no candidate parses.
 */
export function extractJsonObject(value: string): string {
  for (let start = value.indexOf("{"); start >= 0; start = value.indexOf("{", start + 1)) {
    const end = balancedObjectEnd(value, start);
    if (end < 0) continue;
    const candidate = value.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Not JSON (e.g. a brace in prose); try the next "{".
    }
  }
  throw new Error("Semantic extraction response did not contain a JSON object");
}

/** Index of the "}" closing the object that opens at `start`, or -1 if it never closes. */
function balancedObjectEnd(value: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * A numeric setting from the environment: blank or non-numeric values use
 * `fallback`, and the result is never below `min`. (`Math.max(Number("abc"), min)`
 * is NaN, which silently zeroed timeouts and emptied prompts.)
 */
export function numberSetting(raw: string | undefined, fallback: number, min: number): number {
  const parsed = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  return Math.max(Number.isFinite(parsed) ? parsed : fallback, min);
}
