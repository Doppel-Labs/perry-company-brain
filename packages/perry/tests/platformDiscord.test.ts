import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TextChannel } from "discord.js";
import { loadAppSettings } from "@core";
import { client, fetchTextChannelName, sendToMeetingChannel, sendToStandupChannel, standupJobs } from "@discord";

const keys = ["PERRY_CONFIG_PATH", "PERRY_DISCORD_DRY_RUN", "DISCORD_STANDUP_CHANNEL_ID", "DISCORD_MEETING_CHANNEL_ID", "STANDUP_ENABLED"];

async function withEnv(fileSettings: unknown, envValues: Record<string, string>, run: () => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "perry-discord-"));
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const configPath = join(dir, "perry.config.json");
  writeFileSync(configPath, JSON.stringify(fileSettings));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { PERRY_CONFIG_PATH: configPath }, envValues);
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A TextChannel stand-in that records sends, plus a channels.fetch stub that serves it. */
function stubChannelFetch(channels: Record<string, { name: string; sent: string[] }>): () => void {
  const fetched: string[] = [];
  const original = client.channels.fetch;
  (client.channels as any).fetch = async (id: string) => {
    fetched.push(id);
    const spec = channels[id];
    if (!spec) throw new Error("Unknown Channel");
    const channel = Object.create(TextChannel.prototype) as TextChannel;
    Object.defineProperty(channel, "name", { value: spec.name });
    Object.defineProperty(channel, "send", {
      value: async (content: string) => {
        spec.sent.push(content);
        return { url: `https://discord.test/${id}` };
      },
    });
    return channel;
  };
  return () => {
    (client.channels as any).fetch = original;
  };
}

test("standup jobs are not scheduled when standups are disabled", async () => {
  await withEnv({ standup: { enabled: false } }, {}, () => {
    assert.deepEqual(standupJobs(loadAppSettings().standup), []);
  });
  await withEnv({}, { STANDUP_ENABLED: "false" }, () => {
    assert.deepEqual(standupJobs(loadAppSettings().standup), []);
  });
});

test("standup jobs run at the configured reminder, pre-standup, and summary times", async () => {
  await withEnv({ standup: { reminderTime: "09:05", preStandupReminderTime: "11:15", standupTime: "11:45" } }, {}, () => {
    const jobs = standupJobs(loadAppSettings().standup);
    assert.deepEqual(
      jobs.map((job) => [job.name, job.expression]),
      [
        ["reminder", "0 5 9 * * *"],
        ["pre-standup-reminder", "0 15 11 * * *"],
        ["summary", "0 45 11 * * *"],
      ]
    );
  });
});

test("standup channel sends honour PERRY_DISCORD_DRY_RUN", async () => {
  await withEnv({}, { PERRY_DISCORD_DRY_RUN: "true" }, async () => {
    const restore = stubChannelFetch({});
    try {
      // No standup channel is configured and none is fetched: dry run never touches Discord.
      const url = await sendToStandupChannel("Standup summary");
      assert.match(url, /^https:\/\/discord\.example\/perry-dry-run\/standup\//u);
    } finally {
      restore();
    }
  });
});

test("standup and meeting sends use the channel saved in settings over env", async () => {
  await withEnv(
    { discord: { standupChannelId: "saved-standup", meetingChannelId: "saved-meeting" } },
    { DISCORD_STANDUP_CHANNEL_ID: "env-standup", DISCORD_MEETING_CHANNEL_ID: "env-meeting" },
    async () => {
      const savedStandup = { name: "standup", sent: [] as string[] };
      const savedMeeting = { name: "meetings", sent: [] as string[] };
      const restore = stubChannelFetch({ "saved-standup": savedStandup, "saved-meeting": savedMeeting });
      try {
        assert.equal(await sendToStandupChannel("reminder"), "https://discord.test/saved-standup");
        assert.equal(await sendToMeetingChannel("notes"), "https://discord.test/saved-meeting");
        assert.deepEqual(savedStandup.sent, ["reminder"]);
        assert.deepEqual(savedMeeting.sent, ["notes"]);
      } finally {
        restore();
      }
    }
  );
});

test("fetchTextChannelName fetches a channel that is not in the cache", async () => {
  const restore = stubChannelFetch({ "uncached-channel": { name: "engineering", sent: [] } });
  try {
    assert.equal(client.channels.cache.has("uncached-channel"), false);
    assert.equal(await fetchTextChannelName("uncached-channel"), "engineering");
    await assert.rejects(() => fetchTextChannelName("missing-channel"), /not found or is not a text channel/u);
  } finally {
    restore();
  }
});
