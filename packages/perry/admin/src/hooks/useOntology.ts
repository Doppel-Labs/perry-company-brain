// hooks/useOntology — Ontology Cockpit state: filters, mode, results, summary, health,
// and the selected entity's evidence.
import { useState } from "react";
import { optional, orReportError } from "../api/client";
import * as ontologyApi from "../api/ontology";
import type { OntologyMode } from "../api/ontology";
import { reportErrors } from "../lib/errors";
import { defaultSinceInput } from "../lib/format";
import type { OntologyEntityRecord, OntologyEvidenceResponse, OntologyHealthResponse, OntologySummaryResponse, OntologyType } from "../types";
import type { HookDeps } from "./types";

/**
 * Reads only. Refresh is best-effort and silent on non-OK responses; evidence loads report
 * non-OK responses via `setError`. Network errors from either are reported via `setError`
 * and `ontologyStatus` always returns to "idle", so neither action ever rejects.
 */
export function useOntology({ setError }: Pick<HookDeps, "setError">) {
  const [ontologySummary, setOntologySummary] = useState<OntologySummaryResponse["summary"] | null>(null);
  const [ontologyHealth, setOntologyHealth] = useState<OntologyHealthResponse | null>(null);
  const [ontologyType, setOntologyType] = useState<OntologyType>("risk");
  const [ontologyProject, setOntologyProject] = useState("Wallace");
  const [ontologyMode, setOntologyMode] = useState<OntologyMode>("state");
  const [ontologyQuery, setOntologyQuery] = useState("");
  const [ontologySince, setOntologySince] = useState(() => defaultSinceInput());
  const [ontologyEntities, setOntologyEntities] = useState<OntologyEntityRecord[]>([]);
  const [ontologyCount, setOntologyCount] = useState(0);
  const [selectedOntologyEvidence, setSelectedOntologyEvidence] = useState<OntologyEvidenceResponse | null>(null);
  const [ontologyStatus, setOntologyStatus] = useState<"idle" | "loading" | "evidence">("idle");

  // Parameters override the current filters, so callers can reload with a value whose
  // setter has not re-rendered yet. Drops the evidence drawer if its entity left the results.
  function refreshOntology(
    nextType = ontologyType,
    nextProject = ontologyProject,
    nextMode = ontologyMode,
    nextQuery = ontologyQuery
  ) {
    return reportErrors(
      async () => {
        setOntologyStatus("loading");
        try {
          const filter = { mode: nextMode, type: nextType, project: nextProject, query: nextQuery, since: ontologySince };
          const [summary, queryResult, health] = await Promise.all([
            optional(ontologyApi.fetchOntologySummary()),
            optional(ontologyApi.queryOntology(filter)),
            optional(ontologyApi.fetchOntologyHealth()),
          ]);
          if (summary) setOntologySummary(summary);
          if (health) setOntologyHealth(health);
          if (queryResult) {
            setOntologyCount(queryResult.count);
            setOntologyEntities(queryResult.entities);
            if (selectedOntologyEvidence && !queryResult.entities.some((entity) => entity.stableKey === selectedOntologyEvidence.stableKey)) {
              setSelectedOntologyEvidence(null);
            }
          }
        } finally {
          setOntologyStatus("idle");
        }
      },
      setError,
      "Ontology load failed"
    );
  }

  /** Switch to state mode for `type` and reload. */
  function showType(type: OntologyType) {
    setOntologyType(type);
    setOntologyMode("state");
    void refreshOntology(type, ontologyProject, "state");
  }

  function switchMode(mode: OntologyMode) {
    setOntologyMode(mode);
    void refreshOntology(ontologyType, ontologyProject, mode);
  }

  function loadOntologyEvidence(stableKey: string) {
    return reportErrors(
      async () => {
        setOntologyStatus("evidence");
        try {
          const evidence = await orReportError(ontologyApi.fetchOntologyEvidence(stableKey), setError);
          if (evidence) setSelectedOntologyEvidence(evidence);
        } finally {
          setOntologyStatus("idle");
        }
      },
      setError,
      "Ontology evidence load failed"
    );
  }

  return {
    ontologySummary,
    ontologyHealth,
    ontologyType,
    ontologyProject,
    setOntologyProject,
    ontologyMode,
    ontologyQuery,
    setOntologyQuery,
    ontologySince,
    setOntologySince,
    ontologyEntities,
    ontologyCount,
    selectedOntologyEvidence,
    ontologyStatus,
    refreshOntology,
    showType,
    switchMode,
    loadOntologyEvidence,
  };
}

export type OntologyState = ReturnType<typeof useOntology>;
