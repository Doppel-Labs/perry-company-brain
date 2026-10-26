// extraction/pipeline — the single entry point ingestion uses to turn a meeting
// note into decisions, action items, and entities.
//
// PERRY_EXTRACTION_MODE picks the strategy:
//   rules  (default) the deterministic parser only; no network calls.
//   llm    the configured LLM backend, falling back to rules on failure.
//   hybrid the LLM result, plus any rule-found items it missed.
// Rules stay the default because llm/hybrid send the meeting summary to a model
// (a third party when PERRY_EXTRACTION_BACKEND=together). Private notes and the
// transcript are never sent.
//
// Model output is untrusted. Before it is used, every item must be grounded in
// the text the model saw (most of its content words appear in the note), owners
// are kept only when they match an attendee or roster member, and a reply below
// PERRY_EXTRACTION_MIN_CONFIDENCE falls back to rules. The result always
// records how it was produced (`extraction`), including why a fallback happened.
import { getRoster } from "@core";
import type { MeetingNote } from "@meetings";
import { extractMeetingSemantics, getExtractionBackend } from "./extract";
import { extractKnowledge, type ExtractedKnowledge } from "./knowledge";
import { getLmStudioExtractionConfig } from "./lm-studio";
import { numberSetting, type LocalSemanticExtraction } from "./semantic";
import { getTogetherExtractionConfig } from "./together";
import type { ExtractedEntity, ExtractionMode, ExtractionProvenance } from "./types";

export interface ExtractionOptions {
  /** Defaults to process.env; supplies the mode, backend, and model settings. */
  env?: NodeJS.ProcessEnv;
  /** Overrides PERRY_EXTRACTION_MODE. */
  mode?: ExtractionMode;
  /** Overrides the configured backend call; used by tests and evaluations. */
  extractor?: (note: MeetingNote) => Promise<LocalSemanticExtraction>;
  /** Names an owner may resolve to. Defaults to the note's attendees plus the roster. */
  people?: string[];
}

/** The rules parser's result, labelled with its provenance. Synchronous; never calls a model. */
export function extractRulesKnowledge(note: MeetingNote): ExtractedKnowledge {
  return { ...extractKnowledge(note), extraction: { method: "rules", requestedMode: "rules" } };
}

/** Reads PERRY_EXTRACTION_MODE; anything other than "llm" or "hybrid" means "rules". */
export function getExtractionMode(env: NodeJS.ProcessEnv = process.env): ExtractionMode {
  const mode = env.PERRY_EXTRACTION_MODE?.trim().toLowerCase();
  return mode === "llm" || mode === "hybrid" ? mode : "rules";
}

/**
 * Extracts knowledge from a note using the configured mode. Never throws on an
 * LLM failure: it falls back to the rules result and says why in `extraction`.
 */
export async function extractMeetingKnowledge(note: MeetingNote, options: ExtractionOptions = {}): Promise<ExtractedKnowledge> {
  const env = options.env ?? process.env;
  const mode = options.mode ?? getExtractionMode(env);
  const rules = extractKnowledge(note);
  if (mode === "rules") return extractRulesKnowledge(note);

  const model = options.extractor ? { backend: "custom", model: undefined } : describeBackend(env);
  const base = { requestedMode: mode, backend: model.backend, model: model.model };
  const fallback = (reason: string, extra: Partial<ExtractionProvenance> = {}): ExtractedKnowledge => ({
    ...rules,
    extraction: { ...base, ...extra, method: "rules", fallbackReason: reason },
  });

  const started = Date.now();
  let reply: LocalSemanticExtraction;
  try {
    reply = await (options.extractor ?? ((input: MeetingNote) => extractMeetingSemantics(input, env)))(note);
  } catch (error) {
    return fallback(`LLM extraction failed: ${error instanceof Error ? error.message : String(error)}`, {
      durationMs: Date.now() - started,
    });
  }
  const durationMs = Date.now() - started;

  const minConfidence = numberSetting(env.PERRY_EXTRACTION_MIN_CONFIDENCE, 0.5, 0);
  if (reply.confidence < minConfidence) {
    return fallback(`LLM confidence ${reply.confidence} is below ${minConfidence}`, { confidence: reply.confidence, durationMs });
  }

  const source = sourceText(note);
  const people = options.people ?? knownPeople(note);
  const decisions = reply.decisions.filter((item) => isGrounded(item.text, source)).map((item) => ({ text: clean(item.text) }));
  const actionItems = reply.actionItems
    .filter((item) => isGrounded(item.text, source))
    .map((item) => ({
      text: clean(item.text),
      owner: resolveOwner(item.owner, people),
      dueDate: groundedDueDate(item.dueDate, source),
    }));
  const entities = groundedEntities(reply.entities, source);
  const droppedUngrounded = reply.decisions.length + reply.actionItems.length - decisions.length - actionItems.length;
  const provenance = { ...base, confidence: reply.confidence, durationMs, droppedUngrounded };

  if (mode === "llm") {
    if (decisions.length + actionItems.length === 0 && rules.decisions.length + rules.actionItems.length > 0) {
      return fallback("LLM returned no grounded decisions or action items", provenance);
    }
    return { decisions, actionItems, entities, extraction: { ...provenance, method: "llm" } };
  }

  return {
    decisions: mergeItems(decisions, rules.decisions, (llm) => llm),
    actionItems: mergeItems(actionItems, rules.actionItems, (llm, rule) => ({
      ...llm,
      owner: llm.owner ?? rule?.owner,
      dueDate: llm.dueDate ?? rule?.dueDate,
    })),
    entities,
    extraction: { ...provenance, method: "hybrid" },
  };
}

