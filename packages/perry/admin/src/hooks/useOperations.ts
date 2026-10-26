// hooks/useOperations — diagnostics, meeting history, decisions, action items,
// approvals, users, and pivots, plus the approval action.
import { useState } from "react";
import { actOnApproval as postApprovalAction } from "../api/operations";
import { reportErrors } from "../lib/errors";
import type { ActionItemRecord, ApprovalRecord, DecisionRecord, Diagnostics, MeetingRecord, PivotRecord, UserRecord } from "../types";
import type { HookDeps } from "./types";

/** Read-mostly operational data: readiness, meeting history, extracted knowledge, approvals, people. */
export function useOperations({ setError, refresh }: HookDeps) {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [history, setHistory] = useState<MeetingRecord[]>([]);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [actionItems, setActionItems] = useState<ActionItemRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [pivots, setPivots] = useState<PivotRecord[]>([]);

  // Server write followed by a refresh. Any failure (non-OK response, network error, or a
  // failed refresh) is reported via `setError`, never rejected; a failed write skips the refresh.
  function actOnApproval(id: string, action: "approve" | "reject") {
    setError("");
    return reportErrors(
      async () => {
        await postApprovalAction(id, action);
        await refresh();
      },
      setError,
      "Approval action failed"
    );
  }

  return {
    diagnostics,
    setDiagnostics,
    history,
    setHistory,
    decisions,
    setDecisions,
    actionItems,
    setActionItems,
    approvals,
    setApprovals,
    users,
    setUsers,
    pivots,
    setPivots,
    actOnApproval,
  };
}

export type OperationsState = ReturnType<typeof useOperations>;
