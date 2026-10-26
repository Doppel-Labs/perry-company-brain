// ontology/types — the in-memory ontology index and query result shapes.
import {
  companyOntologyEntityTypes,
  type CompanyOntologyEntityType,
  type GraphEntityUpsert,
  type GraphEvidenceLink,
  type GraphRelationAssertion,
} from "@core";

export type { CompanyOntologyEntityType } from "@core";

/** The entity types the ontology indexes (projects are linked to, not listed). */
export const ontologyTypes: ReadonlySet<CompanyOntologyEntityType> = new Set(companyOntologyEntityTypes);

export interface OntologyEntityRecord extends GraphEntityUpsert {
  sourceMeetingIds: string[];
  incoming: GraphRelationAssertion[];
  outgoing: GraphRelationAssertion[];
  evidence: GraphEvidenceLink[];
  updatedAt?: string;
}

export interface OntologyIndex {
  generatedAt: string;
  changeSetCount: number;
  entities: OntologyEntityRecord[];
  relations: GraphRelationAssertion[];
  evidence: GraphEvidenceLink[];
  warnings: string[];
}

export interface OntologyQueryOptions {
  project?: string;
  q?: string;
  limit?: number;
}

export interface OntologyQueryResult {
  type: CompanyOntologyEntityType;
  project?: string;
  count: number;
  entities: OntologyEntityRecord[];
}

export interface OntologyChangedSinceResult {
  since: string;
  count: number;
  entities: OntologyEntityRecord[];
}
