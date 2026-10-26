// core/config — Perry's settings file, env-var defaults, and the startup Config.
//
// Two layers feed two readers. AppSettings is the admin-editable JSON file
// (PERRY_CONFIG_PATH, default ./data/perry.config.json) layered over defaults
// built from env vars; Config is the flat set of secrets and ids Discord and
// Notion need at runtime. Precedence is the same for both: env vars are only
// defaults, and a value saved in the settings file wins (each top-level section
// is shallow-merged, roster and routingRules replace wholesale). loadConfig is
// derived from loadAppSettings, so the two never disagree. Secrets
// (DISCORD_TOKEN, NOTION_TOKEN, API keys) are env-only. Nothing is cached: every call re-reads the file, so admin edits take effect
// without a restart.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, {
  message: "Must be in HH:MM 24-hour format",
});
const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());
const optionalEmail = z.preprocess((value) => (value === "" ? undefined : value), z.string().email().optional());

const PersonSchema = z.object({
  name: z.string().min(1),
  discordUserId: z.string().min(1),
  notionName: z.string().optional(),
  notionUserId: z.string().optional(),
  granolaEmail: optionalEmail,
  githubUsername: z.string().optional(),
  team: z.string().optional(),
  timezone: z.string().optional(),
  isActive: z.boolean().optional(),
});

/** A roster entry as stored in settings: a teammate keyed by Discord user id, with optional Notion/Granola/GitHub identities. */
export type PersonConfig = z.infer<typeof PersonSchema>;

// Matching criteria (folder, title keywords, attendee emails) and the
// destination overrides used by meetings/routing.ts.
const RoutingRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  project: z.string().optional(),
  titleKeywords: z.array(z.string()).default([]),
  attendeeEmails: z.array(z.string()).default([]),
  granolaFolderName: z.string().optional(),
  discordChannelId: z.string().optional(),
  notionDataSourceId: z.string().optional(),
  publishMode: z.enum(["approval", "auto", "draft"]).default("approval"),
  isActive: z.boolean().default(true),
});

/** A meeting routing rule; see resolveMeetingRoute for how rules are scored. */
export type RoutingRuleConfig = z.infer<typeof RoutingRuleSchema>;

/**
 * Validator for the settings file. Applies defaults (11:45 standup, 09:30 and
 * 11:15 reminders, America/New_York, manual Granola mode, "approval" publishing)
 * and treats empty-string URLs/emails as unset.
 */
