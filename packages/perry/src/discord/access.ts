// access — who may run Perry's /brain commands.
import type { ChatInputCommandInteraction } from "discord.js";

/** Fail closed: with no admin roles configured, nobody can query company knowledge. */
export function hasBrainCommandAccess(input: { roleIds: string[]; adminRoleIds: string[] }): boolean {
  if (input.adminRoleIds.length === 0) return false;
  return input.roleIds.some((roleId) => input.adminRoleIds.includes(roleId));
}

/** The invoking member's role ids, from either the raw API array or a cached GuildMember; [] outside a guild. */
export function interactionRoleIds(interaction: ChatInputCommandInteraction): string[] {
  const member = interaction.member as { roles?: string[] | { cache?: { keys(): IterableIterator<string> } } } | null;
  const roles = member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles;
  return roles.cache ? [...roles.cache.keys()] : [];
}
