// App — composition root. Owns no state itself: `useAdminData` holds every domain
// hook, and this file only lays out the panels and hands each one its slice.
import { ApprovalQueue } from "./components/ApprovalQueue";
import { BrainSearchPanel } from "./components/brain/BrainSearchPanel";
import { OpenActionItems, RecentDecisions } from "./components/brain/KnowledgePanels";
import { ConnectScreen } from "./components/ConnectScreen";
import { GranolaTestBench } from "./components/GranolaTestBench";
import { GraphMemoryPanel } from "./components/graph/GraphMemoryPanel";
import { MultiplayerPanel } from "./components/issues/MultiplayerPanel";
import { MeetingHistory } from "./components/MeetingHistory";
import { MetricsRow } from "./components/MetricsRow";
import { OntologyPanel } from "./components/ontology/OntologyPanel";
import { ReadinessPanel } from "./components/ReadinessPanel";
import { SecretsPanel } from "./components/SecretsPanel";
import { RosterPanel } from "./components/settings/RosterPanel";
import { RoutingRulesPanel } from "./components/settings/RoutingRulesPanel";
import { SettingsGrid } from "./components/settings/SettingsGrid";
import { TopBar } from "./components/TopBar";
import { useAdminData } from "./hooks/useAdminData";
import { useAdminToken } from "./hooks/useAdminToken";

export function App() {
  const { adminToken, setAdminToken } = useAdminToken();
  const admin = useAdminData();
  const { status, error, config, operations, issues } = admin;
  const { settings } = config;

  // Settings arrive only when the whole initial load succeeds, so until then show
  // the spinner, or the token prompt if the load failed.
  if (!settings) {
    return (
      <ConnectScreen
        failed={status === "error"}
        error={error}
        adminToken={adminToken}
        onTokenChange={setAdminToken}
        onConnect={() => void admin.loadEverything()}
      />
    );
  }

  return (
    <main className="shell">
      <TopBar adminToken={adminToken} onTokenChange={setAdminToken} saving={status === "saving"} onSave={admin.saveConfig} />

      {error ? <div className="alert">{error}</div> : null}
      {status === "saved" ? <div className="success">Saved to {config.configPath}</div> : null}

      <MetricsRow
        diagnostics={operations.diagnostics}
        secrets={config.secrets}
        settings={settings}
        graphMemory={config.graphMemory}
        activeRosterCount={config.activeRosterCount}
        openIssueCount={issues.openIssueCount}
      />

      <section className="ops-grid">
        <ReadinessPanel diagnostics={operations.diagnostics} onRefresh={() => void admin.refreshFromUi()} />
        <GranolaTestBench bench={admin.granola} />
      </section>

      <ApprovalQueue approvals={operations.approvals} onAct={operations.actOnApproval} />
      <MultiplayerPanel issues={issues} users={operations.users} pivots={operations.pivots} />
      <SettingsGrid settings={settings} update={config.update} />
      <RoutingRulesPanel settings={settings} config={config} />
      <RosterPanel settings={settings} config={config} />
      <MeetingHistory history={operations.history} />
      <GraphMemoryPanel graphMemory={config.graphMemory} sync={admin.graphSync} graph={admin.graph} />

      <section className="brain-grid">
        <OntologyPanel ontology={admin.ontology} />
        <BrainSearchPanel brain={admin.brain} />
        <RecentDecisions decisions={operations.decisions} />
        <OpenActionItems actionItems={operations.actionItems} />
      </section>

      <SecretsPanel secrets={config.secrets} />
    </main>
  );
}
