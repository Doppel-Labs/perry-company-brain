// change-set-validation — structural and privacy checks on a graph change set.
//
// Errors make a change set invalid: it is still stored (marked `invalid`) for
// review, but it is never posted to the bridge, materialized into the ontology,
// or replayed. Warnings never block; they are the builder's own notes (such as
// an ownership decision with no resolvable project) passed through.
//
// The privacy check looks for leaked content, not vocabulary. Evidence is built
// from the summary (with labelled private-notes and transcript lines stripped)
// and from extracted decision and action text, so the word "transcript" in a
// decision is fine. What must not appear is a passage of the note's private
// notes or transcript that Perry does not publish anyway: any run of
// LEAK_WINDOW_WORDS consecutive words (or a whole shorter private text of at
// least MIN_PRIVATE_WORDS words) found in an evidence title or excerpt but in
// none of the public texts (title, summary, extracted items). Extraction reads
// private notes, so an extracted decision may legitimately repeat them; that
// text is public, so it never counts as a leak.
import type { GraphChangeSet, GraphChangeSetValidation } from "@core";
import { stripPrivateSections } from "./change-set-helpers";
import type { GraphMemorySyncInput } from "./memory";

/** What the privacy check compares evidence against; see graphPrivacySourcesFor. */
export interface GraphPrivacySources {
  /** Text that must not reach evidence: the note's private notes and transcript. */
  privateTexts: Array<string | undefined>;
  /** Text Perry publishes anyway; a passage also found here is not a leak. */
  publicTexts: Array<string | undefined>;
}

const LEAK_WINDOW_WORDS = 8;
const MIN_PRIVATE_WORDS = 4;

/**
 * Checks that every entity has a stableKey and name, that every relation and
 * retirement points at entities and evidence inside the same change set, that
 * relation confidence is in (0, 1], and, when `privacy` is given, that no
 * evidence title or excerpt contains a passage of private notes or transcript
 * (see the header). Without `privacy` (a stored change set being replayed, whose
 * note is no longer available) the leak check is skipped. Pure; `valid` is true
 * when there are no errors.
 */
export function validateGraphChangeSet(changeSet: GraphChangeSet, privacy?: GraphPrivacySources): GraphChangeSetValidation {
  const errors: string[] = [];
  const warnings = [...changeSet.warnings];
  const entityKeys = new Set(changeSet.entities.map((entity) => entity.stableKey));
  const evidenceIds = new Set(changeSet.evidence.map((item) => item.evidenceId));

  for (const entity of changeSet.entities) {
    if (!entity.stableKey) errors.push(`Entity is missing stableKey: ${entity.name}`);
    if (!entity.name) errors.push(`Entity is missing name: ${entity.stableKey}`);
    for (const evidenceId of entity.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) errors.push(`Entity ${entity.stableKey} references missing evidence ${evidenceId}`);
    }
  }

  for (const relation of changeSet.relations) {
    if (!entityKeys.has(relation.subjectKey)) errors.push(`Relation subject missing: ${relation.subjectKey}`);
    if (!entityKeys.has(relation.objectKey)) errors.push(`Relation object missing: ${relation.objectKey}`);
    if (!evidenceIds.has(relation.evidenceId)) errors.push(`Relation evidence missing: ${relation.evidenceId}`);
    if (relation.confidence <= 0 || relation.confidence > 1) {
      errors.push(`Relation confidence out of range: ${relation.subjectKey} ${relation.relation}`);
    }
  }

  for (const retirement of changeSet.retirements) {
    if (!entityKeys.has(retirement.subjectKey)) errors.push(`Retirement subject missing: ${retirement.subjectKey}`);
    if (!entityKeys.has(retirement.objectKey)) errors.push(`Retirement object missing: ${retirement.objectKey}`);
    if (!evidenceIds.has(retirement.evidenceId)) errors.push(`Retirement evidence missing: ${retirement.evidenceId}`);
  }

  if (privacy) {
    const leaked = findPrivateLeaks(changeSet, privacy);
    if (leaked.length > 0) errors.push(`Graph evidence contains private notes or transcript content: ${leaked.join(", ")}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * The privacy sources for a meeting: its private notes and transcript are
 * private; its title, calendar title, folder, summary (minus labelled private
 * lines), and extracted decision and action text are public.
 */
export function graphPrivacySourcesFor(input: GraphMemorySyncInput): GraphPrivacySources {
  return {
    privateTexts: [input.note.privateNotes, input.note.transcript],
    publicTexts: [
      input.note.title,
      input.note.calendarTitle,
      input.note.folderName,
      input.note.summaryMarkdown ? stripPrivateSections(input.note.summaryMarkdown) : undefined,
      ...input.knowledge.decisions.map((decision) => decision.text),
      ...input.knowledge.actionItems.map((action) => action.text),
    ],
  };
}

// Evidence ids whose title or excerpt contains a private-only passage.
function findPrivateLeaks(changeSet: GraphChangeSet, privacy: GraphPrivacySources): string[] {
  const publicWords = privacy.publicTexts.map((text) => words(text ?? ""));
  // Private passages keyed by their length in words, minus any that are also public.
  const privateWindows = new Map<number, Set<string>>();
  for (const text of privacy.privateTexts) {
    const tokens = words(text ?? "");
    if (tokens.length < MIN_PRIVATE_WORDS) continue;
    const size = Math.min(LEAK_WINDOW_WORDS, tokens.length);
    const set = privateWindows.get(size) ?? new Set<string>();
    for (const window of windows(tokens, size)) set.add(window);
    privateWindows.set(size, set);
  }
  for (const [size, set] of privateWindows) {
    for (const tokens of publicWords) {
      for (const window of windows(tokens, size)) set.delete(window);
    }
  }
  if ([...privateWindows.values()].every((set) => set.size === 0)) return [];

  return changeSet.evidence
    .filter((item) => {
      const tokens = words(`${item.title ?? ""}\n${item.excerpt ?? ""}`);
      for (const [size, set] of privateWindows) {
        for (const window of windows(tokens, size)) if (set.has(window)) return true;
      }
      return false;
    })
    .map((item) => item.evidenceId);
}

function words(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function windows(tokens: string[], size: number): string[] {
  const output: string[] = [];
  for (let start = 0; start + size <= tokens.length; start += 1) output.push(tokens.slice(start, start + size).join(" "));
  return output;
}
