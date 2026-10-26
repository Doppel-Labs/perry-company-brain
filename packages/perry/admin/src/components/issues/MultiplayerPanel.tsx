// components/issues/MultiplayerPanel — the issue tracker (create, list, detail), the
// Project button that turns meetings into issues, and the ownership-pivot strip.
import { Loader2, RefreshCw, Users } from "lucide-react";
import type { IssuesState } from "../../hooks/useIssues";
import type { PivotRecord, UserRecord } from "../../types";
import { SectionTitle } from "../shared";
import { IssueCreateForm } from "./IssueCreateForm";
import { IssueDetail } from "./IssueDetail";
import { IssueList } from "./IssueList";

export function MultiplayerPanel({ issues, users, pivots }: { issues: IssuesState; users: UserRecord[]; pivots: PivotRecord[] }) {
  return (
    <section className="panel multiplayer-panel">
      <div className="panel-head">
        <SectionTitle icon={<Users size={19} />} title="Multiplayer Brain" />
        <div className="button-row">
          <span className="subtle">
            {users.length} users | {issues.issues.length} open issues | {pivots.length} pivots
          </span>
          <button className="secondary" onClick={() => void issues.projectMultiplayer()} disabled={issues.issueActionStatus !== "idle"}>
            {issues.issueActionStatus === "projecting" ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
            <span>Project</span>
          </button>
        </div>
      </div>
      <div className="multiplayer-grid">
        <IssueCreateForm issues={issues} users={users} />
        <IssueList issues={issues} />
        <IssueDetail issues={issues} users={users} />
      </div>
      <div className="pivot-strip">
        {pivots.length === 0 ? (
          <div className="empty">Ownership changes inferred from decisions will appear here.</div>
        ) : (
          pivots.map((pivot) => (
            <div className="pivot-item" key={pivot.id}>
              <strong>{pivot.subject}</strong>
              <p>{[pivot.previousOwner, pivot.newOwner].filter(Boolean).join(" -> ") || pivot.reason}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
