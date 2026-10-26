// analytics — aggregate workload, theme, and volume statistics for the whole brain.
//
// Themes are crude on purpose: a record's "theme" is its first eight normalized
// non-stop-words, so near-identical decisions and actions bucket together.
// Every ratio is rounded to four decimals and is 0 when its denominator is 0.
import {
  listActionItems,
  listDecisions,
  listMeetingRecords,
  type ActionItemRecord,
  type DecisionRecord,
  type MeetingRecord,
} from "@store";
import { buildCompanyBrainHealth, type CompanyBrainHealthReport } from "./health";
import { paged } from "./paging";

/** One group of records sharing a key, with up to five distinct example texts. */
export interface AnalyticsBucket {
  key: string;
  count: number;
  examples: string[];
}

export interface OwnerAnalytics {
  owner: string;
  openActions: number;
  datedActions: number;
  actionShare: number;
  examples: string[];
}

export interface CompanyBrainAnalyticsReport {
  generatedAt: string;
  counts: {
    meetings: number;
    decisions: number;
    actions: number;
    openActions: number;
    owners: number;
    unownedActions: number;
  };
  ownerWorkload: OwnerAnalytics[];
  meetingTitleClusters: AnalyticsBucket[];
  decisionThemes: AnalyticsBucket[];
  actionThemes: AnalyticsBucket[];
  dailyVolume: AnalyticsBucket[];
  qualitySignals: {
    openActionRate: number;
    unownedActionRate: number;
    topOwnerActionShare: number;
    repeatedDecisionThemeRate: number;
    repeatedActionThemeRate: number;
  };
  health: Pick<CompanyBrainHealthReport, "counts">;
}

/** Loads up to `limit` meetings, decisions, and action items (each) from the store and analyzes them. */
export function getCompanyBrainAnalytics(limit = 100_000): CompanyBrainAnalyticsReport {
  const meetings = paged((offset, pageSize) => listMeetingRecords({ limit: pageSize, offset }), limit, 1000);
  const decisions = paged((offset, pageSize) => listDecisions(pageSize, offset), limit, 5000);
  const actions = paged((offset, pageSize) => listActionItems(pageSize, offset), limit, 5000);
  return buildCompanyBrainAnalytics({ meetings, decisions, actions });
}

/**
 * Pure analysis over the given records: open-action load per owner, the top 25
 * meeting-title/decision/action themes, meetings per day (top 60 days by count),
 * quality ratios, and the health report's counts.
 */
export function buildCompanyBrainAnalytics(input: {
  meetings: MeetingRecord[];
  decisions: DecisionRecord[];
  actions: ActionItemRecord[];
}): CompanyBrainAnalyticsReport {
  const openActions = input.actions.filter((action) => action.status === "open");
  const ownerWorkload = summarizeOwners(openActions);
  const decisionThemes = bucketText(input.decisions.map((decision) => decision.text), 25);
  const actionThemes = bucketText(input.actions.map((action) => action.text), 25);
  const repeatedDecisionCount = decisionThemes.filter((bucket) => bucket.count > 1).reduce((sum, bucket) => sum + bucket.count, 0);
  const repeatedActionCount = actionThemes.filter((bucket) => bucket.count > 1).reduce((sum, bucket) => sum + bucket.count, 0);
  const health = buildCompanyBrainHealth({ decisions: input.decisions, actions: input.actions });

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      meetings: input.meetings.length,
      decisions: input.decisions.length,
      actions: input.actions.length,
      openActions: openActions.length,
      owners: ownerWorkload.length,
      unownedActions: input.actions.filter((action) => !action.owner).length,
    },
    ownerWorkload,
    meetingTitleClusters: bucketText(input.meetings.map((meeting) => meeting.title), 25),
    decisionThemes,
    actionThemes,
    dailyVolume: bucketText(input.meetings.map((meeting) => meeting.createdAt.slice(0, 10)), 60, { preserveShortKeys: true }),
    qualitySignals: {
      openActionRate: ratio(openActions.length, input.actions.length),
      unownedActionRate: ratio(input.actions.filter((action) => !action.owner).length, input.actions.length),
      topOwnerActionShare: ratio(ownerWorkload[0]?.openActions ?? 0, openActions.length),
      repeatedDecisionThemeRate: ratio(repeatedDecisionCount, input.decisions.length),
      repeatedActionThemeRate: ratio(repeatedActionCount, input.actions.length),
    },
    health: { counts: health.counts },
  };
}

function summarizeOwners(actions: ActionItemRecord[]): OwnerAnalytics[] {
  const byOwner = new Map<string, ActionItemRecord[]>();
  for (const action of actions) {
    if (!action.owner) continue;
    byOwner.set(action.owner, [...(byOwner.get(action.owner) ?? []), action]);
  }
  return [...byOwner.entries()]
    .map(([owner, ownerActions]) => ({
      owner,
      openActions: ownerActions.length,
      datedActions: ownerActions.filter((action) => Boolean(action.dueDate)).length,
      actionShare: ratio(ownerActions.length, actions.length),
      examples: ownerActions.slice(0, 5).map((action) => action.text),
    }))
    .sort((a, b) => b.openActions - a.openActions || a.owner.localeCompare(b.owner));
}

/** Groups values by theme key (or by the raw value with `preserveShortKeys`); largest buckets first. */
function bucketText(values: string[], limit: number, options: { preserveShortKeys?: boolean } = {}): AnalyticsBucket[] {
  const buckets = new Map<string, string[]>();
  for (const value of values) {
    const key = options.preserveShortKeys ? value : analyticsKey(value);
    if (!key) continue;
    buckets.set(key, [...(buckets.get(key) ?? []), value]);
  }
  return [...buckets.entries()]
    .map(([key, examples]) => ({ key, count: examples.length, examples: unique(examples).slice(0, 5) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function analyticsKey(value: string): string {
  const stop = new Set([
    "a",
    "an",
    "and",
    "by",
    "for",
    "from",
    "in",
    "is",
    "of",
    "on",
    "the",
    "to",
    "with",
  ]);
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter((part) => part.length > 1 && !stop.has(part) && !/^\d+$/u.test(part))
    .slice(0, 8)
    .join(" ");
}

function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
