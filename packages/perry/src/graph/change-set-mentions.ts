// change-set-mentions — ontology objects mentioned in a meeting's text.
//
// Regex extraction over one corpus (title, calendar title, folder, summary,
// decision and action text). Labelled phrases such as `Risk: ...`, `KPI: ...`
// or `repo owner/name` become typed entities linked from the meeting, all
// citing the meeting's evidence. Confidence is fixed per kind (0.62–0.78), below
// the 0.85–1 used for structured meeting facts, and each extractor keeps at
// most 12 values. See docs/company-brain-ontology.md for the types.
import { type GraphEntityType, type GraphEntityUpsert, type GraphRelationAssertion, type GraphRelationType } from "@core";
import { type GraphMemorySyncInput } from "./memory";
import { assertRelation, upsertEntity } from "./change-set-builders";
import { cleanProperties, normalizeKey, projectStableKey, unique } from "./change-set-helpers";

/**
 * Adds mentioned repositories, customers, policies, goals, metrics, risks,
 * blockers, open questions, capabilities, features, artifacts and benchmark
 * reports to `entities`/`relations` in place. With a project, also links it to
 * the goals, risks, blockers, questions and capabilities; features, metrics and
 * artifacts are linked to any benchmark reports in the same meeting.
 */
export function addMentionedOperatingObjects(
  entities: Map<string, GraphEntityUpsert>,
  relations: GraphRelationAssertion[],
  input: GraphMemorySyncInput,
  meetingKey: string,
  evidenceId: string,
  referenceTime: string,
  projectName?: string
): void {
  const corpus = [
    input.note.title,
    input.note.calendarTitle,
    input.note.folderName,
    input.note.summaryMarkdown,
    ...input.knowledge.decisions.map((decision) => decision.text),
    ...input.knowledge.actionItems.map((action) => action.text),
  ]
    .filter(Boolean)
    .join("\n");

  for (const repository of extractRepositories(corpus)) {
    const key = `repository:${normalizeKey(repository)}`;
    upsertEntity(entities, {
      type: "repository",
      stableKey: key,
      name: repository,
      aliases: unique([repository]),
      properties: cleanProperties({ provider: repository.includes("/") ? "github" : undefined }),
      evidenceIds: [evidenceId],
    });
    relations.push(assertRelation(meetingKey, "MENTIONS_REPOSITORY", key, evidenceId, referenceTime, 0.78));
  }

  for (const customer of extractNamedObjects(corpus, /\b(?:[Cc]ustomer|[Cc]lient|[Aa]ccount)\s+(?<name>[A-Z][A-Za-z0-9&-]*(?:\s+[A-Z][A-Za-z0-9&-]*){0,4})/gu)) {
    const key = `customer:${normalizeKey(customer)}`;
    upsertEntity(entities, {
      type: "customer",
      stableKey: key,
      name: customer,
      aliases: unique([customer]),
      properties: {},
      evidenceIds: [evidenceId],
    });
    relations.push(assertRelation(meetingKey, "MENTIONS_CUSTOMER", key, evidenceId, referenceTime, 0.72));
  }

  for (const policy of extractNamedObjects(corpus, /\b(?:[Pp]olicy|SOP|[Rr]unbook)\s+(?<name>[A-Z][A-Za-z0-9&-]*(?:\s+[A-Z][A-Za-z0-9&-]*){0,5})/gu)) {
    const key = `policy:${normalizeKey(policy)}`;
    upsertEntity(entities, {
      type: "policy",
      stableKey: key,
      name: policy,
      aliases: unique([policy]),
      properties: {},
      evidenceIds: [evidenceId],
    });
    relations.push(assertRelation(meetingKey, "REFERENCES_POLICY", key, evidenceId, referenceTime, 0.72));
  }

  addExtractedEntities(entities, relations, input, meetingKey, evidenceId, referenceTime);

  const projectKey = projectName ? projectStableKey(projectName) : undefined;
  const goals = addTypedMentions(entities, relations, corpus, {
    type: "goal",
    relation: "MENTIONS_GOAL",
    prefix: "goal",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Gg]oal|OKR|[Oo]bjective|[Tt]arget)\s*[:\-]\s*(?<name>[^\n.;]{4,140})/gu,
      /\b(?:goal|objective|target)\s+(?:is|is to|to)\s+(?<name>[^\n.;]{4,140})/giu,
    ],
  });
  const metrics = addTypedMentions(entities, relations, corpus, {
    type: "metric",
    relation: "MENTIONS_METRIC",
    prefix: "metric",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Mm]etric|KPI|SLO)\s*[:\-]\s*(?<name>[^\n.;]{3,120})/gu,
      /\b(?<name>p(?:50|90|95|99)\s+[A-Za-z][^\n.;]{3,100})/gu,
    ],
  });
  const risks = addTypedMentions(entities, relations, corpus, {
    type: "risk",
    relation: "MENTIONS_RISK",
    prefix: "risk",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Rr]isk|[Rr]isk accepted|[Rr]isk identified)\s*[:\-]\s*(?<name>[^\n.;]{4,140})/gu,
    ],
  });
  const blockers = addTypedMentions(entities, relations, corpus, {
    type: "blocker",
    relation: "MENTIONS_BLOCKER",
    prefix: "blocker",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Bb]locker|[Bb]locked by|[Dd]ependency)\s*[:\-]\s*(?<name>[^\n.;]{4,140})/gu,
    ],
  });
  const openQuestions = addTypedMentions(entities, relations, corpus, {
    type: "open_question",
    relation: "MENTIONS_OPEN_QUESTION",
    prefix: "open-question",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Oo]pen question|[Qq]uestion)\s*[:\-]\s*(?<name>[^\n.;?]{4,140}\??)/gu,
    ],
  });
  const capabilities = addTypedMentions(entities, relations, corpus, {
    type: "capability",
    relation: "MENTIONS_CAPABILITY",
    prefix: "capability",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Cc]apability|[Ww]orkflow)\s*[:\-]\s*(?<name>[^\n.;]{4,120})/gu,
    ],
  });
  const features = addTypedMentions(entities, relations, corpus, {
    type: "feature",
    relation: "MENTIONS_FEATURE",
    prefix: "feature",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Ff]eature|[Ii]ntegration)\s*[:\-]\s*(?<name>[^\n.;]{4,120})/gu,
    ],
  });
  const artifacts = addTypedMentions(entities, relations, corpus, {
    type: "artifact",
    relation: "REFERENCES_ARTIFACT",
    prefix: "artifact",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Aa]rtifact|[Dd]ocument|[Dd]oc|[Dd]ashboard|[Cc]onfig|[Pp]rompt)\s*[:\-]\s*(?<name>[^\n.;]{4,160})/gu,
      /\b(?<name>reports\/[A-Za-z0-9_.\-\/]+\.(?:json|md|sqlite|db))/gu,
    ],
  });
  const benchmarkReports = addTypedMentions(entities, relations, corpus, {
    type: "benchmark_report",
    relation: "REFERENCES_BENCHMARK_REPORT",
    prefix: "benchmark-report",
    evidenceId,
    meetingKey,
    referenceTime,
    patterns: [
      /\b(?:[Bb]enchmark report|[Pp]erformance report|[Ee]valuation report)\s*[:\-]\s*(?<name>[^\n.;]{4,160})/gu,
    ],
  });

  // Cross-links are inferred purely from co-occurring in the same meeting.
  if (projectKey) {
    for (const item of goals) relations.push(assertRelation(projectKey, "SUPPORTS_GOAL", item.key, evidenceId, referenceTime, 0.72));
    for (const item of risks) relations.push(assertRelation(projectKey, "HAS_RISK", item.key, evidenceId, referenceTime, 0.72));
    for (const item of blockers) relations.push(assertRelation(projectKey, "BLOCKED_BY", item.key, evidenceId, referenceTime, 0.72));
    for (const item of openQuestions) relations.push(assertRelation(projectKey, "HAS_OPEN_QUESTION", item.key, evidenceId, referenceTime, 0.72));
    for (const item of capabilities) relations.push(assertRelation(projectKey, "IMPLEMENTS_CAPABILITY", item.key, evidenceId, referenceTime, 0.68));
  }
  for (const feature of features) {
    for (const capability of capabilities) relations.push(assertRelation(feature.key, "IMPLEMENTS_CAPABILITY", capability.key, evidenceId, referenceTime, 0.62));
    for (const report of benchmarkReports) relations.push(assertRelation(feature.key, "VALIDATED_BY", report.key, evidenceId, referenceTime, 0.62));
  }
  for (const metric of metrics) {
    for (const report of benchmarkReports) relations.push(assertRelation(metric.key, "VALIDATED_BY", report.key, evidenceId, referenceTime, 0.62));
  }
  for (const artifact of artifacts) {
    for (const report of benchmarkReports) relations.push(assertRelation(artifact.key, "VALIDATED_BY", report.key, evidenceId, referenceTime, 0.62));
  }
}

