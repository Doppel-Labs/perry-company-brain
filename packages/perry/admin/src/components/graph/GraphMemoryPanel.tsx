// components/graph/GraphMemoryPanel — graph memory status: queue metrics, Queue Backfill
// and Drain buttons (server writes), and the sync and explorer cards.
import { CheckCircle2, ClipboardList, Database, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { GraphExplorerState } from "../../hooks/useGraphExplorer";
import type { GraphSyncState } from "../../hooks/useGraphSync";
import type { ConfigResponse } from "../../types";
import { Metric, SectionTitle } from "../shared";
import { ActiveFactsCard, EntityContextCard, SemanticSearchCard, TimelineCard, TypedEntitiesCard } from "./ExplorerCards";
import { ChangeSetsCard, ReplayDiffCard, SyncJobsCard } from "./SyncCards";

export function GraphMemoryPanel({
  graphMemory,
  sync,
  graph,
}: {
  graphMemory: ConfigResponse["graphMemory"] | null;
  sync: GraphSyncState;
  graph: GraphExplorerState;
}) {
  const { graphSyncQueue, graphActionStatus } = sync;
  return (
    <section className="panel graph-panel">
      <div className="panel-head">
        <SectionTitle icon={<Database size={19} />} title="Graph Memory" />
        <span className="subtle">
          {graphMemory?.enabled ? `${graphMemory.groupId} enabled` : "disabled"}
        </span>
      </div>
      <div className="metrics">
        <Metric icon={<ClipboardList size={20} />} label="Queued" value={`${graphSyncQueue?.stats.queued ?? 0}`} />
        <Metric icon={<Loader2 size={20} />} label="Processing" value={`${graphSyncQueue?.stats.processing ?? 0}`} />
        <Metric icon={<CheckCircle2 size={20} />} label="Completed" value={`${graphSyncQueue?.stats.completed ?? 0}`} />
        <Metric icon={<Trash2 size={20} />} label="Failed" value={`${graphSyncQueue?.stats.failed ?? 0}`} />
      </div>
      <div className="button-row">
        <button className="secondary" onClick={sync.enqueueGraphBackfill} disabled={graphActionStatus !== "idle"}>
          {graphActionStatus === "backfilling" ? <Loader2 className="spin" size={17} /> : <Database size={17} />}
          <span>Queue Backfill</span>
        </button>
        <button className="secondary" onClick={sync.drainGraphSync} disabled={graphActionStatus !== "idle"}>
          {graphActionStatus === "draining" ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
          <span>Drain Graph Sync</span>
        </button>
      </div>

      <div className="graph-dashboard">
        <ChangeSetsCard sync={sync} />
        <TypedEntitiesCard graph={graph} />
        <ActiveFactsCard graph={graph} />
        <ReplayDiffCard diff={sync.lastGraphReplayDiff} />
        <EntityContextCard graph={graph} />
        <TimelineCard graph={graph} />
        <SemanticSearchCard graph={graph} />
        <SyncJobsCard sync={sync} />
      </div>
    </section>
  );
}
