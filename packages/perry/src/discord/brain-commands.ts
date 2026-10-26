// brain-commands — /brain: ephemeral, role-gated reads of company knowledge.
import type { ChatInputCommandInteraction } from "discord.js";
import { formatOntologyChangedSince, formatOntologyEvidence, formatOntologyState } from "@brain";
import {
  type CompanyOntologyEntityType,
  findPersonByDiscordId,
  loadAppSettings,
  personStableKey,
  projectStableKey,
} from "@core";
import { getGraphEntityContext, listGraphEntities } from "@graph";
import { listOpenActionItemsByOwners, listPivots } from "@store";
import { hasBrainCommandAccess, interactionRoleIds } from "./access";

/**
 * Handles `/brain`. The caller must hold a role in settings.discord.adminRoleIds
 * (DISCORD_ADMIN_ROLE_IDS); every reply is ephemeral. project/owner/why read graph memory by stable key;
 * state/changed/evidence read the ontology; my-actions and recent-pivots read
 * the store.
 */
export async function handleBrainInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  const settings = loadAppSettings();
  if (!hasBrainCommandAccess({ roleIds: interactionRoleIds(interaction), adminRoleIds: settings.discord.adminRoleIds })) {
    const content = settings.discord.adminRoleIds.length
      ? "You do not have access to Perry brain commands."
      : "Perry brain commands are disabled until an admin configures DISCORD_ADMIN_ROLE_IDS.";
    await interaction.reply({ content, ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case "project": {
      const name = interaction.options.getString("name", true);
      await interaction.reply({ content: await formatEntityContext(projectStableKey(name), name), ephemeral: true });
      break;
    }
    case "owner": {
      const name = interaction.options.getString("name", true);
      const entities = await listGraphEntities({ query: name, type: "person", limit: 1 });
      const stableKey = entities.entities[0]?.stableKey ?? personStableKey(name);
      await interaction.reply({ content: await formatEntityContext(stableKey, name), ephemeral: true });
      break;
    }
    case "state": {
      const type = interaction.options.getString("type", true) as CompanyOntologyEntityType;
      await interaction.reply({
        content: formatOntologyState({
          type,
          project: interaction.options.getString("project") ?? undefined,
          q: interaction.options.getString("q") ?? undefined,
          limit: interaction.options.getInteger("limit") ?? undefined,
        }),
        ephemeral: true,
      });
      break;
    }
    case "changed": {
      await interaction.reply({
        content: formatOntologyChangedSince({
          since: interaction.options.getString("since", true),
          project: interaction.options.getString("project") ?? undefined,
          limit: interaction.options.getInteger("limit") ?? undefined,
        }),
        ephemeral: true,
      });
      break;
    }
    case "evidence": {
      await interaction.reply({ content: formatOntologyEvidence(interaction.options.getString("entity", true)), ephemeral: true });
      break;
    }
    case "my-actions": {
      await interaction.reply({ content: formatMyActions(interaction.user), ephemeral: true });
      break;
    }
    case "recent-pivots": {
      const pivots = listPivots({ limit: 8 });
      const lines = pivots.map((pivot) => `- ${pivot.subject}: ${pivot.previousOwner ?? "unassigned"} -> ${pivot.newOwner ?? "unassigned"} (${pivot.project ?? "no project"})`);
      await interaction.reply({ content: lines.length ? `Recent pivots:\n${lines.join("\n")}` : "No recent pivots found.", ephemeral: true });
      break;
    }
    case "why": {
      const stableKey = interaction.options.getString("entity", true);
      await interaction.reply({ content: await formatEntityContext(stableKey, stableKey), ephemeral: true });
      break;
    }
    default:
      await interaction.reply({ content: "Unknown brain command", ephemeral: true });
  }
}

/**
 * The owner names that count as the caller for /brain my-actions. A caller on
 * the roster (matched by Discord user id) is every name the roster knows them
 * by: their name and Notion name. Otherwise it falls back to their Discord
 * global name and username. Owners are matched exactly, ignoring case.
 */
export function ownerNamesFor(user: { id: string; username: string; globalName?: string | null }): { label: string; names: string[] } {
  const person = findPersonByDiscordId(user.id);
  if (person) return { label: person.name, names: [person.name, person.notionName].filter((name): name is string => Boolean(name)) };
  const names = [user.globalName, user.username].filter((name): name is string => Boolean(name));
  return { label: names[0] ?? user.username, names };
}

/** The /brain my-actions reply: up to eight of the caller's open actions, newest first. */
export function formatMyActions(user: { id: string; username: string; globalName?: string | null }): string {
  const { label, names } = ownerNamesFor(user);
  const lines = listOpenActionItemsByOwners(names, { limit: 8 }).map(
    (action) => `- ${action.text}${action.dueDate ? ` due ${action.dueDate}` : ""}`
  );
  return lines.length ? `Open actions for ${label}:\n${lines.join("\n")}` : `No open actions found for ${label}.`;
}

/** Renders up to six active graph facts for an entity, or a reason none could be read. */
async function formatEntityContext(stableKey: string, label: string): Promise<string> {
  const context = await getGraphEntityContext(stableKey, 8);
  if (!context.enabled) return "Graph memory is not enabled.";
  if (context.error) return `Graph read failed: ${context.error}`;
  if (!context.entity) return `No graph entity found for ${label} (${stableKey}).`;
  const facts = context.facts.slice(0, 6).map((row) => {
    const fact = row.fact;
    return `- ${fact?.subjectKey ?? stableKey} ${fact?.relation ?? "RELATES_TO"} ${fact?.objectKey ?? "unknown"}${row.evidence?.excerpt ? `: ${truncate(row.evidence.excerpt, 120)}` : ""}`;
  });
  const retired = context.retirements.length ? `\nRetired facts: ${context.retirements.length}` : "";
  return truncate(`**${context.entity.name ?? stableKey}**\n${facts.length ? facts.join("\n") : "No active facts found."}${retired}`, 1800);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
