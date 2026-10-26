// values — small, pure conversions shared by the store's row mappers and queries.
import type { PageOptions } from "./types";

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Normalizes a date string to ISO-8601, or undefined when it does not parse. */
export function validIsoOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Stable-key slug. Changing this changes stored ids, so keep it frozen. */
export function slugKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
}

/** Clamps paging input: limit to [0, maxLimit], offset to >= 0. */
export function normalizePage(options: PageOptions, defaultLimit: number, maxLimit: number): Required<PageOptions> {
  return {
    limit: Math.min(Math.max(Math.trunc(options.limit ?? defaultLimit), 0), maxLimit),
    offset: Math.max(Math.trunc(options.offset ?? 0), 0),
  };
}

/** Parses a JSON object column; anything else (including bad JSON) is undefined. */
export function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Parses a JSON object column of scalar properties; anything else is {}. */
export function parseJsonObject(value: unknown): Record<string, string | number | boolean | null> {
  if (typeof value !== "string") return {};
  return (parseJsonRecord(value) as Record<string, string | number | boolean | null> | undefined) ?? {};
}

/** Union of a stored JSON string array and new values: trimmed, case-insensitively unique, order kept. */
export function mergeJsonArrays(existingJson: unknown, next: string[]): string[] {
  return uniqueStrings([...parseJsonStringArray(existingJson), ...next]);
}

function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
