// controllers/approvals — meeting publish approvals.
import { approvePendingMeeting, rejectPendingMeeting } from "@ingestion";
import { listApprovals, listApprovalSummaries } from "@store";
import type { RouteDefinition } from "../router";
import { parseApprovalStatus } from "../validation";

/** List approvals (summaries, or full records with ?detail=true); approve or reject a pending meeting. */
export const approvalRoutes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/approvals",
    handle: ({ query }) => {
      const list = query.flag("detail") ? listApprovals : listApprovalSummaries;
      return { records: list(query.parse("status", parseApprovalStatus), query.page()) };
    },
  },
  {
    method: "POST",
    path: "/api/approvals/:id/approve",
    handle: ({ params }) => approvePendingMeeting(params.id),
  },
  {
    method: "POST",
    path: "/api/approvals/:id/reject",
    handle: ({ params }) => rejectPendingMeeting(params.id),
  },
];
