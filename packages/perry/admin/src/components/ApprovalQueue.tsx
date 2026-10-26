// components/ApprovalQueue — pending meeting announcements awaiting review, each
// with Approve and Reject buttons (server writes via `onAct`).
import { ClipboardList, Send, Trash2 } from "lucide-react";
import type { ApprovalRecord } from "../types";
import { SectionTitle } from "./shared";

export function ApprovalQueue({
  approvals,
  onAct,
}: {
  approvals: ApprovalRecord[];
  onAct: (id: string, action: "approve" | "reject") => Promise<void>;
}) {
  return (
    <section className="panel approvals-panel">
      <div className="panel-head">
        <SectionTitle icon={<ClipboardList size={19} />} title="Approval Queue" />
        <span className="subtle">{approvals.length} pending</span>
      </div>
      <div className="approval-list">
        {approvals.length === 0 ? (
          <div className="empty">Incoming notes that need review will appear here.</div>
        ) : (
          approvals.map((approval) => {
            return (
              <div className="approval-item" key={approval.id}>
                <div className="approval-copy">
                  <strong>{approval.title}</strong>
                  <p>{approval.routeReason ?? approval.routeProject ?? "Default route"}</p>
                  <p>
                    {approval.decisionCount} decisions · {approval.actionItemCount} actions
                  </p>
                </div>
                <div className="button-row">
                  <button className="secondary" onClick={() => void onAct(approval.id, "reject")}>
                    <Trash2 size={17} />
                    <span>Reject</span>
                  </button>
                  <button className="primary" onClick={() => void onAct(approval.id, "approve")}>
                    <Send size={17} />
                    <span>Approve</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
