// jobs — the daily standup cron schedule.
//
// Three daily jobs, each a six-field node-cron expression (seconds first) in
// the configured timezone: a missing-standup reminder at the reminder time, a
// second one at the pre-standup reminder time, and the standup summary at the
// standup time. Every job reads today's entries from Notion and posts to the
// standup channel. Nothing is scheduled when standups are disabled
// (`standup.enabled` / STANDUP_ENABLED=false). Times are read once at startup.
import cron from "node-cron";
import { getActiveRoster, loadAppSettings, type AppSettings } from "@core";
import { fetchStandupEntries, findMissingStandups } from "@notion";
import { formatMissing, formatSummary } from "./format";
import { sendToStandupChannel } from "./client";

/** One scheduled standup job: its name, six-field cron expression, and callback. */
export interface StandupJob {
  name: "reminder" | "pre-standup-reminder" | "summary";
  expression: string;
  run: () => Promise<void>;
}

/** Parses a HH:MM string into numeric hours and minutes. */
function parseHHMM(time: string): { hour: number; minute: number } {
  const [hh, mm] = time.split(":").map((s) => parseInt(s, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) {
    throw new Error(`Invalid time string: ${time}`);
  }
  return { hour: hh, minute: mm };
}

function dailyAt(time: string): string {
  const { hour, minute } = parseHHMM(time);
  return `0 ${minute} ${hour} * * *`;
}

async function postMissingReminder(): Promise<void> {
  const date = new Date();
  const entries = await fetchStandupEntries(date);
  const missing = findMissingStandups(entries, getActiveRoster());
  await sendToStandupChannel(formatMissing(missing, date));
}

async function postSummary(): Promise<void> {
  const date = new Date();
  const entries = await fetchStandupEntries(date);
  await sendToStandupChannel(formatSummary(entries, date));
}

/**
 * The standup jobs the given settings call for: none when standups are
 * disabled, else the two reminders and the summary. Throws if a configured
 * time has no numeric hour and minute ("HH:MM").
 */
export function standupJobs(standup: AppSettings["standup"]): StandupJob[] {
  if (!standup.enabled) return [];
  return [
    { name: "reminder", expression: dailyAt(standup.reminderTime), run: postMissingReminder },
    { name: "pre-standup-reminder", expression: dailyAt(standup.preStandupReminderTime), run: postMissingReminder },
    { name: "summary", expression: dailyAt(standup.standupTime), run: postSummary },
  ];
}

/**
 * Schedules the daily standup reminders and summary posting from the current
 * settings, or logs and schedules nothing when standups are disabled. Throws at
 * startup if a configured time is not "HH:MM".
 */
export function scheduleJobs(): void {
  const { standup } = loadAppSettings();
  const jobs = standupJobs(standup);
  if (jobs.length === 0) {
    console.log("Standups are disabled; no standup jobs scheduled.");
    return;
  }
  for (const job of jobs) {
    cron.schedule(job.expression, guarded(job.run), { timezone: standup.timezone });
  }
  console.log(
    `Scheduled standup jobs at ${standup.reminderTime}, ${standup.preStandupReminderTime} and ${standup.standupTime} (${standup.timezone}).`
  );
}

/**
 * Wraps a cron callback so a Notion or Discord failure is logged as a failed
 * standup job and the schedule keeps running, rather than surfacing as an
 * anonymous unhandled rejection.
 */
function guarded(job: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await job();
    } catch (error) {
      console.error("Standup job failed:", error);
    }
  };
}