export const AppSettingsSchema = z.object({
  discord: z.object({
    clientId: z.string().optional(),
    guildId: z.string().optional(),
    standupChannelId: z.string().optional(),
    meetingChannelId: z.string().optional(),
    adminRoleIds: z.array(z.string()).default([]),
  }),
  notion: z.object({
    standupDataSourceId: z.string().optional(),
    meetingNotesDataSourceId: z.string().optional(),
    meetingNotesDatabaseUrl: optionalUrl,
  }),
  standup: z.object({
    enabled: z.boolean().default(true),
    standupTime: hhmm.default("11:45"),
    reminderTime: hhmm.default("09:30"),
    preStandupReminderTime: hhmm.default("11:15"),
    timezone: z.string().min(1).default("America/New_York"),
    formUrl: optionalUrl,
  }),
  // Only "manual" and "zapier-webhook" modes do anything today. "api-poll",
  // folderName, and pollIntervalMinutes are reserved for a Granola API poller
  // that does not exist yet; diagnostics warns when "api-poll" is selected.
  granola: z.object({
    mode: z.enum(["manual", "zapier-webhook", "api-poll"]).default("manual"),
    folderName: z.string().optional(),
    pollIntervalMinutes: z.number().int().min(1).max(1440).default(15),
    defaultPublishMode: z.enum(["approval", "auto", "draft"]).default("approval"),
  }),
  roster: z.array(PersonSchema).default([]),
  routingRules: z.array(RoutingRuleSchema).default([]),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

/** Flat runtime config for the Discord bot and Notion client; built by loadConfig. */
export interface Config {
  DISCORD_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_GUILD_ID: string;
  DISCORD_STANDUP_CHANNEL_ID: string;
  DISCORD_MEETING_CHANNEL_ID?: string;
  NOTION_TOKEN: string;
  /** The standup Notion *data source* id (named for the legacy env var); see settings.notion.standupDataSourceId. */
  NOTION_DATABASE_ID: string;
  NOTION_MEETING_NOTES_DATA_SOURCE_ID?: string;
  STANDUP_TIME: string;
  REMINDER_TIME: string;
  PRE_STANDUP_REMINDER_TIME: string;
  STANDUP_FORM_URL?: string;
  TIMEZONE: string;
}

// Placeholder roster used only until a settings file supplies a real one.
const defaultRoster: PersonConfig[] = [
  {
    name: "Example Engineer",
    discordUserId: "000000000000000000",
    notionName: "Example Engineer",
    team: "Engineering",
    isActive: true,
  },
];

function settingsPath(): string {
  return env("PERRY_CONFIG_PATH") ?? join(process.cwd(), "data", "perry.config.json");
}

// The baseline settings when no file exists (or for keys the file omits).
// NOTION_STANDUP_DATA_SOURCE_ID wins over the legacy NOTION_DATABASE_ID.
function defaultsFromEnv(): AppSettings {
  return AppSettingsSchema.parse({
    discord: {
      clientId: env("DISCORD_CLIENT_ID"),
      guildId: env("DISCORD_GUILD_ID"),
      standupChannelId: env("DISCORD_STANDUP_CHANNEL_ID"),
      meetingChannelId: env("DISCORD_MEETING_CHANNEL_ID"),
      adminRoleIds: parseList(env("DISCORD_ADMIN_ROLE_IDS")),
    },
    notion: {
      standupDataSourceId: env("NOTION_STANDUP_DATA_SOURCE_ID") ?? env("NOTION_DATABASE_ID"),
      meetingNotesDataSourceId: env("NOTION_MEETING_NOTES_DATA_SOURCE_ID"),
      meetingNotesDatabaseUrl: env("NOTION_MEETING_NOTES_DATABASE_URL"),
    },
    standup: {
      enabled: env("STANDUP_ENABLED") === "false" ? false : true,
      standupTime: env("STANDUP_TIME") ?? "11:45",
      reminderTime: env("REMINDER_TIME") ?? "09:30",
      preStandupReminderTime: env("PRE_STANDUP_REMINDER_TIME") ?? "11:15",
      timezone: env("TIMEZONE") ?? "America/New_York",
      formUrl: env("STANDUP_FORM_URL"),
    },
    granola: {
      mode: parseGranolaMode(env("GRANOLA_MODE")),
      folderName: env("GRANOLA_FOLDER_NAME"),
      pollIntervalMinutes: positiveNumber(env("GRANOLA_POLL_INTERVAL_MINUTES"), 15),
      defaultPublishMode: parsePublishMode(env("PERRY_DEFAULT_PUBLISH_MODE")),
    },
    roster: defaultRoster,
    routingRules: [],
  });
}

/**
 * Reads the settings file merged over env defaults (file wins). Returns the
 * env defaults when the file is missing; throws on malformed JSON or a
 * schema violation. Reads the file synchronously on every call.
 */
export function loadAppSettings(): AppSettings {
  const defaults = defaultsFromEnv();
  const path = settingsPath();
  if (!existsSync(path)) return defaults;

  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AppSettings>;
  return AppSettingsSchema.parse(mergeSettings(defaults, raw));
}

/** Validates and writes the whole settings file (creating its directory); returns the parsed settings. Throws on invalid input. */
export function saveAppSettings(settings: AppSettings): AppSettings {
  const parsed = AppSettingsSchema.parse(settings);
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed;
}

/** PERRY_CONFIG_PATH, or ./data/perry.config.json relative to the process cwd. */
export function getSettingsPath(): string {
  return settingsPath();
}

/**
 * Builds the runtime Config from loadAppSettings, so a value saved in the
 * settings file wins over its env var (which is only the default). DISCORD_TOKEN
 * and NOTION_TOKEN are env-only. Throws listing every missing required value
 * (Discord token, client, guild, standup channel; Notion token and standup data
 * source).
 */
export function loadConfig(): Config {
  const settings = loadAppSettings();
  const required = {
    DISCORD_TOKEN: env("DISCORD_TOKEN"),
    DISCORD_CLIENT_ID: settings.discord.clientId,
    DISCORD_GUILD_ID: settings.discord.guildId,
    DISCORD_STANDUP_CHANNEL_ID: settings.discord.standupChannelId,
    NOTION_TOKEN: env("NOTION_TOKEN"),
    NOTION_DATABASE_ID: settings.notion.standupDataSourceId,
  };

  const result = z
    .object({
      DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
      DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
      DISCORD_GUILD_ID: z.string().min(1, "DISCORD_GUILD_ID is required"),
      DISCORD_STANDUP_CHANNEL_ID: z.string().min(1, "DISCORD_STANDUP_CHANNEL_ID is required"),
      NOTION_TOKEN: z.string().min(1, "NOTION_TOKEN is required"),
      NOTION_DATABASE_ID: z.string().min(1, "NOTION_STANDUP_DATA_SOURCE_ID is required"),
    })
    .safeParse(required);

  if (!result.success) {
    const errors = result.error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return {
    ...result.data,
    DISCORD_MEETING_CHANNEL_ID: settings.discord.meetingChannelId,
    NOTION_MEETING_NOTES_DATA_SOURCE_ID: settings.notion.meetingNotesDataSourceId,
    STANDUP_TIME: settings.standup.standupTime,
    REMINDER_TIME: settings.standup.reminderTime,
    PRE_STANDUP_REMINDER_TIME: settings.standup.preStandupReminderTime,
    STANDUP_FORM_URL: settings.standup.formUrl,
    TIMEZONE: settings.standup.timezone,
  };
}

/**
 * Reads an environment variable, treating blank values as unset. `.env.example`
 * ships every key with an empty value; without this, a copied-but-unfilled line
 * would shadow the value saved in the admin UI (and a blank PERRY_CONFIG_PATH
 * would point settings at "").
 */
function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** A positive finite number, else `fallback` (keeps a typo from failing schema validation on every load). */
function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseGranolaMode(value: string | undefined): AppSettings["granola"]["mode"] {
  if (value === "zapier-webhook" || value === "api-poll") return value;
  return "manual";
}

// One level deep: a section in the file overrides only the keys it sets, but
// a roster or routingRules array in the file replaces the default entirely.
// Blank strings and nulls in the file count as unset, like blank env values, so
// a field left empty in the admin UI falls back to its env default.
function mergeSettings(defaults: AppSettings, override: Partial<AppSettings>): AppSettings {
  return {
    discord: { ...defaults.discord, ...setKeys(override.discord) },
    notion: { ...defaults.notion, ...setKeys(override.notion) },
    standup: { ...defaults.standup, ...setKeys(override.standup) },
    granola: { ...defaults.granola, ...setKeys(override.granola) },
    roster: override.roster ?? defaults.roster,
    routingRules: override.routingRules ?? defaults.routingRules,
  };
}

function setKeys<T extends object>(section: T | undefined): Partial<T> {
  if (!section) return {};
  return Object.fromEntries(
    Object.entries(section).filter(([, value]) => value !== null && value !== undefined && !(typeof value === "string" && value.trim() === ""))
  ) as Partial<T>;
}

function parsePublishMode(value: string | undefined): AppSettings["granola"]["defaultPublishMode"] {
  if (value === "auto" || value === "draft") return value;
  return "approval";
}
