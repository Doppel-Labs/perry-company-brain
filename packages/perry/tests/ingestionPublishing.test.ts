import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  approvePendingMeeting,
  enqueueGranolaIngestionJob,
  processGranolaZapierPayload,
  processNextGranolaIngestionJob,
} from "@ingestion";
import { closeBrainStore, getApproval, getMeetingRecord, listIngestionJobs, upsertMeetingRecord, withDb } from "@store";

// Notion runs as a dry run; Discord fails until PERRY_DISCORD_DRY_RUN is set,
// because no channel is configured. That is the "Notion page exists, Discord
// post failed" crash window the resumable workflow has to survive.
const managedEnv = [
  "PERRY_DB_PATH",
  "PERRY_CONFIG_PATH",
  "PERRY_DEFAULT_PUBLISH_MODE",
  "PERRY_NOTION_DRY_RUN",
  "PERRY_DISCORD_DRY_RUN",
  "DISCORD_MEETING_CHANNEL_ID",
  "DISCORD_STANDUP_CHANNEL_ID",
  "PERRY_GRAPHITI_ENABLED",
];

async function withPublishingBrain(publishMode: "auto" | "approval", run: () => Promise<void>): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-publishing-"));
  const previous = new Map(managedEnv.map((name) => [name, process.env[name]]));
  for (const name of managedEnv) delete process.env[name];
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_CONFIG_PATH = join(tempDir, "perry.config.json");
  process.env.PERRY_DEFAULT_PUBLISH_MODE = publishMode;
  process.env.PERRY_NOTION_DRY_RUN = "true";
  try {
    await run();
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// Stands in for a real Notion page: a dry-run re-run would overwrite these
// values, so seeing them survive proves the Notion step was skipped.
function pretendNotionPageWasCreated(meetingId: string): void {
  const record = getMeetingRecord(meetingId)!;
  upsertMeetingRecord({ ...record, notionPageId: "notion-page-1", notionUrl: "https://notion.so/page-1" });
}

const payload = {
  note_id: "publish-note",
  title: "Publishing Review",
  summary: "Decision: publish once.\n\nAction items:\n- Ada: Watch the retries",
};
const meetingId = "granola:publish-note";

test("a failed auto publish resumes after the Notion page instead of creating a second one", async () => {
  await withPublishingBrain("auto", async () => {
    await assert.rejects(processGranolaZapierPayload(payload), /No Discord meeting or standup channel/u);

    const partial = getMeetingRecord(meetingId);
    assert.equal(partial?.status, "publishing");
    assert.ok(partial?.notionPageId, "the Notion page id is saved as soon as the page exists");
    assert.equal(partial?.discordMessageUrl, undefined);

    pretendNotionPageWasCreated(meetingId);
    process.env.PERRY_DISCORD_DRY_RUN = "true";
    const retried = await processGranolaZapierPayload(payload);

    assert.equal(retried.record.status, "processed");
    assert.equal(retried.notionPageId, "notion-page-1");
    assert.match(retried.announcement, /https:\/\/notion\.so\/page-1/u);
    assert.match(retried.discordMessageUrl ?? "", /^https:\/\/discord\.example\/perry-dry-run\//u);
  });
});

test("a failed approval publish resumes on the next approve", async () => {
  await withPublishingBrain("approval", async () => {
    const held = await processGranolaZapierPayload(payload);
    const approvalId = held.approval!.id;

    await assert.rejects(approvePendingMeeting(approvalId), /No Discord meeting or standup channel/u);
    assert.equal(getApproval(approvalId)?.status, "pending");
    assert.equal(getMeetingRecord(meetingId)?.status, "publishing");

    pretendNotionPageWasCreated(meetingId);
    process.env.PERRY_DISCORD_DRY_RUN = "true";
    const approved = await approvePendingMeeting(approvalId);

    assert.equal(getApproval(approvalId)?.status, "posted");
    assert.equal(approved.record.status, "processed");
    assert.equal(approved.notionPageId, "notion-page-1");
  });
});

test("a forced re-run of a half-published meeting skips every finished step", async () => {
  await withPublishingBrain("auto", async () => {
    process.env.PERRY_DISCORD_DRY_RUN = "true";
    upsertMeetingRecord({
      id: meetingId,
      source: "granola",
      sourceId: "publish-note",
      title: "Publishing Review",
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
      notionPageId: "notion-page-1",
      notionUrl: "https://notion.so/page-1",
      discordMessageUrl: "https://discord.com/channels/1/2/3",
      status: "publishing",
    });

    const result = await processGranolaZapierPayload(payload, { force: true, bypassApproval: true });

    assert.equal(result.record.status, "processed");
    assert.equal(result.notionPageId, "notion-page-1");
    assert.equal(result.discordMessageUrl, "https://discord.com/channels/1/2/3");
  });
});

test("an ingestion job that runs out of attempts mid-publish marks its meeting failed, and a re-send resumes it", async () => {
  await withPublishingBrain("auto", async () => {
    const { job } = enqueueGranolaIngestionJob(payload);
    withDb((db) => db.prepare("UPDATE ingestion_jobs SET max_attempts = 1 WHERE id = ?").run(job.id));

    await assert.rejects(processNextGranolaIngestionJob(), /No Discord meeting or standup channel/u);

    assert.equal(listIngestionJobs()[0].status, "failed");
    const failed = getMeetingRecord(meetingId);
    assert.equal(failed?.status, "failed");
    assert.match(failed?.error ?? "", /No Discord meeting or standup channel/u);
    assert.ok(failed?.notionPageId, "a failed meeting keeps its finished steps");

    pretendNotionPageWasCreated(meetingId);
    process.env.PERRY_DISCORD_DRY_RUN = "true";
    const resent = await processGranolaZapierPayload(payload);
    assert.equal(resent.record.status, "processed");
    assert.equal(resent.record.error, undefined);
    assert.equal(resent.notionPageId, "notion-page-1");
  });
});
