// components/MeetingHistory — the 8 most recent processed meeting notes and their status.
import { FileText } from "lucide-react";
import type { MeetingRecord } from "../types";
import { SectionTitle } from "./shared";

export function MeetingHistory({ history }: { history: MeetingRecord[] }) {
  return (
    <section className="panel history-panel">
      <div className="panel-head">
        <SectionTitle icon={<FileText size={19} />} title="Meeting History" />
        <span className="subtle">{history.length} records</span>
      </div>
      <div className="history-list">
        {history.length === 0 ? (
          <div className="empty">No processed meeting notes yet.</div>
        ) : (
          history.slice(0, 8).map((record) => (
            <div className="history-item" key={record.id}>
              <div>
                <strong>{record.title}</strong>
                <p>{new Date(record.createdAt).toLocaleString()}</p>
              </div>
              <span className={`pill ${record.status}`}>{record.status}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
