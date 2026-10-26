// commands — slash command definitions and their registration with Discord.
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { discordOntologyTypes } from "@brain";
import { getConfig } from "./client";

/**
 * Slash command definitions. When adding a subcommand, also handle it in the
 * switch in `standup-commands.ts` or `brain-commands.ts`; a new top-level
 * command must also be routed in `bot.ts`.
 */
const commands = [
  new SlashCommandBuilder()
    .setName("standup")
    .setDescription("Standup commands")
    .addSubcommand((sub) =>
      sub
        .setName("missing")
        .setDescription("List people who have not submitted their standup today")
    )
    .addSubcommand((sub) =>
      sub
        .setName("summary")
        .setDescription("Post a summary of today's standups")
    )
    .addSubcommand((sub) =>
      sub
        .setName("remind")
        .setDescription("Send a standup reminder to the standup channel")
    )
    .addSubcommand((sub) =>
      sub.setName("link").setDescription("Get the link to the standup form")),
  new SlashCommandBuilder()
    .setName("brain")
    .setDescription("Query Perry company brain")
    .addSubcommand((sub) =>
      sub
        .setName("project")
        .setDescription("Show bounded graph context for a project")
        .addStringOption((option) => option.setName("name").setDescription("Project name").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("owner")
        .setDescription("Show bounded graph context for a person")
        .addStringOption((option) => option.setName("name").setDescription("Owner name").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("state")
        .setDescription("Show indexed ontology state for a project")
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("Ontology object type")
            .setRequired(true)
            .addChoices(...discordOntologyTypes.map((type) => ({ name: type.replace(/_/gu, " "), value: type })))
        )
        .addStringOption((option) => option.setName("project").setDescription("Project name"))
        .addStringOption((option) => option.setName("q").setDescription("Filter text"))
        .addIntegerOption((option) => option.setName("limit").setDescription("Rows to return, max 10"))
    )
    .addSubcommand((sub) =>
      sub
        .setName("changed")
        .setDescription("Show ontology objects changed since an ISO timestamp")
        .addStringOption((option) => option.setName("since").setDescription("ISO timestamp").setRequired(true))
        .addStringOption((option) => option.setName("project").setDescription("Project name"))
        .addIntegerOption((option) => option.setName("limit").setDescription("Rows to return, max 10"))
    )
    .addSubcommand((sub) =>
      sub
        .setName("evidence")
        .setDescription("Show bounded ontology evidence for a stable key")
        .addStringOption((option) => option.setName("entity").setDescription("Ontology stable key").setRequired(true))
    )
    .addSubcommand((sub) => sub.setName("my-actions").setDescription("List open actions that appear to belong to you"))
    .addSubcommand((sub) => sub.setName("recent-pivots").setDescription("List recent ownership pivots"))
    .addSubcommand((sub) =>
      sub
        .setName("why")
        .setDescription("Explain a graph entity by stable key")
        .addStringOption((option) => option.setName("entity").setDescription("Graph stable key").setRequired(true))
    ),
];

/** Expose the slash command data to register with Discord. */
export const slashCommandData = commands.map((c) => c.toJSON());

/**
 * Replaces the application's commands in DISCORD_GUILD_ID with this set (a
 * guild-scoped PUT via the REST API). Called at startup so definitions stay in sync.
 */
export async function registerSlashCommands(): Promise<void> {
  const config = getConfig();
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
    { body: slashCommandData }
  );
}
