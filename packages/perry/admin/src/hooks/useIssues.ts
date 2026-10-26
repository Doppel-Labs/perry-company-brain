// hooks/useIssues — the issue tracker: loaded issues, selection, the selected issue's
// events, the create draft, and the comment box.
import { useEffect, useMemo, useState } from "react";
import { optional } from "../api/client";
import * as issuesApi from "../api/issues";
import type { IssueDraft, IssuePatch } from "../api/issues";
import { errorMessage, reportErrors } from "../lib/errors";
import type { IssueEventRecord, IssueRecord } from "../types";
import type { HookDeps } from "./types";

const emptyIssueDraft: IssueDraft = {
  title: "",
  project: "",
  owner: "",
  priority: "normal",
  dueDate: "",
};

/**
 * Create and Project are server writes followed by a full refresh. Patch (status,
 * owner, comment) updates the issue and its events in place from the response.
 * Failures go to `setError`; event reloads are best-effort.
 *
 * The selected issue is the single source of truth for the detail pane: events are
 * stored with the id they belong to and loaded by an effect on that id, so the pane can
 * never show one issue with another's history, whichever code path changed the selection.
 */
export function useIssues({ setError, refresh }: HookDeps) {
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [loadedEvents, setLoadedEvents] = useState<{ issueId: string; events: IssueEventRecord[] } | null>(null);
  // Bumped by `reloadIssueEvents` to re-run the events effect for an unchanged selection.
  const [eventsVersion, setEventsVersion] = useState(0);
  const [issueDraft, setIssueDraft] = useState(emptyIssueDraft);
  const [issueComment, setIssueComment] = useState("");
  const [issueActionStatus, setIssueActionStatus] = useState<"idle" | "projecting" | "creating" | "updating">("idle");

  const openIssueCount = useMemo(() => issues.filter((issue) => issue.status !== "done" && issue.status !== "canceled").length, [issues]);
  // Falls back to the first issue when nothing is selected yet.
  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.id === selectedIssueId) ?? issues[0],
    [issues, selectedIssueId]
  );
  // The id the pane actually shows (including the first-issue fallback), not the raw selection.
  const shownIssueId = selectedIssue?.id ?? "";
  const issueEvents = loadedEvents && loadedEvents.issueId === shownIssueId ? loadedEvents.events : [];

  // Load the shown issue's events whenever it changes or a reload is requested. A
  // response (or failure) that arrives after the selection moved on, or after a newer reload
  // began, is dropped.
  useEffect(() => {
    if (!shownIssueId) return;
    let stale = false;
    void reportErrors(
      async () => {
        const records = await optional(issuesApi.fetchIssueEvents(shownIssueId));
        if (records && !stale) setLoadedEvents({ issueId: shownIssueId, events: records });
      },
      (message) => {
        if (!stale) setError(message);
      },
      "Issue events load failed"
    );
    return () => {
      stale = true;
    };
  }, [shownIssueId, eventsVersion]);

  /** Re-fetch the shown issue's events; `refresh` calls this after reloading the issue list. */
  function reloadIssueEvents() {
    setEventsVersion((version) => version + 1);
  }

  function updateDraft(patch: Partial<IssueDraft>) {
    setIssueDraft((current) => ({ ...current, ...patch }));
  }

  async function projectMultiplayer() {
    setIssueActionStatus("projecting");
    setError("");
    try {
      await issuesApi.projectMultiplayer();
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Projection failed"));
    } finally {
      setIssueActionStatus("idle");
    }
  }

  async function createIssue() {
    if (!issueDraft.title.trim()) return;
    setIssueActionStatus("creating");
    setError("");
    try {
      const issue = await issuesApi.createIssue(issueDraft);
      setIssueDraft(emptyIssueDraft);
      // The refresh brings the new issue into the list; selecting it loads its events.
      setSelectedIssueId(issue.id);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Issue create failed"));
    } finally {
      setIssueActionStatus("idle");
    }
  }

  async function patchIssue(issue: IssueRecord, patch: IssuePatch) {
    setIssueActionStatus("updating");
    setError("");
    try {
      const payload = await issuesApi.patchIssue(issue.id, patch);
      setIssues((current) => current.map((item) => (item.id === payload.issue.id ? payload.issue : item)));
      setLoadedEvents({ issueId: payload.issue.id, events: payload.events });
      setIssueComment("");
    } catch (err) {
      setError(errorMessage(err, "Issue update failed"));
    } finally {
      setIssueActionStatus("idle");
    }
  }

  return {
    issues,
    setIssues,
    selectedIssueId,
    selectedIssue,
    openIssueCount,
    issueEvents,
    issueDraft,
    updateDraft,
    issueComment,
    setIssueComment,
    issueActionStatus,
    reloadIssueEvents,
    selectIssue: setSelectedIssueId,
    projectMultiplayer,
    createIssue,
    patchIssue,
  };
}

export type IssuesState = ReturnType<typeof useIssues>;
