// components/brain/KnowledgePanels — read-only lists of recently extracted decisions
// and action items.
import { CheckCircle2, ClipboardList } from "lucide-react";
import type { ActionItemRecord, DecisionRecord } from "../../types";
import { SectionTitle } from "../shared";

export function RecentDecisions({ decisions }: { decisions: DecisionRecord[] }) {
  return (
    <div className="panel">
      <SectionTitle icon={<ClipboardList size={19} />} title="Recent Decisions" />
      <div className="history-list">
        {decisions.length === 0 ? (
          <div className="empty">No extracted decisions yet.</div>
        ) : (
          decisions.map((decision) => (
            <div className="knowledge-item" key={decision.id}>
              <strong>{decision.text}</strong>
              <span className={`pill ${decision.status}`}>{decision.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function OpenActionItems({ actionItems }: { actionItems: ActionItemRecord[] }) {
  return (
    <div className="panel">
      <SectionTitle icon={<CheckCircle2 size={19} />} title="Open Action Items" />
      <div className="history-list">
        {actionItems.length === 0 ? (
          <div className="empty">No extracted action items yet.</div>
        ) : (
          actionItems.map((action) => (
            <div className="knowledge-item" key={action.id}>
              <div>
                <strong>{action.text}</strong>
                <p>{[action.owner, action.dueDate].filter(Boolean).join(" · ")}</p>
              </div>
              <span className={`pill ${action.status}`}>{action.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
