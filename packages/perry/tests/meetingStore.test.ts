import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  findMeetingRecord,
  listActionItems,
  listDecisions,
  listMeetingRecords,
  flushFtsQueue,
  meetingRecordFromNote,
  replaceMeetingKnowledge,
  searchBrain,
  upsertMeetingRecord,
  closeBrainStore,
  createApproval,
  listApprovalSummaries,
  getMeetingRecord,
  meetingIdForNote,
  listOpenActionItemsByOwners,
  withDb,
} from "@store";
import type { MeetingNote } from "@meetings";

test("stores and finds processed meeting records by source id", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-store-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    const note: MeetingNote = {
      source: "granola",
      sourceId: "note-1",
      title: "Design Review",
      attendees: [],
      summaryMarkdown: "Decision: proceed.",
    };

    const record = upsertMeetingRecord({
      ...meetingRecordFromNote(note, "processed"),
      notionUrl: "https://notion.so/page",
      discordMessageUrl: "https://discord.com/channels/1/2/3",
    });

    assert.equal(findMeetingRecord(note)?.id, record.id);
    assert.equal(listMeetingRecords().length, 1);
    replaceMeetingKnowledge(record.id, {
      decisions: [{ text: "Use Notion as the source of truth." }],
      actionItems: [{ text: "Create the Discord route.", owner: "Ada" }],
    });
    flushFtsQueue(10);
    assert.equal(listDecisions().length, 1);
    assert.equal(listActionItems().length, 1);
    assert.equal(searchBrain("notion").length, 1);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("search handles dotted versions, possessives, and relevance at scale", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-store-search-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    for (let index = 0; index < 30; index += 1) {
      const note: MeetingNote = {
        source: "granola",
        sourceId: `noise-${index}`,
        title: `Perry Planning Noise ${index}`,
        attendees: [],
        summaryMarkdown: "Decision: keep generic planning notes searchable.",
      };
      const record = upsertMeetingRecord(meetingRecordFromNote(note, "processed"));
      replaceMeetingKnowledge(record.id, {
        decisions: [{ text: "Keep generic planning notes searchable." }],
        actionItems: [],
      });
    }

    const note: MeetingNote = {
      source: "granola",
      sourceId: "versioned-note",
      title: "Perry-Discord Bot v2.1 Planning Session",
      attendees: [],
      summaryMarkdown: "Decision: Deprecate Perry's v1.5 endpoint and scope Atlas v2.1 to core workflows.",
    };
    const record = upsertMeetingRecord(meetingRecordFromNote(note, "processed"));
    replaceMeetingKnowledge(record.id, {
      decisions: [{ text: "Deprecate Perry's v1.5 endpoint and scope Atlas v2.1 to core workflows." }],
      actionItems: [],
    });

    flushFtsQueue(1000);

    assert.equal(searchBrain("Perry Discord Bot v2.1 Planning", 10)[0]?.id, record.id);
    assert.ok(searchBrain("Perry's v1.5 endpoint", 10).some((result) => result.meetingId === record.id));
    assert.ok(searchBrain("Atlas v2.1 core workflows", 10).some((result) => result.meetingId === record.id));
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("lists approval summaries without requiring full JSON payload parsing", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-approval-summary-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    createApproval({
      id: "approval:note-1",
      meetingId: "granola:note-1",
      title: "Product Review",
      payloadJson: JSON.stringify({ note_id: "note-1" }),
      announcement: "Meeting notes: Product Review",
      knowledgeJson: JSON.stringify({
        decisions: [{ text: "Keep approvals lightweight." }],
        actionItems: [{ text: "Ship summary rows." }, { text: "Benchmark payloads." }],
      }),
      routeJson: JSON.stringify({ project: "Perry", reason: "Matched project route", publishMode: "approval" }),
      status: "pending",
    });

    const [summary] = listApprovalSummaries("pending");
    assert.equal(summary.title, "Product Review");
    assert.equal(summary.routeProject, "Perry");
    assert.equal(summary.routeReason, "Matched project route");
    assert.equal(summary.publishMode, "approval");
    assert.equal(summary.decisionCount, 1);
    assert.equal(summary.actionItemCount, 2);
    assert.equal("payloadJson" in summary, false);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("replaceMeetingKnowledge is atomic: a failed replace keeps the old knowledge", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-store-knowledge-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    const note: MeetingNote = {
      source: "granola",
      sourceId: "atomic-knowledge",
      title: "Atomic Knowledge",
      attendees: [],
      summaryMarkdown: "",
    };
    const record = upsertMeetingRecord(meetingRecordFromNote(note, "processed"));
    replaceMeetingKnowledge(record.id, {
      decisions: [{ text: "Original decision." }],
      actionItems: [{ text: "Original action.", owner: "Ada" }],
    });
    // Fails the replace after its deletes and the new decision have run.
    withDb((db) =>
      db.exec(`CREATE TRIGGER explode_action BEFORE INSERT ON action_items WHEN NEW.text = 'Explode'
        BEGIN SELECT RAISE(ABORT, 'action insert failed'); END;`)
    );

    assert.throws(
      () =>
        replaceMeetingKnowledge(record.id, {
          decisions: [{ text: "Replacement decision." }],
          actionItems: [{ text: "Explode" }],
        }),
      /action insert failed/u
    );

    assert.deepEqual(
      listDecisions().map((decision) => decision.text),
      ["Original decision."]
    );
    assert.deepEqual(
      listActionItems().map((action) => action.text),
      ["Original action."]
    );
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("notes without a sourceId get a stable content-derived id and dedupe", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-store-content-id-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    const note: MeetingNote = {
      source: "granola",
      title: "Untracked Sync",
      creatorEmail: "ada@example.com",
      startedAt: "2026-10-01T10:00:00.000Z",
      attendees: [],
      summaryMarkdown: "Decision: keep it.",
    };
    const first = meetingRecordFromNote(note, "processed");
    const again = meetingRecordFromNote({ ...note, summaryMarkdown: "Decision: keep it, edited." }, "processed");
    assert.match(first.id, /^granola:content:[0-9a-f]{24}$/u);
    assert.equal(again.id, first.id, "a dated note keeps its id when its summary is edited");
    assert.notEqual(meetingIdForNote({ ...note, startedAt: "2026-10-02T10:00:00.000Z" }), first.id);
    assert.notEqual(meetingIdForNote({ ...note, creatorEmail: "bo@example.com" }), first.id);

    // Undated notes that share only a title stay separate.
    const undated = { ...note, startedAt: undefined };
    assert.notEqual(meetingIdForNote(undated), meetingIdForNote({ ...undated, summaryMarkdown: "Another standup." }));

    upsertMeetingRecord(first);
    assert.equal(findMeetingRecord(note)?.id, first.id);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("meetings stored as dry-run by older versions read back as pending_approval", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-store-dry-run-migration-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    withDb((db) =>
      db
        .prepare(
          `INSERT INTO meetings (id, source, source_id, title, created_at, updated_at, status)
           VALUES ('granola:legacy', 'granola', 'legacy', 'Legacy Hold', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'dry-run')`
        )
        .run()
    );
    closeBrainStore(process.env.PERRY_DB_PATH);

    assert.equal(getMeetingRecord("granola:legacy")?.status, "pending_approval");
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("listOpenActionItemsByOwners matches owners case-insensitively and skips closed items", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-store-owner-actions-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    const note: MeetingNote = { source: "granola", sourceId: "owners", title: "Owners", attendees: [], summaryMarkdown: "" };
    const record = upsertMeetingRecord(meetingRecordFromNote(note, "processed"));
    replaceMeetingKnowledge(record.id, {
      decisions: [],
      actionItems: [
        { text: "Ada's task.", owner: " Ada " },
        { text: "Bo's task.", owner: "bo" },
        { text: "Cy's task.", owner: "Cy" },
      ],
    });
    withDb((db) => db.prepare("UPDATE action_items SET status = 'done' WHERE text = ?").run("Bo's task."));

    assert.deepEqual(
      listOpenActionItemsByOwners(["ada", "BO", " "]).map((action) => action.text),
      ["Ada's task."]
    );
    assert.deepEqual(listOpenActionItemsByOwners([]), []);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
