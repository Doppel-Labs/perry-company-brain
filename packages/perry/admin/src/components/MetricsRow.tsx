// components/MetricsRow — the summary tiles under the top bar: readiness, Notion token,
// Granola mode, Graphiti, active roster, and open issues.
import { Bot, ClipboardList, Database, Users, Webhook } from "lucide-react";
import type { AppSettings, ConfigResponse, Diagnostics } from "../types";
import { Metric } from "./shared";

export function MetricsRow({
  diagnostics,
  secrets,
  settings,
  graphMemory,
  activeRosterCount,
  openIssueCount,
}: {
  diagnostics: Diagnostics | null;
  secrets: Record<string, boolean>;
  settings: AppSettings;
  graphMemory: ConfigResponse["graphMemory"] | null;
  activeRosterCount: number;
  openIssueCount: number;
}) {
  return (
    <section className="metrics">
      <Metric icon={<Bot size={20} />} label="Readiness" value={diagnostics?.ready ? "Ready" : "Needs setup"} />
      <Metric icon={<Database size={20} />} label="Notion" value={secrets.notionToken ? "Token set" : "Token missing"} />
      <Metric icon={<Webhook size={20} />} label="Granola" value={settings.granola.mode} />
      <Metric icon={<Database size={20} />} label="Graphiti" value={graphMemory?.enabled ? graphMemory.groupId : "Off"} />
      <Metric icon={<Users size={20} />} label="Roster" value={`${activeRosterCount} active`} />
      <Metric icon={<ClipboardList size={20} />} label="Issues" value={`${openIssueCount} open`} />
    </section>
  );
}
