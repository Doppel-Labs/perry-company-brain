import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadAppSettings, loadConfig } from "@core";

const keys = [
  "PERRY_CONFIG_PATH",
  "DISCORD_TOKEN",
  "NOTION_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "DISCORD_STANDUP_CHANNEL_ID",
  "DISCORD_MEETING_CHANNEL_ID",
  "NOTION_STANDUP_DATA_SOURCE_ID",
  "NOTION_DATABASE_ID",
  "NOTION_MEETING_NOTES_DATA_SOURCE_ID",
  "STANDUP_TIME",
  "REMINDER_TIME",
  "PRE_STANDUP_REMINDER_TIME",
  "STANDUP_FORM_URL",
  "TIMEZONE",
];

function withConfig(fileSettings: unknown, envValues: Record<string, string>, run: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), "perry-config-precedence-"));
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const configPath = join(dir, "perry.config.json");
  writeFileSync(configPath, JSON.stringify(fileSettings));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { PERRY_CONFIG_PATH: configPath, DISCORD_TOKEN: "env-token", NOTION_TOKEN: "env-notion" }, envValues);
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("loadConfig lets saved settings win over env for every editable setting", () => {
  withConfig(
    {
      discord: { clientId: "saved-client", guildId: "saved-guild", standupChannelId: "saved-standup", meetingChannelId: "saved-meeting" },
      notion: { standupDataSourceId: "saved-standup-source", meetingNotesDataSourceId: "saved-meeting-source" },
      standup: {
        standupTime: "10:00",
        reminderTime: "08:00",
        preStandupReminderTime: "09:45",
        timezone: "Europe/London",
        formUrl: "https://saved.example/form",
      },
    },
    {
      DISCORD_CLIENT_ID: "env-client",
      DISCORD_GUILD_ID: "env-guild",
      DISCORD_STANDUP_CHANNEL_ID: "env-standup",
      DISCORD_MEETING_CHANNEL_ID: "env-meeting",
      NOTION_STANDUP_DATA_SOURCE_ID: "env-standup-source",
      NOTION_DATABASE_ID: "env-legacy-db",
      NOTION_MEETING_NOTES_DATA_SOURCE_ID: "env-meeting-source",
      STANDUP_TIME: "11:45",
      REMINDER_TIME: "09:30",
      PRE_STANDUP_REMINDER_TIME: "11:15",
      STANDUP_FORM_URL: "https://env.example/form",
      TIMEZONE: "America/New_York",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.DISCORD_TOKEN, "env-token");
      assert.equal(config.DISCORD_CLIENT_ID, "saved-client");
      assert.equal(config.DISCORD_GUILD_ID, "saved-guild");
      assert.equal(config.DISCORD_STANDUP_CHANNEL_ID, "saved-standup");
      assert.equal(config.DISCORD_MEETING_CHANNEL_ID, "saved-meeting");
      assert.equal(config.NOTION_DATABASE_ID, "saved-standup-source");
      assert.equal(config.NOTION_MEETING_NOTES_DATA_SOURCE_ID, "saved-meeting-source");
      assert.equal(config.STANDUP_TIME, "10:00");
      assert.equal(config.REMINDER_TIME, "08:00");
      assert.equal(config.PRE_STANDUP_REMINDER_TIME, "09:45");
      assert.equal(config.STANDUP_FORM_URL, "https://saved.example/form");
      assert.equal(config.TIMEZONE, "Europe/London");
    }
  );
});

test("env values are defaults for settings the file does not set", () => {
  withConfig(
    { discord: { clientId: "saved-client" } },
    {
      DISCORD_GUILD_ID: "env-guild",
      DISCORD_STANDUP_CHANNEL_ID: "env-standup",
      NOTION_DATABASE_ID: "env-legacy-db",
      STANDUP_TIME: "12:30",
      TIMEZONE: "Asia/Tokyo",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.DISCORD_CLIENT_ID, "saved-client");
      assert.equal(config.DISCORD_GUILD_ID, "env-guild");
      assert.equal(config.DISCORD_STANDUP_CHANNEL_ID, "env-standup");
      assert.equal(config.NOTION_DATABASE_ID, "env-legacy-db");
      assert.equal(config.STANDUP_TIME, "12:30");
      assert.equal(config.TIMEZONE, "Asia/Tokyo");
    }
  );
});

test("NOTION_STANDUP_DATA_SOURCE_ID is preferred over the legacy NOTION_DATABASE_ID default", () => {
  withConfig({}, { NOTION_STANDUP_DATA_SOURCE_ID: "env-standup-source", NOTION_DATABASE_ID: "env-legacy-db" }, () => {
    assert.equal(loadAppSettings().notion.standupDataSourceId, "env-standup-source");
  });
});

test("blank values saved in the settings file fall back to env defaults", () => {
  withConfig(
    { discord: { guildId: "", standupChannelId: "  " }, standup: { timezone: "" } },
    { DISCORD_GUILD_ID: "env-guild", DISCORD_STANDUP_CHANNEL_ID: "env-standup", TIMEZONE: "Asia/Tokyo" },
    () => {
      const settings = loadAppSettings();
      assert.equal(settings.discord.guildId, "env-guild");
      assert.equal(settings.discord.standupChannelId, "env-standup");
      assert.equal(settings.standup.timezone, "Asia/Tokyo");
    }
  );
});
