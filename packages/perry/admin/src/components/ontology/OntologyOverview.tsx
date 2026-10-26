// components/ontology/OntologyOverview — ontology health banner and per-type counts;
// clicking a count switches to state mode for that type.
import type { OntologyState } from "../../hooks/useOntology";
import type { OntologyType } from "../../types";

/** Health banner plus the per-type count buttons. */
export function OntologyOverview({ ontology }: { ontology: OntologyState }) {
  const { ontologyHealth, ontologySummary, ontologyType } = ontology;
  return (
    <>
      {ontologyHealth ? (
        <div className={`ontology-health ${ontologyHealth.ok ? "ok" : "critical"}`}>
          <div>
            <strong>{ontologyHealth.ok ? "Ontology health passing" : "Ontology health needs repair"}</strong>
            <p>
              {ontologyHealth.counts.materializedEntities} entities, {ontologyHealth.counts.materializedRelations} relations, {ontologyHealth.counts.materializedEvidence} evidence rows
            </p>
          </div>
          <span className={`pill ${ontologyHealth.ok ? "valid" : "invalid"}`}>
            {ontologyHealth.checks.filter((item) => !item.passed).length} issues
          </span>
        </div>
      ) : null}
      <div className="ontology-counts">
        {ontologySummary
          ? Object.entries(ontologySummary.counts).map(([type, count]) => (
              <button
                className={`ontology-count ${ontologyType === type ? "selected" : ""}`}
                key={type}
                onClick={() => ontology.showType(type as OntologyType)}
              >
                <span>{type.replace("_", " ")}</span>
                <strong>{count}</strong>
              </button>
            ))
          : null}
      </div>
    </>
  );
}
