// bot — logs the client in and dispatches slash commands to their handlers.
import { handleBrainInteraction } from "./brain-commands";
import { client, getConfig } from "./client";
import { handleStandupInteraction } from "./standup-commands";

/**
 * Registers the ready and interactionCreate listeners, then logs in with
 * DISCORD_TOKEN. Resolves when login() does, which can be before the "ready"
 * event; use ensureDiscordReady to wait for it. Handler errors are logged and,
 * if nothing was sent yet, answered with an ephemeral "An error occurred."
 */
export async function startDiscord(): Promise<void> {
  const config = getConfig();
  client.once("ready", () => {
    console.log(`Logged in as ${client.user?.tag}`);
  });
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "standup" && interaction.commandName !== "brain") return;
    try {
      if (interaction.commandName === "brain") await handleBrainInteraction(interaction);
      else await handleStandupInteraction(interaction);
    } catch (err) {
      console.error(err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "An error occurred.", ephemeral: true });
      }
    }
  });
  await client.login(config.DISCORD_TOKEN);
}
