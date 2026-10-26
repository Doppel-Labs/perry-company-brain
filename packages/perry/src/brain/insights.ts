// insights — who owns what: ownership parsed from decision text, and open actions per owner.
//
// Ownership is not a stored field. It is recovered from decisions phrased as
// "<Owner> now owns <subject>", "<Owner> owns <subject> until ...",
// "<Owner> takes over <subject> from <Previous>", or "Ownership of <subject>
// moves [from <Previous>] to <Owner>", optionally followed by a fallback
// reviewer or previous-owner clause, and replayed in createdAt order so the
// last decision for a subject wins. A fallback reviewer is never an owner.
import { listActionItems, listDecisions, type ActionItemRecord, type DecisionRecord } from "@store";

/** The current owner of a subject and the decision that assigned it. */
export interface OwnershipInsight {
  subject: string;
  owner: string;
  previousOwner?: string;
  fallbackReviewer?: string;
  sourceDecisionId: string;
  sourceMeetingId: string;
  updatedAt: string;
  sourceText: string;
}

/** One ownership assignment; `sequence` is its 1-based position across all subjects. */
export interface OwnershipHistoryItem extends OwnershipInsight {
  sequence: number;
}

export interface OpenActionOwnerInsight {
  owner: string;
  count: number;
  /** Open actions with any due date; it does not check whether the date has passed. */
  overdueOrDatedCount: number;
  actions: ActionItemRecord[];
}

export interface CompanyBrainInsights {
  generatedAt: string;
  counts: {
    decisionsAnalyzed: number;
    actionsAnalyzed: number;
    ownershipSubjects: number;
    ownersWithOpenActions: number;
    ownershipChanges: number;
  };
  ownership: OwnershipInsight[];
  ownershipHistory: OwnershipHistoryItem[];
  openActionsByOwner: OpenActionOwnerInsight[];
  unownedOpenActions: ActionItemRecord[];
}

/** Builds insights from the `limit` most recent decisions and action items (one page each, no paging). */
export function getCompanyBrainInsights(limit = 10_000): CompanyBrainInsights {
  return buildCompanyBrainInsights({
    decisions: listDecisions(limit),
    actions: listActionItems(limit),
  });
}

/**
 * Replays ownership decisions oldest first and groups open actions by owner
 * (first 20 per owner kept). `ownershipChanges` counts assignments whose
 * previous owner differs from the new one.
 */
export function buildCompanyBrainInsights(input: {
  decisions: DecisionRecord[];
  actions: ActionItemRecord[];
}): CompanyBrainInsights {
  const decisions = [...input.decisions].sort(compareRecords);
  const actions = [...input.actions].sort(compareRecords);
  const currentOwnership = new Map<string, OwnershipInsight>();
  const ownershipHistory: OwnershipHistoryItem[] = [];

  decisions.forEach((decision) => {
    const parsed = parseOwnershipDecision(decision);
    if (!parsed) return;
    const previous = currentOwnership.get(parsed.subject);
    const insight: OwnershipInsight = {
      subject: parsed.subject,
      owner: parsed.owner,
      previousOwner: parsed.previousOwner ?? previous?.owner,
      fallbackReviewer: parsed.fallbackReviewer,
      sourceDecisionId: decision.id,
      sourceMeetingId: decision.meetingId,
      updatedAt: decision.createdAt,
      sourceText: decision.text,
    };
    currentOwnership.set(parsed.subject, insight);
    ownershipHistory.push({ ...insight, sequence: ownershipHistory.length + 1 });
  });

  const openActions = actions.filter((action) => action.status === "open");
  const actionsByOwner = new Map<string, ActionItemRecord[]>();
  const unownedOpenActions: ActionItemRecord[] = [];
  for (const action of openActions) {
    if (!action.owner) {
      unownedOpenActions.push(action);
      continue;
    }
    const existing = actionsByOwner.get(action.owner) ?? [];
    existing.push(action);
    actionsByOwner.set(action.owner, existing);
  }

  const openActionsByOwner = [...actionsByOwner.entries()]
    .map(([owner, ownerActions]) => ({
      owner,
      count: ownerActions.length,
      overdueOrDatedCount: ownerActions.filter((action) => Boolean(action.dueDate)).length,
      actions: ownerActions.slice(0, 20),
    }))
    .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner));

  const ownership = [...currentOwnership.values()].sort((a, b) => a.subject.localeCompare(b.subject));

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      decisionsAnalyzed: decisions.length,
      actionsAnalyzed: actions.length,
      ownershipSubjects: ownership.length,
      ownersWithOpenActions: openActionsByOwner.length,
      ownershipChanges: ownershipHistory.filter((item) => Boolean(item.previousOwner) && item.previousOwner !== item.owner).length,
    },
    ownership,
    ownershipHistory,
    openActionsByOwner,
    unownedOpenActions,
  };
}

