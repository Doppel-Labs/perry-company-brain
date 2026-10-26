import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { closeBrainStore, createApproval, getApproval, listApprovals, updateApprovalStatus, withDb } from "@store";
import { processGranolaZapierPayload, rejectPendingMeeting } from "@ingestion";

async function withTempBrain(run: () => Promise<void> | void): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-approval-"));
  const previous = { db: process.env.PERRY_DB_PATH, config: process.env.PERRY_CONFIG_PATH };
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_CONFIG_PATH = join(tempDir, "perry.config.json");
  try {
    await run();
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    restoreEnv("PERRY_DB_PATH", previous.db);
    restoreEnv("PERRY_CONFIG_PATH", previous.config);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function auditCount(entityId: string): number {
  return withDb((db) =>
    Number((db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id = ?").get(entityId) as { count: number }).count)
  );
}

const approvalPayload = {
  note_id: "approval-note",
  title: "Approval Review",
  summary: "Decisions:\n- Keep Perry quiet by default.\n\nAction items:\n- Ada: Review the approval queue",
};

test("creates a pending approval by default instead of posting", async () => {
  await withTempBrain(async () => {
    const result = await processGranolaZapierPayload(approvalPayload);

    // Held for approval is not a dry run: the meeting and approval are stored.
    assert.equal(result.dryRun, false);
    assert.equal(result.record.status, "pending_approval");
    assert.equal(result.approval?.status, "pending");
    assert.equal(listApprovals("pending").length, 1);
    assert.equal(result.knowledge?.decisions.length, 1);
  });
});

test("a re-sent meeting does not reopen a rejected approval and keeps its createdAt", async () => {
  await withTempBrain(async () => {
    const first = await processGranolaZapierPayload(approvalPayload);
    const approvalId = first.approval!.id;
    const createdAt = getApproval(approvalId)!.createdAt;
    assert.equal(first.approval?.createdAt, createdAt);
    rejectPendingMeeting(approvalId);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const resent = await processGranolaZapierPayload({ ...approvalPayload, summary: `${approvalPayload.summary}\n- Bo: Late edit` });

    assert.equal(resent.approval?.status, "rejected");
    assert.equal(resent.approval?.createdAt, createdAt);
    assert.equal(getApproval(approvalId)?.status, "rejected");
    assert.equal(listApprovals("pending").length, 0);
  });
});

test("createApproval preserves posted approvals and refreshes pending ones", async () => {
  await withTempBrain(() => {
    const input = {
      id: "approval:test",
      meetingId: "granola:test",
      title: "Original",
      payloadJson: "{}",
      announcement: "first",
      knowledgeJson: "{}",
      routeJson: "{}",
      status: "pending" as const,
    };
    const created = createApproval(input);
    const refreshed = createApproval({ ...input, title: "Refreshed" });
    assert.equal(refreshed.title, "Refreshed");
    assert.equal(refreshed.createdAt, created.createdAt);

    updateApprovalStatus(input.id, "posted");
    const resent = createApproval({ ...input, title: "Resent" });
    assert.equal(resent.status, "posted");
    assert.equal(resent.title, "Refreshed");
  });
});

test("updateApprovalStatus audits only real changes", async () => {
  await withTempBrain(() => {
    assert.equal(updateApprovalStatus("approval:missing", "rejected"), undefined);
    assert.equal(auditCount("approval:missing"), 0);

    createApproval({
      id: "approval:audited",
      meetingId: "granola:audited",
      title: "Audited",
      payloadJson: "{}",
      announcement: "",
      knowledgeJson: "{}",
      routeJson: "{}",
      status: "pending",
    });
    const afterCreate = auditCount("approval:audited");
    assert.equal(updateApprovalStatus("approval:audited", "pending")?.status, "pending");
    assert.equal(auditCount("approval:audited"), afterCreate);
    assert.equal(updateApprovalStatus("approval:audited", "rejected")?.status, "rejected");
    assert.equal(auditCount("approval:audited"), afterCreate + 1);
  });
});
