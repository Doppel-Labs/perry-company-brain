// controllers — the complete admin API route table, one module per resource.
import type { RouteDefinition } from "../router";
import { approvalRoutes } from "./approvals";
import { graphMemoryRoutes } from "./graph-memory";
import { graphSyncRoutes } from "./graph-sync";
import { ingestionRoutes } from "./ingestion";
import { issueRoutes } from "./issues";
import { knowledgeRoutes } from "./knowledge";
import { ontologyRoutes } from "./ontology";
import { systemRoutes } from "./system";

/** Every /api route. Order matters only for overlapping patterns: the first match wins. */
export const apiRoutes: readonly RouteDefinition[] = [
  ...systemRoutes,
  ...ingestionRoutes,
  ...approvalRoutes,
  ...issueRoutes,
  ...knowledgeRoutes,
  ...graphMemoryRoutes,
  ...ontologyRoutes,
  ...graphSyncRoutes,
];
