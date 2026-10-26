// diagnostics — setup readiness checks for the admin UI and /api/health.
//
// Each check is "ready", "missing", or "warning". "missing" means something
// Perry needs is absent or broken; "warning" marks an optional feature that is
// off or degraded (Graphiti disabled, manual or unimplemented Granola mode, no
// meeting channel or meeting-notes source, no routing rules). `ready` is true
// when no check is "missing": warnings are allowed.
import { dirname } from "node:path";
import { existsSync, mkdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { countApprovals, countMeetingRecords, getMeetingStorePath, pendingFtsCount } from "@store";
import { getSettingsPath, loadAppSettings } from "@core";
import { getExtractionBackend, getExtractionMode, getLmStudioExtractionConfig, getTogetherExtractionConfig } from "@extraction";
import { getGraphMemoryStatus } from "@graph";

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: "ready" | "missing" | "warning";
  detail: string;
}

export interface Diagnostics {
  checks: DiagnosticCheck[];
  ready: boolean;
  configPath: string;
  meetingStorePath: string;
  processedMeetingCount: number;
  pendingApprovalCount: number;
  pendingFtsCount: number;
  dbHealth: {
    path: string;
    parentWritable: boolean;
    note?: string;
  };
}

/**
 * Checks secrets (presence only), Discord and Notion ids, Granola mode, roster,
 * routing rules, Graphiti, the settings file, and DB writability, plus queue
 * counts. `ready` ignores warnings. Side effect: probes writability once by
 * creating the DB's parent directory and writing then deleting `<db>.probe`.
 */
export function getDiagnostics(): Diagnostics {
  const settings = loadAppSettings();
  const dbHealth = getDbHealth();
  const checks: DiagnosticCheck[] = [
    secretCheck("discord-token", "Discord token", "DISCORD_TOKEN"),
    secretCheck("notion-token", "Notion token", "NOTION_TOKEN"),
    valueCheck("discord-client", "Discord client", settings.discord.clientId, "Client ID configured"),
    valueCheck("discord-guild", "Discord guild", settings.discord.guildId, "Guild ID configured"),
    valueCheck(
      "standup-channel",
      "Standup channel",
      settings.discord.standupChannelId,
      "Standup channel configured"
    ),
    optionalValueCheck(
      "meeting-channel",
      "Meeting channel",
      settings.discord.meetingChannelId,
      "Meeting notes channel configured",
      "Not configured; meeting notes post to the standup channel"
    ),
    valueCheck(
      "standup-source",
      "Standup data source",
      settings.notion.standupDataSourceId,
      "Standup Notion data source configured"
    ),
    optionalValueCheck(
      "meeting-source",
      "Meeting notes data source",
      settings.notion.meetingNotesDataSourceId,
      "Meeting notes Notion data source configured",
      "Not configured; meeting notes are not written to Notion unless a routing rule sets a data source"
    ),
    granolaModeCheck(settings.granola.mode),
    {
      id: "roster",
      label: "Roster",
      status: settings.roster.some((person) => person.isActive !== false) ? "ready" : "warning",
      detail: `${settings.roster.filter((person) => person.isActive !== false).length} active people`,
    },
    {
      id: "routing",
      label: "Routing rules",
      status: settings.routingRules.some((rule) => rule.isActive !== false) ? "ready" : "warning",
      detail: `${settings.routingRules.filter((rule) => rule.isActive !== false).length} active routes`,
    },
    graphMemoryCheck(),
    extractionCheck(),
    {
      id: "config-file",
      label: "Config file",
      status: existsSync(getSettingsPath()) ? "ready" : "warning",
      detail: existsSync(getSettingsPath()) ? "Saved config exists" : "Using defaults until settings are saved",
    },
    dbCheck(dbHealth),
  ];

  return {
    checks,
    ready: checks.every((check) => check.status !== "missing"),
    configPath: getSettingsPath(),
    meetingStorePath: getMeetingStorePath(),
    processedMeetingCount: countMeetingRecords("processed"),
    pendingApprovalCount: countApprovals("pending"),
    pendingFtsCount: pendingFtsCount(),
    dbHealth,
  };
}

