// validation — request input models. Controllers only ever see parsed, typed values.
import type { CompanyOntologyEntityType } from "@brain";
import { z } from "zod";
import { badRequest } from "./http/errors";

/**
 * Validator for a small closed set of string literals: returns the value when
 * it is one of `allowed`, else undefined.
 */
export function oneOf<const T extends string>(...allowed: T[]): (value: string | null | undefined) => T | undefined {
  const set = new Set<string>(allowed);
  return (value) => (value != null && set.has(value) ? (value as T) : undefined);
}

export const parseOntologyType = oneOf<CompanyOntologyEntityType>(
  "goal", "metric", "risk", "blocker", "open_question", "capability", "feature", "artifact", "benchmark_report"
);
export const parseIssueStatus = oneOf("open", "in_progress", "blocked", "done", "canceled");
export const parseIssuePriority = oneOf("low", "normal", "high", "urgent");
export const parseGraphChangeSetStatus = oneOf("queued", "applied", "failed");
export const parseApprovalStatus = oneOf("pending", "approved", "rejected", "posted");
export const parseSearchType = oneOf("meeting", "decision", "action");

/** Comma-separated list through an item parser, dropping unknown values. */
export function parseList<T>(value: string | null, parseItem: (item: string) => T | undefined): T[] {
  return (value ?? "")
    .split(",")
    .map((item) => parseItem(item.trim()))
    .filter((item): item is T => item !== undefined);
}

/** Undefined when no known types are given, so the caller's default type set applies. */
export function parseOntologyTypes(value: string | null): CompanyOntologyEntityType[] | undefined {
  const types = parseList(value, parseOntologyType);
  return types.length ? types : undefined;
}

/** Validates a JSON body against a schema; failures become a 400 listing each issue. */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown, label = "request body"): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw badRequest(`Invalid ${label}: ${issues.join("; ")}`);
}

/** Trimmed text; blank becomes undefined (field left unchanged). */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim() || undefined)
    .optional();

/** Trimmed text where "" is meaningful (clears the field). */
const clearableText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim())
    .optional();

/** Create/update body for an issue; every field is optional here (POST checks `title` itself). */
export const IssueBodySchema = z.object({
  id: optionalText(200),
  project: clearableText(200),
  title: optionalText(500),
  description: clearableText(20_000),
  status: optionalText(40),
  priority: optionalText(40),
  owner: clearableText(200),
  dueDate: clearableText(40),
  actor: optionalText(200),
  comment: optionalText(5_000),
});
export type IssueBody = z.infer<typeof IssueBodySchema>;
