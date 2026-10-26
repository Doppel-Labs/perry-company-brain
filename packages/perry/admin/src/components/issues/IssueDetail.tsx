// components/issues/IssueDetail — the selected issue: change status or owner, add a
// comment (each a server write), and read its event history.
import { MessageSquare } from "lucide-react";
import type { IssuesState } from "../../hooks/useIssues";
import { formatIssueEvent } from "../../lib/format";
import type { IssueStatus, UserRecord } from "../../types";
import { OwnerOptions } from "./OwnerOptions";

export function IssueDetail({ issues, users }: { issues: IssuesState; users: UserRecord[] }) {
  const { selectedIssue, issueComment, setIssueComment, issueEvents, patchIssue } = issues;
  return (
    <div className="issue-detail">
      {selectedIssue ? (
        <>
          <div className="issue-title-row">
            <strong>{selectedIssue.title}</strong>
            <span className={`pill ${selectedIssue.priority}`}>{selectedIssue.priority}</span>
          </div>
          <div className="split">
            <label className="field">
              <span>Status</span>
              <select
                value={selectedIssue.status}
                onChange={(event) => void patchIssue(selectedIssue, { status: event.target.value as IssueStatus })}
              >
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="done">Done</option>
                <option value="canceled">Canceled</option>
              </select>
            </label>
            <label className="field">
              <span>Owner</span>
              <select value={selectedIssue.owner ?? ""} onChange={(event) => void patchIssue(selectedIssue, { owner: event.target.value })}>
                <OwnerOptions users={users} />
              </select>
            </label>
          </div>
          <div className="comment-row">
            <input
              aria-label="Issue comment"
              placeholder="Add comment"
              value={issueComment}
              onChange={(event) => setIssueComment(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && issueComment.trim()) void patchIssue(selectedIssue, { comment: issueComment });
              }}
            />
            <button className="secondary" onClick={() => void patchIssue(selectedIssue, { comment: issueComment })} disabled={!issueComment.trim()}>
              <MessageSquare size={17} />
              <span>Comment</span>
            </button>
          </div>
          <div className="event-list">
            {issueEvents.length === 0 ? (
              <div className="empty">No events for this issue yet.</div>
            ) : (
              issueEvents.map((event) => (
                <div className="event-row" key={event.id}>
                  <span className={`pill ${event.type}`}>{event.type.replace("_", " ")}</span>
                  <p>{formatIssueEvent(event)}</p>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="empty">Select an issue to manage ownership, status, and discussion.</div>
      )}
    </div>
  );
}
