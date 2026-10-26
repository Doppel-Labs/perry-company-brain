// http — composition root for the admin server: workers, router, static SPA, error boundary.
import { createServer, type Server } from "node:http";
import { startFtsWorker } from "@brain";
import { startGraphSyncWorker } from "@graph";
import { startIngestionWorker } from "@ingestion";
import { adminHost, assertSafeBind } from "./auth";
import { apiRoutes } from "./controllers";
import { toHttpError } from "./http/errors";
import { sendJson } from "./http/response";
import { serveStatic } from "./http/static";
import { Router } from "./router";

let workersStarted = false;

/**
 * Starts the background workers (FTS, ingestion, graph sync; once per process)
 * and listens on PORT (default 8787) and ADMIN_HOST. Throws before binding a
 * non-loopback host without ADMIN_API_TOKEN.
 */
export function startAdminServer(port = Number(process.env.PORT) || 8787, host = adminHost()): void {
  assertSafeBind(host);
  if (!workersStarted) {
    startFtsWorker();
    startIngestionWorker();
    startGraphSyncWorker();
    workersStarted = true;
  }

  createAdminHttpServer().listen(port, host, () => {
    console.log(`Perry admin server listening on http://${host.includes(":") ? `[${host}]` : host}:${port}`);
  });
}

/** The request handler alone, with no workers or listen; /api goes to the router, everything else to the SPA. */
export function createAdminHttpServer(router = new Router(apiRoutes)): Server {
  return createServer(async (req, res) => {
    try {
      // The base is fixed: the Host header is client-controlled and must not shape routing.
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) await router.dispatch(req, res, url);
      else serveStatic(url.pathname, res);
    } catch (error) {
      const clientError = toHttpError(error);
      if (!clientError) console.error(error);
      if (res.headersSent) {
        res.end();
        return;
      }
      // Only deliberate 4xx messages reach the client; internals stay in the server log.
      if (clientError) sendJson(res, clientError.status, { error: clientError.message });
      else sendJson(res, 500, { error: "Internal server error" });
    }
  });
}
