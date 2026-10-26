// hooks/useAdminData — the root hook: composes every domain hook and runs the initial
// load, the post-mutation refresh, and config save.
import { useEffect, useState } from "react";
import { allInOrder, optional } from "../api/client";
import { fetchConfig, fetchDiagnostics, saveConfig as putConfig } from "../api/config";
import { fetchActiveGraphFacts, fetchGraphChangeSets, fetchGraphSyncJobs, searchGraphEntities } from "../api/graph";
import { fetchGranolaSample } from "../api/granola";
import { fetchOpenIssues } from "../api/issues";
import {
  fetchActionItems,
  fetchDecisions,
  fetchMeetingHistory,
  fetchPendingApprovals,
  fetchPivots,
  fetchUsers,
} from "../api/operations";
import { errorMessage, reportErrors } from "../lib/errors";
import { useBrainSearch } from "./useBrainSearch";
import { useConfig } from "./useConfig";
import { useGranolaTestBench } from "./useGranolaTestBench";
import { useGraphExplorer } from "./useGraphExplorer";
import { useGraphSync } from "./useGraphSync";
import { useIssues } from "./useIssues";
import { useOntology } from "./useOntology";
import { useOperations } from "./useOperations";

/**
 * Composes the per-domain hooks and owns the cross-domain flows: the initial load,
 * the post-mutation refresh, and saving the config.
 */
export function useAdminData() {
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState("");
  // `refreshOperations` is a hoisted function declaration, so each hook gets this render's closure.
  const deps = { setError, refresh: refreshOperations };
  const config = useConfig();
  const operations = useOperations(deps);
  const issues = useIssues(deps);
  const graphSync = useGraphSync(deps);
  const graph = useGraphExplorer(deps);
  const ontology = useOntology(deps);
  const brain = useBrainSearch(deps);
  const granola = useGranolaTestBench(deps);

  useEffect(() => {
    void loadEverything();
  }, []);

  /**
   * The initial load, also run by ConnectScreen's Connect. All-or-nothing via
   * `allInOrder`: any failure sets `error` and status "error" (which shows the token
   * prompt), and no panel state is written. Ontology loads separately, best-effort.
   */
  async function loadEverything() {
    setStatus("loading");
    setError("");
    try {
      const [
        configPayload,
        diagnostics,
        history,
        decisions,
        actionItems,
        approvals,
        users,
        loadedIssues,
        pivots,
        graphSyncQueue,
        graphChangeSets,
        graphEntities,
        graphFacts,
        sample,
      ] = await allInOrder([
        fetchConfig(),
        fetchDiagnostics(),
        fetchMeetingHistory(),
        fetchDecisions(),
        fetchActionItems(),
        fetchPendingApprovals(),
        fetchUsers(),
        fetchOpenIssues(),
        fetchPivots(),
        fetchGraphSyncJobs(),
        fetchGraphChangeSets(),
        searchGraphEntities("wallace", 8, "Graph entities load"),
        fetchActiveGraphFacts(),
        fetchGranolaSample(),
      ]);
      config.setSettings(configPayload.settings);
      config.setSecrets(configPayload.secrets);
      config.setGraphMemory(configPayload.graphMemory);
      config.setConfigPath(configPayload.configPath);
      operations.setDiagnostics(diagnostics);
      operations.setHistory(history);
      operations.setDecisions(decisions);
      operations.setActionItems(actionItems);
      operations.setApprovals(approvals);
      operations.setUsers(users);
      // With no selection the first issue is shown, and useIssues loads its events.
      issues.setIssues(loadedIssues);
      operations.setPivots(pivots);
      graphSync.setGraphSyncQueue(graphSyncQueue);
      graphSync.setGraphChangeSets(graphChangeSets);
      graph.setGraphEntities(graphEntities.entities);
      graph.setGraphFacts(graphFacts);
      if (graphEntities.entities.length > 0) {
        graph.setSelectedGraphEntityKey(graphEntities.entities[0].stableKey);
        void graph.refreshGraphEntityContext(graphEntities.entities[0].stableKey);
      }
      granola.setSamplePayload(JSON.stringify(sample, null, 2));
      void ontology.refreshOntology();
      setStatus("idle");
    } catch (err) {
      setError(errorMessage(err, "Config load failed"));
      setStatus("error");
    }
  }

  /** Server write: PUT the edited settings, then refresh. On failure sets `error` and status "error". */
  async function saveConfig() {
    if (!config.settings) return;
    setStatus("saving");
    setError("");
    try {
      const payload = await putConfig(config.settings);
      config.setSettings(payload.settings);
      config.setConfigPath(payload.configPath);
      await refreshOperations();
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1600);
    } catch (err) {
      setError(errorMessage(err, "Save failed"));
      setStatus("error");
    }
  }

  /**
   * Best-effort reload: a failing endpoint leaves its panel's previous data in place.
   * The hooks that write (operations, issues, graph sync, Granola test bench) receive it
   * as `deps.refresh` and await it after a successful server write; saveConfig does too.
   * It re-runs the initial reads through `optional`, then reloads the selected issue's
   * events, the selected entity's context, and the ontology. A network error rejects,
   * which those callers report; the Readiness button uses `refreshFromUi` instead.
   */
  async function refreshOperations() {
    const [
      diagnostics,
      history,
      decisions,
      actionItems,
      approvals,
      users,
      loadedIssues,
      pivots,
      graphSyncQueue,
      graphChangeSets,
      graphEntities,
      graphFacts,
    ] = await Promise.all([
      optional(fetchDiagnostics()),
      optional(fetchMeetingHistory()),
      optional(fetchDecisions()),
      optional(fetchActionItems()),
      optional(fetchPendingApprovals()),
      optional(fetchUsers()),
      optional(fetchOpenIssues()),
      optional(fetchPivots()),
      optional(fetchGraphSyncJobs()),
      optional(fetchGraphChangeSets()),
      optional(searchGraphEntities(graph.graphEntityQuery, 8, "Graph entities load")),
      optional(fetchActiveGraphFacts()),
    ]);
    if (diagnostics) operations.setDiagnostics(diagnostics);
    if (history) operations.setHistory(history);
    if (decisions) operations.setDecisions(decisions);
    if (actionItems) operations.setActionItems(actionItems);
    if (approvals) operations.setApprovals(approvals);
    if (users) operations.setUsers(users);
    if (loadedIssues) issues.setIssues(loadedIssues);
    if (pivots) operations.setPivots(pivots);
    if (graphSyncQueue) graphSync.setGraphSyncQueue(graphSyncQueue);
    if (graphChangeSets) graphSync.setGraphChangeSets(graphChangeSets);
    if (graphEntities) graph.setGraphEntities(graphEntities.entities);
    if (graphFacts) graph.setGraphFacts(graphFacts);
    issues.reloadIssueEvents();
    if (graph.selectedGraphEntityKey) await graph.refreshGraphEntityContext(graph.selectedGraphEntityKey);
    void ontology.refreshOntology();
  }

  /** `refreshOperations` for a UI button: never rejects, a failure goes to the error banner. */
  function refreshFromUi() {
    setError("");
    return reportErrors(refreshOperations, setError, "Refresh failed");
  }

  return {
    status,
    error,
    config,
    operations,
    issues,
    graphSync,
    graph,
    ontology,
    brain,
    granola,
    loadEverything,
    saveConfig,
    refreshOperations,
    refreshFromUi,
  };
}

export type AdminData = ReturnType<typeof useAdminData>;
