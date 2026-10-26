// discord-ontology — renders ontology queries as short Markdown replies for /brain.
//
// Replies are kept under Discord's 2000-character message limit: at most 10
// rows, inline excerpts trimmed to 120-140 characters, and the whole reply
// truncated to 1800. Invalid input yields a usage message rather than an error.
import {
  queryArtifacts,
  queryBenchmarkReports,
  queryBlockers,
  queryCapabilities,
  queryEvidenceFor,
  queryFeatures,
  queryGoals,
  queryMetrics,
  queryOntologyChangedSince,
  queryOpenQuestions,
  queryRisks,
  summarizeOntology,
  type CompanyOntologyEntityType,
  type OntologyEntityRecord,
  type OntologyQueryResult,
} from "./ontology";

/** The entity types offered as choices for `/brain state`. */
export const discordOntologyTypes: readonly CompanyOntologyEntityType[] = [
  "goal",
  "metric",
  "risk",
  "blocker",
  "open_question",
  "capability",
  "feature",
  "artifact",
  "benchmark_report",
];

/** Lists entities of one type, optionally scoped to a project and filter text (default 8 rows, max 10). */
export function formatOntologyState(options: {
  type: CompanyOntologyEntityType;
  project?: string;
  q?: string;
  limit?: number;
}): string {
  const limit = clampLimit(options.limit ?? 8);
  const result = runOntologyTypeQuery(options.type, { project: options.project, q: options.q, limit });
  const title = [options.project?.trim(), ontologyTypeLabel(options.type)].filter(Boolean).join(" ") || ontologyTypeLabel(options.type);
  const lines = result.entities.map(formatOntologyEntityLine);
  const summary = summarizeOntology();
  const count = summary.counts[options.type] ?? result.count;
  return truncate(
    [
      `**${title}**`,
      `${result.count} matching, ${count} indexed total.`,
      lines.length ? lines.join("\n") : "No matching ontology objects found.",
    ].join("\n"),
    1800
  );
}

/** Lists entities changed since an ISO timestamp (default 8 rows, max 10). */
export function formatOntologyChangedSince(options: { since: string; project?: string; limit?: number }): string {
  const since = options.since.trim();
  if (!validIso(since)) return "Use an ISO timestamp for `since`, for example `2026-05-25T00:00:00.000Z`.";
  const result = queryOntologyChangedSince(since, {
    project: options.project,
    limit: clampLimit(options.limit ?? 8),
  });
  const lines = result.entities.map(formatOntologyEntityLine);
  const title = options.project?.trim() ? `${options.project.trim()} ontology changes` : "Ontology changes";
  return truncate(
    [
      `**${title}**`,
      `${result.count} ontology objects changed since ${since}.`,
      lines.length ? lines.join("\n") : "No changed ontology objects found.",
    ].join("\n"),
    1800
  );
}

/** Shows an entity's relation and evidence counts and its first six evidence items. */
export function formatOntologyEvidence(stableKey: string): string {
  const key = stableKey.trim();
  if (!key) return "Provide an ontology stable key.";
  const result = queryEvidenceFor(key);
  if (!result.entity) return `No ontology entity found for ${key}.`;
  const evidence = result.evidence.slice(0, 6).map((item) => {
    const title = item.title ?? item.sourceId;
    const excerpt = item.excerpt ? `: ${truncateInline(item.excerpt, 140)}` : "";
    return `- ${title}${excerpt}`;
  });
  return truncate(
    [
      `**${result.entity.name}**`,
      `${result.relations.length} relations, ${result.evidence.length} evidence records.`,
      evidence.length ? evidence.join("\n") : "No bounded evidence attached.",
    ].join("\n"),
    1800
  );
}

function runOntologyTypeQuery(
  type: CompanyOntologyEntityType,
  options: { project?: string; q?: string; limit?: number }
): OntologyQueryResult {
  switch (type) {
    case "goal":
      return queryGoals(options);
    case "metric":
      return queryMetrics(options);
    case "risk":
      return queryRisks(options);
    case "blocker":
      return queryBlockers(options);
    case "open_question":
      return queryOpenQuestions(options);
    case "capability":
      return queryCapabilities(options);
    case "feature":
      return queryFeatures(options);
    case "artifact":
      return queryArtifacts(options);
    case "benchmark_report":
      return queryBenchmarkReports(options);
  }
}

function formatOntologyEntityLine(entity: OntologyEntityRecord): string {
  const evidence = entity.evidence[0]?.excerpt ?? entity.evidence[0]?.title;
  const suffix = evidence ? `: ${truncateInline(evidence, 120)}` : "";
  return `- ${entity.name} (${entity.sourceMeetingIds.length} notes)${suffix}`;
}

function ontologyTypeLabel(type: CompanyOntologyEntityType): string {
  return type.replace(/_/gu, " ");
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 1), 10);
}

function validIso(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function truncateInline(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3).trimEnd()}...`;
}
