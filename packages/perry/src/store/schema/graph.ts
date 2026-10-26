// schema/graph — Graph change sets and the materialized company ontology.
export const graphSchema = `
  CREATE TABLE IF NOT EXISTS graph_change_sets (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    graph_sync_job_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    validation_status TEXT NOT NULL,
    validation_errors_json TEXT NOT NULL,
    validation_warnings_json TEXT NOT NULL,
    change_set_json TEXT NOT NULL,
    apply_status TEXT NOT NULL,
    applied_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ontology_entities (
    stable_key TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    aliases_json TEXT NOT NULL,
    properties_json TEXT NOT NULL,
    evidence_ids_json TEXT NOT NULL,
    source_meeting_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ontology_relations (
    id TEXT PRIMARY KEY,
    subject_key TEXT NOT NULL,
    relation TEXT NOT NULL,
    object_key TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    valid_from TEXT,
    confidence REAL NOT NULL,
    properties_json TEXT NOT NULL,
    source_meeting_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ontology_evidence (
    evidence_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    meeting_id TEXT NOT NULL,
    title TEXT,
    excerpt TEXT,
    url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ontology_entity_evidence (
    stable_key TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    PRIMARY KEY(stable_key, evidence_id)
  );

  CREATE INDEX IF NOT EXISTS idx_graph_change_sets_meeting_id ON graph_change_sets(meeting_id);

  CREATE INDEX IF NOT EXISTS idx_graph_change_sets_job_id ON graph_change_sets(graph_sync_job_id);

  CREATE INDEX IF NOT EXISTS idx_graph_change_sets_apply_status ON graph_change_sets(apply_status, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_ontology_entities_type_name ON ontology_entities(type, name);

  CREATE INDEX IF NOT EXISTS idx_ontology_entities_updated ON ontology_entities(updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_ontology_relations_subject_relation ON ontology_relations(subject_key, relation);

  CREATE INDEX IF NOT EXISTS idx_ontology_relations_object_relation ON ontology_relations(object_key, relation);

  CREATE INDEX IF NOT EXISTS idx_ontology_relations_source_meeting ON ontology_relations(source_meeting_id);

  CREATE INDEX IF NOT EXISTS idx_ontology_relations_updated ON ontology_relations(updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_ontology_evidence_meeting ON ontology_evidence(meeting_id);

  CREATE INDEX IF NOT EXISTS idx_ontology_entity_evidence_evidence ON ontology_entity_evidence(evidence_id);
`;