/** Ready for zapier-webhook; a warning for manual mode and for api-poll, which has no poller behind it. */
function granolaModeCheck(mode: string): DiagnosticCheck {
  const detail =
    mode === "manual"
      ? "Manual mode is useful for setup, but it will not ingest notes automatically"
      : mode === "api-poll"
        ? "api-poll is not implemented and ingests nothing; use zapier-webhook"
        : `${mode} configured`;
  return { id: "granola-mode", label: "Granola mode", status: mode === "zapier-webhook" ? "ready" : "warning", detail };
}

/**
 * Validates the extraction configuration without calling the model (this runs
 * on every health poll). Model reachability is checked per meeting instead: a
 * failed call falls back to rules and records why in the result's provenance.
 */
function extractionCheck(): DiagnosticCheck {
  const mode = getExtractionMode();
  if (mode === "rules") {
    return { id: "extraction", label: "Extraction", status: "ready", detail: "Rules-based extraction; no LLM calls" };
  }
  if (getExtractionBackend() === "together") {
    const config = getTogetherExtractionConfig();
    return config.apiKey
      ? { id: "extraction", label: "Extraction", status: "ready", detail: `${mode} via Together.ai (${config.model}); summaries leave this machine` }
      : { id: "extraction", label: "Extraction", status: "missing", detail: `${mode} mode needs TOGETHER_API_KEY; every meeting will fall back to rules` };
  }
  const config = getLmStudioExtractionConfig();
  return { id: "extraction", label: "Extraction", status: "ready", detail: `${mode} via ${config.baseUrl} (${config.model})` };
}

/** Warning when PERRY_GRAPHITI_ENABLED is unset or "false"; otherwise ready only if the bridge is configured. */
function graphMemoryCheck(): DiagnosticCheck {
  const status = getGraphMemoryStatus();
  if (!process.env.PERRY_GRAPHITI_ENABLED || process.env.PERRY_GRAPHITI_ENABLED === "false") {
    return {
      id: "graphiti",
      label: "Graphiti memory",
      status: "warning",
      detail: "Optional temporal graph memory is disabled",
    };
  }
  return {
    id: "graphiti",
    label: "Graphiti memory",
    status: status.enabled ? "ready" : "missing",
    detail: status.enabled
      ? `Bridge configured for group ${status.groupId}`
      : "Set PERRY_GRAPHITI_BRIDGE_URL or disable PERRY_GRAPHITI_ENABLED",
  };
}

function secretCheck(id: string, label: string, envName: string): DiagnosticCheck {
  const hasValue = Boolean(process.env[envName]);
  return {
    id,
    label,
    status: hasValue ? "ready" : "missing",
    detail: hasValue ? `${envName} is set` : `${envName} is missing`,
  };
}

function valueCheck(id: string, label: string, value: unknown, readyDetail: string): DiagnosticCheck {
  return {
    id,
    label,
    status: value ? "ready" : "missing",
    detail: value ? readyDetail : "Not configured",
  };
}

/** Like valueCheck, but an unset optional value is a warning rather than "missing". */
function optionalValueCheck(id: string, label: string, value: unknown, readyDetail: string, unsetDetail: string): DiagnosticCheck {
  return {
    id,
    label,
    status: value ? "ready" : "warning",
    detail: value ? readyDetail : unsetDetail,
  };
}

function dbCheck(health: Diagnostics["dbHealth"]): DiagnosticCheck {
  return {
    id: "db-path",
    label: "Brain database path",
    status: health.parentWritable ? "ready" : "missing",
    detail: health.parentWritable ? `Writable: ${health.path}` : health.note ?? `Not writable: ${health.path}`,
  };
}

/** An in-memory DB always passes; otherwise a probe file must be writable next to the DB. */
function getDbHealth(): Diagnostics["dbHealth"] {
  const path = getMeetingStorePath();
  if (path === ":memory:") {
    return {
      path,
      parentWritable: true,
      note: "In-memory database is suitable for smoke tests only",
    };
  }

  const parent = dirname(path);
  const probe = `${path}.probe`;
  try {
    mkdirSync(parent, { recursive: true });
    writeFileSync(probe, "ok", "utf8");
    rmSync(probe, { force: true });
    const parentStats = statSync(parent);
    return {
      path,
      parentWritable: parentStats.isDirectory(),
    };
  } catch (error) {
    return {
      path,
      parentWritable: false,
      note: error instanceof Error ? error.message : "Unable to verify DB path",
    };
  }
}
