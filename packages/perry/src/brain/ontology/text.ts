// ontology/text — matching, normalization, and ordering helpers.
import type { OntologyEntityRecord } from "./types";

/** Most-referenced first, then most evidence, then by name. */
export function compareOntologyEntities(a: OntologyEntityRecord, b: OntologyEntityRecord): number {
  return b.sourceMeetingIds.length - a.sourceMeetingIds.length || b.evidence.length - a.evidence.length || a.name.localeCompare(b.name);
}

/** Substring match after normalizeText on both sides; an empty query matches everything. */
export function matches(value: string, query: string): boolean {
  return normalizeText(value).includes(normalizeText(query));
}

/** Lowercase, with runs of non-letter/digit characters collapsed to single spaces. */
export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

/** De-duplicates, dropping empty strings. */
export function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
