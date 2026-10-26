// standup-commands — /standup: missing reports, summaries, reminders, form link.
import type { ChatInputCommandInteraction } from "discord.js";
import { getActiveRoster } from "@core";
import { fetchStandupEntries, findMissingStandups } from "@notion";
import { getConfig, sendToStandupChannel } from "./client";
import { formatMissing, formatSummary } from "./format";

/**
 * Handles `/standup` against today's Notion entries. `missing` and `link` reply
 * ephemerally; `summary` replies publicly; `remind` posts the missing list to
 * the standup channel.
 */
export async function handleStandupInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const today = new Date();
  switch (sub) {
    case "missing": {
      const entries = await fetchStandupEntries(today);
      const missing = findMissingStandups(entries, getActiveRoster());
      const content = formatMissing(missing, today);
      await interaction.reply({ content, ephemeral: true });
      break;
    }
    case "summary": {
      const entries = await fetchStandupEntries(today);
      const content = formatSummary(entries, today);
      await interaction.reply({ content });
      break;
    }
    case "remind": {
      const entries = await fetchStandupEntries(today);
      const missing = findMissingStandups(entries, getActiveRoster());
      const content = formatMissing(missing, today);
      await sendToStandupChannel(content);
      await interaction.reply({ content: "Reminder sent.", ephemeral: true });
      break;
    }
    case "link": {
      // Provide a link to the standup form or database.  This should be
      // customised by editing this message or adding a configuration option.
      const config = getConfig();
      await interaction.reply({
        content: config.STANDUP_FORM_URL
          ? `Please submit your standup in Notion: ${config.STANDUP_FORM_URL}`
          : "No standup form URL is configured yet.",
        ephemeral: true,
      });
      break;
    }
    default:
      await interaction.reply({ content: "Unknown subcommand", ephemeral: true });
  }
}
