import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadAppSettings, loadConfig } from "@core";

test("blank environment values do not shadow saved settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "perry-config-env-"));
  const blank = [
    "DISCORD_CLIENT_ID",
    "DISCORD_GUILD_ID",
    "DISCORD_STANDUP_CHANNEL_ID",
    "DISCORD_MEETING_CHANNEL_ID",
    "NOTION_STANDUP_DATA_SOURCE_ID",
    "NOTION_DATABASE_ID",
  ];
  const keys = ["PERRY_CONFIG_PATH", "DISCORD_TOKEN", "NOTION_TOKEN", "GRANOLA_POLL_INTERVAL_MINUTES", ...blank];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const configPath = join(dir, "perry.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      discord: { clientId: "saved-client", guildId: "saved-guild", standupChannelId: "saved-standup", meetingChannelId: "saved-channel" },
      notion: { standupDataSourceId: "saved-notion" },
    })
  );
  process.env.PERRY_CONFIG_PATH = configPath;
  process.env.DISCORD_TOKEN = "test-discord-token";
  process.env.NOTION_TOKEN = "test-notion-token";
  for (const key of blank) process.env[key] = key === "DISCORD_CLIENT_ID" ? "   " : "";
  process.env.GRANOLA_POLL_INTERVAL_MINUTES = "not-a-number";
  try {
    const settings = loadAppSettings();
    assert.equal(settings.discord.meetingChannelId, "saved-channel");
    assert.equal(settings.granola.pollIntervalMinutes, 15);
    const config = loadConfig();
    assert.equal(config.DISCORD_CLIENT_ID, "saved-client");
    assert.equal(config.DISCORD_MEETING_CHANNEL_ID, "saved-channel");
    assert.equal(config.NOTION_DATABASE_ID, "saved-notion");
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
