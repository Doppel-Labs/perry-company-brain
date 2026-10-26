// components/ontology/OntologyPanel — the Ontology Cockpit: State/Changed toggle,
// filters, results, and the evidence drawer for a clicked entity. Read-only.
import { Database, Loader2, RefreshCw } from "lucide-react";
import type { OntologyState } from "../../hooks/useOntology";
import { apiSince, formatMaybeDate } from "../../lib/format";
import { SectionTitle } from "../shared";
import { OntologyEvidenceDrawer } from "./OntologyEvidenceDrawer";
import { OntologyOverview } from "./OntologyOverview";
import { OntologyToolbar } from "./OntologyToolbar";

export function OntologyPanel({ ontology }: { ontology: OntologyState }) {
  const { ontologyMode, ontologyStatus, ontologyEntities, selectedOntologyEvidence } = ontology;
  return (
    <div className="panel ontology-panel">
      <div className="panel-head">
        <SectionTitle icon={<Database size={19} />} title="Ontology Cockpit" />
        <button className="secondary" onClick={() => void ontology.refreshOntology()} disabled={ontologyStatus !== "idle"}>
          {ontologyStatus === "loading" ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
          <span>Refresh</span>
        </button>
      </div>
      <div className="ontology-mode-toggle" aria-label="Ontology mode">
        <button className={ontologyMode === "state" ? "selected" : ""} onClick={() => ontology.switchMode("state")}>
          State
        </button>
        <button className={ontologyMode === "changed" ? "selected" : ""} onClick={() => ontology.switchMode("changed")}>
          Changed
        </button>
      </div>
      <OntologyToolbar ontology={ontology} />
      <OntologyOverview ontology={ontology} />
      <div className="brain-results">
        {ontologyEntities.length === 0 ? (
          <div className="empty">No ontology entities returned for this filter.</div>
        ) : (
          ontologyEntities.map((entity) => (
            <button
              className={`brain-result ontology-result ${selectedOntologyEvidence?.stableKey === entity.stableKey ? "selected" : ""}`}
              key={entity.stableKey}
              onClick={() => void ontology.loadOntologyEvidence(entity.stableKey)}
            >
              <span className="pill meeting">{ontologyMode === "changed" ? entity.type.replace("_", " ") : `${entity.sourceMeetingIds.length} notes`}</span>
              <div>
                <strong>{entity.name}</strong>
                <p>{entity.updatedAt ? `${entity.stableKey} | ${formatMaybeDate(entity.updatedAt)}` : entity.stableKey}</p>
              </div>
            </button>
          ))
        )}
      </div>
      <div className="subtle">
        {ontologyMode === "changed"
          ? `${ontology.ontologyCount} changed entities since ${formatMaybeDate(apiSince(ontology.ontologySince))}`
          : `${ontology.ontologyCount} total matches across ${ontology.ontologySummary?.changeSetCount ?? 0} indexed change sets`}
      </div>
      {selectedOntologyEvidence ? <OntologyEvidenceDrawer evidence={selectedOntologyEvidence} /> : null}
    </div>
  );
}
