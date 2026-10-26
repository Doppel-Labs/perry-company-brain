// multiplayer-projection — derives issues, pivots and users from meeting knowledge.
//
// Reads stored decisions and action items from SQLite (not the Graphiti graph)
// and upserts the multiplayer tables. Ids are derived from the source rows
// (`issue:<actionId>`, `pivot:<decisionId>`), so re-running updates rather
// than duplicates.
//
// Closing rule: people own an issue's status once it exists, so re-projection
// never overwrites it, with one exception. When the source action item is done
// (or won't-do), its issue is closed to `done` (or `canceled`), unless someone
// has changed the issue's status by hand (a `status_changed` event by any actor
// other than the projection). Owner, priority or text edits do not block the
// close; a hand-set status always wins. The projection never reopens an issue.
import { parseOwnershipDecision } from "@brain";
import {
  listActionItems,
  listDecisions,
  listIssueEvents,
  listIssues,
  listPivots,
  listUsers,
  upsertIssue,
  updateIssue,
  upsertPivot,
  upsertUser,
  type ActionItemRecord,
  type DecisionRecord,
  type IssueRecord,
  type PivotRecord,
  type UserRecord,
} from "@store";
import { inferProjectFromText as inferProject } from "./change-set-helpers";

/** The actor recorded on issue events the projection itself writes. */
export const MULTIPLAYER_PROJECTION_ACTOR = "perry:projection";

export interface MultiplayerProjectionResult {
  users: UserRecord[];
  issues: IssueRecord[];
  pivots: PivotRecord[];
  createdOrUpdated: {
    users: number;
    issues: number;
    pivots: number;
  };
}

/** Projects from the most recent `limit` decisions and action items in the store. */
export function projectMultiplayerState(limit = 10_000): MultiplayerProjectionResult {
  return projectMultiplayerStateFromRecords({
    decisions: listDecisions(limit),
    actions: listActionItems(limit),
  });
}

/**
 * Upserts one issue per action item and one pivot per ownership decision, plus a
 * user for every owner and fallback reviewer. Status, priority and owner are
 * set only when an issue is created; existing issues keep their values, except
 * that a done or won't-do action closes its issue under the closing rule above. Pivots
 * are processed oldest first and list up to 20 open issues in the same project.
 * Returns the full user, issue and pivot tables (up to 10,000 each) and counts.
 */
export function projectMultiplayerStateFromRecords(input: {
  decisions: DecisionRecord[];
  actions: ActionItemRecord[];
}): MultiplayerProjectionResult {
  const users = new Map<string, UserRecord>();
  let issueCount = 0;
  let pivotCount = 0;

  for (const action of input.actions) {
    if (action.owner) {
      const user = upsertUser({ displayName: action.owner });
      users.set(user.id, user);
    }
    const projectedStatus = issueStatusFor(action);
    const upserted = upsertIssue({
      id: `issue:${action.id}`,
      project: inferProject(action.text),
      title: action.text,
      status: projectedStatus,
      priority: inferPriority(action.text),
      owner: action.owner,
      sourceMeetingId: action.meetingId,
      sourceActionId: action.id,
      dueDate: action.dueDate,
      preserveMutableFields: true,
    });
    const issue = closeIfSourceClosed(upserted, projectedStatus);
    issueCount += 1;
    if (issue.owner) {
      const user = upsertUser({ displayName: issue.owner });
      users.set(user.id, user);
    }
  }

  for (const decision of [...input.decisions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const ownership = parseOwnershipDecision(decision);
    if (!ownership) continue;
    const owner = upsertUser({ displayName: ownership.owner });
    users.set(owner.id, owner);
    if (ownership.fallbackReviewer) {
      const fallback = upsertUser({ displayName: ownership.fallbackReviewer });
      users.set(fallback.id, fallback);
    }
    const relatedIssues = listIssues({ project: inferProject(ownership.subject), status: "open", limit: 20 }).map(
      (issue) => issue.id
    );
    upsertPivot({
      id: `pivot:${decision.id}`,
      project: inferProject(ownership.subject),
      subject: ownership.subject,
      previousOwner: ownership.previousOwner,
      newOwner: ownership.owner,
      fallbackReviewer: ownership.fallbackReviewer,
      reason: decision.text,
      sourceDecisionId: decision.id,
      sourceMeetingId: decision.meetingId,
      affectedIssueIds: relatedIssues,
      createdAt: decision.createdAt,
    });
    pivotCount += 1;
  }

  return {
    users: listUsers({ limit: 10_000 }),
    issues: listIssues({ limit: 10_000 }),
    pivots: listPivots({ limit: 10_000 }),
    createdOrUpdated: {
      users: users.size,
      issues: issueCount,
      pivots: pivotCount,
    },
  };
}

function issueStatusFor(action: ActionItemRecord): IssueRecord["status"] {
  if (action.status === "done") return "done";
  if (action.status === "wont-do") return "canceled";
  return "open";
}

// Applies the closing rule: a terminal projected status closes the issue unless
// a person has set its status by hand. Logged as a status_changed event by the projection.
function closeIfSourceClosed(issue: IssueRecord, projectedStatus: IssueRecord["status"]): IssueRecord {
  if (projectedStatus !== "done" && projectedStatus !== "canceled") return issue;
  if (issue.status === projectedStatus) return issue;
  const manuallySet = listIssueEvents(issue.id, { limit: 1000 }).some(
    (event) => event.type === "status_changed" && event.actor !== MULTIPLAYER_PROJECTION_ACTOR
  );
  if (manuallySet) return issue;
  return updateIssue({ id: issue.id, status: projectedStatus, actor: MULTIPLAYER_PROJECTION_ACTOR }) ?? issue;
}

// Keyword heuristic over the action text.
function inferPriority(text: string): IssueRecord["priority"] {
  if (/\burgent|asap|blocker|blocked\b/iu.test(text)) return "urgent";
  if (/\bhigh priority|customer|launch\b/iu.test(text)) return "high";
  return "normal";
}
