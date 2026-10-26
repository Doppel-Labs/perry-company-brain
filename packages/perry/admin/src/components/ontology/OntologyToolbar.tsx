// components/ontology/OntologyToolbar — type, project, search, and (in changed mode)
// since filters. Changing type reloads at once; the text fields reload on Enter.
import type { OntologyState } from "../../hooks/useOntology";
import type { OntologyType } from "../../types";

export function OntologyToolbar({ ontology }: { ontology: OntologyState }) {
  const { ontologyType, ontologyProject, ontologyMode, ontologyQuery, refreshOntology } = ontology;
  return (
    <div className="ontology-toolbar">
      <label className="field compact-field">
        <span>Type</span>
        <select
          value={ontologyType}
          disabled={ontologyMode === "changed"}
          onChange={(event) => ontology.showType(event.target.value as OntologyType)}
        >
          <option value="goal">Goals</option>
          <option value="metric">Metrics</option>
          <option value="risk">Risks</option>
          <option value="blocker">Blockers</option>
          <option value="open_question">Open questions</option>
          <option value="capability">Capabilities</option>
          <option value="feature">Features</option>
          <option value="artifact">Artifacts</option>
          <option value="benchmark_report">Benchmarks</option>
        </select>
      </label>
      <label className="field compact-field">
        <span>Project</span>
        <input
          aria-label="Ontology project"
          value={ontologyProject}
          onChange={(event) => ontology.setOntologyProject(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void refreshOntology(ontologyType, ontologyProject, ontologyMode);
          }}
        />
      </label>
      <label className="field compact-field">
        <span>Search</span>
        <input
          aria-label="Ontology search"
          value={ontologyQuery}
          onChange={(event) => ontology.setOntologyQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void refreshOntology(ontologyType, ontologyProject, ontologyMode, ontologyQuery);
          }}
        />
      </label>
      {ontologyMode === "changed" ? (
        <label className="field compact-field">
          <span>Since</span>
          <input
            aria-label="Ontology changed since"
            type="datetime-local"
            value={ontology.ontologySince}
            onChange={(event) => ontology.setOntologySince(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void refreshOntology(ontologyType, ontologyProject, "changed");
            }}
          />
        </label>
      ) : null}
    </div>
  );
}
