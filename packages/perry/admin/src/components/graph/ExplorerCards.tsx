// components/graph/ExplorerCards — the read-side cards of the Graph Memory panel,
// all driven by `useGraphExplorer`.
import { RefreshCw } from "lucide-react";
import type { GraphExplorerState } from "../../hooks/useGraphExplorer";
import { formatMaybeDate } from "../../lib/format";
import { graphEndpointLabel, graphFactLabel, graphRetirementLabel, graphTimelineLabel } from "../../lib/graphLabels";

/** Entity search; clicking a hit selects it and loads its context and timeline. */
export function TypedEntitiesCard({ graph }: { graph: GraphExplorerState }) {
  const { graphEntities, selectedGraphEntityKey } = graph;
  return (
    <div className="graph-card">
      <div className="card-head">
        <strong>Typed Entities</strong>
        <span className="subtle">{graphEntities.length} hits</span>
      </div>
      <div className="search-row compact">
        <input
          aria-label="Search graph entities"
          placeholder="project:wallace, Ada, decision"
          value={graph.graphEntityQuery}
          onChange={(event) => graph.setGraphEntityQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void graph.searchGraphEntities();
          }}
        />
        <button className="secondary" onClick={graph.searchGraphEntities}>
          <RefreshCw size={17} />
          <span>Find</span>
        </button>
      </div>
      <div className="entity-list">
        {graphEntities.length === 0 ? (
          <div className="empty">Search entities to inspect their bounded context.</div>
        ) : (
          graphEntities.map((entity) => (
            <button
              className={`entity-button ${selectedGraphEntityKey === entity.stableKey ? "selected" : ""}`}
              key={entity.stableKey}
              onClick={() => graph.selectGraphEntity(entity.stableKey)}
            >
              <span>{graphEndpointLabel(entity)}</span>
              <small>{entity.stableKey}</small>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function ActiveFactsCard({ graph }: { graph: GraphExplorerState }) {
  const { graphFacts } = graph;
  return (
    <div className="graph-card">
      <div className="card-head">
        <strong>Active Facts</strong>
        <span className="subtle">{graphFacts.length} recent</span>
      </div>
      <div className="graph-list">
        {graphFacts.length === 0 ? (
          <div className="empty">No active graph facts returned yet.</div>
        ) : (
          graphFacts.map((row, index) => (
            <div className="graph-fact" key={`${row.fact?.factKey ?? "fact"}-${index}`}>
              <strong>{graphFactLabel(row)}</strong>
              <p>{row.evidence?.excerpt ?? row.evidence?.title ?? "No evidence excerpt attached."}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Current facts and retirements for the selected entity. */
export function EntityContextCard({ graph }: { graph: GraphExplorerState }) {
  const { graphEntityContext, selectedGraphEntityKey } = graph;
  return (
    <div className="graph-card span-two">
      <div className="card-head">
        <strong>Entity Context</strong>
        <span className="subtle">{graphEntityContext?.entity?.stableKey ?? (selectedGraphEntityKey || "none selected")}</span>
      </div>
      {graphEntityContext?.entity ? (
        <div className="context-head">
          <div>
            <strong>{graphEndpointLabel(graphEntityContext.entity)}</strong>
            <p>{graphEntityContext.entity.aliases?.slice(0, 4).join(", ") || graphEntityContext.entity.type || "Entity"}</p>
          </div>
          <span className="pill meeting">{graphEntityContext.facts.length} facts</span>
        </div>
      ) : (
        <div className="empty">Select an entity to inspect facts, retirements, and evidence.</div>
      )}
      <div className="context-grid">
        <div>
          <strong className="mini-title">Current Facts</strong>
          <div className="graph-list">
            {graphEntityContext?.facts.length ? (
              graphEntityContext.facts.map((row, index) => (
                <div className="graph-fact" key={`${row.fact?.factKey ?? "context"}-${index}`}>
                  <strong>{graphFactLabel(row)}</strong>
                  <p>{row.evidence?.excerpt ?? row.evidence?.title ?? "No evidence excerpt attached."}</p>
                </div>
              ))
            ) : (
              <div className="empty">No current facts for this entity.</div>
            )}
          </div>
        </div>
        <div>
          <strong className="mini-title">Retirements</strong>
          <div className="graph-list">
            {graphEntityContext?.retirements.length ? (
              graphEntityContext.retirements.map((row, index) => (
                <div className="graph-fact" key={`${row.retirement?.evidenceId ?? "retired"}-${index}`}>
                  <strong>{graphRetirementLabel(row)}</strong>
                  <p>{row.retirement?.reason ?? row.evidence?.excerpt ?? "No retirement reason attached."}</p>
                </div>
              ))
            ) : (
              <div className="empty">No retired facts for this entity.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Fact and retirement events for the selected entity. */
export function TimelineCard({ graph }: { graph: GraphExplorerState }) {
  const { graphTimeline } = graph;
  return (
    <div className="graph-card">
      <div className="card-head">
        <strong>Timeline</strong>
        <span className="subtle">{graphTimeline?.events.length ?? 0} events</span>
      </div>
      <div className="timeline-list">
        {graphTimeline?.events.length ? (
          graphTimeline.events.map((event, index) => (
            <div className="timeline-item" key={`${event.type}-${index}`}>
              <span className={`pill ${event.type === "fact" ? "applied" : "failed"}`}>{event.type}</span>
              <div>
                <strong>{graphTimelineLabel(event)}</strong>
                <p>{formatMaybeDate(event.at)}</p>
              </div>
            </div>
          ))
        ) : (
          <div className="empty">No entity timeline selected yet.</div>
        )}
      </div>
    </div>
  );
}

/** Free-text semantic search over graph memory. */
export function SemanticSearchCard({ graph }: { graph: GraphExplorerState }) {
  const { graphResults } = graph;
  return (
    <div className="graph-card span-two">
      <div className="card-head">
        <strong>Semantic Search</strong>
        <span className="subtle">{graphResults.length} results</span>
      </div>
      <div className="search-row">
        <input
          aria-label="Search graph memory"
          placeholder="Ask about relationships, ownership, project history"
          value={graph.graphQuery}
          onChange={(event) => graph.setGraphQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void graph.searchGraph();
          }}
        />
        <button className="secondary" onClick={graph.searchGraph}>
          <RefreshCw size={17} />
          <span>Search Graph</span>
        </button>
      </div>
      <div className="brain-results">
        {graphResults.length === 0 ? (
          <div className="empty">Graph search results will appear here.</div>
        ) : (
          graphResults.map((result, index) => (
            <div className="brain-result" key={result.uuid ?? String(index)}>
              <span className="pill meeting">{result.score?.toFixed(2) ?? "graph"}</span>
              <div>
                <strong>{result.name ?? result.fact ?? "Graph fact"}</strong>
                <p>{result.fact ?? JSON.stringify(result.raw)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
