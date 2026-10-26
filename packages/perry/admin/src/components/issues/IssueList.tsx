// components/issues/IssueList — loaded issues as selectable rows.
import type { IssuesState } from "../../hooks/useIssues";

export function IssueList({ issues }: { issues: IssuesState }) {
  const { selectedIssue } = issues;
  return (
    <div className="issue-list">
      {issues.issues.length === 0 ? (
        <div className="empty">Project meetings into issues or create one manually.</div>
      ) : (
        issues.issues.map((issue) => (
          <button
            className={`issue-row ${selectedIssue?.id === issue.id ? "selected" : ""}`}
            key={issue.id}
            onClick={() => issues.selectIssue(issue.id)}
          >
            <span className={`pill ${issue.status}`}>{issue.status.replace("_", " ")}</span>
            <strong>{issue.title}</strong>
            <small>{[issue.project, issue.owner, issue.priority].filter(Boolean).join(" | ")}</small>
          </button>
        ))
      )}
    </div>
  );
}
