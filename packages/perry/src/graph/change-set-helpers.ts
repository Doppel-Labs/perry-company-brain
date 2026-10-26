// change-set-helpers — project inference, stable-key normalization and small
// value cleaners shared by the change-set builders.
import { normalizeStableKey, personStableKey, projectStableKey } from "@core";
import { type GraphMemorySyncInput } from "./memory";

// Stable keys come from @core so readers outside the graph build identical keys.
export { projectStableKey };

/**
 * Project names recognized in free text (case-insensitive substring match),
 * the fallback when a meeting has no routed project. The single list shared by
 * the change-set builders and the multiplayer projection. Configured routing
 * rules are deliberately not read here: a routed meeting already carries its
 * project in `input.route`, and keeping this a constant keeps the builders
 * pure, so rebuilding a meeting always yields the same keys.
 */
export const knownProjects: readonly string[] = ["Wallace", "Perry", "Atlas", "Notion Wiki", "Discord Ops", "Graph Memory"];

/**
 * The meeting's project: the route's project if set, otherwise the first known
 * project named in the folder, then the title, then the decision and action text.
 */
export function inferProject(input: GraphMemorySyncInput): string | undefined {
  return (
    input.route?.project ??
    inferProjectFromText(input.note.folderName) ??
    inferProjectFromText(input.note.title) ??
    inferProjectFromText(
      [
        ...input.knowledge.decisions.map((item) => item.text),
        ...input.knowledge.actionItems.map((item) => item.text),
      ].join("\n")
    )
  );
}

/** The first entry of the known-project list that appears in `text`, if any. */
export function inferProjectFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return knownProjects.find((project) => text.toLowerCase().includes(project.toLowerCase()));
}

/** `person:<key>` from the email when present, else the name, else `unknown`. */
export const personKey = personStableKey;

/** Slug for stable keys; see normalizeStableKey in @core. */
export const normalizeKey = normalizeStableKey;

/**
 * Evidence excerpt from a summary: drops any line text after a `private notes:` or
 * `transcript:` label, collapses whitespace, and truncates to 500 characters.
 */
export function compactExcerpt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const compact = stripPrivateSections(value).replace(/\s+/gu, " ").trim();
  return compact.length > 500 ? `${compact.slice(0, 497).trimEnd()}...` : compact;
}

/** Drops the rest of any line after a `private notes:` or `transcript:` label. */
export function stripPrivateSections(value: string): string {
  return value.replace(/\bprivate notes?\s*:.*$/gimu, "").replace(/\btranscript\s*:.*$/gimu, "");
}

/** Normalizes a parseable date to ISO 8601; undefined when missing or unparseable. */
export function validIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Copies properties without the undefined values (null is kept). */
export function cleanProperties(
  properties: Record<string, string | number | boolean | null | undefined>
): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) output[key] = value;
  }
  return output;
}

/** Trimmed, non-empty strings, deduplicated case-insensitively; the first spelling wins. */
export function unique(items: Array<string | undefined> | undefined): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items ?? []) {
    const normalized = item?.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}
