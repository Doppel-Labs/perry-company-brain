// Model-supplied due dates must be supported by the note (Codex review on
// Doppel-Labs #4): a valid ISO date is not evidence on its own.
import assert from "node:assert/strict";
import test from "node:test";
import { extractMeetingKnowledge, groundDueDate, supportedDueDates } from "@extraction";
import type { MeetingNote } from "@meetings";

// Monday 26 October 2026, 15:00 UTC (11:00 in New York).
const meeting = "2026-10-26T15:00:00.000Z";

test("an invented ISO date in an undated note is dropped (the reported case)", async () => {
  const note: MeetingNote = {
    source: "granola",
    sourceId: "undated",
    title: "Onboarding sync",
    attendees: [{ name: "Ada Lovelace" }],
    summaryMarkdown: "Ship the onboarding checklist.",
  };
  const knowledge = await extractMeetingKnowledge(note, {
    mode: "llm",
    people: ["Ada Lovelace"],
    extractor: async () => ({
      decisions: [],
      actionItems: [{ text: "Ship the onboarding checklist", owner: "Ada", dueDate: "1999-01-01" }],
      entities: [],
      confidence: 0.9,
    }),
  });
  assert.deepEqual(knowledge.actionItems, [{ text: "Ship the onboarding checklist", owner: "Ada Lovelace", dueDate: undefined }]);
});

test("an ISO date is kept when the note states it or a phrase resolves to it", () => {
  const cases: Array<[string, string]> = [
    ["Ship it by 2026-11-02.", "2026-11-02"],
    ["Ship it today.", "2026-10-26"],
    ["Ship it tomorrow.", "2026-10-27"],
    ["Ship it next week.", "2026-11-02"],
    ["Ship it by Friday.", "2026-10-30"],
    ["Ship it by Fri.", "2026-10-30"],
    ["Ship it by end of week.", "2026-10-30"],
    ["Ship it next Friday.", "2026-11-06"],
    ["Ship it by Nov 2.", "2026-11-02"],
    ["Ship it by November 2nd.", "2026-11-02"],
    ["Ship it by 2 November.", "2026-11-02"],
    ["Ship it by 11/2.", "2026-11-02"],
    ["Ship it by Jan 15.", "2027-01-15"], // already past this year, so next January
  ];
  for (const [source, iso] of cases) {
    assert.equal(groundDueDate(iso, source, meeting, "America/New_York"), iso, source);
  }
});

test("an ISO date the note does not support is dropped", () => {
  const cases: Array<[string, string]> = [
    ["Ship it tomorrow.", "2026-10-28"], // the day after tomorrow
    ["Ship it by Friday.", "2026-10-29"], // Thursday
    ["Ship it by Nov 2.", "2026-11-03"],
    ["Ship it soon.", "2026-10-27"],
    ["Ship it by 2026-11-02.", "2026-11-20"],
    ["Ship it on Feb 30.", "2027-03-02"], // no such date; never rolled over
  ];
  for (const [source, iso] of cases) {
    assert.equal(groundDueDate(iso, source, meeting, "America/New_York"), undefined, `${source} -> ${iso}`);
  }
});

test("without a meeting date only fully written dates can be confirmed", () => {
  assert.equal(groundDueDate("2026-10-27", "Ship it tomorrow."), undefined);
  assert.equal(groundDueDate("2026-11-02", "Ship it by 2026-11-02."), "2026-11-02");
  assert.equal(groundDueDate("2026-11-02", "Ship it by November 2, 2026."), "2026-11-02");
});

test("'tomorrow' is read in the meeting's own timezone as well as UTC", () => {
  // 03:00 UTC on 27 Oct is still 26 Oct (23:00) in New York.
  const lateEvening = "2026-10-27T03:00:00.000Z";
  assert.equal(groundDueDate("2026-10-27", "Ship it tomorrow.", lateEvening, "America/New_York"), "2026-10-27");
  assert.equal(groundDueDate("2026-10-28", "Ship it tomorrow.", lateEvening, "America/New_York"), "2026-10-28");
  assert.equal(groundDueDate("2026-10-27", "Ship it tomorrow.", lateEvening), undefined, "UTC alone reads tomorrow as the 28th");
  assert.ok(supportedDueDates("Ship it tomorrow.", lateEvening, "Not/A_Zone").has("2026-10-28"), "a bad timezone falls back to UTC");
});

test("non-ISO due phrases still need to appear verbatim", () => {
  assert.equal(groundDueDate("end of sprint", "Ship it by end of sprint."), "end of sprint");
  assert.equal(groundDueDate("next quarter", "Ship it soon."), undefined);
  assert.equal(groundDueDate("   ", "Ship it soon."), undefined);
});
