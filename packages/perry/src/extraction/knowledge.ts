// extraction/knowledge — deterministic, LLM-free extraction of decisions and
// action items from a meeting's summary and private notes.
//
// Two passes are unioned: bullets under a recognised heading ("Decisions:",
// "Action items:", "Next steps:", ...) and single lines with an inline cue
// ("we decided ...", "todo: ..."). A "Notes"/"Transcript"/"Private notes"
// heading ends the current section. Results are deduplicated case-insensitively,
// keeping first-seen order.
import type { MeetingNote } from "@meetings";
import type { ExtractedEntity, ExtractionProvenance } from "./types";

/**
 * Decisions and action items found in a note; owner and dueDate are best-effort
 * parses of the item text. `entities` and `extraction` are filled in by the
 * extraction pipeline (pipeline.ts), not by the rules parser.
 */
export interface ExtractedKnowledge {
  decisions: Array<{ text: string }>;
  actionItems: Array<{ text: string; owner?: string; dueDate?: string }>;
  entities?: ExtractedEntity[];
  extraction?: ExtractionProvenance;
}

const decisionHeadings = [/^decisions?\s*:?$/iu, /^what we decided\s*:?$/iu];
const actionHeadings = [/^actions?\s*:?$/iu, /^action items?\s*:?$/iu, /^next steps?\s*:?$/iu, /^follow-ups?\s*:?$/iu];
const otherHeadings = [/^private notes?\s*:?$/iu, /^notes?\s*:?$/iu, /^transcript\s*:?$/iu];

// Inline markers. Verbs ("decided", "agreed", "todo") may run straight into the
// content; the bare nouns "decision" and "action (item)" need a colon, and no
// marker may be the first half of a hyphenated word, so "Decision-making was
// slow" is not read as the decision "-making was slow".
const inlineDecision = /\b(?:(?:we decided|decided|agreed)\b(?!-)\s*:?|decision\s*:)\s*(.+)$/iu;
const inlineAction = /\b(?:(?:todo|next step)\b(?!-)\s*:?|action(?: item)?\s*:)\s*(.+)$/iu;

/**
 * Extracts decisions and action items from `summaryMarkdown` plus `privateNotes`
 * (unlike the LLM prompt, private notes are included here). Pure; never throws,
 * returns empty arrays when nothing matches. Used by the ingestion workflow.
 */
export function extractKnowledge(note: MeetingNote): ExtractedKnowledge {
  const text = [note.summaryMarkdown, note.privateNotes ? `Private Notes:\n${note.privateNotes}` : undefined]
    .filter(Boolean)
    .join("\n");
  const sections = collectSections(text);
  const decisions = unique([
    ...extractFromSections(sections, "decision"),
    ...extractInline(text, inlineDecision),
  ]).map((item) => ({ text: item }));
  const actionItems = unique([
    ...extractFromSections(sections, "action"),
    ...extractInline(text, inlineAction),
  ]).map(parseActionItem);

  return {
    decisions,
    actionItems,
  };
}

function collectSections(text: string): Array<{ type: "decision" | "action" | "other"; line: string }> {
  const output: Array<{ type: "decision" | "action" | "other"; line: string }> = [];
  let current: "decision" | "action" | "other" = "other";

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = cleanLine(rawLine);
    if (!line) continue;
    if (decisionHeadings.some((pattern) => pattern.test(line))) {
      current = "decision";
      continue;
    }
    if (actionHeadings.some((pattern) => pattern.test(line))) {
      current = "action";
      continue;
    }
    if (otherHeadings.some((pattern) => pattern.test(line))) {
      current = "other";
      continue;
    }
    output.push({ type: current, line });
  }

  return output;
}

function extractFromSections(
  sections: Array<{ type: "decision" | "action" | "other"; line: string }>,
  type: "decision" | "action"
): string[] {
  return sections
    .filter((section) => section.type === type)
    .map((section) => normalizeSentence(section.line))
    .filter(Boolean);
}

function extractInline(text: string, pattern: RegExp): string[] {
  return text
    .split(/\r?\n/u)
    .map(cleanLine)
    .filter((line) => !decisionHeadings.some((heading) => heading.test(line)))
    .filter((line) => !actionHeadings.some((heading) => heading.test(line)))
    .filter((line) => !otherHeadings.some((heading) => heading.test(line)))
    .map((line) => line.match(pattern)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(normalizeSentence)
    .filter(Boolean);
}

// Owner: the shortest capitalised prefix (up to ~40 chars) before ":" or a
// spaced dash, e.g. "Alex: ship the fix" or "Alex - fix the follow-up" -> owner
// "Alex". Only a spaced dash separates, so "Mary-Jane: ship" keeps the full name.
// Due date: "by" or "due" followed by today, tomorrow, next week, an ISO date,
// or "Month D".
function parseActionItem(text: string): { text: string; owner?: string; dueDate?: string } {
  const ownerMatch = text.match(/^(?<owner>[A-Z][\w .'-]{1,40}?)(?:\s*:\s*|\s+[-–]\s+)(?<task>.+)$/u);
  const dueMatch = text.match(/\b(?:by|due)\s+(?<due>(?:today|tomorrow|next week|\d{4}-\d{2}-\d{2}|[A-Z][a-z]+ \d{1,2}))\b/iu);
  return {
    text: ownerMatch?.groups?.task?.trim() ?? text,
    owner: ownerMatch?.groups?.owner?.trim(),
    dueDate: dueMatch?.groups?.due?.trim(),
  };
}

// Strips a leading bullet (-, *) or list number (1. / 1)).
function cleanLine(line: string): string {
  return line.replace(/^\s*(?:[-*]|\d+[.)])\s*/u, "").trim();
}

function normalizeSentence(line: string | undefined): string {
  if (!line) return "";
  return line.replace(/\s+/gu, " ").trim();
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}
