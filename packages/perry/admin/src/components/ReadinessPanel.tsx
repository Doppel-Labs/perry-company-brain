// components/ReadinessPanel — the diagnostics checklist; Refresh reloads all operational data.
import { ClipboardList, RefreshCw } from "lucide-react";
import type { Diagnostics } from "../types";
import { SectionTitle } from "./shared";

export function ReadinessPanel({ diagnostics, onRefresh }: { diagnostics: Diagnostics | null; onRefresh: () => void }) {
  return (
    <div className="panel readiness-panel">
      <div className="panel-head">
        <SectionTitle icon={<ClipboardList size={19} />} title="Readiness" />
        <button className="secondary" onClick={onRefresh}>
          <RefreshCw size={17} />
          <span>Refresh</span>
        </button>
      </div>
      <div className="checklist">
        {diagnostics?.checks.map((check) => (
          <div className={`check ${check.status}`} key={check.id}>
            <span className="dot" />
            <div>
              <strong>{check.label}</strong>
              <p>{check.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
