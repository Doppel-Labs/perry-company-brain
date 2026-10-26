// core/roster — the team roster, read from settings on every call.
import { loadAppSettings } from "./config";

/**
 * The roster defines who is expected to submit standup updates each day.
 */
export interface Person {
  name: string;
  discordUserId: string;
  notionName?: string;
  team?: string;
  timezone?: string;
  isActive?: boolean;
}

/** Every roster entry, including inactive people. Re-reads the settings file. */
export function getRoster(): Person[] {
  return loadAppSettings().roster;
}

/** The active roster entry for a Discord user id, or undefined when absent or `isActive: false`. */
export function findPersonByDiscordId(userId: string): Person | undefined {
  return getRoster().find((person) => person.discordUserId === userId && person.isActive !== false);
}

/** Roster entries not explicitly marked `isActive: false` (a missing flag counts as active). */
export function getActiveRoster(): Person[] {
  return getRoster().filter((person) => person.isActive !== false);
}
