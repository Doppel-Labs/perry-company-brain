// controllers/system — health, counts, diagnostics, and settings.
import { existsSync } from "node:fs";
import { AppSettingsSchema, getSettingsPath, loadAppSettings, saveAppSettings } from "@core";
import { getGraphMemoryStatus, getGraphSyncQueueSnapshot } from "@graph";
import { getIngestionQueueSnapshot } from "@ingestion";
import { countApprovals, countMeetingRecords } from "@store";
import { getDiagnostics } from "../diagnostics";
import { readJson } from "../http/request";
import { Reply } from "../http/response";
import { staticRoot } from "../http/static";
import type { RouteDefinition } from "../router";
import { parseApprovalStatus, parseBody } from "../validation";
import { z } from "zod";

/** Pre-serialized liveness body: /api/ping is the hot path for uptime checks. */
const pingReply = new Reply(200, Buffer.from('{"ok":true}'));

/** PUT /api/config accepts either `{ settings }` or the bare settings object. */
const ConfigBodySchema = z.union([z.object({ settings: AppSettingsSchema }).transform((body) => body.settings), AppSettingsSchema]);

/**
 * The public /api/ping liveness check; admin health, counts, agent status,
 * diagnostics; and reading or replacing the saved settings (secrets reported as
 * presence flags only).
 */
export const systemRoutes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/ping",
    access: "public",
    handle: () => pingReply,
  },
  {
    method: "GET",
    path: "/api/health",
    handle: () => ({ ok: true, configPath: getSettingsPath(), adminBuilt: existsSync(staticRoot), diagnostics: getDiagnostics() }),
  },
  {
    method: "GET",
    path: "/api/counts",
    handle: ({ query }) => ({
      approvals: countApprovals(query.parse("status", parseApprovalStatus)),
      processedMeetings: countMeetingRecords("processed"),
      ingestionQueue: getIngestionQueueSnapshot({ limit: 0 }).stats,
      graphSyncQueue: getGraphSyncQueueSnapshot({ limit: 0 }).stats,
    }),
  },
  {
    method: "GET",
    path: "/api/agent/status",
    handle: () => ({
      ok: true,
      approvals: countApprovals("pending"),
      processedMeetings: countMeetingRecords("processed"),
      ingestionQueue: getIngestionQueueSnapshot({ limit: 5 }),
      graphSyncQueue: getGraphSyncQueueSnapshot({ limit: 5 }),
      graphMemory: getGraphMemoryStatus(),
    }),
  },
  {
    method: "GET",
    path: "/api/diagnostics",
    handle: () => getDiagnostics(),
  },
  {
    method: "GET",
    path: "/api/config",
    handle: () => ({
      settings: loadAppSettings(),
      // Presence flags only — secret values never leave the server.
      secrets: {
        discordToken: Boolean(process.env.DISCORD_TOKEN),
        notionToken: Boolean(process.env.NOTION_TOKEN),
        granolaApiKey: Boolean(process.env.GRANOLA_API_KEY),
        adminApiToken: Boolean(process.env.ADMIN_API_TOKEN),
        graphitiBridgeUrl: Boolean(process.env.PERRY_GRAPHITI_BRIDGE_URL),
      },
      graphMemory: getGraphMemoryStatus(),
      configPath: getSettingsPath(),
    }),
  },
  {
    method: "PUT",
    path: "/api/config",
    handle: async ({ req }) => {
      const settings = parseBody(ConfigBodySchema, await readJson(req), "settings");
      return { settings: saveAppSettings(settings), configPath: getSettingsPath() };
    },
  },
];
