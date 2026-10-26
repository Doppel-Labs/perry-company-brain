// router — declarative route table. Every route states its access level, so the
// security posture of the whole API is readable in one place per controller.
import type { IncomingMessage, ServerResponse } from "node:http";
import { type Access, authorize } from "./auth";
import { badRequest, notFound } from "./http/errors";
import { Query } from "./http/request";
import { sendResult } from "./http/response";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** Decoded `:name` path segments. */
  params: Record<string, string>;
  query: Query;
}

export interface RouteDefinition {
  method: Method | Method[];
  /** Exact path, with `:name` placeholders for single segments. */
  path: string;
  /** Defaults to "admin": a route is protected unless it explicitly opts out. */
  access?: Access;
  /** Returns the response model; a `Reply` sets a non-200 status. */
  handle(ctx: RouteContext): unknown;
}

interface CompiledRoute {
  methods: Set<string>;
  pattern: RegExp;
  keys: string[];
  access: Access;
  handle: RouteDefinition["handle"];
}

/** Compiles route definitions to regexes; dispatch runs the first route matching path and method. */
export class Router {
  private readonly routes: CompiledRoute[] = [];

  constructor(definitions: Iterable<RouteDefinition> = []) {
    for (const definition of definitions) this.add(definition);
  }

  add(definition: RouteDefinition): this {
    const keys: string[] = [];
    const source = definition.path
      .split("/")
      .map((segment) => {
        if (!segment.startsWith(":")) return segment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        keys.push(segment.slice(1));
        return "([^/]+)";
      })
      .join("/");
    this.routes.push({
      methods: new Set([definition.method].flat()),
      pattern: new RegExp(`^${source}$`, "u"),
      keys,
      access: definition.access ?? "admin",
      handle: definition.handle,
    });
    return this;
  }

  /**
   * Dispatches an /api request. Authorization runs before the handler and
   * before any body is read; unknown /api paths are admin-gated 404s so the
   * route table is not enumerable anonymously.
   */
  async dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const found = this.find(req.method ?? "GET", url.pathname);
    authorize(req, found?.route.access ?? "admin");
    if (!found) throw notFound(`No route for ${req.method} ${url.pathname}`);
    const { route, match } = found;
    const params = Object.fromEntries(route.keys.map((key, index) => [key, decodeSegment(match[index + 1])]));
    sendResult(res, await route.handle({ req, res, url, params, query: new Query(url.searchParams) }));
  }

  /** The access level a request needs: its route's, or "admin" for an unknown method or path. */
  accessFor(method: string, pathname: string): Access {
    return this.find(method, pathname)?.route.access ?? "admin";
  }

  private find(method: string, pathname: string): { route: CompiledRoute; match: RegExpExecArray } | undefined {
    for (const route of this.routes) {
      const match = route.pattern.exec(pathname);
      if (match && route.methods.has(method)) return { route, match };
    }
    return undefined;
  }
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw badRequest("Malformed URL path segment.");
  }
}
