// components/ontology/OntologyEvidenceDrawer — the first 5 evidence rows and the
// relation count for the selected ontology entity.
import type { OntologyEvidenceResponse } from "../../types";

export function OntologyEvidenceDrawer({ evidence }: { evidence: OntologyEvidenceResponse }) {
  return (
    <div className="ontology-evidence-drawer">
      <div className="card-head">
        <strong>{evidence.entity?.name ?? evidence.stableKey}</strong>
        <span className="pill meeting">{evidence.evidence.length} evidence</span>
      </div>
      <div className="graph-list">
        {evidence.evidence.length ? (
          evidence.evidence.slice(0, 5).map((item) => (
            <div className="graph-fact" key={item.evidenceId}>
              <strong>{item.title ?? item.source ?? item.evidenceId}</strong>
              <p>{item.excerpt ?? item.url ?? item.evidenceId}</p>
            </div>
          ))
        ) : (
          <div className="empty">No bounded evidence attached.</div>
        )}
      </div>
      <div className="subtle">{evidence.relations.length} linked relations</div>
    </div>
  );
}
