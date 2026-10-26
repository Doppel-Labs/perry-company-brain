// components/issues/IssueCreateForm — draft form for a new issue; Create is a server
// write and is disabled while another issue action runs or the title is blank.
import { Loader2, Plus } from "lucide-react";
import type { IssuesState } from "../../hooks/useIssues";
import type { IssuePriority, UserRecord } from "../../types";
import { Field } from "../shared";
import { OwnerOptions } from "./OwnerOptions";

export function IssueCreateForm({ issues, users }: { issues: IssuesState; users: UserRecord[] }) {
  const { issueDraft, updateDraft, issueActionStatus } = issues;
  return (
    <div className="issue-create">
      <Field label="Issue" value={issueDraft.title} onChange={(value) => updateDraft({ title: value })} />
      <Field label="Project" value={issueDraft.project} onChange={(value) => updateDraft({ project: value })} />
      <label className="field">
        <span>Owner</span>
        <select value={issueDraft.owner} onChange={(event) => updateDraft({ owner: event.target.value })}>
          <OwnerOptions users={users} />
        </select>
      </label>
      <label className="field">
        <span>Priority</span>
        <select value={issueDraft.priority} onChange={(event) => updateDraft({ priority: event.target.value as IssuePriority })}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </label>
      <Field label="Due" value={issueDraft.dueDate} onChange={(value) => updateDraft({ dueDate: value })} />
      <button className="primary" onClick={() => void issues.createIssue()} disabled={issueActionStatus !== "idle" || !issueDraft.title.trim()}>
        {issueActionStatus === "creating" ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
        <span>Create</span>
      </button>
    </div>
  );
}
