// controllers/ontology — typed company ontology reads and the agent-facing brain tools.
import {
  type CompanyOntologyEntityType,
  getBrainToolChangedSince,
  getBrainToolEvidence,
  getBrainToolProjectState,
  getOntologyHealthReport,
  getOntologyIndex,
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
} from "@brain";
import type { Query } from "../http/request";
import type { RouteDefinition } from "../router";
import { parseOntologyType, parseOntologyTypes } from "../validation";

type OntologyIndex = ReturnType<typeof getOntologyIndex>;
type OntologyQuery = (options: { project?: string; q?: string; limit?: number }, index: OntologyIndex) => unknown;

/** Entity type → its index query. */
const ontologyQueries: Record<CompanyOntologyEntityType, OntologyQuery> = {
  goal: queryGoals,
  metric: queryMetrics,
  risk: queryRisks,
  blocker: queryBlockers,
  open_question: queryOpenQuestions,
  capability: queryCapabilities,
  feature: queryFeatures,
  artifact: queryArtifacts,
  benchmark_report: queryBenchmarkReports,
};

// `changeSetLimit` only caps change sets on the replay fallback; with materialized
// tables it scales the row limits instead (see getOntologyIndex).
const indexFrom = (query: Query): OntologyIndex => getOntologyIndex(query.int("changeSetLimit", 1000));

/**
 * /api/brain/ontology returns a summary, or one type's entities with ?type=;
 * other routes cover changes since a timestamp, evidence, health, and the
 * agent-facing brain tools under /api/brain/tools/*.
 */
export const ontologyRoutes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/brain/ontology",
    handle: ({ query }) => {
      const index = indexFrom(query);
      const type = query.parse("type", parseOntologyType);
      if (!type) return { summary: summarizeOntology(index) };
      return ontologyQueries[type]({ project: query.string("project"), q: query.string("q"), limit: query.int("limit", 25) }, index);
    },
  },
  {
    method: "GET",
    path: "/api/brain/ontology/changed-since",
    handle: ({ query }) =>
      queryOntologyChangedSince(query.required("since"), {
        project: query.string("project"),
        q: query.string("q"),
        limit: query.int("limit", 100),
      }),
  },
  {
    method: "GET",
    path: "/api/brain/ontology/evidence",
    handle: ({ query }) => queryEvidenceFor(query.string("stableKey") ?? "", indexFrom(query)),
  },
  {
    method: "GET",
    path: "/api/brain/ontology/health",
    handle: ({ query }) =>
      getOntologyHealthReport({
        changeSetLimit: query.int("changeSetLimit", 200),
        entityLimit: query.int("entityLimit", 1000),
        relationLimit: query.int("relationLimit", 2000),
        evidenceLimit: query.int("evidenceLimit", 1000),
      }),
  },
  {
    method: "GET",
    path: "/api/brain/tools/project-state",
    handle: ({ query }) =>
      getBrainToolProjectState({
        project: query.string("project"),
        q: query.string("q"),
        limit: query.int("limit", 10),
        types: query.parse("types", parseOntologyTypes),
      }),
  },
  {
    method: "GET",
    path: "/api/brain/tools/changed-since",
    handle: ({ query }) =>
      getBrainToolChangedSince({
        since: query.required("since"),
        project: query.string("project"),
        q: query.string("q"),
        limit: query.int("limit", 50),
      }),
  },
  {
    method: "GET",
    path: "/api/brain/tools/evidence",
    handle: ({ query }) => getBrainToolEvidence({ stableKey: query.required("stableKey") }),
  },
];