// A person's name in a trailing clause or a passive form: up to four
// capitalized words ("Ada", "Ada Lovelace", "O'Neil").
const NAME = String.raw`[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3}`;
// The owner at the start of an active-voice statement (the original, looser form).
const OWNER = String.raw`[A-Z][\w .'-]{1,40}`;

// Clauses that may trail an ownership statement, stripped (in any order)
// before the statement itself is matched.
const trailingClauses: Array<{ role: "fallbackReviewer" | "previousOwner"; pattern: RegExp }> = [
  { role: "fallbackReviewer", pattern: new RegExp(String.raw`[;,]\s*(?<name>${NAME})\s+is\s+(?:the\s+)?fallback reviewer$`, "u") },
  { role: "fallbackReviewer", pattern: new RegExp(String.raw`,?\s+with\s+(?<name>${NAME})\s+as\s+(?:the\s+)?fallback reviewer$`, "u") },
  { role: "fallbackReviewer", pattern: new RegExp(String.raw`(?:[;,]\s*|\s*\(\s*)[Ff]allback reviewer(?:\s+is|:)?\s+(?<name>${NAME})\s*\)?$`, "u") },
  { role: "previousOwner", pattern: new RegExp(String.raw`,?\s+(?:taking over from|replacing)\s+(?<name>${NAME})$`, "u") },
  { role: "previousOwner", pattern: new RegExp(String.raw`(?:[;,]\s*|\s*\(\s*)(?:previously|formerly)(?:\s+owned by)?:?\s+(?<name>${NAME})\s*\)?$`, "u") },
];

const statementForms: RegExp[] = [
  new RegExp(String.raw`^(?<owner>${OWNER})\s+now owns\s+(?<subject>.+)$`, "u"),
  new RegExp(String.raw`^(?<owner>${OWNER})\s+owns\s+(?<subject>.+?)\s+until\s+.+$`, "u"),
  new RegExp(String.raw`^(?<owner>${OWNER})\s+(?:takes|took) over\s+(?<subject>.+?)\s+from\s+(?<previous>${NAME})$`, "u"),
  new RegExp(
    String.raw`^Ownership of\s+(?<subject>.+?)\s+(?:moves|moved|passes|passed|transfers|transferred)\s+(?:from\s+(?<previous>${NAME})\s+)?to\s+(?<owner>${NAME})$`,
    "u"
  ),
];

/**
 * Parses an ownership statement out of a decision's text, or undefined if it is
 * not one. Trailing fallback-reviewer clauses ("; Ada is the fallback reviewer",
 * ", with Ada as fallback reviewer", "(fallback reviewer: Ada)") set only
 * `fallbackReviewer`; `previousOwner` is set only when the text names one
 * ("taking over from Ada", "replacing Ada", "(previously Ada)", "takes over X
 * from Ada", "moves from Ada to Ben"). Owner names must start with a capital letter.
 */
export function parseOwnershipDecision(decision: DecisionRecord): {
  owner: string;
  subject: string;
  previousOwner?: string;
  fallbackReviewer?: string;
} | undefined {
  let statement = decision.text.replace(/\s+/gu, " ").trim().replace(/\.$/u, "");
  const clauses: { previousOwner?: string; fallbackReviewer?: string } = {};
  for (let stripped = true; stripped; ) {
    stripped = false;
    for (const clause of trailingClauses) {
      const match = statement.match(clause.pattern);
      if (!match?.groups || match.index === undefined || clauses[clause.role]) continue;
      clauses[clause.role] = match.groups.name.trim();
      statement = statement.slice(0, match.index).trim();
      stripped = true;
    }
  }

  for (const form of statementForms) {
    const groups = statement.match(form)?.groups;
    if (!groups) continue;
    return {
      owner: groups.owner.trim(),
      subject: cleanSubject(groups.subject),
      previousOwner: groups.previous?.trim() ?? clauses.previousOwner,
      fallbackReviewer: clauses.fallbackReviewer,
    };
  }
  return undefined;
}

function cleanSubject(subject: string): string {
  return subject.replace(/[.;]\s*$/u, "").trim();
}

function compareRecords(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
