import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { startFtsWorker } from "@brain";
import { startGraphSyncWorker } from "@graph";
import { startIngestionWorker } from "@ingestion";
import { sendJson, sendJsonBuffer, serveStatic } from "./http-util";
import { authorizeApiRequest } from "./http-auth";
import { handleGraphSync } from "./routes/graph-sync";
import { handleIngestion } from "./routes/ingestion";
import { handleContent } from "./routes/content";
import { handleBrain } from "./routes/brain";
import { handleApprovals } from "./routes/approvals";
import { handleIssues } from "./routes/issues";
import { handleSystem } from "./routes/system";

const pingBody = Buffer.from('{"ok":true}');

let ftsWorkerStarted = false;

let ingestionWorkerStarted = false;

let graphSyncWorkerStarted = false;

export function startAdminServer(port = Number(process.env.PORT ?? 8787)): void {
  if (!ftsWorkerStarted) {
    startFtsWorker();
    ftsWorkerStarted = true;
  }
  if (!ingestionWorkerStarted) {
    startIngestionWorker();
    ingestionWorkerStarted = true;
  }
  if (!graphSyncWorkerStarted) {
    startGraphSyncWorker();
    graphSyncWorkerStarted = true;
  }

  const server = createAdminHttpServer();
  const host = process.env.ADMIN_HOST || "127.0.0.1";
  server.listen(port, host, () => {
    console.log(`Perry admin server listening on http://${host}:${port}`);
  });
}

export function createAdminHttpServer(): Server {
  return createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/api/ping") {
        sendJsonBuffer(res, 200, pingBody);
        return;
      }
      await route(req, res);
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
      if (status >= 500) console.error(error);
      if (status === 413) res.setHeader("connection", "close");
      sendJson(res, status, { error: error instanceof Error ? error.message : "Internal server error" });
    }
  });
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  authorizeApiRequest(req, url.pathname);
  if (await handleGraphSync(req, res, url)) return;
  if (await handleIngestion(req, res, url)) return;
  if (await handleContent(req, res, url)) return;
  if (await handleBrain(req, res, url)) return;
  if (await handleApprovals(req, res, url)) return;
  if (await handleIssues(req, res, url)) return;
  if (await handleSystem(req, res, url)) return;
  serveStatic(url.pathname, res);
}
