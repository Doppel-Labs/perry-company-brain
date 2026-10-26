// client — the Discord client instance and channel messaging helpers.
//
// With PERRY_DISCORD_DRY_RUN=true, every sender (standup, meeting, or explicit
// channel) posts nothing and returns a fake discord.example URL derived from
// the content. Channel ids come from loadAppSettings, so a channel saved in the
// admin UI wins over its env default.
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { loadAppSettings, loadConfig } from "@core";

/** Discord client instance.  Only initialised once. */
export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

/** The standup bot config (env-only tokens plus ids and schedule from settings); see @core loadConfig. */
export function getConfig() {
  return loadConfig();
}

/**
 * Resolves a text channel: from the client's cache when present, otherwise via
 * an API fetch (which also caches it). Throws if the channel does not exist, is
 * not visible to the bot, or is not a text channel.
 */
async function getTextChannel(channelId: string): Promise<TextChannel> {
  const channel = client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Discord channel ${channelId} not found or is not a text channel`);
  }
  return channel;
}

/**
 * Posts to the standup channel (settings, defaulting to DISCORD_STANDUP_CHANNEL_ID)
 * and returns the message URL. Throws if no standup channel is configured.
 */
export async function sendToStandupChannel(content: string): Promise<string> {
  if (isDiscordDryRun()) {
    return dryRunMessageUrl("standup", content);
  }
  const channelId = loadAppSettings().discord.standupChannelId;
  if (!channelId) {
    throw new Error("No Discord standup channel is configured");
  }
  const channel = await getTextChannel(channelId);
  const message = await channel.send(content);
  return message.url;
}

/**
 * Posts meeting notes and returns the message URL. Uses the meeting channel,
 * else the standup channel (each from settings, defaulting to its env var);
 * throws if neither is set.
 */
export async function sendToMeetingChannel(content: string): Promise<string> {
  if (isDiscordDryRun()) {
    return dryRunMessageUrl("meeting", content);
  }
  const settings = loadAppSettings();
  const channelId = settings.discord.meetingChannelId ?? settings.discord.standupChannelId;
  if (!channelId) {
    throw new Error("No Discord meeting or standup channel is configured");
  }
  const channel = await getTextChannel(channelId);
  const message = await channel.send(content);
  return message.url;
}

/** Posts to a specific channel and returns the message URL. */
export async function sendToChannel(channelId: string, content: string): Promise<string> {
  if (isDiscordDryRun()) {
    return dryRunMessageUrl(channelId, content);
  }
  const channel = await getTextChannel(channelId);
  const message = await channel.send(content);
  return message.url;
}

function isDiscordDryRun(): boolean {
  return process.env.PERRY_DISCORD_DRY_RUN === "true";
}

function dryRunMessageUrl(channelId: string, content: string): string {
  const digest = Buffer.from(content).toString("base64url").slice(0, 16);
  return `https://discord.example/perry-dry-run/${encodeURIComponent(channelId)}/${digest}`;
}

/** A text channel's name, fetched from the API when it is not cached; throws like the senders if it cannot be resolved. */
export async function fetchTextChannelName(channelId: string): Promise<string> {
  const channel = await getTextChannel(channelId);
  return channel.name;
}

/** Resolves once the client has emitted "ready" (immediately if it already has). */
export async function ensureDiscordReady(): Promise<void> {
  if (client.isReady()) return;
  await new Promise<void>((resolve) => {
    client.once("ready", () => resolve());
  });
}
