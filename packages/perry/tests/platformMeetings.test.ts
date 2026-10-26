import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatMeetingAnnouncement, type MeetingNote } from "@meetings";

const note: MeetingNote = {
  source: "granola",
  title: "Planning",
  attendees: [],
  startedAt: "2026-01-15T16:30:00.000Z",
  summaryMarkdown: "Summary.",
};

test("meeting announcement dates use the configured standup timezone, not the server's", () => {
  const dir = mkdtempSync(join(tmpdir(), "perry-note-tz-"));
  const previous = { config: process.env.PERRY_CONFIG_PATH, tz: process.env.TIMEZONE };
  process.env.PERRY_CONFIG_PATH = join(dir, "perry.config.json");
  writeFileSync(process.env.PERRY_CONFIG_PATH, JSON.stringify({ standup: { timezone: "Asia/Tokyo" } }));
  process.env.TIMEZONE = "America/New_York";
  try {
    assert.match(formatMeetingAnnouncement(note), /Date: Jan 16, 2026, 1:30\sAM GMT\+9/u);
    assert.match(formatMeetingAnnouncement(note, undefined, "America/New_York"), /Date: Jan 15, 2026, 11:30\sAM EST/u);
  } finally {
    if (previous.config === undefined) delete process.env.PERRY_CONFIG_PATH;
    else process.env.PERRY_CONFIG_PATH = previous.config;
    if (previous.tz === undefined) delete process.env.TIMEZONE;
    else process.env.TIMEZONE = previous.tz;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an invalid timezone leaves the raw start time instead of throwing", () => {
  assert.match(formatMeetingAnnouncement(note, undefined, "Not/AZone"), /Date: 2026-01-15T16:30:00.000Z/u);
});