/** Upserts one entity per extracted mention, linked from the meeting; returns their keys for cross-linking. */
// Model-extracted entities, already grounded by the extraction pipeline (they
// appear verbatim in the note). Only types with a meeting-mention relation are
// linked: projects arrive through routing and people through attendees. Keys
// match the regex extractors above, so the same repository found both ways
// merges into one entity. Confidence 0.7 sits with the regex mentions, below
// structured meeting facts.
const extractedEntityRelations: Partial<Record<string, GraphRelationType>> = {
  repository: "MENTIONS_REPOSITORY",
  customer: "MENTIONS_CUSTOMER",
  policy: "REFERENCES_POLICY",
};

function addExtractedEntities(
  entities: Map<string, GraphEntityUpsert>,
  relations: GraphRelationAssertion[],
  input: GraphMemorySyncInput,
  meetingKey: string,
  evidenceId: string,
  referenceTime: string
): void {
  for (const entity of input.knowledge.entities ?? []) {
    const relation = extractedEntityRelations[entity.type];
    const name = cleanMention(entity.name);
    if (!relation || !name) continue;
    const key = `${entity.type}:${normalizeKey(name)}`;
    upsertEntity(entities, {
      type: entity.type as GraphEntityType,
      stableKey: key,
      name,
      aliases: unique([name]),
      properties: {},
      evidenceIds: [evidenceId],
    });
    relations.push(assertRelation(meetingKey, relation, key, evidenceId, referenceTime, 0.7));
  }
}

