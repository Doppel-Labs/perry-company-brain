// controllers/issues — issue tracker, users roster, and ownership pivots.
import { listIssueEvents, listIssues, listPivots, listUsers, updateIssue, upsertIssue } from "@store";
import { badRequest, notFound } from "../http/errors";
import { readJson } from "../http/request";
import { reply } from "../http/response";
import type { RouteDefinition } from "../router";
import { IssueBodySchema, parseBody, parseIssuePriority, parseIssueStatus } from "../validation";

/**
 * Issue CRUD with an event log. POST requires a title and defaults to open/normal;
 * PATCH/PUT update in place and ignore unknown status or priority values.
 */
export const issueRoutes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/issues",
    handle: ({ query }) => ({
      records: listIssues({
        ...query.page(),
        owner: query.string("owner"),
        project: query.string("project"),
        status: query.parse("status", parseIssueStatus),
      }),
    }),
  },
  {
    method: "POST",
    path: "/api/issues",
    handle: async ({ req }) => {
      const body = parseBody(IssueBodySchema, await readJson(req), "issue");
      if (!body.title) throw badRequest("Issue title is required.");
      const issue = upsertIssue({
        id: body.id ?? `issue:manual:${Date.now()}:${slugKey(body.title)}`,
        project: body.project,
        title: body.title,
        description: body.description,
        status: parseIssueStatus(body.status) ?? "open",
        priority: parseIssuePriority(body.priority) ?? "normal",
        owner: body.owner,
        dueDate: body.dueDate,
      });
      return reply(201, { issue });
    },
  },
  {
    method: ["PATCH", "PUT"],
    path: "/api/issues/:id",
    handle: async ({ req, params }) => {
      const body = parseBody(IssueBodySchema, await readJson(req), "issue");
      const issue = updateIssue({
        ...body,
        id: params.id,
        status: parseIssueStatus(body.status),
        priority: parseIssuePriority(body.priority),
      });
      if (!issue) throw notFound("Issue not found.");
      return { issue, events: listIssueEvents(issue.id, { limit: 100 }) };
    },
  },
  {
    method: "GET",
    path: "/api/issues/:id/events",
    handle: ({ params, query }) => ({ records: listIssueEvents(params.id, query.page()) }),
  },
  {
    method: "GET",
    path: "/api/users",
    handle: ({ query }) => ({ records: listUsers(query.page()) }),
  },
  {
    method: "GET",
    path: "/api/pivots",
    handle: ({ query }) => ({ records: listPivots(query.page()) }),
  },
];

function slugKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
}
