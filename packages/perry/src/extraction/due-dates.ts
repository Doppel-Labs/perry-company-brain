// extraction/due-dates — decides whether a model-supplied due date is supported
// by the meeting note.
//
// A valid date format is not evidence: a model asked for due dates will happily
// invent one. A due date is kept only when the note itself supports it, either
// literally or through a phrase that resolves to exactly that date from the
// meeting's date:
//
//   ISO date in the note       "2026-11-02"
//   relative day               "today", "tomorrow", "next week" (+7 days)
//   weekday                    "Friday", "by Fri", "next Friday", "end of week" (Friday)
//   month and day              "Nov 2", "November 2nd", "2 November", "11/2"
//   ...with an explicit year   "November 2, 2026"
//
// Relative phrases need the meeting's date (`startedAt`); without it, only
// dates written out in full (ISO, or month-day-year) can be confirmed. Because
// "tomorrow" depends on where the meeting happened, the meeting day is taken
// both in UTC and in the configured timezone, and a date matching either counts.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_MS = 86_400_000;

/**
 * Returns the due date to keep, or undefined. An ISO date is kept (as
 * YYYY-MM-DD) only when the note supports it as described above. Any other
 * value is a phrase and is kept only if it appears verbatim in the note.
 */
export function groundDueDate(dueDate: string | undefined, source: string, meetingDate?: string, timeZone?: string): string | undefined {
  const value = dueDate?.trim();
  if (!value) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}/u.test(value) ? toIsoDay(value.slice(0, 10)) : undefined;
  if (iso) return supportedDueDates(source, meetingDate, timeZone).has(iso) ? iso : undefined;
  return source.toLowerCase().includes(value.toLowerCase()) ? value : undefined;
}

/** Every calendar date (YYYY-MM-DD) that some expression in `source` can mean, relative to the meeting day(s). */
export function supportedDueDates(source: string, meetingDate?: string, timeZone?: string): Set<string> {
  const text = source.toLowerCase();
  const dates = new Set<string>();
  const add = (day: number | undefined) => {
    if (day !== undefined) dates.add(new Date(day).toISOString().slice(0, 10));
  };

  // Written out in full: no reference date needed.
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/gu)) add(utcDay(+match[1], +match[2], +match[3]));
  for (const { month, day, year } of monthDayMentions(text)) if (year !== undefined) add(utcDay(year, month, day));

  for (const reference of referenceDays(meetingDate, timeZone)) {
    const year = new Date(reference).getUTCFullYear();
    if (/\btoday\b|\bend of (?:the )?day\b|\beod\b/u.test(text)) add(reference);
    if (/\btomorrow\b/u.test(text)) add(reference + DAY_MS);
    if (/\bnext week\b/u.test(text)) add(reference + 7 * DAY_MS);
    if (/\bend of (?:the )?week\b|\beow\b/u.test(text)) add(nextWeekday(reference, 5, false));

    for (const match of text.matchAll(/\b(next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/gu)) {
      const weekday = WEEKDAYS.indexOf(match[2]);
      // "Friday" is the coming one; "next Friday" may mean that or the one after.
      add(nextWeekday(reference, weekday, false));
      if (match[1]) add(nextWeekday(reference, weekday, true));
    }

    for (const { month, day, year: explicit } of monthDayMentions(text)) {
      if (explicit !== undefined) continue;
      // A month-day with no year is this year's, or next year's once it has passed.
      const thisYear = utcDay(year, month, day);
      if (thisYear === undefined) continue;
      add(thisYear >= reference ? thisYear : utcDay(year + 1, month, day));
    }
    for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\b(?!\/)/gu)) {
      const thisYear = utcDay(year, +match[1], +match[2]);
      if (thisYear !== undefined) add(thisYear >= reference ? thisYear : utcDay(year + 1, +match[1], +match[2]));
    }
  }
  return dates;
}

/** "Nov 2", "November 2nd, 2026", "2 November", "2nd of Nov 2026". */
function monthDayMentions(text: string): Array<{ month: number; day: number; year?: number }> {
  const month = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
  const day = "(\\d{1,2})(?:st|nd|rd|th)?";
  const year = "(?:,?\\s+(\\d{4}))?";
  const mentions: Array<{ month: number; day: number; year?: number }> = [];
  for (const match of text.matchAll(new RegExp(`\\b${month}\\s+${day}\\b${year}`, "gu"))) {
    mentions.push({ month: MONTHS.indexOf(match[1]) + 1, day: +match[2], year: match[3] ? +match[3] : undefined });
  }
  for (const match of text.matchAll(new RegExp(`\\b${day}\\s+(?:of\\s+)?${month}${year}`, "gu"))) {
    mentions.push({ month: MONTHS.indexOf(match[2]) + 1, day: +match[1], year: match[3] ? +match[3] : undefined });
  }
  return mentions;
}

/** The meeting's calendar day as UTC midnight, in UTC and in `timeZone` (deduplicated). */
function referenceDays(meetingDate: string | undefined, timeZone: string | undefined): number[] {
  if (!meetingDate) return [];
  const instant = new Date(meetingDate);
  if (Number.isNaN(instant.getTime())) return [];
  const days = new Set([utcDay(instant.getUTCFullYear(), instant.getUTCMonth() + 1, instant.getUTCDate())!]);
  if (timeZone) {
    try {
      const local = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
      const parsed = toIsoDay(local);
      if (parsed) days.add(Date.parse(parsed));
    } catch {
      // An invalid timezone setting leaves the UTC day only.
    }
  }
  return [...days];
}

/** The first `weekday` (0 = Sunday) strictly after `reference`, or the one a week later when `following`. */
function nextWeekday(reference: number, weekday: number, following: boolean): number {
  const current = new Date(reference).getUTCDay();
  const ahead = ((weekday - current + 7) % 7) || 7;
  return reference + (ahead + (following ? 7 : 0)) * DAY_MS;
}

/** UTC midnight of a real calendar date, or undefined (so Feb 30 is rejected rather than rolled over). */
function utcDay(year: number, month: number, day: number): number | undefined {
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? time : undefined;
}

function toIsoDay(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const time = match ? utcDay(+match[1], +match[2], +match[3]) : undefined;
  return time === undefined ? undefined : new Date(time).toISOString().slice(0, 10);
}