function addTypedMentions(
  entities: Map<string, GraphEntityUpsert>,
  relations: GraphRelationAssertion[],
  corpus: string,
  options: {
    type: GraphEntityType;
    relation: GraphRelationType;
    prefix: string;
    evidenceId: string;
    meetingKey: string;
    referenceTime: string;
    patterns: RegExp[];
  }
): Array<{ key: string; name: string }> {
  const mentions = extractTypedMentions(corpus, options.patterns);
  const output: Array<{ key: string; name: string }> = [];
  for (const name of mentions) {
    const key = `${options.prefix}:${normalizeKey(name)}`;
    upsertEntity(entities, {
      type: options.type,
      stableKey: key,
      name,
      aliases: unique([name]),
      properties: cleanProperties({ extractedFrom: "meeting_text" }),
      evidenceIds: [options.evidenceId],
    });
    relations.push(assertRelation(options.meetingKey, options.relation, key, options.evidenceId, options.referenceTime, 0.7));
    output.push({ key, name });
  }
  return output;
}

function extractTypedMentions(corpus: string, patterns: RegExp[]): string[] {
  const values = new Set<string>();
  for (const pattern of patterns) {
    for (const match of corpus.matchAll(pattern)) {
      const value = cleanMention(match.groups?.name ?? "");
      if (isSpecificOperatingMention(value)) values.add(value);
    }
  }
  return [...values].slice(0, 12);
}

// Words that carry no subject on their own; they never count toward the
// content-word threshold in isSpecificOperatingMention.
const vagueWords = new Set([
  "the", "this", "that", "these", "those", "and", "but", "for", "with", "from", "into", "about", "during",
  "our", "its", "their", "them", "they", "then", "than", "more", "less", "some", "any", "all", "very", "just",
  "also", "should", "would", "could", "will", "can", "get", "got", "make", "made", "does", "did", "done", "keep",
  "going", "thing", "things", "stuff", "better", "soon", "later", "next", "week", "team", "review", "cleanup",
  "follow",
]);

/**
 * True when a mention names something rather than gesturing at it. Rejected
 * outright: under 4 characters, or a bare filler phrase. Otherwise specific
 * when it has a marker of a real name: a capital letter after the first
 * character (a proper noun or acronym, not sentence case after a label), a
 * digit, path or identifier punctuation (/ _ # or a hyphen), or a technical
 * unit such as p95, ms or sqlite. Failing those, it needs at least three
 * content words (3+ letters, not in vagueWords): "adaptive search retries"
 * passes, "make it better" and "Improve things" do not.
 */
export function isSpecificOperatingMention(value: string): boolean {
  if (value.length < 4) return false;
  if (/^(the|this|that|next|team|review|cleanup|follow[ -]up)$/iu.test(value)) return false;
  if (/\p{Lu}/u.test(value.slice(1))) return true;
  if (/\d|\/|-|_|#/u.test(value)) return true;
  if (/\b(?:p50|p90|p95|p99|ms|sec|sqlite|json|md|db|api|slo|okr)\b/iu.test(value)) return true;
  const contentWords = value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !vagueWords.has(word));
  return contentWords.length >= 3;
}

// GitHub URLs plus `repo X` / `repository X` phrases; a bare name must look like
// an identifier (contains - _ . or is capitalized) to count.
function extractRepositories(corpus: string): string[] {
  const repositories = new Set<string>();
  for (const match of corpus.matchAll(/github\.com\/(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)/gu)) {
    if (match.groups?.owner && match.groups.repo) repositories.add(`${match.groups.owner}/${match.groups.repo}`);
  }
  for (const match of corpus.matchAll(/\b(?:[Rr]epo|[Rr]epository)\s+(?<repo>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]{3,64})/gu)) {
    const repo = cleanMention(match.groups?.repo ?? "");
    if (isSpecificRepositoryMention(repo)) repositories.add(repo);
  }
  return [...repositories].filter(Boolean).slice(0, 12);
}

function isSpecificRepositoryMention(value: string): boolean {
  return value.includes("/") || /[-_.]/u.test(value) || /^[A-Z][A-Za-z0-9_.-]{2,63}$/u.test(value);
}

function extractNamedObjects(corpus: string, pattern: RegExp): string[] {
  const values = new Set<string>();
  for (const match of corpus.matchAll(pattern)) {
    const value = cleanMention(match.groups?.name ?? "");
    if (value) values.add(value);
  }
  return [...values].slice(0, 12);
}

function cleanMention(value: string): string {
  return value.replace(/[.,;:)\]]+$/u, "").replace(/\s+/gu, " ").trim();
}
