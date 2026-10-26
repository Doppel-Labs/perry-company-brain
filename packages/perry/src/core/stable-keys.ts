// core/stable-keys — the one normalization behind graph and ontology stable keys.
//
// The graph change-set builders store keys in this form, so every reader
// (ontology project filters, Discord /brain lookups, Notion wiki sync) must
// build them with these functions or its lookups miss. It lives in @core
// because @graph already depends on @brain, so @brain cannot import @graph.

/**
 * Slug for stable keys: lowercased, URL scheme stripped, runs of characters
 * other than ASCII letters and digits collapsed to `-`, capped at 160
 * characters. Accented letters are dropped, not transliterated. Undefined
 * becomes `unknown`.
 */
export function normalizeStableKey(value: string | undefined): string {
  return (value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 160);
}

/** `project:<slug>`; the key the route, ownership decisions and mentions all resolve to. */
export function projectStableKey(project: string): string {
  return `project:${normalizeStableKey(project)}`;
}

/** `person:<slug>` from the email when present, else the name, else `unknown`. */
export function personStableKey(name?: string, email?: string): string {
  return `person:${normalizeStableKey(email ?? name ?? "unknown")}`;
}
