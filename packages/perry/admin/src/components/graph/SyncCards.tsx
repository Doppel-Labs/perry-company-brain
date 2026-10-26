// components/graph/SyncCards — the write-side cards of the Graph Memory panel, driven
// by `useGraphSync`.
import { Loader2, RefreshCw } from "lucide-react";
import type { GraphSyncState } from "../../hooks/useGraphSync";
import { formatMaybeDate, shortKey } from "../../lib/format";
import { graphDiffRelationLabel } from "../../lib/graphLabels";
import type { GraphReplayDiff } from "../../types";

/** Recent change sets with their validation and apply status; Replay re-applies one (server write). */
export function ChangeSetsCard({ sync }: { sync: GraphSyncState }) {
  const { graphChangeSets, replayingGraphChangeSetId } = sync;
  return (
    <div className="graph-card span-two">
      <div className="card-head">
        <strong>Recent Change Sets</strong>
        <span className="subtle">{graphChangeSets.length} loaded</span>
      </div>
      <div className="graph-list">
        {graphChangeSets.length === 0 ? (
          <div className="empty">No validated graph change sets yet.</div>
        ) : (
          graphChangeSets.map((changeSet) => (
            <div className="graph-row" key={changeSet.id}>
              <div>
                <strong>{shortKey(changeSet.meetingId)}</strong>
                <p>
                  {changeSet.validationErrorCount} errors | {changeSet.validationWarningCount} warnings |{" "}
                  {formatMaybeDate(changeSet.appliedAt ?? changeSet.updatedAt)}
                </p>
                {changeSet.lastError ? <p className="danger-text">{changeSet.lastError}</p> : null}
              </div>
              <div className="pill-stack">
                <span className={`pill ${changeSet.applyStatus}`}>{changeSet.applyStatus}</span>
                <span className={`pill ${changeSet.validationStatus}`}>{changeSet.validationStatus}</span>
                <button
                  className="mini-button"
                  onClick={() => sync.replayGraphChangeSet(changeSet.id)}
                  disabled={Boolean(replayingGraphChangeSetId)}
                >
                  {replayingGraphChangeSetId === changeSet.id ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
                  <span>Replay</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** What the last replay expected versus what graph readback was missing. */
export function ReplayDiffCard({ diff }: { diff: GraphReplayDiff | null }) {
  return (
    <div className="graph-card">
      <div className="card-head">
        <strong>Last Replay Diff</strong>
        <span className={`pill ${diff ? (diff.passed ? "applied" : "unverified") : "queued"}`}>
          {diff ? (diff.passed ? "passed" : "review") : "none"}
        </span>
      </div>
      {diff ? (
        <div className="graph-list">
          <div className="graph-fact">
            <strong>
              {diff.expected.entities} entities | {diff.expected.relations} relations | {diff.expected.evidence} evidence
            </strong>
            <p>{formatMaybeDate(diff.checkedAt)}</p>
          </div>
          {diff.missing.entities.length ||
          diff.missing.relations.length ||
          diff.missing.retirements.length ||
          diff.missing.evidence.length ? (
            <div className="graph-fact diff-detail">
              <strong>Missing readback</strong>
              {diff.missing.entities.length ? <p>Entities: {diff.missing.entities.join(", ")}</p> : null}
              {diff.missing.relations.length ? (
                <p>Relations: {diff.missing.relations.map(graphDiffRelationLabel).join(" | ")}</p>
              ) : null}
              {diff.missing.retirements.length ? (
                <p>Retirements: {diff.missing.retirements.map(graphDiffRelationLabel).join(" | ")}</p>
              ) : null}
              {diff.missing.evidence.length ? <p>Evidence: {diff.missing.evidence.join(", ")}</p> : null}
            </div>
          ) : null}
          {diff.errors.length ? (
            <div className="graph-fact diff-detail">
              <strong>Read errors</strong>
              <p>{diff.errors.join(" | ")}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty">Replay a change set to verify graph readback.</div>
      )}
    </div>
  );
}

/** The most recent graph sync jobs and their status. */
export function SyncJobsCard({ sync }: { sync: GraphSyncState }) {
  const { graphSyncQueue } = sync;
  return (
    <div className="graph-card">
      <div className="card-head">
        <strong>Sync Jobs</strong>
        <span className="subtle">{graphSyncQueue?.recent.length ?? 0} recent</span>
      </div>
      <div className="history-list">
        {graphSyncQueue?.recent.length ? (
          graphSyncQueue.recent.map((job) => (
            <div className="knowledge-item" key={job.id}>
              <div>
                <strong>{job.entityId}</strong>
                <p>{job.lastError ?? new Date(job.updatedAt).toLocaleString()}</p>
              </div>
              <span className={`pill ${job.status}`}>{job.status}</span>
            </div>
          ))
        ) : (
          <div className="empty">No graph sync jobs yet.</div>
        )}
      </div>
    </div>
  );
}