function describeBackend(env: NodeJS.ProcessEnv): { backend: string; model?: string } {
  const backend = getExtractionBackend(env);
  const model = backend === "together" ? getTogetherExtractionConfig(env).model : getLmStudioExtractionConfig(env).model;
  return { backend, model };
}

/** The text the model was shown (see buildExtractionPrompt); grounding checks against exactly this. */
function sourceText(note: MeetingNote): string {
  return [note.title, note.calendarTitle, note.folderName, ...note.attendees.map((a) => a.name ?? a.email), note.summaryMarkdown]
    .filter(Boolean)
    .join("\n");
}

const stopWords = new Set(
  "the and for with that this from will was are has have into onto our their they them its not but all any can should would could about over under after before then than when what who why how per via also just more most each".split(" ")
);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !stopWords.has(word));
}

/**
 * True when at least 60% of the item's content words (and at least one) occur
 * in the source. Paraphrase is tolerated; invented facts are not.
 */
export function isGrounded(text: string, source: string): boolean {
  const words = contentWords(text).map(stem);
  if (words.length === 0) return false;
  const vocabulary = new Set(contentWords(source).map(stem));
  const present = words.filter((word) => vocabulary.has(word)).length;
  return present / words.length >= 0.6;
}

/** Light suffix stemming so "ships", "shipped", and "shipping" all compare as "ship". */
function stem(word: string): string {
  let base = word.replace(/(?:ing|ed)$/u, "");
  if (base !== word) {
    if (/([b-df-hj-np-tv-z])\1$/u.test(base)) base = base.slice(0, -1);
  } else {
    base = word.replace(/(?:es|s)$/u, "");
  }
  return base.length >= 3 ? base : word;
}

function knownPeople(note: MeetingNote): string[] {
  const roster = safeRoster().flatMap((person) => [person.name, person.notionName]);
  return [...note.attendees.map((attendee) => attendee.name), note.creatorName, ...roster].filter(
    (name): name is string => Boolean(name?.trim())
  );
}

function safeRoster(): Array<{ name: string; notionName?: string }> {
  try {
    return getRoster();
  } catch {
    // A missing or invalid settings file must not break extraction.
    return [];
  }
}

/**
 * Maps a model-supplied owner to a known person: an exact (case-insensitive)
 * full-name match, else a unique first-name match. Anything else is dropped,
 * so a hallucinated owner never lands on an action item.
 */
export function resolveOwner(owner: string | undefined, people: string[]): string | undefined {
  const wanted = owner?.trim().toLowerCase();
  if (!wanted) return undefined;
  const exact = people.find((person) => person.toLowerCase() === wanted);
  if (exact) return exact;
  const byFirstName = [...new Set(people.filter((person) => person.toLowerCase().split(/\s+/u)[0] === wanted))];
  return byFirstName.length === 1 ? byFirstName[0] : undefined;
}

/** Keeps an ISO date, or a due phrase that literally appears in the note; drops anything invented. */
function groundedDueDate(dueDate: string | undefined, source: string): string | undefined {
  const value = dueDate?.trim();
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/u.test(value) && !Number.isNaN(Date.parse(value))) return value.slice(0, 10);
  return source.toLowerCase().includes(value.toLowerCase()) ? value : undefined;
}

function groundedEntities(entities: LocalSemanticExtraction["entities"], source: string): ExtractedEntity[] {
  const haystack = source.toLowerCase();
  const seen = new Set<string>();
  const output: ExtractedEntity[] = [];
  for (const entity of entities) {
    const name = clean(entity.name);
    const key = `${entity.type}:${name.toLowerCase()}`;
    if (!name || seen.has(key) || !haystack.includes(name.toLowerCase())) continue;
    seen.add(key);
    output.push({ type: entity.type, name });
  }
  return output;
}

/**
 * LLM items first, then rule items the model missed. A rule item is "covered"
 * when it and an LLM item share most of their content words; `combine` lets the
 * LLM item borrow fields (owner, due date) from the rule item that covers it.
 */
function mergeItems<T extends { text: string }>(llmItems: T[], ruleItems: T[], combine: (llm: T, rule?: T) => T): T[] {
  const merged = llmItems.map((item) => combine(item, ruleItems.find((rule) => sameItem(rule.text, item.text))));
  for (const rule of ruleItems) {
    if (!llmItems.some((item) => sameItem(rule.text, item.text))) merged.push(rule);
  }
  return merged;
}

function sameItem(a: string, b: string): boolean {
  const left = new Set(contentWords(a).map(stem));
  const right = new Set(contentWords(b).map(stem));
  if (left.size === 0 || right.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.min(left.size, right.size) >= 0.7;
}

function clean(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}
